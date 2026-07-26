import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SemanticWorkerService } from '../src/internalServer.js';
import { PostgresDownloadJobRepository } from '../src/jobs/jobRepository.js';
import { IndexJobRunner } from '../src/jobs/jobRunner.js';
import type { EmbeddingRuntime } from '../src/model/modelRuntime.js';
import { startWorkerPostgresTestContext } from './support/workerPostgresTestContext.js';

const model = MODEL_CATALOG['multilingual-e5-small'];

describe.sequential('PostgresDownloadJobRepository', () => {
  let context: Awaited<ReturnType<typeof startWorkerPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let repository: PostgresDownloadJobRepository | undefined;

  beforeAll(async () => {
    context = await startWorkerPostgresTestContext();
    pool = context.pool;
    repository = new PostgresDownloadJobRepository(pool);
  }, 120_000);

  beforeEach(async () => {
    await pool!.query(`delete from semantic_jobs; delete from semantic_embeddings`);
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'not_downloaded',
           downloaded_at = null,
           error = null,
           updated_at = clock_timestamp()`,
    );
    await pool!.query(
      `update semantic_index_state
       set active_model_code = $1,
           status = 'waiting_model',
           state_version = 7,
           processed_items = 0,
           total_items = 0,
           pending_items = 0,
           error = null,
           last_ready_at = null,
           updated_at = clock_timestamp()
       where singleton_key = true`,
      [model.code],
    );
  });

  afterAll(async () => {
    await context?.close();
  });

  async function enqueueDownload(): Promise<string> {
    const result = await pool!.query<{ id: string }>(
      `insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version,
         total_bytes
       )
       values ('download', $1, 'queued', 7, $2)
       returning id`,
      [model.code, model.expectedDownloadBytes],
    );
    return result.rows[0]!.id;
  }

  async function enqueueIndex(
    jobType: 'full_index' | 'incremental',
    entityId?: string,
  ): Promise<string> {
    const result = await pool!.query<{ id: string }>(
      `insert into semantic_jobs (
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version
       )
       values ($1, $2, $3, $4, 'queued', 7)
       returning id`,
      [
        jobType,
        model.code,
        jobType === 'incremental' ? 'event' : null,
        jobType === 'incremental' ? entityId : null,
      ],
    );
    return result.rows[0]!.id;
  }

  it('claims exclusively, renews an expired lease, and increments attempts', async () => {
    const id = await enqueueDownload();

    const first = await repository!.claimNextDownload('worker-a', 60_000);
    const blocked = await repository!.claimNextDownload('worker-b', 60_000);
    expect(first).toMatchObject({ id, attempts: 1 });
    expect(blocked).toBeNull();

    await pool!.query(
      `update semantic_jobs
       set lease_expires_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [id],
    );
    const reclaimed = await repository!.claimNextDownload('worker-b', 60_000);
    expect(reclaimed).toMatchObject({ id, attempts: 2 });
  });

  it('does not reclaim a live index lease and reclaims it after expiration', async () => {
    const id = await enqueueIndex('full_index');

    const first = await repository!.claimNextIndex('worker-a', 60_000);
    const blocked = await repository!.claimNextIndex('worker-b', 60_000);
    expect(first).toMatchObject({ id, jobType: 'full_index', attempts: 1 });
    expect(blocked).toBeNull();

    await pool!.query(
      `update semantic_jobs
       set lease_expires_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [id],
    );
    const reclaimed = await repository!.claimNextIndex('worker-b', 60_000);
    expect(reclaimed).toMatchObject({ id, jobType: 'full_index', attempts: 2 });
  });

  it('lets a restarted runner process only after the previous index lease expires', async () => {
    const id = await enqueueIndex('full_index');
    await repository!.claimNextIndex('stopped-worker', 60_000);

    const builtJobs: string[] = [];
    const restartedRunner = new IndexJobRunner({
      repository: repository!,
      builder: {
        buildFull: async (job) => {
          builtJobs.push(job.id);
        },
        buildIncremental: async () => {
          throw new Error('unexpected incremental job');
        },
      },
      workerId: 'restarted-worker',
    });

    await expect(restartedRunner.runOnce()).resolves.toBe(false);
    expect(builtJobs).toEqual([]);

    await pool!.query(
      `update semantic_jobs
       set lease_expires_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [id],
    );

    await expect(restartedRunner.runOnce()).resolves.toBe(true);
    expect(builtJobs).toEqual([id]);
    const result = await pool!.query<{ jobs: number }>(
      `select count(*)::int as jobs
       from semantic_jobs
       where id = $1`,
      [id],
    );
    expect(result.rows).toEqual([{ jobs: 0 }]);
  });

  it('restores the active model when the worker restarts during incremental updates', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = $1`,
      [model.code],
    );
    await pool!.query(
      `update semantic_index_state
       set status = 'updating',
           pending_items = 1
       where singleton_key = true`,
    );

    await expect(repository!.findReadyActiveModel()).resolves.toEqual({
      modelCode: model.code,
      revision: model.revision,
    });
  });

  it('loads a lightweight model adapter after restarting during incremental updates', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = $1`,
      [model.code],
    );
    await pool!.query(
      `update semantic_index_state
       set status = 'updating',
           pending_items = 1
       where singleton_key = true`,
    );
    const loadedPaths: string[] = [];
    const runtime: EmbeddingRuntime = {
      load: async (_definition, localPath) => {
        loadedPaths.push(localPath);
      },
      embedQuery: async () => Array.from({ length: model.dimensions }, () => 0),
      embedDocuments: async (documents) =>
        documents.map(() => Array.from({ length: model.dimensions }, () => 0)),
      dispose: async () => undefined,
    };
    const service = new SemanticWorkerService({
      repository: repository!,
      runtime,
      modelsDirectory: '/models',
      verifyModel: async () => true,
    });

    await service.initialize();

    expect(service.health()).toEqual({
      status: 'ok',
      modelLoaded: true,
      activeModelCode: model.code,
    });
    expect(loadedPaths).toEqual([`/models/${model.code}/${model.revision}`]);
    await expect(service.embedQuery(model.code, '重启恢复查询')).resolves.toMatchObject({
      modelCode: model.code,
      dimensions: model.dimensions,
    });
  });

  it('completes full and incremental index jobs with consistent state', async () => {
    const fullId = await enqueueIndex('full_index');
    await repository!.claimNextIndex('full-worker', 60_000);
    await repository!.completeIndex(fullId, 'full-worker');

    const full = await pool!.query<{ jobs: number }>(
      `select count(*)::int as jobs
       from semantic_jobs
       where id = $1`,
      [fullId],
    );
    expect(full.rows).toEqual([{ jobs: 0 }]);

    await pool!.query(
      `update semantic_index_state
       set status = 'updating',
           pending_items = 1
       where singleton_key = true`,
    );
    const incrementalId = await enqueueIndex('incremental', '10000000-0000-4000-8000-000000000090');
    await repository!.claimNextIndex('incremental-worker', 60_000);
    await repository!.completeIndex(incrementalId, 'incremental-worker');

    const incremental = await pool!.query<{
      jobs: number;
      pending_items: number;
      status: string;
    }>(
      `select state.status,
              state.pending_items,
              (
                select count(*)::int
                from semantic_jobs
                where id = $1
              ) as jobs
       from semantic_index_state as state
       where state.singleton_key = true`,
      [incrementalId],
    );
    expect(incremental.rows).toEqual([{ status: 'ready', pending_items: 0, jobs: 0 }]);
  });

  it('requeues two index failures and records a bounded terminal failure on attempt three', async () => {
    const id = await enqueueIndex('full_index');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await repository!.claimNextIndex(`index-worker-${attempt}`, 60_000);
      await repository!.failIndex(id, `index-worker-${attempt}`, '索引失败'.repeat(200));
    }

    const result = await pool!.query<{
      attempts: number;
      completed: boolean;
      error_length: number;
      job_status: string;
      pending_items: number;
      state_status: string;
    }>(
      `select job.attempts,
              job.status as job_status,
              state.status as state_status,
              state.pending_items,
              length(job.error)::int as error_length,
              job.completed_at is not null as completed
       from semantic_jobs as job
       join semantic_index_state as state
         on state.singleton_key = true
       where job.id = $1`,
      [id],
    );
    expect(result.rows).toEqual([
      {
        attempts: 3,
        job_status: 'failed',
        state_status: 'failed',
        pending_items: 0,
        error_length: 500,
        completed: true,
      },
    ]);
  });

  it('keeps the existing index usable when one incremental job reaches terminal failure', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = $1`,
      [model.code],
    );
    await pool!.query(
      `update semantic_index_state
       set status = 'updating',
           pending_items = 1
       where singleton_key = true`,
    );
    const id = await enqueueIndex('incremental', '10000000-0000-4000-8000-000000000090');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await repository!.claimNextIndex(`incremental-worker-${attempt}`, 60_000);
      await repository!.failIndex(id, `incremental-worker-${attempt}`, '单条增量索引失败');
    }

    const result = await pool!.query<{
      job_status: string;
      pending_items: number;
      state_error: string | null;
      state_status: string;
    }>(
      `select job.status as job_status,
              state.status as state_status,
              state.pending_items,
              state.error as state_error
       from semantic_jobs as job
       join semantic_index_state as state on state.singleton_key = true
       where job.id = $1`,
      [id],
    );
    expect(result.rows).toEqual([
      {
        job_status: 'failed',
        state_status: 'ready',
        pending_items: 0,
        state_error: '单条增量索引失败',
      },
    ]);
  });

  it('removes an older failed incremental job after a newer update succeeds', async () => {
    await pool!.query(
      `update semantic_index_state
       set status = 'updating',
           pending_items = 1
       where singleton_key = true;
       insert into semantic_jobs (
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version,
         attempts,
         started_at,
         completed_at,
         error
       )
       values (
         'incremental',
         '${model.code}',
         'event',
         '10000000-0000-4000-8000-000000000090',
         'failed',
         7,
         3,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         '旧增量任务失败'
       )`,
    );
    const currentId = await enqueueIndex('incremental', '10000000-0000-4000-8000-000000000090');
    await repository!.claimNextIndex('incremental-worker', 60_000);

    await repository!.completeIndex(currentId, 'incremental-worker');

    const result = await pool!.query<{ jobs: number; status: string }>(
      `select state.status,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'incremental'
                  and entity_type = 'event'
                  and entity_id = '10000000-0000-4000-8000-000000000090'
              ) as jobs
       from semantic_index_state as state
       where singleton_key = true`,
    );
    expect(result.rows).toEqual([{ status: 'ready', jobs: 0 }]);
  });

  it('publishes a verified download and queues exactly one full index', async () => {
    const id = await enqueueDownload();
    await repository!.claimNextDownload('worker-a', 60_000);

    await repository!.markDownloading(id, 'worker-a');
    await repository!.updateDownloadProgress(id, 'worker-a', model.expectedDownloadBytes);
    await repository!.markVerifying(id, 'worker-a');
    await repository!.completeDownload(id, 'worker-a');

    const settings = await pool!.query<{
      file_status: string;
      state_status: string;
      download_jobs: number;
      full_index_jobs: number;
    }>(
      `select settings.file_status,
              state.status as state_status,
              (
                select count(*)::int
                from semantic_jobs
                where id = $1
              ) as download_jobs,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'full_index'
                  and status = 'queued'
              ) as full_index_jobs
       from semantic_model_settings as settings
       join semantic_index_state as state
         on state.active_model_code = settings.model_code
       where settings.model_code = $2`,
      [id, model.code],
    );
    expect(settings.rows).toEqual([
      {
        file_status: 'downloaded',
        state_status: 'loading',
        download_jobs: 0,
        full_index_jobs: 1,
      },
    ]);
  });

  it('requeues two failures and records a bounded terminal failure on attempt three', async () => {
    const id = await enqueueDownload();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await repository!.claimNextDownload(`worker-${attempt}`, 60_000);
      await repository!.failDownload(id, `worker-${attempt}`, '失败'.repeat(400));
    }

    const result = await pool!.query<{
      attempts: number;
      job_status: string;
      model_status: string;
      state_status: string;
      error_length: number;
    }>(
      `select job.attempts,
              job.status as job_status,
              settings.file_status as model_status,
              state.status as state_status,
              length(job.error)::int as error_length
       from semantic_jobs as job
       join semantic_model_settings as settings
         on settings.model_code = job.model_code
       join semantic_index_state as state
         on state.active_model_code = job.model_code
       where job.id = $1`,
      [id],
    );
    expect(result.rows).toEqual([
      {
        attempts: 3,
        job_status: 'failed',
        model_status: 'failed',
        state_status: 'failed',
        error_length: 500,
      },
    ]);
  });
});
