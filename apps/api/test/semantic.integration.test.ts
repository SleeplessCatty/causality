import { MODEL_CATALOG } from '@causality/semantic-core';
import type { SemanticModelCode } from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresSemanticLifecycleRepository } from '../src/features/semantic/semanticLifecycleRepository.js';
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
  let workerHealth: {
    status: 'ok';
    modelLoaded: boolean;
    activeModelCode: SemanticModelCode | null;
  };
  let workerHealthUnavailable: boolean;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_semantic_test', {
      semanticWorkerClient: {
        health: async () => {
          if (workerHealthUnavailable) throw new SemanticWorkerClientError();
          return workerHealth;
        },
        embedQuery: async () => {
          throw new SemanticWorkerClientError();
        },
      },
    });
    ({ pool } = context);
  }, 120_000);

  beforeEach(async () => {
    workerHealth = {
      status: 'ok',
      modelLoaded: false,
      activeModelCode: null,
    };
    workerHealthUnavailable = false;
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
           file_status = 'not_downloaded',
           downloaded_at = null,
           failure_kind = null,
           failure_code = null,
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
           failed_items = 0,
           failure_stage = null,
           failure_kind = null,
           failure_code = null,
           error = null,
           last_ready_at = null,
           updated_at = clock_timestamp()
       where singleton_key = true`,
    );
  });

  afterAll(async () => {
    await context?.close();
  });

  it('returns a ready lifecycle snapshot and reports a loaded-model mismatch without changing facts', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'bge-small-zh-v1.5';
       update semantic_index_state
       set active_model_code = 'bge-small-zh-v1.5',
           status = 'ready',
           state_version = 4,
           processed_items = 600,
           total_items = 600,
           updated_at = clock_timestamp()
       where singleton_key = true`,
    );
    await pool!.query(
      `insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version,
         attempts,
         started_at,
         completed_at,
         error
       )
       values (
         'full_index',
         'bge-small-zh-v1.5',
         'failed',
         3,
         3,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         '已被当前索引取代的旧失败'
       )`,
    );
    workerHealth = {
      status: 'ok',
      modelLoaded: true,
      activeModelCode: 'bge-small-zh-v1.5',
    };
    await expect(new PostgresSemanticLifecycleRepository(pool!).readFacts()).resolves.toMatchObject(
      {
        jobs: [],
      },
    );

    const ready = await context!.app.inject({
      method: 'GET',
      url: '/api/semantic/lifecycle',
    });

    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      currentModelCode: 'bge-small-zh-v1.5',
      index: {
        status: 'ready',
        processedItems: 600,
        totalItems: 600,
        availableForEnhancedSearch: true,
      },
      worker: {
        status: 'online',
        modelState: 'loaded',
        loadedModelCode: 'bge-small-zh-v1.5',
      },
      pollAfterMs: null,
      operation: null,
    });
    expect(
      ready
        .json()
        .models.find((model: { modelCode: string }) => model.modelCode === 'bge-small-zh-v1.5'),
    ).toMatchObject({
      role: 'current',
      stage: 'ready',
      allowedActions: ['reindex'],
    });

    const beforeFacts = await pool!.query(
      `select active_model_code, status, state_version, processed_items, total_items
       from semantic_index_state
       where singleton_key = true`,
    );
    workerHealth = {
      status: 'ok',
      modelLoaded: true,
      activeModelCode: 'bge-m3',
    };

    const mismatch = await context!.app.inject({
      method: 'GET',
      url: '/api/semantic/lifecycle',
    });

    expect(mismatch.statusCode).toBe(200);
    expect(mismatch.json()).toMatchObject({
      index: {
        status: 'ready',
        availableForEnhancedSearch: false,
      },
      worker: {
        status: 'online',
        modelState: 'mismatch',
        loadedModelCode: 'bge-m3',
      },
    });
    const afterFacts = await pool!.query(
      `select active_model_code, status, state_version, processed_items, total_items
       from semantic_index_state
       where singleton_key = true`,
    );
    expect(afterFacts.rows).toEqual(beforeFacts.rows);

    workerHealthUnavailable = true;
    const unreachable = await context!.app.inject({
      method: 'GET',
      url: '/api/semantic/lifecycle',
    });
    expect(unreachable.statusCode).toBe(200);
    expect(unreachable.json()).toMatchObject({
      index: {
        status: 'ready',
        availableForEnhancedSearch: false,
      },
      worker: {
        status: 'unreachable',
        modelState: 'missing',
        loadedModelCode: null,
      },
      operation: null,
    });
    const afterUnavailable = await pool!.query(
      `select active_model_code, status, state_version, processed_items, total_items
       from semantic_index_state
       where singleton_key = true`,
    );
    expect(afterUnavailable.rows).toEqual(beforeFacts.rows);
  });

  it('returns the lifecycle catalog and changes one threshold without queuing work', async () => {
    const initial = await context!.app.inject({ method: 'GET', url: '/api/semantic/lifecycle' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      currentModelCode: null,
      index: { status: 'empty', pendingItems: 0 },
      operation: null,
    });
    expect(initial.json().models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelCode: 'bge-small-zh-v1.5',
          threshold: MODEL_CATALOG['bge-small-zh-v1.5'].defaultThreshold,
          role: 'inactive',
        }),
        expect.objectContaining({
          modelCode: 'multilingual-e5-small',
          threshold: MODEL_CATALOG['multilingual-e5-small'].defaultThreshold,
          role: 'inactive',
        }),
        expect.objectContaining({
          modelCode: 'granite-embedding-97m-multilingual-r2',
          threshold: MODEL_CATALOG['granite-embedding-97m-multilingual-r2'].defaultThreshold,
          role: 'inactive',
        }),
        expect.objectContaining({
          modelCode: 'bge-m3',
          threshold: MODEL_CATALOG['bge-m3'].defaultThreshold,
          role: 'inactive',
        }),
      ]),
    );

    const updated = await context!.app.inject({
      method: 'PATCH',
      url: '/api/semantic/models/bge-m3/threshold',
      payload: { threshold: 60 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      currentModelCode: null,
      worker: { status: 'online', modelState: 'idle' },
    });
    expect(
      updated.json().models.find((model: { modelCode: string }) => model.modelCode === 'bge-m3'),
    ).toMatchObject({ threshold: 60 });
    const jobs = await pool!.query<{ count: number }>(
      `select count(*)::int as count from semantic_jobs`,
    );
    expect(jobs.rows[0]?.count).toBe(0);
  });

  it('switches immediately to an undownloaded model and returns the existing queued download for a duplicate submission', async () => {
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

    const duplicate = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/multilingual-e5-small/use',
    });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json()).toEqual(accepted.json());

    const state = await pool!.query<{
      active_model_code: string;
      state_version: number;
      status: string;
      job_count: number;
    }>(
      `select state.active_model_code,
              state.state_version,
              state.status,
              (select count(*)::int from semantic_jobs) as job_count
       from semantic_index_state as state
       where state.singleton_key = true`,
    );
    expect(state.rows).toEqual([
      {
        active_model_code: 'multilingual-e5-small',
        state_version: 1,
        status: 'waiting_model',
        job_count: 1,
      },
    ]);
  });

  it('rejects switching models while another high-level job is active', async () => {
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'waiting_model',
           state_version = 2
       where singleton_key = true;
       update semantic_model_settings
       set file_status = 'download_queued'
       where model_code = 'multilingual-e5-small';
       insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version
       )
       values ('download', 'multilingual-e5-small', 'queued', 2)`,
    );

    const conflict = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/bge-m3/use',
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'SEMANTIC_HIGH_LEVEL_TASK_ACTIVE' });

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

  it('switches to a downloaded model, clears vectors and stale jobs, advances the version, and queues load', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'bge-m3';
       update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 3
       where singleton_key = true;
       insert into semantic_jobs (
         job_type,
         model_code,
         entity_type,
         entity_id,
         status,
         state_version
       )
       values (
         'incremental',
         'multilingual-e5-small',
         'event',
         '${eventId}',
         'queued',
         3
       ), (
         'load',
         'multilingual-e5-small',
         null,
         null,
         'queued',
         2
       )`,
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
    const jobs = await pool!.query<{
      job_type: string;
      model_code: string;
      state_version: number;
      status: string;
    }>(
      `select job_type, model_code, state_version, status
       from semantic_jobs`,
    );
    expect(jobs.rows).toEqual([
      {
        job_type: 'load',
        model_code: 'bge-m3',
        state_version: 4,
        status: 'queued',
      },
    ]);
  });

  it('retries only the selected failed download and removes the model failure', async () => {
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'failed',
           state_version = 5,
           failure_stage = 'download',
           failure_kind = 'retryable',
           failure_code = 'DOWNLOAD_TIMEOUT',
           error = '下载超时'
       where singleton_key = true;
       update semantic_model_settings
       set file_status = 'failed',
           failure_kind = 'retryable',
           failure_code = 'DOWNLOAD_TIMEOUT',
           error = '下载超时'
       where model_code = 'multilingual-e5-small'`,
    );
    const failedDownload = await pool!.query<{ id: string }>(
      `insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version,
         attempts,
         started_at,
         completed_at,
         failure_kind,
         failure_code,
         error
       )
       values (
         'download',
         'multilingual-e5-small',
         'failed',
         5,
         3,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         'retryable',
         'DOWNLOAD_TIMEOUT',
         '下载超时'
       )
       returning id`,
    );
    await pool!.query(
      `insert into semantic_jobs (
         job_type,
         model_code,
         status,
         state_version,
         attempts,
         started_at,
         completed_at,
         failure_kind,
         failure_code,
         error
       )
       values (
         'full_index',
         'multilingual-e5-small',
         'failed',
         5,
         3,
         clock_timestamp() - interval '4 minutes',
         clock_timestamp() - interval '3 minutes',
         'manual',
         'INDEX_FAILURE',
         '旧的索引失败'
       )`,
    );

    const retried = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/multilingual-e5-small/retry-download',
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({
      accepted: true,
      taskId: failedDownload.rows[0]!.id,
      activeModelCode: 'multilingual-e5-small',
    });

    const result = await pool!.query<{
      file_status: string;
      index_status: string;
      job_type: string;
      job_status: string;
      failure_code: string | null;
    }>(
      `select settings.file_status,
              state.status as index_status,
              jobs.job_type,
              jobs.status as job_status,
              jobs.failure_code
       from semantic_model_settings as settings
       cross join semantic_index_state as state
       join semantic_jobs as jobs on jobs.model_code = settings.model_code
       where settings.model_code = 'multilingual-e5-small'
       order by jobs.job_type`,
    );
    expect(result.rows).toEqual([
      {
        file_status: 'download_queued',
        index_status: 'waiting_model',
        job_type: 'download',
        job_status: 'queued',
        failure_code: null,
      },
      {
        file_status: 'download_queued',
        index_status: 'waiting_model',
        job_type: 'full_index',
        job_status: 'failed',
        failure_code: 'INDEX_FAILURE',
      },
    ]);
  });

  it('retries only the selected failed load for the current downloaded model', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'bge-small-zh-v1.5';
       update semantic_index_state
       set active_model_code = 'bge-small-zh-v1.5',
           status = 'failed',
           state_version = 6,
           failure_stage = 'load',
           failure_kind = 'manual',
           failure_code = 'MODEL_RUNTIME_INCOMPATIBLE',
           error = '运行环境不兼容'
       where singleton_key = true`,
    );
    const failedLoad = await pool!.query<{ id: string }>(
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
         'bge-small-zh-v1.5',
         'failed',
         'loading',
         6,
         2,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         'manual',
         'MODEL_RUNTIME_INCOMPATIBLE',
         '运行环境不兼容'
       )
       returning id`,
    );

    const retried = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/bge-small-zh-v1.5/retry-load',
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({ taskId: failedLoad.rows[0]!.id });
    const state = await pool!.query<{ status: string; failure_code: string | null }>(
      `select status, failure_code from semantic_index_state where singleton_key = true`,
    );
    const job = await pool!.query<{
      status: string;
      phase: string;
      attempts: number;
      failure_code: string | null;
    }>(
      `select status, phase, attempts, failure_code
       from semantic_jobs
       where id = $1`,
      [failedLoad.rows[0]!.id],
    );
    expect(state.rows).toEqual([{ status: 'loading', failure_code: null }]);
    expect(job.rows).toEqual([
      { status: 'queued', phase: 'waiting', attempts: 0, failure_code: null },
    ]);
  });

  it('retries only a retryable failed full index without advancing the state version', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'granite-embedding-97m-multilingual-r2';
       update semantic_index_state
       set active_model_code = 'granite-embedding-97m-multilingual-r2',
           status = 'failed',
           state_version = 9,
           processed_items = 12,
           total_items = 20,
           failure_stage = 'full_index',
           failure_kind = 'retryable',
           failure_code = 'INDEX_TRANSIENT',
           error = '索引暂时失败'
       where singleton_key = true`,
    );
    const failedIndex = await pool!.query<{ id: string }>(
      `insert into semantic_jobs (
         job_type,
         model_code,
         status,
         phase,
         state_version,
         attempts,
         processed_items,
         total_items,
         started_at,
         completed_at,
         failure_kind,
         failure_code,
         error
       )
       values (
         'full_index',
         'granite-embedding-97m-multilingual-r2',
         'failed',
         'indexing',
         9,
         3,
         12,
         20,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         'retryable',
         'INDEX_TRANSIENT',
         '索引暂时失败'
       )
       returning id`,
    );

    const retried = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/granite-embedding-97m-multilingual-r2/retry-full-index',
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({ taskId: failedIndex.rows[0]!.id });
    const state = await pool!.query<{
      state_version: number;
      status: string;
      processed_items: number;
      total_items: number;
    }>(
      `select state_version, status, processed_items, total_items
       from semantic_index_state
       where singleton_key = true`,
    );
    expect(state.rows).toEqual([
      { state_version: 9, status: 'index_queued', processed_items: 0, total_items: 0 },
    ]);
  });

  it('reindex clears vectors and failed incremental jobs, advances the version, and starts with load', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
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
    await pool!.query(
      `insert into semantic_jobs (
         job_type,
         model_code,
         entity_type,
         entity_id,
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
         'incremental',
         'multilingual-e5-small',
         'event',
         '${eventId}',
         'failed',
         'indexing',
         7,
         3,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute',
         'manual',
         'ITEM_FAILURE',
         '单条索引失败'
       )`,
    );
    await pool!.query(
      `update semantic_index_state
       set status = 'incomplete',
           failed_items = 1,
           failure_stage = 'incremental',
           failure_kind = 'manual',
           failure_code = 'ITEM_FAILURE',
           error = '单条索引失败'
       where singleton_key = true`,
    );

    const response = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/reindex',
    });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
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
        job_type: 'load',
        model_code: 'multilingual-e5-small',
        status: 'queued',
      },
    ]);
  });

  it('redownloads an invalid model but rejects a stage-specific command for the wrong state', async () => {
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'bge-m3',
           status = 'failed',
           state_version = 5,
           failure_stage = 'verify',
           failure_kind = 'manual',
           failure_code = 'MODEL_HASH_MISMATCH',
           error = '模型文件校验失败'
       where singleton_key = true;
       update semantic_model_settings
       set file_status = 'invalid',
           failure_kind = 'manual',
           failure_code = 'MODEL_HASH_MISMATCH',
           error = '模型文件校验失败'
       where model_code = 'bge-m3'`,
    );

    const invalidRetry = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/bge-m3/retry-download',
    });
    expect(invalidRetry.statusCode).toBe(409);
    expect(invalidRetry.json()).toMatchObject({ code: 'SEMANTIC_ACTION_NOT_ALLOWED' });

    const redownloaded = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/bge-m3/redownload',
    });
    expect(redownloaded.statusCode).toBe(202);
    const result = await pool!.query<{
      file_status: string;
      state_version: number;
      index_status: string;
      job_type: string;
    }>(
      `select settings.file_status,
              state.state_version,
              state.status as index_status,
              jobs.job_type
       from semantic_model_settings as settings
       cross join semantic_index_state as state
       join semantic_jobs as jobs on jobs.model_code = settings.model_code
       where settings.model_code = 'bge-m3'`,
    );
    expect(result.rows).toEqual([
      {
        file_status: 'download_queued',
        state_version: 6,
        index_status: 'waiting_model',
        job_type: 'download',
      },
    ]);

    const invalidModel = await context!.app.inject({
      method: 'POST',
      url: '/api/semantic/models/arbitrary-model/use',
    });
    expect(invalidModel.statusCode).toBe(400);
    expect(invalidModel.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('exposes an incomplete current index without making it unavailable', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'multilingual-e5-small';
       update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'incomplete',
           state_version = 5,
           processed_items = 11,
           total_items = 12,
           failed_items = 1,
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
    workerHealth = {
      status: 'ok',
      modelLoaded: true,
      activeModelCode: 'multilingual-e5-small',
    };

    const lifecycle = await context!.app.inject({ method: 'GET', url: '/api/semantic/lifecycle' });

    expect(lifecycle.statusCode).toBe(200);
    expect(lifecycle.json()).toMatchObject({
      index: {
        status: 'incomplete',
        failedItems: 1,
        availableForEnhancedSearch: true,
      },
      operation: null,
    });
  });

  it('does not expose the removed generic retry endpoint for incremental failures', async () => {
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
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

    expect(retried.statusCode).toBe(404);
    const state = await pool!.query<{
      embeddings: number;
      job_status: string;
      state_status: string;
    }>(
      `select job.status as job_status,
              state.status as state_status,
              (select count(*)::int from semantic_embeddings) as embeddings
       from semantic_jobs as job
       join semantic_index_state as state on state.singleton_key = true
       where job.job_type = 'incremental'
         and job.entity_id = $1`,
      [eventId],
    );
    expect(state.rows).toEqual([
      {
        job_status: 'failed',
        state_status: 'ready',
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

    const lifecycle = await context!.app.inject({
      method: 'GET',
      url: '/api/semantic/lifecycle',
    });

    expect(lifecycle.statusCode).toBe(200);
    expect(lifecycle.json()).toMatchObject({
      index: { status: 'ready', processedItems: 12, totalItems: 12 },
      operation: null,
    });
  });

  it('does not expose the removed legacy settings endpoint', async () => {
    const response = await context!.app.inject({
      method: 'GET',
      url: '/api/semantic/settings',
    });

    expect(response.statusCode).toBe(404);
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
    expect(standard.json()).toMatchObject({ semanticIndexNotice: null });

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
      ['index_queued', 'SEMANTIC_INDEX_BUILDING'],
      ['building', 'SEMANTIC_INDEX_BUILDING'],
      ['failed', 'SEMANTIC_INDEX_FAILED'],
    ] as const;
    await pool!.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
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
