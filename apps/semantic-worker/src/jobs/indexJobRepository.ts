import type { SemanticEntityType } from '@causality/contracts';
import type { SemanticModelCode } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';

import type {
  IndexJobRepository,
  IndexStateRepository,
  RecordFailure,
  SemanticIndexJob,
  SemanticLoadJob,
} from './jobTypes.js';
import {
  boundedJobError,
  lockIndexState,
  lockOwnedJob,
  renewJobLease,
  withJobTransaction,
} from './postgresJobSupport.js';

interface IndexJobRow {
  id: string;
  job_type: SemanticIndexJob['jobType'];
  model_code: SemanticModelCode;
  state_version: number;
  attempts: number;
  entity_type: SemanticEntityType | null;
  entity_id: string | null;
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

async function refreshIncrementalState(client: PoolClient, job: SemanticIndexJob): Promise<void> {
  await client.query(
    `with incremental_stats as (
       select
         count(*) filter (
           where status in ('queued', 'running', 'retry_wait')
         )::int as pending_items,
         count(*) filter (
           where status = 'failed'
         )::int as failed_items
       from semantic_jobs
       where job_type = 'incremental'
         and model_code = $1
         and state_version = $2
     )
     update semantic_index_state as state
     set pending_items = stats.pending_items,
         failed_items = stats.failed_items,
         status = case
           when state.status not in ('ready', 'updating', 'incomplete') then state.status
           when stats.failed_items > 0 then 'incomplete'
           when stats.pending_items > 0 then 'updating'
           else 'ready'
         end,
         error = case
           when stats.failed_items = 0 then null
           else (
             select failed.error
             from semantic_jobs as failed
             where failed.job_type = 'incremental'
               and failed.status = 'failed'
               and failed.model_code = $1
               and failed.state_version = $2
             order by failed.completed_at desc nulls last,
                      failed.created_at desc,
                      failed.id desc
             limit 1
           )
         end,
         failure_stage = null,
         failure_kind = null,
         failure_code = null,
         updated_at = clock_timestamp()
     from incremental_stats as stats
     where state.singleton_key = true
       and state.active_model_code = $1
       and state.state_version = $2`,
    [job.modelCode, job.stateVersion],
  );
}

export class PostgresIndexJobRepository implements IndexJobRepository, IndexStateRepository {
  public constructor(private readonly pool: Pool) {}

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
           phase = 'indexing',
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

  public renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void> {
    return renewJobLease(this.pool, jobId, workerId, leaseMilliseconds);
  }

