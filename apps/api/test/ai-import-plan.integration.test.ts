import {
  aiImportPlanSchema,
  type AiCaptureCandidateSet,
  type AiCaptureDecisionSet,
  type AiImportPlan,
  type PrepareAiImportPlanInput,
} from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAiCandidateComparisonRepository } from '../src/features/ai-capture/aiCandidateComparisonRepository.js';
import { AiCandidateComparisonService } from '../src/features/ai-capture/aiCandidateComparisonService.js';
import { PostgresAiImportPlanRepository } from '../src/features/ai-capture/aiImportPlanRepository.js';
import { AiImportPlanService } from '../src/features/ai-capture/aiImportPlanService.js';
import type { AiSemanticCandidateService } from '../src/features/ai-capture/aiSemanticCandidateService.js';
import type { PreparedMutationSet } from '../src/features/ai-capture/aiImportPlanValidator.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const eventAId = '10000000-0000-4000-8000-000000000001';
const eventBId = '10000000-0000-4000-8000-000000000002';
const linkedCaseId = '20000000-0000-4000-8000-000000000001';
const unlinkedCaseId = '20000000-0000-4000-8000-000000000002';
const relationId = '30000000-0000-4000-8000-000000000001';

describe.sequential('AI import plan PostgreSQL lifecycle', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool;
  let comparisonService: AiCandidateComparisonService;
  let service: AiImportPlanService;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_ai_import_plan_test');
    ({ pool } = context);
    await pool.query(
      `insert into abstract_events (id, name, description)
       values
         ($1, '港口停止作业', '港口暂停装卸'),
         ($2, '零部件到货延迟', null)`,
      [eventAId, eventBId],
    );
    await pool.query(
      `insert into event_aliases (event_id, alias)
       values ($1, '港口停工')`,
      [eventAId],
    );
    await pool.query(
      `insert into event_keywords (event_id, keyword, position)
       values ($1, '港口', 1), ($2, '供应链', 1)`,
      [eventAId, eventBId],
    );
    await pool.query(
      `insert into concrete_cases (id, content)
       values
         ($1, '2025年某港口停运后汽车零部件延迟到货'),
         ($2, '2026年另一港口停运后电子零部件延迟到货')`,
      [linkedCaseId, unlinkedCaseId],
    );
    await pool.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id, confidence,
         baseline_confidence, baseline_case_count, description
       )
       values ($1, $2, $3, 10, 10, 0, '港口停工导致零部件延迟')`,
      [relationId, eventAId, eventBId],
    );
    await pool.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [relationId, linkedCaseId],
    );

    const semantic: Pick<AiSemanticCandidateService, 'compare'> = {
      compare: async (_entityType, texts) => texts.map(() => []),
    };
    comparisonService = new AiCandidateComparisonService(
      new PostgresAiCandidateComparisonRepository(pool),
      semantic,
    );
    service = new AiImportPlanService(new PostgresAiImportPlanRepository(pool));
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`delete from ai_import_plans`);
    await pool.query(
      `update abstract_events
       set description = '港口暂停装卸',
           updated_at = '2026-07-28T10:00:00.000Z'
       where id = $1`,
      [eventAId],
    );
  });

  afterAll(async () => {
    await context?.close();
  });

  async function prepareInput(
    options: {
      replaceDescription?: string;
      createSecondLink?: boolean;
      replacesPlanId?: string;
    } = {},
  ): Promise<PrepareAiImportPlanInput> {
    const candidates: AiCaptureCandidateSet = {
      topic: '供应链中断',
      clientName: 'integration-test',
      atomicEvents: [
        {
          ref: 'event-a',
          name: '港口停止作业',
          description: null,
          aliases: [],
          keywords: [],
        },
        {
          ref: 'event-b',
          name: '零部件到货延迟',
          description: null,
          aliases: [],
          keywords: [],
        },
      ],
      concreteCases: [
        { ref: 'case-linked', content: '2025年某港口停运后汽车零部件延迟到货' },
        ...(options.createSecondLink
          ? [
              {
                ref: 'case-unlinked',
                content: '2026年另一港口停运后电子零部件延迟到货',
              },
            ]
          : []),
      ],
      causalRelations: [
        {
          ref: 'relation-a',
          causeEventRef: 'event-a',
          effectEventRef: 'event-b',
          description: '港口停工导致零部件延迟',
        },
      ],
      relationCaseLinks: [
        { relationRef: 'relation-a', caseRef: 'case-linked' },
        ...(options.createSecondLink
          ? [{ relationRef: 'relation-a', caseRef: 'case-unlinked' }]
          : []),
      ],
    };
    const comparison = await comparisonService.compare(candidates);
    const decisions: AiCaptureDecisionSet = {
      atomicEvents: [
        {
          ref: 'event-a',
          action: 'reuse',
          existingId: eventAId,
          appendAliases: [],
          appendKeywords: [],
          ...(options.replaceDescription ? { replaceDescription: options.replaceDescription } : {}),
        },
        {
          ref: 'event-b',
          action: 'reuse',
          existingId: eventBId,
          appendAliases: [],
          appendKeywords: [],
        },
      ],
      concreteCases: [
        { ref: 'case-linked', action: 'reuse', existingId: linkedCaseId },
        ...(options.createSecondLink
          ? [
              {
                ref: 'case-unlinked',
                action: 'reuse' as const,
                existingId: unlinkedCaseId,
              },
            ]
          : []),
      ],
      causalRelations: [{ ref: 'relation-a', action: 'reuse', existingId: relationId }],
      relationCaseLinks: [
        { relationRef: 'relation-a', caseRef: 'case-linked', action: 'reuse' },
        ...(options.createSecondLink
          ? [
              {
                relationRef: 'relation-a',
                caseRef: 'case-unlinked',
                action: 'create' as const,
              },
            ]
          : []),
      ],
    };
    return {
      candidates,
      comparison,
      decisions,
      ...(options.replacesPlanId ? { replacesPlanId: options.replacesPlanId } : {}),
    };
  }

  it('replaces V1 with V2 transactionally and assigns a 30-minute lifetime', async () => {
    const warnings: Error[] = [];
    const captureWarning = (warning: Error) => warnings.push(warning);
    process.on('warning', captureWarning);
    let first!: AiImportPlan;
    let second!: AiImportPlan;
    try {
      first = await service.prepare(await prepareInput());
      second = await service.prepare(
        await prepareInput({
          replacesPlanId: first.id,
          replaceDescription: '港口停止全部装卸作业',
        }),
      );
      await expect(service.status(first.id)).resolves.toBe('replaced');
      await expect(service.status(second.id)).resolves.toBe('pending');
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', captureWarning);
    }

    expect(first.version).toBe(1);
    expect(aiImportPlanSchema.safeParse(first).success).toBe(true);
    expect(second).toMatchObject({
      version: 2,
      replacesPlanId: first.id,
      status: 'pending',
    });
    expect(new Date(first.expiresAt).getTime() - new Date(first.createdAt).getTime()).toBe(
      30 * 60 * 1_000,
    );
    expect(
      warnings.filter((warning) => warning.message.includes('client is already executing a query')),
    ).toEqual([]);

    const claim = await pool.query(
      `update ai_import_plans
       set status = 'submitting'
       where id = $1 and status = 'pending'
       returning id`,
      [first.id],
    );
    expect(claim.rows).toHaveLength(0);
  });

  it('lazily expires pending plans and never revives them', async () => {
    const plan = await service.prepare(await prepareInput());
    await pool.query(
      `update ai_import_plans
       set created_at = clock_timestamp() - interval '31 minutes',
           expires_at = clock_timestamp() - interval '1 minute'
       where id = $1`,
      [plan.id],
    );

    await expect(service.status(plan.id)).resolves.toBe('expired');
    await pool.query(
      `update ai_import_plans set expires_at = clock_timestamp() + interval '1 hour'`,
    );
    await expect(service.status(plan.id)).resolves.toBe('expired');
  });

  it('invalidates a pending plan when an existing dependency changes', async () => {
    const plan = await service.prepare(await prepareInput());
    await pool.query(
      `update abstract_events
       set description = '人工修改后的说明',
           updated_at = clock_timestamp()
       where id = $1`,
      [eventAId],
    );

    await expect(service.status(plan.id)).resolves.toBe('invalidated');
    await pool.query(
      `update abstract_events
       set description = '港口暂停装卸',
           updated_at = '2026-07-28T10:00:00.000Z'
       where id = $1`,
      [eventAId],
    );
    await expect(service.status(plan.id)).resolves.toBe('invalidated');
  });

  it('stores old and new event descriptions plus an automatic confidence preview', async () => {
    const plan = await service.prepare(
      await prepareInput({
        replaceDescription: '港口停止全部装卸作业',
        createSecondLink: true,
      }),
    );
    const stored = await pool.query<{ plan_payload: { mutations: PreparedMutationSet } }>(
      `select plan_payload from ai_import_plans where id = $1`,
      [plan.id],
    );
    const mutations = stored.rows[0]!.plan_payload.mutations;

    expect(mutations.updateEvents).toEqual([
      expect.objectContaining({
        ref: 'event-a',
        oldDescription: '港口暂停装卸',
        newDescription: '港口停止全部装卸作业',
      }),
    ]);
    expect(mutations.confidenceChanges).toEqual([
      {
        relationRef: 'relation-a',
        relationId,
        oldConfidence: 19,
        newConfidence: 27.1,
        oldCaseCount: 1,
        newCaseCount: 2,
      },
    ]);
    expect(plan.summary).toMatchObject({
      eventUpdated: 1,
      relationCaseCreated: 1,
      relationCaseReused: 1,
      confidenceChanged: 1,
    });
  });

  it('keeps a no-change plan pending and executable', async () => {
    const plan = await service.prepare(await prepareInput());
    const stored = await pool.query<{
      plan_payload: { mutations: PreparedMutationSet; payloadHash: string };
    }>(`select plan_payload from ai_import_plans where id = $1`, [plan.id]);
    const payload = stored.rows[0]!.plan_payload;

    expect(plan.status).toBe('pending');
    expect(payload.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.mutations).toMatchObject({
      createEvents: [],
      updateEvents: [],
      createCases: [],
      createRelations: [],
      createLinks: [],
      confidenceChanges: [],
    });
    await expect(service.status(plan.id)).resolves.toBe('pending');
  });
});
