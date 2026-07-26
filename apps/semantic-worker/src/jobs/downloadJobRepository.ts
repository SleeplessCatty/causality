import type { SemanticModelCode } from '@causality/semantic-core';
import type { Pool } from 'pg';

import type { ClassifiedSemanticFailure, SemanticFailureStage } from './failureClassifier.js';
import type {
  DownloadJob,
  DownloadJobRepository,
  LoadJobRepository,
  ReadyActiveModel,
  SemanticLoadJob,
} from './jobTypes.js';
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

interface LoadJobRow {
  id: string;
  model_code: SemanticModelCode;
  state_version: number;
  attempts: number;
}

function mapLoadJob(row: LoadJobRow): SemanticLoadJob {
  return {
    id: row.id,
    jobType: 'load',
    modelCode: row.model_code,
    stateVersion: row.state_version,
    attempts: row.attempts,
  };
}

export class PostgresDownloadJobRepository implements DownloadJobRepository, LoadJobRepository {
  public constructor(private readonly pool: Pool) {}

  public async claimNextDownload(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<DownloadJob | null> {
    return withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const result = await client.query<DownloadJobRow>(
        `with stale as (
         delete from semantic_jobs as stale_job
         where not exists (
           select 1
           from semantic_index_state as current_state
           where current_state.singleton_key = true
             and current_state.active_model_code = stale_job.model_code
             and current_state.state_version = stale_job.state_version
         )
       ),
       candidate as (
         select job.id
         from semantic_jobs as job
         join semantic_index_state as state
           on state.singleton_key = true
          and state.active_model_code = job.model_code
          and state.state_version = job.state_version
         where job.job_type = 'download'
           and state.status = 'waiting_model'
           and (
             job.status = 'queued'
             or (job.status = 'retry_wait' and job.next_attempt_at <= clock_timestamp())
             or (job.status = 'running' and job.lease_expires_at <= clock_timestamp())
           )
           and not exists (
             select 1
             from semantic_jobs as active
             where active.id <> job.id
               and active.job_type in ('download', 'load', 'full_index')
               and active.status = 'running'
               and active.lease_expires_at > clock_timestamp()
           )
         order by job.created_at, job.id
         limit 1
         for update of job skip locked
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
           next_attempt_at = null,
           failure_kind = null,
           failure_code = null,
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
    });
  }

  public renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void> {
    return renewJobLease(this.pool, jobId, workerId, leaseMilliseconds);
  }

  public async releaseLease(jobId: string, workerId: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const candidate = await client.query<{
        job_type: string;
        model_code: SemanticModelCode;
      }>(
        `select job_type, model_code
         from semantic_jobs
         where id = $1
           and status = 'running'
           and lease_owner = $2`,
        [jobId, workerId],
      );
      const job = candidate.rows[0];
      if (!job) return;
      if (job.job_type === 'download') {
        await client.query(
          `update semantic_model_settings
           set file_status = 'download_queued',
               downloaded_at = null,
               failure_kind = null,
               failure_code = null,
               error = null,
               updated_at = clock_timestamp()
           where model_code = $1`,
          [job.model_code],
        );
      }
      await client.query(
        `update semantic_jobs
         set status = 'queued',
             phase = 'waiting',
             attempts = greatest(attempts - 1, 0),
             downloaded_bytes = case when job_type = 'download' then 0 else downloaded_bytes end,
             lease_owner = null,
             lease_expires_at = null,
             next_attempt_at = null,
             started_at = null,
             completed_at = null,
             failure_kind = null,
             failure_code = null,
             error = null,
             updated_at = clock_timestamp()
         where id = $1
           and status = 'running'
           and lease_owner = $2`,
        [jobId, workerId],
      );
    });
  }

  public async claimNextLoad(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<SemanticLoadJob | null> {
    return withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const result = await client.query<LoadJobRow>(
        `with stale as (
         delete from semantic_jobs as stale_job
         where not exists (
           select 1
           from semantic_index_state as current_state
           where current_state.singleton_key = true
             and current_state.active_model_code = stale_job.model_code
             and current_state.state_version = stale_job.state_version
         )
       ),
       candidate as (
         select job.id
         from semantic_jobs as job
         join semantic_index_state as state
           on state.singleton_key = true
          and state.active_model_code = job.model_code
          and state.state_version = job.state_version
         where job.job_type = 'load'
           and state.status = 'loading'
           and (
             job.status = 'queued'
             or (job.status = 'retry_wait' and job.next_attempt_at <= clock_timestamp())
             or (job.status = 'running' and job.lease_expires_at <= clock_timestamp())
           )
           and not exists (
             select 1
             from semantic_jobs as active
             where active.id <> job.id
               and active.job_type in ('download', 'load', 'full_index')
               and active.status = 'running'
               and active.lease_expires_at > clock_timestamp()
           )
         order by job.created_at, job.id
         limit 1
         for update of job skip locked
       )
       update semantic_jobs as job
       set status = 'running',
           phase = 'loading',
           attempts = job.attempts + 1,
           lease_owner = $1,
           lease_expires_at = clock_timestamp() + ($2::integer * interval '1 millisecond'),
           started_at = case
             when job.status = 'queued' then clock_timestamp()
             else job.started_at
           end,
           completed_at = null,
           next_attempt_at = null,
           failure_kind = null,
           failure_code = null,
           error = null,
           updated_at = clock_timestamp()
       from candidate
       where job.id = candidate.id
       returning job.id,
                 job.model_code,
                 job.state_version,
                 job.attempts`,
        [workerId, leaseMilliseconds],
      );
      return result.rows[0] ? mapLoadJob(result.rows[0]) : null;
    });
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
           select 'load',
                  $1::varchar(64),
                  'queued',
                  $2::integer
           where not exists (
             select 1
             from semantic_jobs
             where job_type = 'load'
               and model_code = $1::varchar(64)
               and state_version = $2::integer
               and status in ('queued', 'running', 'retry_wait')
           )`,
          [job.model_code, job.state_version],
        );
      }
    });
  }

  public async markLoading(jobId: string, workerId: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      const job = await lockOwnedJob(client, jobId, workerId);
      if (job.job_type !== 'load') throw new Error('Expected a load job');
      await client.query(
        `update semantic_index_state
         set status = 'loading',
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
    });
  }

  public async completeLoad(jobId: string, workerId: string): Promise<boolean> {
    return withJobTransaction(this.pool, async (client) => {
      const state = await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      if (job.job_type !== 'load') throw new Error('Expected a load job');
      const isCurrent =
        state.active_model_code === job.model_code && state.state_version === job.state_version;
      await client.query(
        `delete from semantic_jobs
         where id = $1
           and status = 'running'
           and lease_owner = $2`,
        [job.id, workerId],
      );
      if (!isCurrent) return false;
      const current = await client.query(
        `update semantic_index_state
         set status = 'index_queued',
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
      if (current.rowCount === 1) {
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
               and status in ('queued', 'running', 'retry_wait')
           )`,
          [job.model_code, job.state_version],
        );
      }
      return current.rowCount === 1;
    });
  }

  public async failDownload(
    jobId: string,
    workerId: string,
    stage: Extract<SemanticFailureStage, 'download' | 'verify'>,
    failure: ClassifiedSemanticFailure,
  ): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      const retry = failure.kind === 'retryable' && job.attempts < 3;
      const finalFailure = !retry;
      const message = boundedJobError(failure.message);
      const retryDelaySeconds = job.attempts === 1 ? 5 : 30;

      await client.query(
        `update semantic_jobs
         set status = $3::varchar(20),
             phase = case when $8::boolean then 'verifying' else phase end,
             lease_owner = null,
             lease_expires_at = null,
             next_attempt_at = case
               when $3::varchar(20) = 'retry_wait'
               then clock_timestamp() + ($4::integer * interval '1 second')
               else null
             end,
             failure_kind = $5,
             failure_code = $6,
             completed_at = case
               when $3::varchar(20) = 'failed' then clock_timestamp()
               else null
             end,
             error = $7::text,
             updated_at = clock_timestamp()
         where id = $1
           and lease_owner = $2`,
        [
          job.id,
          workerId,
          finalFailure ? 'failed' : 'retry_wait',
          retryDelaySeconds,
          failure.kind,
          failure.code,
          message,
          stage === 'verify',
        ],
      );
      await client.query(
        `update semantic_model_settings
         set file_status = $2::varchar(20),
             downloaded_at = null,
             failure_kind = $3,
             failure_code = $4,
             error = $5,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [
          job.model_code,
          stage === 'verify' ? 'invalid' : finalFailure ? 'failed' : 'download_queued',
          failure.kind,
          failure.code,
          message,
        ],
      );
      await client.query(
        `update semantic_index_state
         set status = $3::varchar(20),
             failed_items = 0,
             failure_stage = $4,
             failure_kind = $5,
             failure_code = $6,
             error = $7,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [
          job.model_code,
          job.state_version,
          stage === 'verify' || retry ? 'waiting_model' : 'failed',
          stage,
          failure.kind,
          failure.code,
          message,
        ],
      );
    });
  }

  public async failLoad(
    jobId: string,
    workerId: string,
    stage: Extract<SemanticFailureStage, 'verify' | 'load'>,
    failure: ClassifiedSemanticFailure,
  ): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      if (job.job_type !== 'load') throw new Error('Expected a load job');
      const retry = stage === 'load' && failure.kind === 'retryable' && job.attempts < 3;
      const message = boundedJobError(failure.message);
      const retryDelaySeconds = job.attempts === 1 ? 5 : 30;

      if (stage === 'verify') {
        await client.query(
          `delete from semantic_jobs
           where (
               id = $1
               and status = 'running'
               and lease_owner = $2
             )
             or (
               job_type = 'full_index'
               and model_code = $3
               and state_version = $4
             )`,
          [job.id, workerId, job.model_code, job.state_version],
        );
        await client.query(
          `update semantic_model_settings
           set file_status = 'invalid',
               downloaded_at = null,
               failure_kind = $2,
               failure_code = $3,
               error = $4,
               updated_at = clock_timestamp()
           where model_code = $1`,
          [job.model_code, failure.kind, failure.code, message],
        );
      } else {
        await client.query(
          `update semantic_jobs
           set status = $3::varchar(20),
               lease_owner = null,
               lease_expires_at = null,
               next_attempt_at = case
                 when $3::varchar(20) = 'retry_wait'
                 then clock_timestamp() + ($4::integer * interval '1 second')
                 else null
               end,
               failure_kind = $5,
               failure_code = $6,
               completed_at = case
                 when $3::varchar(20) = 'failed' then clock_timestamp()
                 else null
               end,
               error = $7,
               updated_at = clock_timestamp()
           where id = $1
             and lease_owner = $2`,
          [
            job.id,
            workerId,
            retry ? 'retry_wait' : 'failed',
            retryDelaySeconds,
            failure.kind,
            failure.code,
            message,
          ],
        );
      }
      await client.query(
        `update semantic_index_state
         set status = $3::varchar(20),
             failure_stage = $4,
             failure_kind = $5,
             failure_code = $6,
             error = $7,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [
          job.model_code,
          job.state_version,
          stage === 'verify' ? 'waiting_model' : retry ? 'loading' : 'failed',
          stage,
          failure.kind,
          failure.code,
          message,
        ],
      );
    });
  }

  public async findReadyActiveModel(): Promise<ReadyActiveModel | null> {
    const result = await this.pool.query<{
      model_code: SemanticModelCode;
      revision: string;
      state_version: number;
      downloaded_at: string;
    }>(
      `select settings.model_code,
              settings.revision,
              state.state_version,
              settings.downloaded_at::text as downloaded_at
       from semantic_index_state as state
       join semantic_model_settings as settings
         on settings.model_code = state.active_model_code
       where state.singleton_key = true
         and (
           state.status in ('index_queued', 'building', 'ready', 'updating', 'incomplete')
           or (state.status = 'failed' and state.failure_stage = 'full_index')
         )
         and settings.file_status = 'downloaded'`,
    );
    const row = result.rows[0];
    return row
      ? {
          modelCode: row.model_code,
          revision: row.revision,
          stateVersion: row.state_version,
          downloadedAt: row.downloaded_at,
        }
      : null;
  }

  public async isReadyActiveModel(
    modelCode: SemanticModelCode,
    stateVersion: number,
  ): Promise<boolean> {
    const result = await this.pool.query<{ current: boolean }>(
      `select exists (
         select 1
         from semantic_index_state as state
         join semantic_model_settings as settings
           on settings.model_code = state.active_model_code
         where state.singleton_key = true
           and state.active_model_code = $1
           and state.state_version = $2
           and (
             state.status in ('index_queued', 'building', 'ready', 'updating', 'incomplete')
             or (state.status = 'failed' and state.failure_stage = 'full_index')
           )
           and settings.file_status = 'downloaded'
       ) as current`,
      [modelCode, stateVersion],
    );
    return result.rows[0]?.current ?? false;
  }

  public async invalidateActiveModel(
    modelCode: SemanticModelCode,
    stateVersion: number,
    downloadedAt: string,
    failure: ClassifiedSemanticFailure,
  ): Promise<boolean> {
    const message = boundedJobError(failure.message);
    return withJobTransaction(this.pool, async (client) => {
      const state = await lockIndexState(client);
      const invalidated = await client.query(
        `update semantic_model_settings
         set file_status = 'invalid',
             downloaded_at = null,
             failure_kind = $2,
             failure_code = $3,
             error = $4,
             updated_at = clock_timestamp()
         where model_code = $1
           and downloaded_at = $5::timestamptz`,
        [modelCode, failure.kind, failure.code, message, downloadedAt],
      );
      if (invalidated.rowCount !== 1) return false;
      if (state.active_model_code !== modelCode || state.state_version !== stateVersion)
        return false;
      await client.query(
        `update semantic_index_state
         set status = 'waiting_model',
             failure_stage = 'verify',
             failure_kind = $2,
             failure_code = $3,
             error = $4,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $5`,
        [modelCode, failure.kind, failure.code, message, stateVersion],
      );
      await client.query(
        `delete from semantic_jobs
         where model_code = $1
           and state_version = $2
           and job_type in ('load', 'full_index')`,
        [modelCode, stateVersion],
      );
      return true;
    });
  }

  public async failActiveModelLoad(
    modelCode: SemanticModelCode,
    stateVersion: number,
    failure: ClassifiedSemanticFailure,
  ): Promise<void> {
    const message = boundedJobError(failure.message);
    await withJobTransaction(this.pool, async (client) => {
      const state = await lockIndexState(client);
      if (state.active_model_code !== modelCode || state.state_version !== stateVersion) return;
      await client.query(
        `update semantic_index_state
         set status = 'failed',
             failure_stage = 'load',
             failure_kind = $2,
             failure_code = $3,
             error = $4,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $5`,
        [modelCode, failure.kind, failure.code, message, stateVersion],
      );
      await client.query(
        `delete from semantic_jobs
         where model_code = $1
           and state_version = $2
           and job_type in ('load', 'full_index')`,
        [modelCode, stateVersion],
      );
      await client.query(
        `insert into semantic_jobs (
           job_type,
           model_code,
           status,
           phase,
           state_version,
           attempts,
           started_at,
           completed_at,
           failure_kind,
           failure_code,
           error
         )
         values (
           'load',
           $1,
           'failed',
           'loading',
           $2,
           1,
           clock_timestamp(),
           clock_timestamp(),
           $3,
           $4,
           $5
         )`,
        [modelCode, stateVersion, failure.kind, failure.code, message],
      );
    });
  }
}