  public async completeIndex(jobId: string, workerId: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      if (job.job_type === 'incremental') {
        await client.query(
          `delete from semantic_jobs
           where (
               id = $1
               and status = 'running'
               and lease_owner = $2
             )
             or (
               job_type = 'incremental'
               and model_code = $3
               and state_version = $4
               and entity_type = $5
               and entity_id = $6
               and status = 'failed'
             )`,
          [job.id, workerId, job.model_code, job.state_version, job.entity_type, job.entity_id],
        );
        await refreshIncrementalState(client, {
          id: job.id,
          jobType: 'incremental',
          modelCode: job.model_code,
          stateVersion: job.state_version,
          attempts: job.attempts,
          entityType: job.entity_type,
          entityId: job.entity_id,
        });
        return;
      }

      await client.query(
        `delete from semantic_jobs
         where id = $1
           and status = 'running'
           and lease_owner = $2`,
        [job.id, workerId],
      );
    });
  }

  public async failIndex(jobId: string, workerId: string, error: string): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await lockIndexState(client);
      const job = await lockOwnedJob(client, jobId, workerId);
      const finalFailure = job.attempts >= 3;
      const message = boundedJobError(error);
      if (job.job_type === 'incremental' && finalFailure) {
        await client.query(
          `delete from semantic_jobs
           where job_type = 'incremental'
             and status = 'failed'
             and model_code = $1
             and state_version = $2
             and entity_type = $3
             and entity_id = $4
             and id <> $5`,
          [job.model_code, job.state_version, job.entity_type, job.entity_id, job.id],
        );
      }
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
      if (job.job_type === 'incremental') {
        await refreshIncrementalState(client, {
          id: job.id,
          jobType: 'incremental',
          modelCode: job.model_code,
          stateVersion: job.state_version,
          attempts: job.attempts,
          entityType: job.entity_type,
          entityId: job.entity_id,
        });
        return;
      }
      await client.query(
        `update semantic_index_state
         set status = case
               when $3 and $4::varchar(20) <> 'incremental' then 'failed'
               when $4::varchar(20) = 'full_index' then 'loading'
               when $4::varchar(20) = 'incremental'
                 and not exists (
                   select 1
                   from semantic_jobs
                   where job_type = 'incremental'
                     and status in ('queued', 'running')
                     and model_code = $1
                     and state_version = $2
                 )
               then 'ready'
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
             failed_items = 0,
             error = $5,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [job.model_code, job.state_version, finalFailure, job.job_type, message],
      );
    });
  }

  public async isCurrent(job: SemanticIndexJob): Promise<boolean> {
    const result = await this.pool.query<{
      active_model_code: SemanticModelCode | null;
      state_version: number;
    }>(
      `select active_model_code, state_version
       from semantic_index_state
       where singleton_key = true`,
    );
    const state = result.rows[0];
    return state?.active_model_code === job.modelCode && state.state_version === job.stateVersion;
  }

  public async markModelLoading(job: SemanticLoadJob): Promise<void> {
    await this.pool.query(
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
      [job.modelCode, job.stateVersion],
    );
  }

  public async beginFullBuild(job: SemanticIndexJob, totalItems: number): Promise<void> {
    if (job.jobType !== 'full_index') throw new Error('Expected a full-index job');
    await withJobTransaction(this.pool, async (client) => {
      const state = await lockIndexState(client);
      if (state.active_model_code !== job.modelCode || state.state_version !== job.stateVersion) {
        return;
      }
      await client.query(`delete from semantic_embeddings`);
      await client.query(
        `delete from semantic_jobs
         where job_type = 'incremental'
           and (
             status = 'failed'
             or (
               status = 'queued'
               and (
                 model_code <> $1
                 or state_version <> $2
               )
             )
           )`,
        [job.modelCode, job.stateVersion],
      );
      await client.query(
        `update semantic_index_state
         set status = 'building',
             processed_items = 0,
             total_items = $3,
             pending_items = (
               select count(*)::int
               from semantic_jobs
               where job_type = 'incremental'
                 and status in ('queued', 'running')
                 and model_code = $1
                 and state_version = $2
             ),
             failed_items = 0,
             failure_stage = null,
             failure_kind = null,
             failure_code = null,
             error = null,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [job.modelCode, job.stateVersion, totalItems],
      );
      await client.query(
        `update semantic_jobs
         set processed_items = 0,
             total_items = $2,
             updated_at = clock_timestamp()
         where id = $1
           and job_type = 'full_index'
           and status = 'running'`,
        [job.id, totalItems],
      );
    });
  }

  public async updateFullProgress(
    job: SemanticIndexJob,
    processedItems: number,
    totalItems: number,
  ): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      await client.query(
        `update semantic_index_state
         set processed_items = $3,
             total_items = $4,
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2`,
        [job.modelCode, job.stateVersion, processedItems, totalItems],
      );
      await client.query(
        `update semantic_jobs
         set processed_items = $2,
             total_items = $3,
             updated_at = clock_timestamp()
         where id = $1
           and job_type = 'full_index'
           and status = 'running'`,
        [job.id, processedItems, totalItems],
      );
    });
  }

  public async publishIndex(
    job: SemanticIndexJob,
    indexedItems: number,
    failedItems: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update semantic_index_state
       set status = case when $4::integer = 0 then 'ready' else 'incomplete' end,
           processed_items = $3,
           total_items = $3 + $4,
           pending_items = 0,
           failed_items = $4,
           failure_stage = null,
           failure_kind = null,
           failure_code = null,
           error = null,
           last_ready_at = clock_timestamp(),
           updated_at = clock_timestamp()
       where singleton_key = true
         and active_model_code = $1
         and state_version = $2
         and (
           (select count(*) from abstract_events)
           + (select count(*) from causal_relations)
           + (select count(*) from concrete_cases)
         ) = $3::integer + $4::integer
         and (
           select count(*)
           from semantic_embeddings
         ) = $3::integer
         and (
           select count(*)
           from semantic_jobs
           where job_type = 'incremental'
             and status = 'failed'
             and model_code = $1
             and state_version = $2
         ) = $4::integer
         and not exists (
           select 1
           from semantic_jobs
           where job_type = 'incremental'
             and status in ('queued', 'running', 'retry_wait')
             and model_code = $1
             and state_version = $2
         )`,
      [job.modelCode, job.stateVersion, indexedItems, failedItems],
    );
    return result.rowCount === 1;
  }

  public async recordSourceFailure(job: SemanticIndexJob, failure: RecordFailure): Promise<void> {
    await withJobTransaction(this.pool, async (client) => {
      const state = await lockIndexState(client);
      if (state.active_model_code !== job.modelCode || state.state_version !== job.stateVersion) {
        return;
      }
      await client.query(
        `delete from semantic_embeddings
         where entity_type = $1
           and entity_id = $2`,
        [failure.entityType, failure.entityId],
      );
      await client.query(
        `delete from semantic_jobs
         where job_type = 'incremental'
           and status = 'failed'
           and model_code = $1
           and state_version = $2
           and entity_type = $3
           and entity_id = $4`,
        [job.modelCode, job.stateVersion, failure.entityType, failure.entityId],
      );
      await client.query(
        `insert into semantic_jobs (
           job_type,
           model_code,
           entity_type,
           entity_id,
           status,
           phase,
           state_version,
           attempts,
           failure_kind,
           failure_code,
           error,
           started_at,
           completed_at
         )
         values (
           'incremental',
           $1,
           $2,
           $3,
           'failed',
           'indexing',
           $4,
           3,
           'manual',
           $5,
           $6,
           clock_timestamp(),
           clock_timestamp()
         )`,
        [
          job.modelCode,
          failure.entityType,
          failure.entityId,
          job.stateVersion,
          failure.code,
          boundedJobError(failure.message),
        ],
      );
    });
  }

  public async refreshIncrementalState(job: SemanticIndexJob): Promise<void> {
    await withJobTransaction(this.pool, (client) => refreshIncrementalState(client, job));
  }
}
