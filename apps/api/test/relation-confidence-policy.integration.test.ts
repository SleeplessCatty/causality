import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresCaseRepository } from '../src/features/cases/caseRepository.js';
import { PostgresRelationRepository } from '../src/features/relations/relationRepository.js';
import {
  startPostgresTestContext,
  type StartedPostgresTestContext,
} from './support/postgresTestContext.js';

const eventIds = {
  causeA: '11000000-0000-4000-8000-000000000081',
  effectA: '11000000-0000-4000-8000-000000000082',
  causeB: '11000000-0000-4000-8000-000000000083',
  effectB: '11000000-0000-4000-8000-000000000084',
};
const relationIds = {
  a: '21000000-0000-4000-8000-000000000081',
  b: '21000000-0000-4000-8000-000000000082',
};
const caseIds = [
  '31000000-0000-4000-8000-000000000081',
  '31000000-0000-4000-8000-000000000082',
  '31000000-0000-4000-8000-000000000083',
];

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    delete from causal_relation_cases;
    delete from causal_relations;
    delete from concrete_cases;
    delete from abstract_events;
  `);
}

async function seedEventsAndCases(pool: Pool): Promise<void> {
  await pool.query(
    `insert into abstract_events (id, name) values
       ($1, '策略原因事件 A'),
       ($2, '策略结果事件 A'),
       ($3, '策略原因事件 B'),
       ($4, '策略结果事件 B')`,
    [eventIds.causeA, eventIds.effectA, eventIds.causeB, eventIds.effectB],
  );
  await pool.query(
    `insert into concrete_cases (id, content) values
       ($1, '策略具体案例一'),
       ($2, '策略具体案例二'),
       ($3, '策略具体案例三')`,
    caseIds,
  );
}

async function confidenceRows(pool: Pool, ids: readonly string[]) {
  return (
    await pool.query<{
      id: string;
      confidence: string;
      baseline_confidence: string;
      baseline_case_count: number;
      case_count: number;
    }>(
      `select relation.id::text,
              relation.confidence,
              relation.baseline_confidence,
              relation.baseline_case_count,
              count(link.concrete_case_id)::int as case_count
       from causal_relations relation
       left join causal_relation_cases link on link.causal_relation_id = relation.id
       where relation.id = any($1::uuid[])
       group by relation.id
       order by relation.id`,
      [ids],
    )
  ).rows;
}

async function waitForDatabaseLock(pool: Pool, processId: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = await pool.query<{ wait_event_type: string | null }>(
      `select wait_event_type from pg_stat_activity where pid = $1`,
      [processId],
    );
    if (state.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`database process ${processId} did not wait for the expected relation lock`);
}

describe.sequential('relation confidence policy integration', () => {
  let context: StartedPostgresTestContext | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_relation_confidence_policy_test');
    pool = context.pool;
  }, 120_000);

  beforeEach(async () => {
    await resetDatabase(pool!);
    await seedEventsAndCases(pool!);
  });

  afterAll(async () => {
    await context?.close();
  });

  it('recalculates every affected relation after multi-row link inserts and deletes', async () => {
    await pool!.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id,
         confidence, baseline_confidence, baseline_case_count
       ) values
         ($1, $2, $3, 10, 10, 0),
         ($4, $5, $6, 10, 10, 0)`,
      [
        relationIds.a,
        eventIds.causeA,
        eventIds.effectA,
        relationIds.b,
        eventIds.causeB,
        eventIds.effectB,
      ],
    );
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id) values
         ($1, $3), ($1, $4), ($2, $5)`,
      [relationIds.a, relationIds.b, ...caseIds],
    );

    expect(await confidenceRows(pool!, [relationIds.a, relationIds.b])).toEqual([
      {
        id: relationIds.a,
        confidence: '27.1000',
        baseline_confidence: '10.0000',
        baseline_case_count: 0,
        case_count: 2,
      },
      {
        id: relationIds.b,
        confidence: '19.0000',
        baseline_confidence: '10.0000',
        baseline_case_count: 0,
        case_count: 1,
      },
    ]);

    await pool!.query(
      `delete from causal_relation_cases
       where (causal_relation_id, concrete_case_id) in (($1, $3), ($2, $4))`,
      [relationIds.a, relationIds.b, caseIds[0], caseIds[2]],
    );
    expect(await confidenceRows(pool!, [relationIds.a, relationIds.b])).toEqual([
      {
        id: relationIds.a,
        confidence: '19.0000',
        baseline_confidence: '10.0000',
        baseline_case_count: 0,
        case_count: 1,
      },
      {
        id: relationIds.b,
        confidence: '10.0000',
        baseline_confidence: '10.0000',
        baseline_case_count: 0,
        case_count: 0,
      },
    ]);
  });

  it('uses the default baseline until an explicit edit captures a new baseline', async () => {
    const repository = new PostgresRelationRepository(pool!);
    const created = await repository.create({
      causeEventId: eventIds.causeA,
      effectEventId: eventIds.effectA,
      confidence: 10,
      confidenceManuallyEdited: false,
      description: null,
      caseSelections: caseIds.map((caseId) => ({ type: 'existing' as const, caseId })),
    });
    expect(created.confidence).toBe(34.39);

    const automaticallyReduced = await repository.replace(created.id, {
      causeEventId: eventIds.causeA,
      effectEventId: eventIds.effectA,
      confidence: created.confidence,
      confidenceManuallyEdited: false,
      description: null,
      caseSelections: caseIds.slice(0, 2).map((caseId) => ({
        type: 'existing' as const,
        caseId,
      })),
    });
    expect(automaticallyReduced?.confidence).toBe(27.1);

    const manuallyReset = await repository.replace(created.id, {
      causeEventId: eventIds.causeA,
      effectEventId: eventIds.effectA,
      confidence: 55,
      confidenceManuallyEdited: true,
      description: null,
      caseSelections: [{ type: 'existing', caseId: caseIds[0]! }],
    });
    expect(manuallyReset?.confidence).toBe(55);
    expect(await confidenceRows(pool!, [created.id])).toEqual([
      {
        id: created.id,
        confidence: '55.0000',
        baseline_confidence: '55.0000',
        baseline_case_count: 1,
        case_count: 1,
      },
    ]);
  });

  it('recalculates confidence when deleting a case removes its links', async () => {
    await pool!.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id,
         confidence, baseline_confidence, baseline_case_count
       ) values ($1, $2, $3, 10, 10, 0)`,
      [relationIds.a, eventIds.causeA, eventIds.effectA],
    );
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2), ($1, $3)`,
      [relationIds.a, caseIds[0], caseIds[1]],
    );
    await new PostgresCaseRepository(pool!).delete(caseIds[0]!);

    expect(await confidenceRows(pool!, [relationIds.a])).toEqual([
      {
        id: relationIds.a,
        confidence: '19.0000',
        baseline_confidence: '10.0000',
        baseline_case_count: 0,
        case_count: 1,
      },
    ]);
  });

  it('serializes concurrent link changes before counting current evidence', async () => {
    await pool!.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id,
         confidence, baseline_confidence, baseline_case_count
       ) values ($1, $2, $3, 10, 10, 0)`,
      [relationIds.a, eventIds.causeA, eventIds.effectA],
    );
    const first = await pool!.connect();
    const second = await pool!.connect();
    try {
      await first.query('begin');
      await second.query('begin');
      await first.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values ($1, $2)`,
        [relationIds.a, caseIds[0]],
      );
      const secondProcess = await second.query<{ process_id: number }>(
        `select pg_backend_pid() as process_id`,
      );
      const secondInsert = second.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values ($1, $2)`,
        [relationIds.a, caseIds[1]],
      );
      await waitForDatabaseLock(pool!, secondProcess.rows[0]!.process_id);
      await first.query('commit');
      await secondInsert;
      await second.query('commit');
    } finally {
      await first.query('rollback').catch(() => undefined);
      await second.query('rollback').catch(() => undefined);
      first.release();
      second.release();
    }

    expect(await confidenceRows(pool!, [relationIds.a])).toEqual([
      {
        id: relationIds.a,
        confidence: '27.1000',
        baseline_confidence: '10.0000',
        baseline_case_count: 0,
        case_count: 2,
      },
    ]);
  });
});
