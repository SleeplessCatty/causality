import type { SemanticModelCode } from '@causality/semantic-core';
import type { Pool } from 'pg';

import type { DownloadJob, DownloadJobRepository, ReadyActiveModel } from './jobTypes.js';
import {
  boundedJobError,
  lockIndexState,
  lockOwnedJob,
  renewJobLease,
  WorkerLeaseLostError,
  withJobTransaction,
} from './postgresJobSupport.js';

interface DownloadJobRow {
  id: string;
  model_code: SemanticModelCode;
  state_version: number;
  attempts: number;
  total_bytes: number;
}

function mapDownloadJob(row: DownloadJobRow): DownloadJob {
  return {
    id: row.id,
    modelCode: row.model_code,
    stateVersion: row.state_version,
    attempts: row.attempts,
    totalBytes: row.total_bytes,
  };
}

export class PostgresDownloadJobRepository implements DownloadJobRepository {
  public constructor(private readonly pool: Pool) {}

  public async claimNextDownload(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<DownloadJob | null> {
    const result = await this.pool.query<DownloadJobRow>(
      `with candidate as (
         select id
         from semantic_jobs
         where job_type = 'download'
           and (
             status = 'queued'
             or (status = 'running' and lease_expires_at <= clock_timestamp())
           )
         order by created_at, id
         limit 1
         for update skip locked
       )
       update semantic_jobs as job
       set status = 'running',
           phase = 'waiting',
           attempts = job.attempts + 1,
           lease_owner = $1,
           lease_expires_at = clock_timestamp() + ($2::integer * interval '1 millisecond'),
           started_at = case
             when job.status = 'queued' then clock_timestamp()
             else job.started_at
           end,
           completed_at = null,
           error = null,
           updated_at = clock_timestamp()
       from candidate
       where job.id = candidate.id
       returning job.id,
                 job.model_code,
                 job.state_version,
                 job.attempts,
                 job.total_bytes`,
      [workerId, leaseMilliseconds],
    );
    return result.rows[0] ? mapDownloadJob(result.rows[0]) : null;
  }

  public renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void> {
    return renewJobLease(this.pool, jobId, workerId, leaseMilliseconds);
  }

  public async markDownloading(jobId: string, workerId: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      const job = await lockOwnedJob(client, jobId, workerId);
      await client.query(
        `update semantic_model_settings
         set file_status = 'downloading',
             downloaded_at = null,
             failure_kind = null,
             failure_code = null,
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code],
      );
      await client.query(
        `update semantic_jobs
         set phase = 'downloading',
             updated_at = clock_timestamp()
         where id = $1`,
        [job.id],
      );
    });
  }

  public async updateDownloadProgress(
    jobId: string,
    workerId: string,
    loadedBytes: number,
  ): Promise<void> {
    const result = await this.pool.query(
      `update semantic_jobs
       set downloaded_bytes = $3,
           updated_at = clock_timestamp()
       where id = $1
         and status = 'running'
         and lease_owner = $2
         and $3 between downloaded_bytes and total_bytes`,
      [jobId, workerId, loadedBytes],
    );
    if (result.rowCount !== 1) throw new WorkerLeaseLostError();
  }

  public async markVerifying(jobId: string, workerId: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      const job = await lockOwnedJob(client, jobId, workerId);
      await client.query(
        `update semantic_model_settings
         set file_status = 'verifying',
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code],
      );
      await client.query(
        `update semantic_jobs
         set phase = 'verifying',
             updated_at = clock_timestamp()
         where id = $1`,
        [job.id],
      );
    });
  }

  public async completeDownload(jobId: string, workerId: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      await client.query(
        `update semantic_model_settings
         set file_status = 'downloaded',
             downloaded_at = clock_timestamp(),
             failure_kind = null,
             failure_code = null,
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code],
      );
      await client.query(
        `delete from semantic_jobs
         where id = $1
           and status = 'running'
           and lease_owner = $2`,
        [job.id, workerId],
      );

      const activeState = await client.query(
        `update semantic_index_state
         set status = 'loading',
             processed_items = 0,
             total_items = 0,
             pending_items = 0,
             failed_items = 0,
             failure_stage = null,
             failure_kind = null,
             failure_code = null,
             error = null,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [job.model_code, job.state_version],
      );
      if (activeState.rowCount === 1) {
        await client.query(
          `insert into semantic_jobs (
             job_type,
             model_code,
             status,
             state_version
           )
           select 'full_index',
                  $1::varchar(64),
                  'queued',
                  $2::integer
           where not exists (
             select 1
             from semantic_jobs
             where job_type = 'full_index'
               and model_code = $1::varchar(64)
               and state_version = $2::integer
               and status in ('queued', 'running')
           )`,
          [job.model_code, job.state_version],
        );
      }
    });
  }

  public async failDownload(jobId: string, workerId: string, error: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      const finalFailure = job.attempts >= 3;
      const message = boundedJobError(error);

      await client.query(
        `update semantic_jobs
         set status = $3::varchar(20),
             phase = case
               when $3::varchar(20) = 'failed' then phase
               else 'waiting'
             end,
             lease_owner = null,
             lease_expires_at = null,
             next_attempt_at = null,
             failure_kind = null,
             failure_code = null,
             started_at = case
               when $3::varchar(20) = 'failed' then started_at
               else null
             end,
             completed_at = case
               when $3::varchar(20) = 'failed' then clock_timestamp()
               else null
             end,
             error = $4::text,
             updated_at = clock_timestamp()
         where id = $1
           and lease_owner = $2`,
        [job.id, workerId, finalFailure ? 'failed' : 'queued', message],
      );
      await client.query(
        `update semantic_model_settings
         set file_status = $2::varchar(20),
             downloaded_at = null,
             failure_kind = null,
             failure_code = null,
             error = $3,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code, finalFailure ? 'failed' : 'not_downloaded', message],
      );
      await client.query(
        `update semantic_index_state
         set status = $3::varchar(20),
             failed_items = 0,
             failure_stage = null,
             failure_kind = null,
             failure_code = null,
             error = $4,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [job.model_code, job.state_version, finalFailure ? 'failed' : 'waiting_model', message],
      );
    });
  }

  public async findReadyActiveModel(): Promise<ReadyActiveModel | null> {
    const result = await this.pool.query<{
      model_code: SemanticModelCode;
      revision: string;
    }>(
      `select settings.model_code,
              settings.revision
       from semantic_index_state as state
       join semantic_model_settings as settings
         on settings.model_code = state.active_model_code
       where state.singleton_key = true
         and state.status in ('ready', 'updating')
         and settings.file_status = 'downloaded'`,
    );
    const row = result.rows[0];
    return row ? { modelCode: row.model_code, revision: row.revision } : null;
  }

  public async markActiveModelUnavailable(
    modelCode: SemanticModelCode,
    error: string,
  ): Promise<void> {
    const message = boundedJobError(error);
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      await client.query(
        `update semantic_model_settings
         set file_status = 'failed',
             downloaded_at = null,
             error = $2,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [modelCode, message],
      );
      await client.query(
        `update semantic_index_state
         set status = 'failed',
             error = $2,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1`,
        [modelCode, message],
      );
    });
  }
}
