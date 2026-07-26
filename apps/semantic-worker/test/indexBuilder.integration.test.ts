import { hashSemanticDocument } from '@causality/semantic-core';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PostgresIndexBuilder } from '../src/jobs/indexBuilder.js';
import { PostgresIncrementalIndexDrain } from '../src/jobs/incrementalIndexDrain.js';
import { PostgresIndexJobRepository } from '../src/jobs/indexJobRepository.js';
import { IndexJobRunner } from '../src/jobs/jobRunner.js';
import type { SemanticIndexJob } from '../src/jobs/jobTypes.js';
import { WorkerLeaseLostError } from '../src/jobs/postgresJobSupport.js';
import { PostgresSemanticSourceRepository } from '../src/jobs/semanticSourceRepository.js';
import type { EmbeddingRuntime } from '../src/model/modelRuntime.js';
import { startWorkerPostgresTestContext } from './support/workerPostgresTestContext.js';

const eventId = '10000000-0000-4000-8000-000000000090';
const effectId = '10000000-0000-4000-8000-000000000091';
const relationId = '20000000-0000-4000-8000-000000000090';
const caseId = '30000000-0000-4000-8000-000000000090';

describe.sequential('semantic source repository', () => {
  let context: Awaited<ReturnType<typeof startWorkerPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let repository: PostgresSemanticSourceRepository | undefined;

  beforeAll(async () => {
    context = await startWorkerPostgresTestContext('causality_semantic_source_test');
    pool = context.pool;
    repository = new PostgresSemanticSourceRepository(pool);

    await pool.query(
      `insert into abstract_events (id, name, description)
       values
         ($1, '政策利率上调', '中央银行提高政策利率'),
         ($2, '融资成本上升', null)`,
      [eventId, effectId],
    );
    await pool.query(
      `insert into event_aliases (event_id, alias)
       values ($1, '加息')`,
      [eventId],
    );
    await pool.query(
      `insert into event_keywords (event_id, keyword, position)
       values ($1, '利率', 1)`,
      [eventId],
    );
    await pool.query(
      `insert into causal_relations (
         id,
         cause_event_id,
         effect_event_id,
         confidence,
         description
       )
       values ($1, $2, $3, 70, '利率上调提高融资价格')`,
      [relationId, eventId, effectId],
    );
    await pool.query(
      `insert into concrete_cases (id, content)
       values ($1, '央行宣布上调政策利率')`,
      [caseId],
    );
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  it('loads deterministic semantic documents for events, relations, and cases', async () => {
    const event = await repository!.load('event', eventId);
    const relation = await repository!.load('relation', relationId);
    const concreteCase = await repository!.load('case', caseId);

    expect(event).toMatchObject({
      entityType: 'event',
      entityId: eventId,
      document: '事件名称：政策利率上调\n别名：加息\n关键词：利率\n说明：中央银行提高政策利率',
    });
    expect(relation).toMatchObject({
      entityType: 'relation',
      entityId: relationId,
      document: '原因事件：政策利率上调\n结果事件：融资成本上升\n说明：利率上调提高融资价格',
    });
    expect(relation?.document).not.toContain('案例');
    expect(concreteCase).toMatchObject({
      entityType: 'case',
      entityId: caseId,
      document: '具体案例：央行宣布上调政策利率',
    });
    expect(event?.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('loads stable ID-ordered batches and returns null after deletion', async () => {
    const batch = await repository!.loadBatch('event', null, 10);
    expect(batch.map((record) => record.entityId)).toEqual([eventId, effectId]);

    await pool!.query(`delete from concrete_cases where id = $1`, [caseId]);
    await expect(repository!.load('case', caseId)).resolves.toBeNull();
  });
});

const fullCauseId = '10000000-0000-4000-8000-000000000092';
const fullEffectId = '10000000-0000-4000-8000-000000000093';
const fullRelationId = '20000000-0000-4000-8000-000000000092';
const fullCaseId = '30000000-0000-4000-8000-000000000092';
const concurrentCaseId = '30000000-0000-4000-8000-000000000095';
const fullJobId = '40000000-0000-4000-8000-000000000092';
const incrementalJobId = '40000000-0000-4000-8000-000000000093';

class FakeEmbeddingRuntime implements EmbeddingRuntime {
  public readonly loadedPaths: string[] = [];
  public embeddedDocuments: string[] = [];
  public failingDocumentText: string | undefined;
  public globalFailureCode: string | undefined;
  public vectorLength = 384;
  public nonFiniteVector = false;
  public onFirstEmbedding: (() => Promise<void>) | undefined;
  private embeddingCalls = 0;

  public async load(_model: unknown, localPath: string): Promise<void> {
    this.loadedPaths.push(localPath);
  }

  public async embedQuery(): Promise<number[]> {
    return Array.from({ length: 384 }, () => 0);
  }

  public async embedDocuments(documents: readonly string[]): Promise<number[][]> {
    this.embeddingCalls += 1;
    this.embeddedDocuments.push(...documents);
    if (this.embeddingCalls === 1) await this.onFirstEmbedding?.();
    if (this.globalFailureCode) {
      throw Object.assign(new Error('embedding runtime busy'), { code: this.globalFailureCode });
    }
    if (
      this.failingDocumentText &&
      documents.some((document) => document.includes(this.failingDocumentText!))
    ) {
      throw new Error(`Cannot embed document containing ${this.failingDocumentText}`);
    }
    return documents.map((_document, documentIndex) => {
      const vector: number[] = Array.from({ length: this.vectorLength }, (_unused, dimension) =>
        dimension === documentIndex % this.vectorLength ? 1 : 0,
      );
      if (this.nonFiniteVector) vector[0] = Number.NaN;
      return vector;
    });
  }

  public async dispose(): Promise<void> {}
}

function fullJob(): SemanticIndexJob {
  return {
    id: fullJobId,
    jobType: 'full_index',
    modelCode: 'multilingual-e5-small',
    stateVersion: 11,
    attempts: 1,
    entityType: null,
    entityId: null,
    leaseOwner: 'full-index-test-worker',
  };
}

function incrementalJob(overrides: Partial<SemanticIndexJob> = {}): SemanticIndexJob {
  return {
    id: incrementalJobId,
    jobType: 'incremental',
    modelCode: 'multilingual-e5-small',
    stateVersion: 11,
    attempts: 1,
    entityType: 'event',
    entityId: fullCauseId,
    leaseOwner: 'worker-test',
    ...overrides,
  };
}

describe.sequential('PostgresIndexBuilder', () => {
  let context: Awaited<ReturnType<typeof startWorkerPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let sourceRepository: PostgresSemanticSourceRepository | undefined;
  let runtime: FakeEmbeddingRuntime | undefined;
  let builder: PostgresIndexBuilder | undefined;

  beforeAll(async () => {
    context = await startWorkerPostgresTestContext('causality_semantic_index_test');
    pool = context.pool;
  }, 120_000);

  beforeEach(async () => {
    await pool!.query(
      `update semantic_index_state
       set active_model_code = null,
           status = 'empty',
           state_version = 0,
           processed_items = 0,
           total_items = 0,
           pending_items = 0,
           failed_items = 0,
           failure_stage = null,
           failure_kind = null,
           failure_code = null,
           error = null,
           last_ready_at = null;
       delete from semantic_jobs;
       delete from semantic_embeddings;
       delete from causal_relation_cases;
       delete from causal_relations;
       delete from concrete_cases;
       delete from event_aliases;
       delete from event_keywords;
       delete from abstract_events`,
    );
    await pool!.query(
      `insert into abstract_events (id, name, description)
       values
         ($1, '政策利率上调', '中央银行提高政策利率'),
         ($2, '融资成本上升', null)`,
      [fullCauseId, fullEffectId],
    );
    await pool!.query(
      `insert into causal_relations (
         id,
         cause_event_id,
         effect_event_id,
         confidence,
         description
       )
       values ($1, $2, $3, 70, '利率上调提高融资价格')`,
      [fullRelationId, fullCauseId, fullEffectId],
    );
    await pool!.query(
      `insert into concrete_cases (id, content)
       values ($1, '央行宣布上调政策利率')`,
      [fullCaseId],
    );
    await pool!.query(
      `update semantic_model_settings
       set file_status = case
             when model_code = 'multilingual-e5-small' then 'downloaded'
             else 'not_downloaded'
           end,
           downloaded_at = case
             when model_code = 'multilingual-e5-small' then clock_timestamp()
             else null
           end,
           error = null;
       update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'loading',
           state_version = 11,
           processed_items = 0,
           total_items = 0,
           pending_items = 0,
           failed_items = 0,
           failure_stage = null,
           failure_kind = null,
           failure_code = null,
           error = null`,
    );
    await pool!.query(
      `insert into semantic_jobs (
         id,
         job_type,
         model_code,
         status,
         phase,
         state_version,
         attempts,
         lease_owner,
         lease_expires_at,
         started_at
       )
       values (
         $1,
         'full_index',
         'multilingual-e5-small',
         'running',
         'indexing',
         11,
         1,
         'full-index-test-worker',
         clock_timestamp() + interval '1 hour',
         clock_timestamp()
       )`,
      [fullJobId],
    );
    sourceRepository = new PostgresSemanticSourceRepository(pool!);
    runtime = new FakeEmbeddingRuntime();
    builder = new PostgresIndexBuilder({
      pool: pool!,
      stateRepository: new PostgresIndexJobRepository(pool!),
      sourceRepository,
      runtime,
    });
  });

  afterAll(async () => {
    await context?.close();
  });

  it('builds and publishes a complete index for all three entity types', async () => {
    await builder!.buildFull(fullJob());

    const count = await pool!.query<{ count: number }>(
      `select count(*)::int as count from semantic_embeddings`,
    );
    const state = await pool!.query<{
      status: string;
      processed_items: number;
      total_items: number;
      pending_items: number;
    }>(
      `select status, processed_items, total_items, pending_items
       from semantic_index_state`,
    );

    expect(count.rows[0]?.count).toBe(4);
    expect(state.rows).toEqual([
      {
        status: 'ready',
        processed_items: 4,
        total_items: 4,
        pending_items: 0,
      },
    ]);
    expect(runtime!.loadedPaths).toEqual([]);
  });

  async function runQueuedFullIndex(): Promise<void> {
    await pool!.query(
      `update semantic_index_state
       set status = 'index_queued'
       where singleton_key = true`,
    );
    await pool!.query(
      `update semantic_jobs
       set status = 'queued',
           phase = 'waiting',
           attempts = 0,
           lease_owner = null,
           lease_expires_at = null,
           started_at = null,
           completed_at = null
       where id = $1`,
      [fullJobId],
    );
    const repository = new PostgresIndexJobRepository(pool!);
    const runner = new IndexJobRunner({
      repository,
      builder: builder!,
      workerId: 'full-index-test-worker',
    });
    await expect(runner.runOnce()).resolves.toBe(true);
  }

  it('isolates one failed source and publishes the remaining full index as incomplete', async () => {
    runtime!.failingDocumentText = '中央银行提高政策利率';

    await runQueuedFullIndex();

    const result = await pool!.query<{
      embeddings: number;
      failed_incrementals: number;
      failed_items: number;
      full_jobs: number;
      processed_items: number;
      status: string;
      total_items: number;
    }>(
      `select state.status,
              state.processed_items,
              state.total_items,
              state.failed_items,
              (
                select count(*)::int
                from semantic_embeddings
              ) as embeddings,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'incremental'
                  and status = 'failed'
                  and model_code = 'multilingual-e5-small'
                  and state_version = 11
                  and entity_type = 'event'
                  and entity_id = $1
                  and failure_code = 'SOURCE_EMBEDDING_FAILED'
              ) as failed_incrementals,
              (
                select count(*)::int
                from semantic_jobs
                where id = $2
              ) as full_jobs
       from semantic_index_state as state
       where state.singleton_key = true`,
      [fullCauseId, fullJobId],
    );

    expect(result.rows).toEqual([
      {
        status: 'incomplete',
        processed_items: 3,
        total_items: 4,
        failed_items: 1,
        embeddings: 3,
        failed_incrementals: 1,
        full_jobs: 0,
      },
    ]);
  });

  it('retries the full job instead of publishing incomplete when embedding runtime is transiently unavailable', async () => {
    runtime!.globalFailureCode = 'EBUSY';

    await runQueuedFullIndex();

    const result = await pool!.query<{
      failed_sources: number;
      failure_code: string | null;
      job_status: string;
      state_status: string;
    }>(
      `select state.status as state_status,
              job.status as job_status,
              job.failure_code,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'incremental'
                  and status = 'failed'
                  and failure_code = 'SOURCE_EMBEDDING_FAILED'
              ) as failed_sources
       from semantic_index_state as state
       join semantic_jobs as job on job.id = $1`,
      [fullJobId],
    );

    expect(result.rows).toEqual([
      {
        state_status: 'building',
        job_status: 'retry_wait',
        failure_code: 'SOURCE_EMBEDDING_FAILED',
        failed_sources: 0,
      },
    ]);
  });

  it.each([
    [
      'VECTOR_DIMENSION_INVALID',
      (target: FakeEmbeddingRuntime): void => {
        target.vectorLength = 383;
      },
    ],
    [
      'VECTOR_VALUE_INVALID',
      (target: FakeEmbeddingRuntime): void => {
        target.nonFiniteVector = true;
      },
    ],
  ] as const)(
    'fails the full index for %s instead of publishing incomplete',
    async (code, breakVector) => {
      breakVector(runtime!);

      await runQueuedFullIndex();

      const result = await pool!.query<{
        embeddings: number;
        failure_code: string | null;
        failed_sources: number;
        job_status: string;
        state_status: string;
      }>(
        `select state.status as state_status,
              state.failure_code,
              job.status as job_status,
              (select count(*)::int from semantic_embeddings) as embeddings,
              (
                select count(*)::int
                from semantic_jobs
                where job_type = 'incremental'
                  and status = 'failed'
                  and failure_code = 'SOURCE_EMBEDDING_FAILED'
              ) as failed_sources
       from semantic_index_state as state
       join semantic_jobs as job on job.id = $1`,
        [fullJobId],
      );
      expect(result.rows).toEqual([
        {
          state_status: 'failed',
          job_status: 'failed',
          failure_code: code,
          embeddings: 0,
          failed_sources: 0,
        },
      ]);
    },
  );

  it('retries the full index when a transient database write fails', async () => {
    await pool!.query(
      `create function fail_semantic_embedding_write()
       returns trigger
       language plpgsql
       as $$
       begin
         raise exception using errcode = '57P01', message = 'database restarting';
       end;
       $$;
       create trigger fail_semantic_embedding_write_trigger
       before insert or update on semantic_embeddings
       for each row execute function fail_semantic_embedding_write()`,
    );
    try {
      await runQueuedFullIndex();
      const result = await pool!.query<{
        failure_code: string | null;
        job_status: string;
        state_status: string;
      }>(
        `select state.status as state_status,
                job.status as job_status,
                job.failure_code
         from semantic_index_state as state
         join semantic_jobs as job on job.id = $1`,
        [fullJobId],
      );
      expect(result.rows).toEqual([
        {
          state_status: 'building',
          job_status: 'retry_wait',
          failure_code: 'DATABASE_TEMPORARILY_UNAVAILABLE',
        },
      ]);
    } finally {
      await pool!.query(
        `drop trigger if exists fail_semantic_embedding_write_trigger on semantic_embeddings;
         drop function if exists fail_semantic_embedding_write()`,
      );
    }
  });

  it('returns an incomplete index to ready after editing and reindexing its failed source', async () => {
    runtime!.failingDocumentText = '中央银行提高政策利率';
    await runQueuedFullIndex();
    const incomplete = await pool!.query<{
      full_jobs: number;
      status: string;
    }>(
      `select state.status,
              (
                select count(*)::int
                from semantic_jobs
                where id = $1
              ) as full_jobs
       from semantic_index_state as state
       where state.singleton_key = true`,
      [fullJobId],
    );
    expect(incomplete.rows).toEqual([{ status: 'incomplete', full_jobs: 0 }]);

    runtime!.failingDocumentText = undefined;
    await pool!.query(
      `update abstract_events
       set description = '中央银行调整并提高基准政策利率'
       where id = $1`,
      [fullCauseId],
    );

    const repository = new PostgresIndexJobRepository(pool!);
    const runner = new IndexJobRunner({
      repository,
      builder: builder!,
      workerId: 'incremental-recovery-test-worker',
    });
    await expect(runner.runOnce()).resolves.toBe(true);

    const result = await pool!.query<{
      failed_incrementals: number;
      failed_items: number;
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
                  and model_code = 'multilingual-e5-small'
                  and state_version = 11
                  and entity_type = 'event'
                  and entity_id = $1
              ) as failed_incrementals
       from semantic_index_state as state
       where state.singleton_key = true`,
      [fullCauseId],
    );

    expect(result.rows).toEqual([
      {
        status: 'ready',
        pending_items: 0,
        failed_items: 0,
        failed_incrementals: 0,
      },
    ]);
  });

  it('writes each inference batch in one database transaction', async () => {
    await pool!.query(
      `create table semantic_write_transaction_audit (
         transaction_id bigint not null
       );
       create function audit_semantic_write_transaction()
       returns trigger
       language plpgsql
       as $$
       begin
         insert into semantic_write_transaction_audit (transaction_id)
         values (txid_current());
         return new;
       end;
       $$;
       create trigger semantic_write_transaction_audit_trigger
       after insert or update on semantic_embeddings
       for each row execute function audit_semantic_write_transaction()`,
    );
    try {
      await builder!.buildFull(fullJob());
      const result = await pool!.query<{ transactions: number }>(
        `select count(distinct transaction_id)::int as transactions
         from semantic_write_transaction_audit`,
      );
      expect(result.rows[0]?.transactions).toBe(3);
    } finally {
      await pool!.query(
        `drop trigger if exists semantic_write_transaction_audit_trigger on semantic_embeddings;
         drop function if exists audit_semantic_write_transaction();
         drop table if exists semantic_write_transaction_audit`,
      );
    }
  });

  it('checks the live guard after inference and before writing a full-index batch', async () => {
    let active = true;
    runtime!.onFirstEmbedding = async () => {
      active = false;
    };

    await expect(
      builder!.buildFull(fullJob(), () => {
        if (!active) throw new WorkerLeaseLostError();
      }),
    ).rejects.toThrow(WorkerLeaseLostError);

    const count = await pool!.query<{ count: number }>(
      `select count(*)::int as count from semantic_embeddings`,
    );
    expect(count.rows).toEqual([{ count: 0 }]);
  });

  it('validates embedding metadata in bounded pages', async () => {
    const originalQuery = pool!.query.bind(pool!);
    const querySpy = vi.spyOn(pool!, 'query');
    querySpy.mockImplementation(((query: string, parameters?: unknown[]) => {
      const sql = typeof query === 'string' ? query : '';
      if (sql.includes('vector_dims(embedding)') && !sql.includes('where entity_type =')) {
        throw new Error('Unbounded semantic embedding validation query');
      }
      return originalQuery(query, parameters);
    }) as Pool['query']);

    try {
      await expect(builder!.buildFull(fullJob())).resolves.toBeUndefined();
    } finally {
      querySpy.mockRestore();
    }
  });

  it('refuses publication when a vector disappears after validation', async () => {
    const repository = new PostgresIndexJobRepository(pool!);
    const guardedBuilder = new PostgresIndexBuilder({
      pool: pool!,
      stateRepository: repository,
      sourceRepository: sourceRepository!,
      runtime: runtime!,
    });
    const publishIndex = repository.publishIndex.bind(repository);
    const publishSpy = vi.spyOn(repository, 'publishIndex');
    publishSpy.mockImplementationOnce(async (...arguments_) => {
      await pool!.query(
        `delete from semantic_embeddings
         where entity_type = 'event'
           and entity_id = $1`,
        [fullCauseId],
      );
      return publishIndex(...arguments_);
    });

    try {
      await expect(guardedBuilder.buildFull(fullJob())).rejects.toThrow(
        'Semantic index validation failed',
      );
      const state = await pool!.query<{ status: string }>(
        `select status
         from semantic_index_state
         where singleton_key = true`,
      );
      expect(state.rows).toEqual([{ status: 'building' }]);
    } finally {
      publishSpy.mockRestore();
    }
  });

  it('refuses publication after the full-index lease is reassigned', async () => {
    const repository = new PostgresIndexJobRepository(pool!);
    const guardedBuilder = new PostgresIndexBuilder({
      pool: pool!,
      stateRepository: repository,
      sourceRepository: sourceRepository!,
      runtime: runtime!,
    });
    const publishIndex = repository.publishIndex.bind(repository);
    const publishSpy = vi.spyOn(repository, 'publishIndex');
    publishSpy.mockImplementationOnce(async (...arguments_) => {
      await pool!.query(
        `update semantic_jobs
         set lease_owner = 'replacement-worker',
             attempts = attempts + 1,
             lease_expires_at = clock_timestamp() + interval '1 minute'
         where id = $1`,
        [fullJobId],
      );
      return publishIndex(...arguments_);
    });

    try {
      await expect(guardedBuilder.buildFull(fullJob())).rejects.toThrow(WorkerLeaseLostError);
      const state = await pool!.query<{ status: string }>(
        `select status from semantic_index_state where singleton_key = true`,
      );
      expect(state.rows).toEqual([{ status: 'building' }]);
    } finally {
      publishSpy.mockRestore();
    }
  });

  it('throttles full-index progress writes between inference batches', async () => {
    await pool!.query(
      `insert into abstract_events (id, name)
       select
         ('10000000-0000-4000-8000-' || lpad((100 + item)::text, 12, '0'))::uuid,
         '批量索引事件' || item
       from generate_series(1, 12) as generated(item)`,
    );
    const originalQuery = pool!.query.bind(pool!);
    let progressUpdates = 0;
    const querySpy = vi.spyOn(pool!, 'query');
    querySpy.mockImplementation(((query: string, parameters?: unknown[]) => {
      if (query.includes('set processed_items = $3')) progressUpdates += 1;
      return originalQuery(query, parameters);
    }) as Pool['query']);

    try {
      await builder!.buildFull(fullJob());
      expect(progressUpdates).toBeLessThanOrEqual(5);
    } finally {
      querySpy.mockRestore();
    }
  });

  it('drains a concurrent event update and stores only the latest source hash', async () => {
    runtime!.onFirstEmbedding = async () => {
      await pool!.query(
        `update abstract_events
         set name = '政策利率进一步上调'
         where id = $1`,
        [fullCauseId],
      );
    };

    await builder!.buildFull(fullJob());

    const latest = await sourceRepository!.load('event', fullCauseId);
    const stored = await pool!.query<{ source_hash: string }>(
      `select source_hash
       from semantic_embeddings
       where entity_type = 'event'
         and entity_id = $1`,
      [fullCauseId],
    );
    const pending = await pool!.query<{ count: number }>(
      `select count(*)::int as count
       from semantic_jobs
       where job_type = 'incremental'
         and status in ('queued', 'running')`,
    );

    expect(stored.rows[0]?.source_hash).toBe(latest?.sourceHash);
    expect(latest?.document).toContain('政策利率进一步上调');
    expect(pending.rows[0]?.count).toBe(0);
  });

  it('expands full-index progress when a source is created during the scan', async () => {
    runtime!.onFirstEmbedding = async () => {
      await pool!.query(
        `insert into concrete_cases (id, content)
         values ($1, '索引构建期间新增的具体案例')`,
        [concurrentCaseId],
      );
    };

    await builder!.buildFull(fullJob());

    const state = await pool!.query<{
      embeddings: number;
      processed_items: number;
      status: string;
      total_items: number;
    }>(
      `select state.status,
              state.processed_items,
              state.total_items,
              (
                select count(*)::int
                from semantic_embeddings
              ) as embeddings
       from semantic_index_state as state`,
    );
    expect(state.rows).toEqual([
      {
        status: 'ready',
        processed_items: 5,
        total_items: 5,
        embeddings: 5,
      },
    ]);
  });

  it('reclaims an expired incremental lease before publishing a full index', async () => {
    await pool!.query(
      `insert into semantic_jobs (
         id,
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version,
         attempts,
         lease_owner,
         lease_expires_at,
         started_at
       )
       values (
         $1,
         'incremental',
         'multilingual-e5-small',
         'event',
         $2,
         'running',
         11,
         1,
         'stopped-worker',
         clock_timestamp() - interval '1 second',
         clock_timestamp() - interval '2 minutes'
       )`,
      [incrementalJobId, fullCauseId],
    );

    await builder!.buildFull(fullJob());

    const result = await pool!.query<{ jobs: number; status: string }>(
      `select state.status,
              (
                select count(*)::int
                from semantic_jobs
                where id = $1
              ) as jobs
       from semantic_index_state as state`,
      [incrementalJobId],
    );
    expect(result.rows).toEqual([{ status: 'ready', jobs: 0 }]);
  });

  it('renews an incremental lease while draining it before full-index publication', async () => {
    await pool!.query(
      `insert into semantic_jobs (
         id,
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version,
         attempts,
         lease_owner,
         lease_expires_at,
         started_at
       )
       values (
         $1,
         'incremental',
         'multilingual-e5-small',
         'event',
         $2,
         'running',
         11,
         1,
         'stopped-worker',
         clock_timestamp() - interval '1 second',
         clock_timestamp() - interval '2 minutes'
       )`,
      [incrementalJobId, fullCauseId],
    );
    const slowRuntime = new FakeEmbeddingRuntime();
    const embedDocuments = slowRuntime.embedDocuments.bind(slowRuntime);
    slowRuntime.embedDocuments = async (documents) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return embedDocuments(documents);
    };
    const heartbeatBuilder = new PostgresIndexBuilder({
      pool: pool!,
      stateRepository: new PostgresIndexJobRepository(pool!),
      sourceRepository: sourceRepository!,
      runtime: slowRuntime,
      drainedIncrementalLeaseMilliseconds: 30,
    });
    const originalQuery = pool!.query.bind(pool!);
    let renewals = 0;
    const querySpy = vi.spyOn(pool!, 'query');
    querySpy.mockImplementation(((query: string, parameters?: unknown[]) => {
      if (query.includes('set lease_expires_at = clock_timestamp()')) renewals += 1;
      return originalQuery(query, parameters);
    }) as Pool['query']);

    try {
      await heartbeatBuilder.buildFull(fullJob());
      expect(renewals).toBeGreaterThan(0);
    } finally {
      querySpy.mockRestore();
    }
  });

  it('stops drained incremental work as soon as its lease is lost', async () => {
    await pool!.query(
      `insert into semantic_jobs (
         id,
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version
       )
       values (
         $1,
         'incremental',
         'multilingual-e5-small',
         'event',
         $2,
         'queued',
         11
       )`,
      [incrementalJobId, fullCauseId],
    );
    const drain = new PostgresIncrementalIndexDrain(pool!, 30);
    let started!: () => void;
    const buildStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let wroteAfterLeaseLoss = false;
    const draining = drain.drain(fullJob(), async (_job, assertLeaseValid) => {
      started();
      await delay(50);
      assertLeaseValid();
      wroteAfterLeaseLoss = true;
    });

    await buildStarted;
    await pool!.query(
      `update semantic_jobs
       set attempts = attempts + 1,
           lease_expires_at = clock_timestamp() + interval '1 minute'
       where id = $1`,
      [incrementalJobId],
    );

    await expect(draining).rejects.toBeInstanceOf(WorkerLeaseLostError);
    expect(wroteAfterLeaseLoss).toBe(false);
  });

  it('upserts the latest incremental source and removes a deleted source vector', async () => {
    await pool!.query(
      `update semantic_index_state
       set status = 'ready'`,
    );
    await pool!.query(
      `insert into semantic_jobs (
         id,
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version,
         attempts,
         lease_owner,
         lease_expires_at,
         started_at
       )
       values (
         $1,
         'incremental',
         'multilingual-e5-small',
         'event',
         $2,
         'running',
         11,
         1,
         'worker-test',
         clock_timestamp() + interval '1 minute',
         clock_timestamp()
       )`,
      [incrementalJobId, fullCauseId],
    );

    await builder!.buildIncremental(incrementalJob());
    const source = await sourceRepository!.load('event', fullCauseId);
    const stored = await pool!.query<{ source_hash: string }>(
      `select source_hash
       from semantic_embeddings
       where entity_type = 'event'
         and entity_id = $1`,
      [fullCauseId],
    );
    expect(stored.rows[0]?.source_hash).toBe(hashSemanticDocument(source!.document));

    await pool!.query(`delete from semantic_jobs where id = $1`, [incrementalJobId]);
    await pool!.query(
      `insert into abstract_events (id, name)
       values ('10000000-0000-4000-8000-000000000094', '待删除孤立事件')`,
    );
    const deletedId = '10000000-0000-4000-8000-000000000094';
    await pool!.query(`delete from semantic_jobs where entity_id = $1`, [deletedId]);
    await pool!.query(
      `insert into semantic_embeddings (
         entity_type,
         entity_id,
         model_code,
         source_hash,
         embedding
       )
       values (
         'event',
         $1,
         'multilingual-e5-small',
         repeat('a', 64),
         array_fill(0.1, array[384])::vector
       )`,
      [deletedId],
    );
    await pool!.query(
      `insert into semantic_jobs (
         id,
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version,
         attempts,
         lease_owner,
         lease_expires_at,
         started_at
       )
       values (
         $2,
         'incremental',
         'multilingual-e5-small',
         'event',
         $1,
         'running',
         11,
         1,
         'worker-test',
         clock_timestamp() + interval '1 minute',
         clock_timestamp()
       )`,
      [deletedId, incrementalJobId],
    );
    await pool!.query(`delete from abstract_events where id = $1`, [deletedId]);

    await builder!.buildIncremental(incrementalJob({ entityId: deletedId }));
    const deletedVector = await pool!.query<{ count: number }>(
      `select count(*)::int as count
       from semantic_embeddings
       where entity_type = 'event'
         and entity_id = $1`,
      [deletedId],
    );
    expect(deletedVector.rows[0]?.count).toBe(0);
  });

  it('ignores stale model state versions without writing a vector', async () => {
    await builder!.buildIncremental(incrementalJob({ stateVersion: 10 }));

    const stored = await pool!.query<{ count: number }>(
      `select count(*)::int as count
       from semantic_embeddings
       where entity_type = 'event'
         and entity_id = $1`,
      [fullCauseId],
    );
    expect(stored.rows[0]?.count).toBe(0);
  });
});
