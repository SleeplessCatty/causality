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

    const semantic: Pick<AiSemanticCandidateService, 'compare' | 'topicRelevance'> = {
      compare: async (_entityType, texts) => texts.map(() => []),
      topicRelevance: async (_topic, events) =>
        events.map((event, index) => ({
          ref: event.ref,
          similarity: index === 0 ? 0.4 : 0.6,
        })),
    };
    comparisonService = new AiCandidateComparisonService(
      new PostgresAiCandidateComparisonRepository(pool),
      semantic,
    );
    service = new AiImportPlanService(new PostgresAiImportPlanRepository(pool), semantic);
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

  function reorderedWarningInput(reverse: boolean): PrepareAiImportPlanInput {
    const candidates: AiCaptureCandidateSet = {
      topic: '供应链递进影响',
      clientName: 'canonical-plan-test',
      atomicEvents: [
        {
          ref: 'event-a',
          name: '上游供应减少',
          description: null,
          aliases: [],
          keywords: [],
        },
        {
          ref: 'event-b',
          name: '工厂库存下降',
          description: null,
          aliases: [],
          keywords: [],
        },
        {
          ref: 'event-c',
          name: '客户交付延迟',
          description: null,
          aliases: [],
          keywords: [],
        },
      ],
      concreteCases: [
        { ref: 'case-a', content: '2026年上游供应减少后工厂库存下降' },
        { ref: 'case-b', content: '2026年工厂库存下降后客户交付延迟' },
      ],
      causalRelations: [
        {
          ref: 'relation-1',
          causeEventRef: 'event-a',
          effectEventRef: 'event-b',
          description: null,
        },
        {
          ref: 'relation-2',
          causeEventRef: 'event-b',
          effectEventRef: 'event-c',
          description: null,
        },
        {
          ref: 'relation-3',
          causeEventRef: 'event-a',
          effectEventRef: 'event-c',
          description: null,
        },
      ],
      relationCaseLinks: [
        { relationRef: 'relation-1', caseRef: 'case-a' },
        { relationRef: 'relation-2', caseRef: 'case-b' },
      ],
    };
    const comparison = {
      atomicEvents: candidates.atomicEvents.map(({ ref }) => ({ ref, matches: [] })),
      concreteCases: candidates.concreteCases.map(({ ref }) => ({ ref, matches: [] })),
      causalRelations: candidates.causalRelations.map(({ ref }) => ({
        ref,
        status: 'missing' as const,
      })),
      relationCaseLinks: candidates.relationCaseLinks.map((link) => ({ ...link, exists: false })),
      qualityReport: {
        version: 1 as const,
        status: 'passed' as const,
        issues: [],
        topicRelevance: [],
      },
    };
    const decisions: AiCaptureDecisionSet = {
      atomicEvents: candidates.atomicEvents.map(({ ref }) => ({ ref, action: 'create' })),
      concreteCases: candidates.concreteCases.map(({ ref }) => ({ ref, action: 'create' })),
      causalRelations: candidates.causalRelations.map(({ ref }) => ({ ref, action: 'create' })),
      relationCaseLinks: candidates.relationCaseLinks.map((link) => ({
        ...link,
        action: 'create',
      })),
    };

    if (reverse) {
      candidates.atomicEvents.reverse();
      candidates.concreteCases.reverse();
      candidates.causalRelations.reverse();
      candidates.relationCaseLinks.reverse();
      comparison.atomicEvents.reverse();
      comparison.concreteCases.reverse();
      comparison.causalRelations.reverse();
      comparison.relationCaseLinks.reverse();
      decisions.atomicEvents.reverse();
      decisions.concreteCases.reverse();
      decisions.causalRelations.reverse();
      decisions.relationCaseLinks.reverse();
    }

    return { candidates, comparison, decisions };
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

  it.each([
    {
      name: 'event',
      refs: ['event-a'],
      change(value: PrepareAiImportPlanInput) {
        value.comparison.atomicEvents[0]!.matches = [];
        value.decisions.atomicEvents[0] = { ref: 'event-a', action: 'create' };
        value.comparison.causalRelations[0] = { ref: 'relation-a', status: 'missing' };
        value.decisions.causalRelations[0] = { ref: 'relation-a', action: 'create' };
        value.comparison.relationCaseLinks[0]!.exists = false;
        value.decisions.relationCaseLinks[0] = {
          relationRef: 'relation-a',
          caseRef: 'case-linked',
          action: 'create',
        };
      },
    },
    {
      name: 'case',
      refs: ['case-linked'],
      change(value: PrepareAiImportPlanInput) {
        value.comparison.concreteCases[0]!.matches = [];
        value.decisions.concreteCases[0] = { ref: 'case-linked', action: 'create' };
        value.comparison.relationCaseLinks[0]!.exists = false;
        value.decisions.relationCaseLinks[0] = {
          relationRef: 'relation-a',
          caseRef: 'case-linked',
          action: 'create',
        };
      },
    },
    {
      name: 'relation',
      refs: ['relation-a'],
      change(value: PrepareAiImportPlanInput) {
        value.comparison.causalRelations[0] = { ref: 'relation-a', status: 'missing' };
        value.decisions.causalRelations[0] = { ref: 'relation-a', action: 'create' };
        value.comparison.relationCaseLinks[0]!.exists = false;
        value.decisions.relationCaseLinks[0] = {
          relationRef: 'relation-a',
          caseRef: 'case-linked',
          action: 'create',
        };
      },
    },
    {
      name: 'relation-case link',
      refs: ['relation-a', 'case-linked'],
      change(value: PrepareAiImportPlanInput) {
        value.comparison.relationCaseLinks[0]!.exists = false;
        value.decisions.relationCaseLinks[0] = {
          relationRef: 'relation-a',
          caseRef: 'case-linked',
          action: 'create',
        };
      },
    },
  ])(
    'blocks a create plan when a stale comparison omits a current exact $name',
    async ({ refs, change }) => {
      const value = await prepareInput();
      change(value);

      await expect(service.prepare(value)).rejects.toMatchObject({
        code: 'AI_PLAN_QUALITY_BLOCKED',
        qualityReport: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: 'AI_QUALITY_CREATE_EXACT_CONFLICT',
              refs,
            }),
          ]),
        },
      });
    },
  );

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

  it('canonicalizes reordered plan payloads before warning paths, hashing, and persistence', async () => {
    const first = await service.prepare(reorderedWarningInput(true));
    const second = await service.prepare(reorderedWarningInput(false));
    const stored = await pool.query<{
      id: string;
      candidate_payload: AiCaptureCandidateSet;
      plan_payload: {
        comparison: AiImportPlan['comparison'];
        decisions: AiCaptureDecisionSet;
        payloadHash: string;
      };
    }>(
      `select id, candidate_payload, plan_payload
       from ai_import_plans
       where id = any($1::uuid[])
       order by id`,
      [[first.id, second.id]],
    );

    for (const plan of [first, second]) {
      const shortcut = plan.comparison.qualityReport.issues.find(
        (issue) => issue.code === 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED',
      );
      expect(plan.candidates.atomicEvents.map(({ ref }) => ref)).toEqual([
        'event-a',
        'event-b',
        'event-c',
      ]);
      expect(plan.candidates.concreteCases.map(({ ref }) => ref)).toEqual(['case-a', 'case-b']);
      expect(plan.candidates.causalRelations.map(({ ref }) => ref)).toEqual([
        'relation-1',
        'relation-2',
        'relation-3',
      ]);
      expect(plan.candidates.relationCaseLinks).toEqual([
        { relationRef: 'relation-1', caseRef: 'case-a' },
        { relationRef: 'relation-2', caseRef: 'case-b' },
      ]);
      expect(plan.comparison.atomicEvents.map(({ ref }) => ref)).toEqual([
        'event-a',
        'event-b',
        'event-c',
      ]);
      expect(plan.comparison.concreteCases.map(({ ref }) => ref)).toEqual(['case-a', 'case-b']);
      expect(plan.comparison.causalRelations.map(({ ref }) => ref)).toEqual([
        'relation-1',
        'relation-2',
        'relation-3',
      ]);
      expect(
        plan.comparison.relationCaseLinks.map(({ relationRef, caseRef }) => [relationRef, caseRef]),
      ).toEqual([
        ['relation-1', 'case-a'],
        ['relation-2', 'case-b'],
      ]);
      expect(plan.decisions.atomicEvents.map(({ ref }) => ref)).toEqual([
        'event-a',
        'event-b',
        'event-c',
      ]);
      expect(plan.decisions.concreteCases.map(({ ref }) => ref)).toEqual(['case-a', 'case-b']);
      expect(plan.decisions.causalRelations.map(({ ref }) => ref)).toEqual([
        'relation-1',
        'relation-2',
        'relation-3',
      ]);
      expect(
        plan.decisions.relationCaseLinks.map(({ relationRef, caseRef }) => [relationRef, caseRef]),
      ).toEqual([
        ['relation-1', 'case-a'],
        ['relation-2', 'case-b'],
      ]);
      expect(plan.decisions.causalRelations[2]).toMatchObject({ ref: 'relation-3' });
      expect(shortcut).toMatchObject({
        refs: ['relation-3'],
        paths: ['/decisions/causalRelations/2'],
      });

      const row = stored.rows.find((candidate) => candidate.id === plan.id)!;
      expect(row.candidate_payload).toEqual(plan.candidates);
      expect(row.plan_payload.decisions).toEqual(plan.decisions);
      expect(row.plan_payload.comparison).toEqual(plan.comparison);
    }

    expect(first.comparison.qualityReport).toEqual(second.comparison.qualityReport);
    expect(stored.rows[0]!.plan_payload.payloadHash).toBe(stored.rows[1]!.plan_payload.payloadHash);
  });

  it('accepts a legacy comparison without a quality report and stores a fresh report', async () => {
    const value = await prepareInput();
    delete (value.comparison as unknown as { qualityReport?: unknown }).qualityReport;

    const plan = await service.prepare(value);

    expect(plan.comparison.qualityReport).toEqual({
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [
        { ref: 'event-a', similarity: 0.4 },
        { ref: 'event-b', similarity: 0.6 },
      ],
    });
  });

  it('reads an old persisted plan without a quality report as an empty V1 report', async () => {
    const plan = await service.prepare(await prepareInput());
    await pool.query(
      `update ai_import_plans
       set plan_payload = plan_payload #- '{comparison,qualityReport}'
       where id = $1`,
      [plan.id],
    );

    const restored = await service.get(plan.id);

    expect(restored.comparison.qualityReport).toEqual({
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [],
    });
  });

  it('allows and persists recomputed warnings', async () => {
    const value = await prepareInput();
    value.candidates.atomicEvents[0]!.name = '港口停止作业并且零部件到货延迟';

    const plan = await service.prepare(value);

    expect(plan.comparison.qualityReport).toMatchObject({
      status: 'warning',
      issues: [
        expect.objectContaining({
          code: 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED',
          severity: 'warning',
          phase: 'plan',
          paths: ['/decisions/atomicEvents/0'],
        }),
      ],
    });
    const stored = await pool.query<{ plan_payload: { comparison: AiImportPlan['comparison'] } }>(
      `select plan_payload from ai_import_plans where id = $1`,
      [plan.id],
    );
    expect(stored.rows[0]!.plan_payload.comparison.qualityReport.status).toBe('warning');
  });

  it('does not insert a plan when the recomputed gate blocks', async () => {
    const value = await prepareInput();
    value.decisions.causalRelations[0] = {
      ref: 'relation-a',
      action: 'skip',
      reason: '关系暂不入库',
    };
    value.decisions.relationCaseLinks[0] = {
      relationRef: 'relation-a',
      caseRef: 'case-linked',
      action: 'skip',
      reason: '关联随关系跳过',
    };

    await expect(service.prepare(value)).rejects.toMatchObject({
      code: 'AI_PLAN_QUALITY_BLOCKED',
    });
    const count = await pool.query<{ count: string }>(`select count(*) from ai_import_plans`);
    expect(Number(count.rows[0]!.count)).toBe(0);
  });

  it('does not insert a plan when existing mutation validation is mapped', async () => {
    const value = await prepareInput();
    value.comparison.atomicEvents[0]!.matches[0]!.updatedAt = '2026-07-28T09:59:59.000Z';

    await expect(service.prepare(value)).rejects.toMatchObject({
      code: 'AI_PLAN_QUALITY_BLOCKED',
      qualityReport: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'AI_QUALITY_COMPARISON_STALE' }),
        ]),
      },
    });
    const count = await pool.query<{ count: string }>(`select count(*) from ai_import_plans`);
    expect(Number(count.rows[0]!.count)).toBe(0);
  });

  it.each([
    {
      scenario: 'candidate name matches a stored alias',
      name: '港口停工',
      aliases: [] as string[],
    },
    {
      scenario: 'candidate alias matches the stored name',
      name: '港口作业中断',
      aliases: ['港口停止作业'],
    },
  ])(
    'treats an exact event-alias create as an exact-existing conflict when $scenario',
    async ({ name, aliases }) => {
      const value = await prepareInput();
      value.candidates.atomicEvents[0]!.name = name;
      value.candidates.atomicEvents[0]!.aliases = aliases;
      value.comparison.atomicEvents[0]!.matches[0]!.matchKind = 'exact_alias';
      value.decisions.atomicEvents[0] = { ref: 'event-a', action: 'create' };

      await expect(service.prepare(value)).rejects.toMatchObject({
        code: 'AI_PLAN_QUALITY_BLOCKED',
        qualityReport: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: 'AI_QUALITY_CREATE_EXACT_CONFLICT',
              refs: ['event-a'],
              suggestedAction: '复用精确匹配的已有记录，或跳过该候选或关联',
            }),
          ]),
        },
      });
      const count = await pool.query<{ count: string }>(`select count(*) from ai_import_plans`);
      expect(Number(count.rows[0]!.count)).toBe(0);
    },
  );

  it('keeps exact-existing creates distinct from reuse-resolved self-loops without inserting plans', async () => {
    const exactExisting = await prepareInput();
    exactExisting.decisions.atomicEvents[0] = { ref: 'event-a', action: 'create' };

    await expect(service.prepare(exactExisting)).rejects.toMatchObject({
      code: 'AI_PLAN_QUALITY_BLOCKED',
      qualityReport: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'AI_QUALITY_CREATE_EXACT_CONFLICT',
            message: '创建决策对应的数据已存在',
            suggestedAction: '复用精确匹配的已有记录，或跳过该候选或关联',
          }),
        ]),
      },
    });
    let count = await pool.query<{ count: string }>(`select count(*) from ai_import_plans`);
    expect(Number(count.rows[0]!.count)).toBe(0);

    const selfLoop = await prepareInput();
    selfLoop.comparison.atomicEvents[1]!.matches = [
      selfLoop.comparison.atomicEvents[0]!.matches[0]!,
    ];
    selfLoop.decisions.atomicEvents[1] = {
      ref: 'event-b',
      action: 'reuse',
      existingId: eventAId,
      appendAliases: [],
      appendKeywords: [],
    };
    selfLoop.comparison.causalRelations = [{ ref: 'relation-a', status: 'missing' }];
    selfLoop.decisions.causalRelations = [{ ref: 'relation-a', action: 'create' }];

    await expect(service.prepare(selfLoop)).rejects.toMatchObject({
      code: 'AI_PLAN_QUALITY_BLOCKED',
      qualityReport: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'AI_QUALITY_SELF_LOOP',
            refs: ['relation-a'],
            message: '关系两端在复用后指向同一个原子事件',
            suggestedAction: '修改原因事件或结果事件的复用目标，或跳过该因果关系',
          }),
        ]),
      },
    });
    count = await pool.query<{ count: string }>(`select count(*) from ai_import_plans`);
    expect(Number(count.rows[0]!.count)).toBe(0);
  });

  it('does not persist forged client status, issues, or topic signals', async () => {
    const value = await prepareInput();
    value.comparison.qualityReport = {
      version: 1,
      status: 'blocked',
      issues: [
        {
          code: 'AI_QUALITY_REPORT_BLOCKED',
          severity: 'error',
          phase: 'plan',
          entityType: 'batch',
          refs: ['forged-ref'],
          paths: ['/decisions'],
          message: '伪造问题',
          suggestedAction: '不应保存',
          aiCanRepair: true,
        },
      ],
      topicRelevance: [{ ref: 'event-a', similarity: 1 }],
    };

    const plan = await service.prepare(value);

    expect(plan.comparison.qualityReport).toEqual({
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [
        { ref: 'event-a', similarity: 0.4 },
        { ref: 'event-b', similarity: 0.6 },
      ],
    });
  });
});
