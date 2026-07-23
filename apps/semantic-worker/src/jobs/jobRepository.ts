import type { SemanticEntityType, SemanticTaskType } from '@causality/contracts';
import type { SemanticModelCode } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';

export interface DownloadJob {
  id: string;
  modelCode: SemanticModelCode;
  stateVersion: number;
  attempts: number;
  totalBytes: number;
}

export interface SemanticIndexJob {
  id: string;
  jobType: Extract<SemanticTaskType, 'full_index' | 'incremental'>;
  modelCode: SemanticModelCode;
  stateVersion: number;
  attempts: number;
  entityType: SemanticEntityType | null;
  entityId: string | null;
}

export interface ReadyActiveModel {
  modelCode: SemanticModelCode;
  revision: string;
}

export interface DownloadJobRepository {
  claimNextDownload(workerId: string, leaseMilliseconds: number): Promise<DownloadJob | null>;
  renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void>;
  markDownloading(jobId: string, workerId: string): Promise<void>;
  updateDownloadProgress(jobId: string, workerId: string, loadedBytes: number): Promise<void>;
  markVerifying(jobId: string, workerId: string): Promise<void>;
  completeDownload(jobId: string, workerId: string): Promise<void>;
  failDownload(jobId: string, workerId: string, error: string): Promise<void>;
  findReadyActiveModel(): Promise<ReadyActiveModel | null>;
  markActiveModelUnavailable(modelCode: SemanticModelCode, error: string): Promise<void>;
}

export interface IndexJobRepository {
  claimNextIndex(workerId: string, leaseMilliseconds: number): Promise<SemanticIndexJob | null>;
  renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void>;
  completeIndex(jobId: string, workerId: string): Promise<void>;
  failIndex(jobId: string, workerId: string, error: string): Promise<void>;
}

interface DownloadJobRow {
  id: string;
  model_code: SemanticModelCode;
  state_version: number;
  attempts: number;
  total_bytes: number;
}

interface IndexJobRow {
  id: string;
  job_type: SemanticIndexJob['jobType'];
  model_code: SemanticModelCode;
  state_version: number;
  attempts: number;
  entity_type: SemanticEntityType | null;
  entity_id: string | null;
}

interface LockedJobRow extends DownloadJobRow {
  job_type: SemanticTaskType;
  entity_type: SemanticEntityType | null;
  entity_id: string | null;
  lease_owner: string | null;
  status: string;
}

export class WorkerLeaseLostError extends Error {
  public constructor() {
    super('Semantic worker job lease was lost');
    this.name = 'WorkerLeaseLostError';
  }
}

function boundedError(error: string): string {
  return error.slice(0, 500);
}

function mapJob(row: DownloadJobRow): DownloadJob {
  return {
    id: row.id,
    modelCode: row.model_code,
    stateVersion: row.state_version,
    attempts: row.attempts,
    totalBytes: row.total_bytes,
  };
}

function mapIndexJob(row: IndexJobRow): SemanticIndexJob {
  return {
    id: row.id,
    jobType: row.job_type,
    modelCode: row.model_code,
    stateVersion: row.state_version,
    attempts: row.attempts,
    entityType: row.entity_type,
    entityId: row.entity_id,
  };
}

async function lockOwnedJob(
  client: PoolClient,
  jobId: string,
  workerId: string,
): Promise<LockedJobRow> {
  const result = await client.query<LockedJobRow>(
    `select id,
            job_type,
            model_code,
            state_version,
            attempts,
            total_bytes,
            entity_type,
            entity_id,
            lease_owner,
            status
     from semantic_jobs
     where id = $1
     for update`,
    [jobId],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'running' || row.lease_owner !== workerId) {
    throw new WorkerLeaseLostError();
  }
  return row;
}

async function lockIndexState(client: PoolClient): Promise<void> {
  await client.query(
    `select singleton_key
     from semantic_index_state
     where singleton_key = true
     for update`,
  );
}

