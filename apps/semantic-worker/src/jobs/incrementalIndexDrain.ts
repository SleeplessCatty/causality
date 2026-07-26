import { setTimeout as delay } from 'node:timers/promises';

import type { SemanticEntityType } from '@causality/contracts';
import type { Pool } from 'pg';

import type { SemanticIndexJob } from './jobRepository.js';

interface ClaimedIncrementalRow {
  id: string;
  model_code: SemanticIndexJob['modelCode'];
  state_version: number;
  attempts: number;
  entity_type: SemanticEntityType;
  entity_id: string;
}

export class PostgresIncrementalIndexDrain {
  public constructor(
    private readonly pool: Pool,
    private readonly leaseMilliseconds = 60_000,
  ) {
    if (!Number.isInteger(leaseMilliseconds) || leaseMilliseconds < 30) {
      throw new Error('Drained incremental lease must be at least 30 milliseconds');
    }
  }

  public async drain(
    fullIndexJob: SemanticIndexJob,
    buildIncremental: (job: SemanticIndexJob) => Promise<void>,
  ): Promise<void> {
    const deadline = Date.now() + 65_000;
    const leaseOwner = this.leaseOwner(fullIndexJob);
    while (true) {
      const incremental = await this.claim(fullIndexJob, leaseOwner);
      if (incremental) {
        await this.withRenewedLease(incremental, leaseOwner, buildIncremental);
        continue;
      }

      if (!(await this.hasPending(fullIndexJob))) return;
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for active incremental index jobs');
      }
      await delay(250);
    }
  }

  private leaseOwner(job: SemanticIndexJob): string {
    return `full-index-${job.id}`;
  }

  private async claim(job: SemanticIndexJob, leaseOwner: string): Promise<SemanticIndexJob | null> {
    const result = await this.pool.query<ClaimedIncrementalRow>(
      `with candidate as (
         select id
         from semantic_jobs
         where job_type = 'incremental'
           and model_code = $1
           and state_version = $2
           and (
             status = 'queued'
             or (status = 'running' and lease_expires_at <= clock_timestamp())
           )
         order by created_at, id
         limit 1
         for update skip locked
       )
       update semantic_jobs as incremental
       set status = 'running',
           attempts = attempts + 1,
           lease_owner = $3,
           lease_expires_at = clock_timestamp() + ($4::integer * interval '1 millisecond'),
           started_at = case
             when incremental.status = 'queued' then clock_timestamp()
             else incremental.started_at
           end,
           completed_at = null,
           error = null,
           updated_at = clock_timestamp()
       from candidate
       where incremental.id = candidate.id
       returning incremental.id,
                 incremental.model_code,
                 incremental.state_version,
                 incremental.attempts,
                 incremental.entity_type,
                 incremental.entity_id`,
      [job.modelCode, job.stateVersion, leaseOwner, this.leaseMilliseconds],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          jobType: 'incremental',
          modelCode: row.model_code,
          stateVersion: row.state_version,
          attempts: row.attempts,
          entityType: row.entity_type,
          entityId: row.entity_id,
        }
      : null;
  }

  private async withRenewedLease(
    incremental: SemanticIndexJob,
    leaseOwner: string,
    buildIncremental: (job: SemanticIndexJob) => Promise<void>,
  ): Promise<void> {
    let leaseFailure: unknown;
    let renewalTail = Promise.resolve();
    const heartbeat = setInterval(
      () => {
        renewalTail = renewalTail
          .then(async () => {
            const renewed = await this.pool.query(
              `update semantic_jobs
               set lease_expires_at = clock_timestamp()
                     + ($3::integer * interval '1 millisecond'),
                   updated_at = clock_timestamp()
               where id = $1
                 and job_type = 'incremental'
                 and status = 'running'
                 and lease_owner = $2`,
              [incremental.id, leaseOwner, this.leaseMilliseconds],
            );
            if (renewed.rowCount !== 1) {
              throw new Error('Lost drained incremental index lease');
            }
          })
          .catch((error: unknown) => {
            leaseFailure ??= error;
          });
      },
      Math.max(10, Math.floor(this.leaseMilliseconds / 3)),
    );
    heartbeat.unref();
    try {
      await buildIncremental(incremental);
      await renewalTail;
      if (leaseFailure) throw leaseFailure;
      const completed = await this.pool.query(
        `delete from semantic_jobs
         where id = $1
           and job_type = 'incremental'
           and status = 'running'
           and lease_owner = $2`,
        [incremental.id, leaseOwner],
      );
      if (completed.rowCount !== 1) {
        throw new Error('Lost drained incremental index lease');
      }
    } finally {
      clearInterval(heartbeat);
      await renewalTail;
    }
  }

  private async hasPending(job: SemanticIndexJob): Promise<boolean> {
    const pending = await this.pool.query<{ pending: boolean }>(
      `select exists (
         select 1
         from semantic_jobs
         where job_type = 'incremental'
           and status in ('queued', 'running')
           and model_code = $1
           and state_version = $2
       ) as pending`,
      [job.modelCode, job.stateVersion],
    );
    return pending.rows[0]?.pending ?? false;
  }
}
