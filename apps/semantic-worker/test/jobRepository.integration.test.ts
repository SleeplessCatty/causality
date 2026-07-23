import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresDownloadJobRepository } from '../src/jobs/jobRepository.js';
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
       set download_status = 'not_downloaded',
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

  it('publishes a verified download and queues exactly one full index', async () => {
    const id = await enqueueDownload();
    await repository!.claimNextDownload('worker-a', 60_000);

    await repository!.markDownloading(id, 'worker-a');
    await repository!.updateDownloadProgress(id, 'worker-a', model.expectedDownloadBytes);
    await repository!.markVerifying(id, 'worker-a');
    await repository!.completeDownload(id, 'worker-a');

    const settings = await pool!.query<{
      download_status: string;
      state_status: string;
      download_job_status: string;
      full_index_jobs: number;
    }>(
      `select settings.download_status,
              state.status as state_status,
              download_job.status as download_job_status,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'full_index'
                  and status = 'queued'
              ) as full_index_jobs
       from semantic_model_settings as settings
       join semantic_index_state as state
         on state.active_model_code = settings.model_code
       join semantic_jobs as download_job
         on download_job.id = $1
       where settings.model_code = $2`,
      [id, model.code],
    );
    expect(settings.rows).toEqual([
      {
        download_status: 'downloaded',
        state_status: 'loading',
        download_job_status: 'succeeded',
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
              settings.download_status as model_status,
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
