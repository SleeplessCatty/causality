import type { SemanticEntityType, SemanticTaskType } from '@causality/contracts';
import type { SemanticModelCode } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';

export interface LockedJobRow {
  id: string;
  job_type: SemanticTaskType;
  model_code: SemanticModelCode;
  state_version: number;
  attempts: number;
  total_bytes: number;
  entity_type: SemanticEntityType | null;
  entity_id: string | null;
  lease_owner: string | null;
  status: string;
}

export interface LockedIndexStateRow {
  active_model_code: SemanticModelCode | null;
  state_version: number;
  status: string;
}

export class WorkerLeaseLostError extends Error {
  public constructor() {
    super('Semantic worker job lease was lost');
    this.name = 'WorkerLeaseLostError';
  }
}

export function boundedJobError(error: string): string {
  return error.slice(0, 500);
}

export async function lockOwnedJob(
  client: PoolClient,
  jobId: string,
  workerId: string,
  attempts?: number,
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
       and status = 'running'
       and lease_owner = $2
       and lease_expires_at > clock_timestamp()
       and ($3::integer is null or attempts = $3)
     for update`,
    [jobId, workerId, attempts ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new WorkerLeaseLostError();
  return row;
}

export async function lockIndexState(client: PoolClient): Promise<LockedIndexStateRow> {
  const result = await client.query<LockedIndexStateRow>(
    `select active_model_code, state_version, status
     from semantic_index_state
     where singleton_key = true
     for update`,
  );
  const state = result.rows[0];
  if (!state) throw new Error('Missing semantic_index_state singleton');
  return state;
}

export async function renewJobLease(
  pool: Pool,
  jobId: string,
  workerId: string,
  leaseMilliseconds: number,
): Promise<void> {
  const result = await pool.query(
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

export async function releaseJobLease(pool: Pool, jobId: string, workerId: string): Promise<void> {
  await pool.query(
    `update semantic_jobs
     set status = 'queued',
         phase = 'waiting',
         attempts = greatest(attempts - 1, 0),
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
}

export async function withJobTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
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
