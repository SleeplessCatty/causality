import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';

const eventId = '10000000-0000-4000-8000-000000000080';

describe.sequential('semantic configuration API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_semantic_test');
    ({ pool } = context);
  }, 120_000);

  beforeEach(async () => {
    await pool!.query(`delete from semantic_jobs`);
    await pool!.query(`delete from semantic_embeddings`);
    await pool!.query(`delete from abstract_events where id = $1`, [eventId]);
    await pool!.query(
      `update semantic_model_settings
       set threshold = case
             when model_code = 'multilingual-e5-small' then 70
             else 55
           end,
           download_status = 'not_downloaded',
           downloaded_at = null,
           error = null,
           updated_at = clock_timestamp();
       update semantic_index_state
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
      models: [
        expect.objectContaining({
          code: 'multilingual-e5-small',
          threshold: 70,
          isActive: false,
        }),
        expect.objectContaining({ code: 'bge-m3', threshold: 55, isActive: false }),
      ],
      activeTask: null,
    });

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
});
