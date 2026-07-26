import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SemanticWorkerService } from '../src/internalServer.js';
import { PostgresDownloadJobRepository } from '../src/jobs/downloadJobRepository.js';
import { PostgresIndexJobRepository } from '../src/jobs/indexJobRepository.js';
import { IndexJobRunner } from '../src/jobs/jobRunner.js';
import type { EmbeddingRuntime } from '../src/model/modelRuntime.js';
import { startWorkerPostgresTestContext } from './support/workerPostgresTestContext.js';

const model = MODEL_CATALOG['multilingual-e5-small'];

describe.sequential('semantic job repositories', () => {
  let context: Awaited<ReturnType<typeof startWorkerPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let downloadRepository: PostgresDownloadJobRepository | undefined;
  let indexRepository: PostgresIndexJobRepository | undefined;

  beforeAll(async () => {
    context = await startWorkerPostgresTestContext();
    pool = context.pool;
    downloadRepository = new PostgresDownloadJobRepository(pool);
    indexRepository = new PostgresIndexJobRepository(pool);
  }, 120_000);

  beforeEach(async () => {
    await pool!.query(`delete from semantic_jobs; delete from semantic_embeddings`);
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'not_downloaded',
           downloaded_at = null,
           failure_kind = null,
           failure_code = null,
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
           failed_items = 0,
           failure_stage = null,
           failure_kind = null,
           failure_code = null,
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

  async function enqueueLoad(): Promise<string> {
    const result = await pool!.query<{ id: string }>(
      `insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version
       )
       values ('load', $1, 'queued', 7)
       returning id`,
      [model.code],
    );
    return result.rows[0]!.id;
  }

  async function prepareDownloadedModelForLoad(): Promise<void> {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = $1`,
      [model.code],
    );
    await pool!.query(
      `update semantic_index_state
       set status = 'loading'
       where singleton_key = true`,
    );
  }

  it('claims exclusively, renews an expired lease, and increments attempts', async () => {
    const id = await enqueueDownload();

    const first = await downloadRepository!.claimNextDownload('worker-a', 60_000);
    const blocked = await downloadRepository!.claimNextDownload('worker-b', 60_000);
    expect(first).toMatchObject({ id, attempts: 1 });
    expect(blocked).toBeNull();

    await pool!.query(
      `update semantic_jobs
       set lease_expires_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [id],
    );
    const reclaimed = await downloadRepository!.claimNextDownload('worker-b', 60_000);
    expect(reclaimed).toMatchObject({ id, attempts: 2 });
  });

  it('does not reclaim a live index lease and reclaims it after expiration', async () => {
    const id = await enqueueIndex('full_index');

    const first = await indexRepository!.claimNextIndex('worker-a', 60_000);
    const blocked = await indexRepository!.claimNextIndex('worker-b', 60_000);
    expect(first).toMatchObject({ id, jobType: 'full_index', attempts: 1 });
    expect(blocked).toBeNull();

    await pool!.query(
      `update semantic_jobs
       set lease_expires_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [id],
    );
    const reclaimed = await indexRepository!.claimNextIndex('worker-b', 60_000);
    expect(reclaimed).toMatchObject({ id, jobType: 'full_index', attempts: 2 });
  });

  it('lets a restarted runner process only after the previous index lease expires', async () => {
    const id = await enqueueIndex('full_index');
    await indexRepository!.claimNextIndex('stopped-worker', 60_000);

    const builtJobs: string[] = [];
    const restartedRunner = new IndexJobRunner({
      repository: indexRepository!,
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

    await expect(downloadRepository!.findReadyActiveModel()).resolves.toEqual({
      modelCode: model.code,
      revision: model.revision,
    });
  });

  it('restores the loaded runtime before resuming a queued full index after restart', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = $1`,
      [model.code],
    );
    await pool!.query(
      `update semantic_index_state
       set status = 'index_queued'
       where singleton_key = true`,
    );

    await expect(downloadRepository!.findReadyActiveModel()).resolves.toEqual({
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
      repository: downloadRepository!,
      runtime,
      modelsDirectory: '/models',
      validateModel: async () => undefined,
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
    await indexRepository!.claimNextIndex('full-worker', 60_000);
    await indexRepository!.completeIndex(fullId, 'full-worker');

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
    await indexRepository!.claimNextIndex('incremental-worker', 60_000);
    await indexRepository!.completeIndex(incrementalId, 'incremental-worker');

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
      await indexRepository!.claimNextIndex(`index-worker-${attempt}`, 60_000);
      await indexRepository!.failIndex(id, `index-worker-${attempt}`, '索引失败'.repeat(200));
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
      await indexRepository!.claimNextIndex(`incremental-worker-${attempt}`, 60_000);
      await indexRepository!.failIndex(id, `incremental-worker-${attempt}`, '单条增量索引失败');
    }

    const result = await pool!.query<{
      failed_items: number;
      job_status: string;
      pending_items: number;
      state_error: string | null;
      state_status: string;
    }>(
      `select job.status as job_status,
              state.status as state_status,
              state.pending_items,
              state.failed_items,
              state.error as state_error
       from semantic_jobs as job
       join semantic_index_state as state on state.singleton_key = true
       where job.id = $1`,
      [id],
    );
    expect(result.rows).toEqual([
      {
        job_status: 'failed',
        state_status: 'incomplete',
        pending_items: 0,
        failed_items: 1,
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
    await indexRepository!.claimNextIndex('incremental-worker', 60_000);

    await indexRepository!.completeIndex(currentId, 'incremental-worker');

    const result = await pool!.query<{
      failed_items: number;
      jobs: number;
      pending_items: number;
      status: string;
    }>(
      `select state.status,
              state.pending_items,
              state.failed_items,
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
    expect(result.rows).toEqual([{ status: 'ready', pending_items: 0, failed_items: 0, jobs: 0 }]);
  });

  it('replaces an older failed incremental record when its newer update also fails', async () => {
    const entityId = '10000000-0000-4000-8000-000000000090';
    await pool!.query(
      `update semantic_index_state
       set status = 'incomplete',
           failed_items = 1
       where singleton_key = true`,
    );
    await pool!.query(
      `insert into semantic_jobs (
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
         $1,
         'event',
         $2,
         'failed',
         7,
         3,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         '旧增量任务失败'
      )`,
      [model.code, entityId],
    );
    const currentId = await enqueueIndex('incremental', entityId);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const workerId = `replacement-worker-${attempt}`;
      await indexRepository!.claimNextIndex(workerId, 60_000);
      await indexRepository!.failIndex(currentId, workerId, '更新后的记录仍无法建立索引');
    }

    const result = await pool!.query<{
      failed_items: number;
      failures: number;
      pending_items: number;
      status: string;
    }>(
      `select state.status,
              state.pending_items,
              state.failed_items,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'incremental'
                  and status = 'failed'
                  and model_code = $1
                  and state_version = 7
                  and entity_type = 'event'
                  and entity_id = $2
              ) as failures
       from semantic_index_state as state
       where state.singleton_key = true`,
      [model.code, entityId],
    );
    expect(result.rows).toEqual([
      { status: 'incomplete', pending_items: 0, failed_items: 1, failures: 1 },
    ]);
  });

  it('publishes a verified download and queues exactly one load job', async () => {
    const id = await enqueueDownload();
    await downloadRepository!.claimNextDownload('worker-a', 60_000);

    await downloadRepository!.markDownloading(id, 'worker-a');
    await downloadRepository!.updateDownloadProgress(id, 'worker-a', model.expectedDownloadBytes);
    await downloadRepository!.markVerifying(id, 'worker-a');
    await downloadRepository!.completeDownload(id, 'worker-a');

    const settings = await pool!.query<{
      file_status: string;
      state_status: string;
      download_jobs: number;
      load_jobs: number;
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
                where job_type = 'load'
                  and status = 'queued'
              ) as load_jobs,
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
        load_jobs: 1,
        full_index_jobs: 0,
      },
    ]);
  });

  it('schedules retryable download failures after 5 and 30 seconds before attempt three fails', async () => {
    const id = await enqueueDownload();
    const failure = {
      kind: 'retryable' as const,
      code: 'DOWNLOAD_NETWORK_ERROR' as const,
      message: 'connection reset',
    };

    async function readAttempt() {
      const result = await pool!.query<{
        attempts: number;
        failure_code: string | null;
        failure_kind: string | null;
        seconds_until_retry: number | null;
        status: string;
      }>(
        `select attempts,
                status,
                failure_kind,
                failure_code,
                case
                  when next_attempt_at is null then null
                  else round(extract(epoch from (next_attempt_at - clock_timestamp())))::int
                end as seconds_until_retry
         from semantic_jobs
         where id = $1`,
        [id],
      );
      return result.rows[0]!;
    }

    await downloadRepository!.claimNextDownload('worker-1', 60_000);
    await downloadRepository!.failDownload(id, 'worker-1', 'download', failure);
    expect(await readAttempt()).toMatchObject({
      status: 'retry_wait',
      attempts: 1,
      failure_kind: 'retryable',
      failure_code: 'DOWNLOAD_NETWORK_ERROR',
      seconds_until_retry: 5,
    });
    await expect(downloadRepository!.claimNextDownload('worker-early', 60_000)).resolves.toBeNull();

    await pool!.query(
      `update semantic_jobs
       set next_attempt_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [id],
    );
    await downloadRepository!.claimNextDownload('worker-2', 60_000);
    await downloadRepository!.failDownload(id, 'worker-2', 'download', failure);
    expect(await readAttempt()).toMatchObject({
      status: 'retry_wait',
      attempts: 2,
      seconds_until_retry: 30,
    });

    await pool!.query(
      `update semantic_jobs
       set next_attempt_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [id],
    );
    await downloadRepository!.claimNextDownload('worker-3', 60_000);
    await downloadRepository!.failDownload(id, 'worker-3', 'download', failure);
    expect(await readAttempt()).toMatchObject({
      status: 'failed',
      attempts: 3,
      seconds_until_retry: null,
    });
  });

  it('marks a manual verification failure invalid without queuing another download', async () => {
    const id = await enqueueDownload();
    await downloadRepository!.claimNextDownload('worker-a', 60_000);

    await downloadRepository!.failDownload(id, 'worker-a', 'verify', {
      kind: 'manual',
      code: 'MODEL_HASH_MISMATCH',
      message: 'Model file checksum mismatch: model.onnx',
    });

    const result = await pool!.query<{
      download_jobs: number;
      failure_code: string | null;
      file_status: string;
      index_status: string;
      job_phase: string;
      job_status: string;
    }>(
      `select settings.file_status,
              settings.failure_code,
              state.status as index_status,
              job.phase as job_phase,
              job.status as job_status,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'download'
                  and status in ('queued', 'running', 'retry_wait')
              ) as download_jobs
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
        file_status: 'invalid',
        failure_code: 'MODEL_HASH_MISMATCH',
        index_status: 'waiting_model',
        job_phase: 'verifying',
        job_status: 'failed',
        download_jobs: 0,
      },
    ]);
  });

  it('publishes a successful load and queues exactly one full index job', async () => {
    await prepareDownloadedModelForLoad();
    const id = await enqueueLoad();

    await downloadRepository!.claimNextLoad('load-worker', 60_000);
    await downloadRepository!.markLoading(id, 'load-worker');
    await downloadRepository!.completeLoad(id, 'load-worker');

    const result = await pool!.query<{
      full_index_jobs: number;
      load_jobs: number;
      state_status: string;
    }>(
      `select state.status as state_status,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'load'
              ) as load_jobs,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'full_index'
                  and status = 'queued'
              ) as full_index_jobs
       from semantic_index_state as state
       where state.singleton_key = true`,
    );
    expect(result.rows).toEqual([
      { state_status: 'index_queued', load_jobs: 0, full_index_jobs: 1 },
    ]);
  });

  it('keeps downloaded files while a retryable load failure waits for retry', async () => {
    await prepareDownloadedModelForLoad();
    const id = await enqueueLoad();
    await downloadRepository!.claimNextLoad('load-worker', 60_000);

    await downloadRepository!.failLoad(id, 'load-worker', 'load', {
      kind: 'retryable',
      code: 'MODEL_LOAD_TRANSIENT',
      message: 'runtime busy',
    });

    const result = await pool!.query<{
      failure_code: string | null;
      file_status: string;
      job_status: string;
      state_status: string;
    }>(
      `select settings.file_status,
              state.status as state_status,
              job.status as job_status,
              job.failure_code
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
        file_status: 'downloaded',
        state_status: 'loading',
        job_status: 'retry_wait',
        failure_code: 'MODEL_LOAD_TRANSIENT',
      },
    ]);
  });

  it('invalidates files when pre-load validation fails without queuing a download', async () => {
    await prepareDownloadedModelForLoad();
    const id = await enqueueLoad();
    await enqueueIndex('full_index');
    await downloadRepository!.claimNextLoad('load-worker', 60_000);

    await downloadRepository!.failLoad(id, 'load-worker', 'verify', {
      kind: 'manual',
      code: 'MODEL_SIZE_MISMATCH',
      message: 'Model file size mismatch: model.onnx',
    });

    const result = await pool!.query<{
      active_downloads: number;
      file_status: string;
      full_index_jobs: number;
      load_jobs: number;
      state_status: string;
    }>(
      `select settings.file_status,
              state.status as state_status,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'load'
              ) as load_jobs,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'full_index'
              ) as full_index_jobs,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'download'
                  and status in ('queued', 'running', 'retry_wait')
              ) as active_downloads
       from semantic_model_settings as settings
       join semantic_index_state as state
         on state.active_model_code = settings.model_code
       where settings.model_code = $1`,
      [model.code],
    );
    expect(result.rows).toEqual([
      {
        file_status: 'invalid',
        state_status: 'waiting_model',
        load_jobs: 0,
        full_index_jobs: 0,
        active_downloads: 0,
      },
    ]);
  });
});
