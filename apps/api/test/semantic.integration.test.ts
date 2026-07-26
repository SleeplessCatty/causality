import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresSemanticSearchRepository } from '../src/features/semantic/semanticSearchRepository.js';
import { SemanticWorkerClientError } from '../src/features/semantic/semanticWorkerClient.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const eventId = '10000000-0000-4000-8000-000000000080';
const reindexEffectEventId = '10000000-0000-4000-8000-000000000083';
const reindexRelationId = '20000000-0000-4000-8000-000000000083';
const reindexCaseId = '30000000-0000-4000-8000-000000000083';

describe.sequential('semantic configuration API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_semantic_test', {
      semanticWorkerClient: {
        embedQuery: async () => {
          throw new SemanticWorkerClientError();
        },
      },
    });
    ({ pool } = context);
  }, 120_000);

  beforeEach(async () => {
    await pool!.query(`delete from semantic_jobs`);
    await pool!.query(`delete from semantic_embeddings`);
    await pool!.query(
      `delete from causal_relation_cases where causal_relation_id = $1 or concrete_case_id = $2`,
      [reindexRelationId, reindexCaseId],
    );
    await pool!.query(`delete from causal_relations where id = $1`, [reindexRelationId]);
    await pool!.query(`delete from concrete_cases where id = $1`, [reindexCaseId]);
    await pool!.query(`delete from abstract_events where id = any($1::uuid[])`, [
      [eventId, reindexEffectEventId],
    ]);
    await pool!.query(
      `update semantic_model_settings
       set threshold = case
             when model_code = 'bge-small-zh-v1.5' then $1::smallint
             when model_code = 'multilingual-e5-small' then $2::smallint
             when model_code = 'granite-embedding-97m-multilingual-r2' then $3::smallint
             when model_code = 'bge-m3' then $4::smallint
           end,
           download_status = 'not_downloaded',
           downloaded_at = null,
           error = null,
           updated_at = clock_timestamp()`,
      [
        MODEL_CATALOG['bge-small-zh-v1.5'].defaultThreshold,
        MODEL_CATALOG['multilingual-e5-small'].defaultThreshold,
        MODEL_CATALOG['granite-embedding-97m-multilingual-r2'].defaultThreshold,
        MODEL_CATALOG['bge-m3'].defaultThreshold,
      ],
    );
    await pool!.query(
      `update semantic_index_state
       set active_model_code = null,
           status = 'empty',
           state_version = 0,
           processed_items = 0,
           total_items = 0,
           pending_items = 0,
           error = null,
           last_ready_at = null,
           updated_at = clock_timestamp()
       where singleton_key = true`,
    );
  });

  afterAll(async () => {
    await context?.close();
  });

  it('returns pinned settings and changes one threshold without queuing work', async () => {
    const initial = await context!.app.inject({ method: 'GET', url: '/api/semantic/settings' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      activeModelCode: null,
      index: { status: 'empty', pendingItems: 0 },
      activeTask: null,
    });
    expect(initial.json().models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'bge-small-zh-v1.5',
          threshold: MODEL_CATALOG['bge-small-zh-v1.5'].defaultThreshold,
          isActive: false,
        }),
        expect.objectContaining({
          code: 'multilingual-e5-small',
          threshold: MODEL_CATALOG['multilingual-e5-small'].defaultThreshold,
          isActive: false,
        }),
        expect.objectContaining({
          code: 'granite-embedding-97m-multilingual-r2',
          threshold: MODEL_CATALOG['granite-embedding-97m-multilingual-r2'].defaultThreshold,
          isActive: false,
        }),
        expect.objectContaining({
          code: 'bge-m3',
          threshold: MODEL_CATALOG['bge-m3'].defaultThreshold,
          isActive: false,
        }),
      ]),
    );

    const updated = await context!.app.inject({
      method: 'PATCH',
      url: '/api/semantic/models/bge-m3/threshold',
      payload: { threshold: 60 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().models).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'bge-m3', threshold: 60 })]),
    );
    const jobs = await pool!.query<{ count: number }>(
      `select count(*)::int as count from semantic_jobs`,
    );
    expect(jobs.rows[0]?.count).toBe(0);
  });

  it('queues a first download and rejects a second model request while it is active', async () => {
    const accepted = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/multilingual-e5-small/use',
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({
      accepted: true,
      activeModelCode: 'multilingual-e5-small',
    });

    const job = await pool!.query<{
      job_type: string;
      model_code: string;
      status: string;
      total_bytes: number;
    }>(
      `select job_type, model_code, status, total_bytes
       from semantic_jobs`,
    );
    expect(job.rows).toEqual([
      expect.objectContaining({
        job_type: 'download',
        model_code: 'multilingual-e5-small',
        status: 'queued',
        total_bytes: 135_392_857,
      }),
    ]);

    const settings = await context!.app.inject({ method: 'GET', url: '/api/semantic/settings' });
    expect(settings.json()).toMatchObject({
      activeModelCode: 'multilingual-e5-small',
      index: { status: 'waiting_model' },
      activeTask: {
        type: 'download',
        status: 'queued',
        modelCode: 'multilingual-e5-small',
      },
    });

    await pool!.query(
      `update semantic_jobs
       set status = 'running',
           started_at = clock_timestamp(),
           lease_owner = 'test-worker',
           lease_expires_at = clock_timestamp() + interval '1 minute',
           updated_at = clock_timestamp()
       where job_type = 'download'
         and status = 'queued'`,
    );
    const conflict = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/bge-m3/use',
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'SEMANTIC_SWITCH_CONFLICT' });

    const stateAfterConflict = await pool!.query<{
      active_model_code: string;
      job_count: number;
    }>(
      `select state.active_model_code,
              (select count(*)::int from semantic_jobs) as job_count
       from semantic_index_state as state
       where state.singleton_key = true`,
    );
    expect(stateAfterConflict.rows).toEqual([
      {
        active_model_code: 'multilingual-e5-small',
        job_count: 1,
      },
    ]);
  });

  it('switches to a downloaded model, clears old vectors, and queues a full index', async () => {
    await pool!.query(
      `update semantic_model_settings
       set download_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'bge-m3';
       update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 3
       where singleton_key = true`,
    );
    await pool!.query(`insert into abstract_events (id, name) values ($1, '旧模型事件')`, [
      eventId,
    ]);
    await pool!.query(
      `insert into semantic_embeddings
         (entity_type, entity_id, model_code, source_hash, embedding)
       values (
         'event',
         $1,
         'multilingual-e5-small',
         repeat('a', 64),
         array_fill(0.1, array[384])::vector
       )`,
      [eventId],
    );

    const response = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/bge-m3/use',
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ activeModelCode: 'bge-m3' });

    const state = await pool!.query<{
      active_model_code: string;
      state_version: number;
      status: string;
    }>(
      `select active_model_code, state_version, status
       from semantic_index_state`,
    );
    expect(state.rows).toEqual([
      {
        active_model_code: 'bge-m3',
        state_version: 4,
        status: 'loading',
      },
    ]);
    const vectors = await pool!.query<{ count: number }>(
      `select count(*)::int as count from semantic_embeddings`,
    );
    expect(vectors.rows[0]?.count).toBe(0);
    const jobs = await pool!.query<{ job_type: string; model_code: string; status: string }>(
      `select job_type, model_code, status
       from semantic_jobs`,
    );
    expect(jobs.rows).toEqual([{ job_type: 'full_index', model_code: 'bge-m3', status: 'queued' }]);
  });

  it('rebuilds the active index without deleting events, relations, or cases', async () => {
    await pool!.query(
      `update semantic_model_settings
       set download_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'multilingual-e5-small'`,
    );
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 7,
           processed_items = 4,
           total_items = 4
       where singleton_key = true`,
    );
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '重新索引原因事件'), ($2, '重新索引结果事件')`,
      [eventId, reindexEffectEventId],
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($3, $1, $2, 72)`,
      [eventId, reindexEffectEventId, reindexRelationId],
    );
    await pool!.query(
      `insert into concrete_cases (id, content)
       values ($1, '2026年7月，测试地区记录到重新索引验证案例。')`,
      [reindexCaseId],
    );
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [reindexRelationId, reindexCaseId],
    );
    await pool!.query(
      `insert into semantic_embeddings
         (entity_type, entity_id, model_code, source_hash, embedding)
       values (
         'event',
         $1,
         'multilingual-e5-small',
         repeat('a', 64),
         array_fill(0.1, array[384])::vector
       )`,
      [eventId],
    );

    const response = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/reindex',
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      accepted: true,
      activeModelCode: 'multilingual-e5-small',
    });

    const result = await pool!.query<{
      cases: number;
      embeddings: number;
      events: number;
      relations: number;
      state_version: number;
      status: string;
    }>(
      `select
         (select count(*)::int from abstract_events where id = any($1::uuid[])) as events,
         (select count(*)::int from causal_relations where id = $2) as relations,
         (select count(*)::int from concrete_cases where id = $3) as cases,
         (select count(*)::int from semantic_embeddings) as embeddings,
         state_version,
         status
       from semantic_index_state
       where singleton_key = true`,
      [[eventId, reindexEffectEventId], reindexRelationId, reindexCaseId],
    );
    expect(result.rows).toEqual([
      {
        events: 2,
        relations: 1,
        cases: 1,
        embeddings: 0,
        state_version: 8,
        status: 'loading',
      },
    ]);
    const jobs = await pool!.query<{ job_type: string; model_code: string; status: string }>(
      `select job_type, model_code, status
       from semantic_jobs`,
    );
    expect(jobs.rows).toEqual([
      {
        job_type: 'full_index',
        model_code: 'multilingual-e5-small',
        status: 'queued',
      },
    ]);
  });

  it('retries the latest failed high-level task and validates fixed model parameters', async () => {
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'failed',
           state_version = 5,
           error = '下载失败'
       where singleton_key = true;
       update semantic_model_settings
       set download_status = 'failed',
           error = '下载失败'
       where model_code = 'multilingual-e5-small';
       insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version,
         started_at,
         completed_at,
         error
       )
       values (
         'download',
         'multilingual-e5-small',
         'failed',
         5,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         '下载失败'
       )`,
    );

    const retried = await context!.app.inject({ method: 'POST', url: '/api/semantic/retry' });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({ activeModelCode: 'multilingual-e5-small' });

    const queued = await pool!.query<{ count: number }>(
      `select count(*)::int as count
       from semantic_jobs
       where job_type = 'download'
         and status = 'queued'
         and state_version = 5`,
    );
    expect(queued.rows[0]?.count).toBe(1);

    const invalidModel = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/arbitrary-model/use',
    });
    expect(invalidModel.statusCode).toBe(400);
    expect(invalidModel.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('exposes a current incremental failure without making the existing index unavailable', async () => {
    await pool!.query(
      `update semantic_model_settings
       set download_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'multilingual-e5-small';
       update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 5,
           processed_items = 12,
           total_items = 12,
           error = '单条增量索引失败'
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
         'multilingual-e5-small',
         'event',
         '${eventId}',
         'failed',
         5,
         3,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         '单条增量索引失败'
       )`,
    );

    const settings = await context!.app.inject({ method: 'GET', url: '/api/semantic/settings' });

    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      index: { status: 'ready', error: '单条增量索引失败' },
      activeTask: {
        type: 'incremental',
        status: 'failed',
        error: '单条增量索引失败',
      },
    });
  });

  it('requeues a failed incremental task without clearing the usable index', async () => {
    await pool!.query(
      `update semantic_model_settings
       set download_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'multilingual-e5-small';
       update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 5,
           processed_items = 12,
           total_items = 12,
           error = '单条增量索引失败'
       where singleton_key = true;
       insert into semantic_embeddings (
         entity_type,
         entity_id,
         model_code,
         source_hash,
         embedding
       )
       values (
         'event',
         '${eventId}',
         'multilingual-e5-small',
         repeat('a', 64),
         array_fill(0.1, array[384])::vector
       );
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
         'multilingual-e5-small',
         'event',
         '${eventId}',
         'failed',
         5,
         3,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         '单条增量索引失败'
       )`,
    );

    const retried = await context!.app.inject({ method: 'POST', url: '/api/semantic/retry' });

    expect(retried.statusCode).toBe(202);
    const state = await pool!.query<{
      attempts: number;
      embeddings: number;
      error: string | null;
      job_status: string;
      state_status: string;
    }>(
      `select job.status as job_status,
              job.attempts,
              state.status as state_status,
              state.error,
              (select count(*)::int from semantic_embeddings) as embeddings
       from semantic_jobs as job
       join semantic_index_state as state on state.singleton_key = true
       where job.id = $1`,
      [retried.json().taskId],
    );
    expect(state.rows).toEqual([
      {
        job_status: 'queued',
        attempts: 0,
        state_status: 'updating',
        error: null,
        embeddings: 1,
      },
    ]);
  });

  it('does not expose a stale failed task after the index has recovered', async () => {
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 6,
           processed_items = 12,
           total_items = 12,
           error = null
       where singleton_key = true;
       insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version,
         started_at,
         completed_at,
         error
       )
       values (
         'full_index',
         'multilingual-e5-small',
         'failed',
         5,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         '旧任务失败'
       )`,
    );

    const settings = await context!.app.inject({
      method: 'GET',
      url: '/api/semantic/settings',
    });

    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      index: { status: 'ready', processedItems: 12, totalItems: 12 },
      activeTask: null,
    });
  });

  it('retrieves only same-type vectors above the configured cosine threshold', async () => {
    const relatedEventId = '10000000-0000-4000-8000-000000000081';
    const unrelatedEventId = '10000000-0000-4000-8000-000000000082';
    const sameVectorCaseId = '30000000-0000-4000-8000-000000000081';
    const related = [1, ...Array.from({ length: 383 }, () => 0)];
    const unrelated = [0, 1, ...Array.from({ length: 382 }, () => 0)];
    await pool!.query(
      `insert into semantic_embeddings (
         entity_type,
         entity_id,
         model_code,
         source_hash,
         embedding
       )
       values
         ('event', $1, 'multilingual-e5-small', repeat('a', 64), $4::vector),
         ('event', $2, 'multilingual-e5-small', repeat('b', 64), $5::vector),
         ('case', $3, 'multilingual-e5-small', repeat('c', 64), $4::vector)`,
      [
        relatedEventId,
        unrelatedEventId,
        sameVectorCaseId,
        `[${related.join(',')}]`,
        `[${unrelated.join(',')}]`,
      ],
    );
    const repository = new PostgresSemanticSearchRepository(pool!);

    await expect(
      repository.candidates({
        entityType: 'event',
        modelCode: 'multilingual-e5-small',
        dimensions: 384,
        threshold: 70,
        vector: related,
        limit: 100,
      }),
    ).resolves.toEqual([{ id: relatedEventId, similarity: 1 }]);
  });

  it('keeps standard lists independent and returns stable enhanced-query state errors', async () => {
    const standard = await context!.app.inject({
      method: 'GET',
      url: '/api/events?searchMode=standard',
    });
    expect(standard.statusCode).toBe(200);
    expect(standard.json()).toMatchObject({ semanticIndexUpdating: false });

    for (const path of ['/api/events', '/api/relations', '/api/cases']) {
      const empty = await context!.app.inject({
        method: 'GET',
        url: `${path}?searchMode=enhanced`,
      });
      expect(empty.statusCode).toBe(400);
      expect(empty.json()).toMatchObject({ code: 'SEMANTIC_QUERY_EMPTY' });
    }

    const states = [
      ['empty', 'SEMANTIC_MODEL_UNAVAILABLE'],
      ['waiting_model', 'SEMANTIC_MODEL_DOWNLOADING'],
      ['loading', 'SEMANTIC_INDEX_BUILDING'],
      ['building', 'SEMANTIC_INDEX_BUILDING'],
      ['failed', 'SEMANTIC_INDEX_FAILED'],
    ] as const;
    await pool!.query(
      `update semantic_model_settings
       set download_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'multilingual-e5-small'`,
    );
    for (const [status, code] of states) {
      await pool!.query(
        `update semantic_index_state
         set active_model_code = $1,
             status = $2,
             state_version = 9
         where singleton_key = true`,
        [status === 'empty' ? null : 'multilingual-e5-small', status],
      );
      const response = await context!.app.inject({
        method: 'GET',
        url: '/api/events?q=政策&searchMode=enhanced',
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code });
    }

    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 10
       where singleton_key = true`,
    );
    const unavailableWorker = await context!.app.inject({
      method: 'GET',
      url: '/api/events?q=政策&searchMode=enhanced',
    });
    expect(unavailableWorker.statusCode).toBe(503);
    expect(unavailableWorker.json()).toMatchObject({
      code: 'SEMANTIC_WORKER_UNAVAILABLE',
    });
  });
});
