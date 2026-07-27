import type { SemanticModelCode } from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SemanticDuplicateRule } from '../src/features/data-checks/semanticDuplicateRule.js';
import { PostgresSemanticLifecycleRepository } from '../src/features/semantic/semanticLifecycleRepository.js';
import type { SemanticWorkerClient } from '../src/features/semantic/semanticWorkerClient.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const modelCode: SemanticModelCode = 'multilingual-e5-small';

function unitVector(first = 1, second = 0): string {
  return `[${first},${second},${Array.from({ length: 382 }, () => 0).join(',')}]`;
}

describe.sequential('semantic duplicate data-check rule', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let workerAvailable = true;
  let loadedModelCode: SemanticModelCode | null = modelCode;

  const workerClient: SemanticWorkerClient = {
    health: async () => {
      if (!workerAvailable) throw new Error('worker unavailable');
      return {
        status: 'ok',
        modelLoaded: loadedModelCode !== null,
        activeModelCode: loadedModelCode,
      };
    },
    embedQuery: async () => [],
  };

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_semantic_duplicate_test');
    ({ pool } = context);
  }, 120_000);

  beforeEach(async () => {
    workerAvailable = true;
    loadedModelCode = modelCode;
    await pool!.query(`delete from semantic_embeddings`);
    await pool!.query(`delete from causal_relations`);
    await pool!.query(`delete from concrete_cases`);
    await pool!.query(`delete from abstract_events`);
    await pool!.query(
      `update semantic_model_settings
       set dedupe_threshold = 100,
           file_status = 'downloaded',
           downloaded_at = now()
       where model_code = $1`,
      [modelCode],
    );
    await pool!.query(
      `update semantic_index_state
       set active_model_code = $1,
           status = 'ready',
           state_version = 1,
           processed_items = 0,
           total_items = 0,
           pending_items = 0,
           failed_items = 0,
           failure_stage = null,
           failure_kind = null,
           failure_code = null,
           error = null
       where singleton_key = true`,
      [modelCode],
    );
  });

  afterAll(async () => {
    await context?.close();
  });

  function rule() {
    return new SemanticDuplicateRule(pool!, workerClient);
  }

  async function insertEvent(id: string, name: string, vector = unitVector()): Promise<void> {
    await pool!.query(`insert into abstract_events (id, name) values ($1, $2)`, [id, name]);
    await pool!.query(
      `insert into semantic_embeddings (entity_type, entity_id, model_code, source_hash, embedding)
       values ('event', $1, $2, repeat('a', 64), $3::vector)`,
      [id, modelCode, vector],
    );
  }

  async function publishSeededIndex(): Promise<void> {
    await pool!.query(`delete from semantic_jobs`);
    await pool!.query(
      `update semantic_index_state
       set status = 'ready',
           processed_items = (select count(*)::int from semantic_embeddings),
           total_items = (select count(*)::int from semantic_embeddings),
           pending_items = 0,
           failed_items = 0,
           failure_stage = null,
           failure_kind = null,
           failure_code = null,
           error = null
       where singleton_key = true`,
    );
  }

  it('returns precise skipped reasons before querying candidates', async () => {
    await pool!.query(
      `update semantic_index_state set active_model_code = null, status = 'empty' where singleton_key = true`,
    );
    await expect(rule().scan()).resolves.toMatchObject({
      semantic: { status: 'skipped', reason: 'no_active_model', issueCount: 0 },
    });

    await pool!.query(
      `update semantic_index_state set active_model_code = $1, status = 'ready' where singleton_key = true`,
      [modelCode],
    );
    workerAvailable = false;
    await expect(rule().scan()).resolves.toMatchObject({
      semantic: { status: 'skipped', reason: 'worker_unreachable', issueCount: 0 },
    });

    workerAvailable = true;
    await pool!.query(
      `update semantic_index_state set status = 'building' where singleton_key = true`,
    );
    await expect(rule().scan()).resolves.toMatchObject({
      semantic: { status: 'skipped', reason: 'index_not_ready', issueCount: 0 },
    });

    await pool!.query(`update semantic_index_state set status = 'ready' where singleton_key = true`);
    await expect(rule().scan()).resolves.toMatchObject({
      semantic: { status: 'skipped', reason: 'no_embeddings', issueCount: 0 },
    });
  });

  it('emits stable event and case pairs, ignores relation vectors, and honors a 100% threshold', async () => {
    const eventA = '10000000-0000-4000-8000-000000000201';
    const eventB = '10000000-0000-4000-8000-000000000202';
    const eventNear = '10000000-0000-4000-8000-000000000203';
    const caseA = '30000000-0000-4000-8000-000000000201';
    const caseB = '30000000-0000-4000-8000-000000000202';
    const relation = '20000000-0000-4000-8000-000000000201';
    await insertEvent(eventA, '语义事件甲');
    await insertEvent(eventB, '语义事件乙');
    await insertEvent(eventNear, '语义事件丙', unitVector(1, 0.1));
    await pool!.query(
      `insert into concrete_cases (id, content) values ($1, '语义案例甲'), ($2, '语义案例乙')`,
      [caseA, caseB],
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 50)`,
      [relation, eventA, eventB],
    );
    await pool!.query(
      `insert into semantic_embeddings (entity_type, entity_id, model_code, source_hash, embedding)
       values
         ('case', $1, $4, repeat('b', 64), $3::vector),
         ('case', $2, $4, repeat('c', 64), $3::vector),
         ('relation', $5, $4, repeat('d', 64), $3::vector)`,
      [caseA, caseB, unitVector(), modelCode, relation],
    );
    await publishSeededIndex();

    const result = await rule().scan();
    expect(result.semantic).toEqual({ status: 'completed', reason: null, issueCount: 2 });
    expect(result.issues).toEqual([
      expect.objectContaining({
        issueType: 'semantic_duplicate_event',
        targetId: eventA,
        relatedId: eventB,
      }),
      expect.objectContaining({
        issueType: 'semantic_duplicate_case',
        targetId: caseA,
        relatedId: caseB,
      }),
    ]);

    await pool!.query(
      `update semantic_model_settings set dedupe_threshold = 90 where model_code = $1`,
      [modelCode],
    );
    await expect(rule().scan()).resolves.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          issueType: 'semantic_duplicate_event',
          targetId: eventA,
          relatedId: eventNear,
        }),
      ]),
    });
  });

  it('leaves exact deterministic duplicates out of semantic results', async () => {
    const eventA = '10000000-0000-4000-8000-000000000211';
    const eventB = '10000000-0000-4000-8000-000000000212';
    const caseA = '30000000-0000-4000-8000-000000000211';
    const caseB = '30000000-0000-4000-8000-000000000212';
    await pool!.query(`drop index abstract_events_normalized_name_uidx`);
    await pool!.query(`drop index concrete_cases_content_uidx`);
    await pool!.query(
      `insert into abstract_events (id, name) values ($1, '确定性重复事件'), ($2, '确定性重复事件')`,
      [eventA, eventB],
    );
    await pool!.query(
      `insert into concrete_cases (id, content) values ($1, '确定性重复案例'), ($2, '确定性重复案例')`,
      [caseA, caseB],
    );
    await pool!.query(
      `insert into semantic_embeddings (entity_type, entity_id, model_code, source_hash, embedding)
       values
         ('event', $1, $5, repeat('a', 64), $3::vector),
         ('event', $2, $5, repeat('b', 64), $3::vector),
         ('case', $4, $5, repeat('c', 64), $3::vector),
         ('case', $6, $5, repeat('d', 64), $3::vector)`,
      [eventA, eventB, unitVector(), caseA, modelCode, caseB],
    );
    await publishSeededIndex();

    await expect(rule().scan()).resolves.toMatchObject({
      semantic: { status: 'completed', issueCount: 0 },
      issues: [],
    });
  });

  it('retains no more than five candidates for each semantic source', async () => {
    const eventIds = Array.from(
      { length: 7 },
      (_, index) => `10000000-0000-4000-8000-0000000002${String(20 + index).padStart(2, '0')}`,
    );
    for (const [index, eventId] of eventIds.entries()) {
      await insertEvent(eventId, `候选上限事件${index + 1}`);
    }
    await publishSeededIndex();

    const result = await rule().scan();
    expect(result.semantic).toEqual({ status: 'completed', reason: null, issueCount: 20 });
    expect(result.issues).toHaveLength(20);
  });

  it('caps a 50,001-row global candidate probe as a truncated semantic snapshot', async () => {
    const readFacts = vi.spyOn(PostgresSemanticLifecycleRepository.prototype, 'readFacts').mockResolvedValue({
      models: [
        {
          modelCode,
          label: 'test',
          description: 'test',
          languageLabel: 'test',
          dimensions: 384,
          expectedDownloadBytes: 0,
          threshold: 0,
          dedupeThreshold: 0,
          downloadedAt: null,
          fileState: 'downloaded',
          failure: null,
        },
      ],
      index: {
        currentModelCode: modelCode,
        status: 'ready',
        stateVersion: 1,
        processedItems: 0,
        totalItems: 0,
        pendingItems: 0,
        failedItems: 0,
        failure: null,
        updatedAt: null,
      },
      jobs: [],
    });
    const candidateRows = Array.from({ length: 50_001 }, (_, index) => ({
      target_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      related_id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      similarity: 1,
      entity_type: 'event' as const,
    }));
    const fakePool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        .mockResolvedValueOnce({ rows: candidateRows }),
    } as unknown as Pool;

    const result = await new SemanticDuplicateRule(fakePool, workerClient).scan();

    expect(result.semantic).toEqual({
      status: 'truncated',
      reason: 'candidate_limit',
      issueCount: 50_000,
    });
    expect(result.issues).toHaveLength(50_000);
    readFacts.mockRestore();
  });
});