export class PostgresDownloadJobRepository implements DownloadJobRepository, IndexJobRepository {
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
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  public async claimNextIndex(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<SemanticIndexJob | null> {
    const result = await this.pool.query<IndexJobRow>(
      `with candidate as (
         select id
         from semantic_jobs
         where job_type in ('full_index', 'incremental')
           and (
             status = 'queued'
             or (status = 'running' and lease_expires_at <= clock_timestamp())
           )
         order by
           case when job_type = 'full_index' then 0 else 1 end,
           created_at,
           id
         limit 1
         for update skip locked
       )
       update semantic_jobs as job
       set status = 'running',
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
                 job.job_type,
                 job.model_code,
                 job.state_version,
                 job.attempts,
                 job.entity_type,
                 job.entity_id`,
      [workerId, leaseMilliseconds],
    );
    return result.rows[0] ? mapIndexJob(result.rows[0]) : null;
  }

  public async renewLease(
    jobId: string,
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<void> {
    const result = await this.pool.query(
      `update semantic_jobs
       set lease_expires_at = clock_timestamp() + ($3::integer * interval '1 millisecond'),
           updated_at = clock_timestamp()
       where id = $1
         and status = 'running'
         and lease_owner = $2`,
      [jobId, workerId, leaseMilliseconds],
    );
    if (result.rowCount !== 1) throw new WorkerLeaseLostError();
  }

  public async markDownloading(jobId: string, workerId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      const job = await lockOwnedJob(client, jobId, workerId);
      await client.query(
        `update semantic_model_settings
         set download_status = 'downloading',
             downloaded_at = null,
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code],
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
    await this.withTransaction(async (client) => {
      const job = await lockOwnedJob(client, jobId, workerId);
      await client.query(
        `update semantic_model_settings
         set download_status = 'verifying',
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code],
      );
    });
  }

  public async completeDownload(jobId: string, workerId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      await client.query(
        `update semantic_model_settings
         set download_status = 'downloaded',
             downloaded_at = clock_timestamp(),
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code],
      );
      await client.query(
        `update semantic_jobs
         set status = 'succeeded',
             downloaded_bytes = total_bytes,
             lease_owner = null,
             lease_expires_at = null,
             error = null,
             completed_at = clock_timestamp(),
             updated_at = clock_timestamp()
         where id = $1`,
        [job.id],
      );

      const activeState = await client.query(
        `update semantic_index_state
         set status = 'loading',
             processed_items = 0,
             total_items = 0,
             pending_items = 0,
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
    await this.withTransaction(async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      const finalFailure = job.attempts >= 3;
      const message = boundedError(error);

      await client.query(
        `update semantic_jobs
         set status = $3::varchar(20),
             lease_owner = null,
             lease_expires_at = null,
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
         set download_status = $2::varchar(20),
             downloaded_at = null,
             error = $3,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [job.model_code, finalFailure ? 'failed' : 'not_downloaded', message],
      );
      await client.query(
        `update semantic_index_state
         set status = $3::varchar(20),
             error = $4,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [job.model_code, job.state_version, finalFailure ? 'failed' : 'waiting_model', message],
      );
    });
  }

  public async completeIndex(jobId: string, workerId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      if (job.job_type === 'incremental') {
        await client.query(
          `delete from semantic_jobs
           where id = $1
             and status = 'running'
             and lease_owner = $2`,
          [job.id, workerId],
        );
        await client.query(
          `update semantic_index_state
           set pending_items = (
                 select count(*)::int
                 from semantic_jobs
                 where job_type = 'incremental'
                   and status in ('queued', 'running')
                   and model_code = $1
                   and state_version = $2
               ),
               status = case
                 when status = 'updating'
                   and not exists (
                     select 1
                     from semantic_jobs
                     where job_type = 'incremental'
                       and status in ('queued', 'running')
                       and model_code = $1
                       and state_version = $2
                   )
                 then 'ready'
                 else status
               end,
               updated_at = clock_timestamp()
           where singleton_key = true
             and active_model_code = $1
             and state_version = $2`,
          [job.model_code, job.state_version],
        );
        return;
      }

      await client.query(
        `update semantic_jobs
         set status = 'succeeded',
             processed_items = total_items,
             lease_owner = null,
             lease_expires_at = null,
             error = null,
             completed_at = clock_timestamp(),
             updated_at = clock_timestamp()
         where id = $1
           and status = 'running'
           and lease_owner = $2`,
        [job.id, workerId],
      );
    });
  }

  public async failIndex(jobId: string, workerId: string, error: string): Promise<void> {
    await this.withTransaction(async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      const finalFailure = job.attempts >= 3;
      const message = boundedError(error);
      await client.query(
        `update semantic_jobs
         set status = $3::varchar(20),
             lease_owner = null,
             lease_expires_at = null,
             started_at = case
               when $3::varchar(20) = 'failed' then started_at
               else null
             end,
             completed_at = case
               when $3::varchar(20) = 'failed' then clock_timestamp()
               else null
             end,
             error = $4,
             updated_at = clock_timestamp()
         where id = $1
           and lease_owner = $2`,
        [job.id, workerId, finalFailure ? 'failed' : 'queued', message],
      );
      await client.query(
        `update semantic_index_state
         set status = case
               when $3 then 'failed'
               when $4::varchar(20) = 'full_index' then 'loading'
               else 'updating'
             end,
             pending_items = (
               select count(*)::int
               from semantic_jobs
               where job_type = 'incremental'
                 and status in ('queued', 'running')
                 and model_code = $1
                 and state_version = $2
             ),
             error = $5,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [job.model_code, job.state_version, finalFailure, job.job_type, message],
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
         and state.status = 'ready'
         and settings.download_status = 'downloaded'`,
    );
    const row = result.rows[0];
    return row ? { modelCode: row.model_code, revision: row.revision } : null;
  }

  public async markActiveModelUnavailable(
    modelCode: SemanticModelCode,
    error: string,
  ): Promise<void> {
    const message = boundedError(error);
    await this.withTransaction(async (client) => {
      await lockIndexState(client);
      await client.query(
        `update semantic_model_settings
         set download_status = 'failed',
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

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
