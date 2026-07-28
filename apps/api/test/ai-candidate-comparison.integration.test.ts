import { aiCaptureComparisonSchema, type AiCaptureCandidateSet } from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAiCandidateComparisonRepository } from '../src/features/ai-capture/aiCandidateComparisonRepository.js';
import { AiCandidateComparisonService } from '../src/features/ai-capture/aiCandidateComparisonService.js';
import type { AiSemanticCandidateService } from '../src/features/ai-capture/aiSemanticCandidateService.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const exactEventId = '10000000-0000-4000-8000-000000000001';
const aliasEventId = '10000000-0000-4000-8000-000000000002';
const fuzzyEventId = '10000000-0000-4000-8000-000000000003';
const semanticEventId = '10000000-0000-4000-8000-000000000004';
const existingRelationId = '20000000-0000-4000-8000-000000000001';
const exactCaseId = '30000000-0000-4000-8000-000000000001';
const otherOccurrenceCaseId = '30000000-0000-4000-8000-000000000002';

describe.sequential('AI candidate comparison PostgreSQL integration', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_ai_candidate_comparison_test');
    ({ pool } = context);
    await pool!.query(
      `insert into abstract_events (id, name, description)
       values
         ($1, '市场需求下降', '市场购买意愿和订单总量减少'),
         ($2, '企业订单减少', '企业收到的订单数量下降'),
         ($3, '工业产能利用率持续上升', '生产设备使用比例提高'),
         ($4, '企业资本开支增加', '企业增加长期资产投资')`,
      [exactEventId, aliasEventId, fuzzyEventId, semanticEventId],
    );
    await pool!.query(`insert into event_aliases (event_id, alias) values ($1, '订单回落')`, [
      aliasEventId,
    ]);
    await pool!.query(
      `insert into event_keywords (event_id, keyword, position)
       values
         ($1, '需求', 1),
         ($2, '订单', 1),
         ($3, '产能利用率', 1),
         ($4, '资本开支', 1)`,
      [exactEventId, aliasEventId, fuzzyEventId, semanticEventId],
    );
    await pool!.query(
      `insert into concrete_cases (id, content)
       values
         ($1, '2025年上海甲公司库存明显上升'),
         ($2, '2026年深圳乙公司库存明显上升')`,
      [exactCaseId, otherOccurrenceCaseId],
    );
    await pool!.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id, confidence,
         baseline_confidence, baseline_case_count, description
       )
       values ($1, $2, $3, 19, 10, 0, '需求下降导致订单减少')`,
      [existingRelationId, exactEventId, aliasEventId],
    );
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [existingRelationId, exactCaseId],
    );
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  it('separates ranked event, case, relation, and relation-case comparisons', async () => {
    const semantic: Pick<AiSemanticCandidateService, 'compare'> = {
      compare: async (entityType) =>
        entityType === 'event'
          ? [
              [{ id: aliasEventId, similarity: 0.88 }],
              [],
              [],
              [{ id: semanticEventId, similarity: 0.94 }],
            ]
          : [
              [{ id: otherOccurrenceCaseId, similarity: 0.82 }],
              [{ id: exactCaseId, similarity: 0.81 }],
            ],
    };
    const service = new AiCandidateComparisonService(
      new PostgresAiCandidateComparisonRepository(pool!),
      semantic,
    );
    const input: AiCaptureCandidateSet = {
      topic: '供需变化',
      clientName: 'integration-test',
      atomicEvents: [
        {
          ref: 'event-exact',
          name: '市场需求下降',
          description: null,
          aliases: [],
          keywords: [],
        },
        {
          ref: 'event-alias',
          name: '订单回落',
          description: null,
          aliases: [],
          keywords: [],
        },
        {
          ref: 'event-fuzzy',
          name: '工业产能利用率上升',
          description: null,
          aliases: [],
          keywords: [],
        },
        {
          ref: 'event-semantic',
          name: '企业长期投资增长',
          description: null,
          aliases: [],
          keywords: [],
        },
      ],
      concreteCases: [
        { ref: 'case-linked', content: '2025年上海甲公司库存明显上升' },
        { ref: 'case-unlinked', content: '2026年深圳乙公司库存明显上升' },
      ],
      causalRelations: [
        {
          ref: 'relation-existing',
          causeEventRef: 'event-exact',
          effectEventRef: 'event-alias',
          description: null,
        },
        {
          ref: 'relation-reverse',
          causeEventRef: 'event-alias',
          effectEventRef: 'event-exact',
          description: null,
        },
        {
          ref: 'relation-missing',
          causeEventRef: 'event-fuzzy',
          effectEventRef: 'event-semantic',
          description: null,
        },
      ],
      relationCaseLinks: [
        { relationRef: 'relation-existing', caseRef: 'case-linked' },
        { relationRef: 'relation-existing', caseRef: 'case-unlinked' },
      ],
    };

    const result = await service.compare(input);

    expect(aiCaptureComparisonSchema.safeParse(result).success).toBe(true);
    expect(result.atomicEvents.map((comparison) => comparison.ref)).toEqual([
      'event-exact',
      'event-alias',
      'event-fuzzy',
      'event-semantic',
    ]);
    expect(result.atomicEvents[0]!.matches[0]).toMatchObject({
      id: exactEventId,
      matchKind: 'exact_name',
      aliases: [],
      keywords: ['需求'],
    });
    expect(result.atomicEvents[1]!.matches[0]).toMatchObject({
      id: aliasEventId,
      matchKind: 'exact_alias',
      aliases: ['订单回落'],
      keywords: ['订单'],
    });
    expect(result.atomicEvents[2]!.matches[0]).toMatchObject({
      id: fuzzyEventId,
      matchKind: 'fuzzy',
    });
    expect(result.atomicEvents[3]!.matches[0]).toMatchObject({
      id: semanticEventId,
      matchKind: 'semantic',
      similarity: 0.94,
    });

    expect(result.concreteCases[0]!.matches.map((match) => match.id)).toEqual([
      exactCaseId,
      otherOccurrenceCaseId,
    ]);
    expect(result.concreteCases[0]!.matches.map((match) => match.matchKind)).toEqual([
      'exact_content',
      'fuzzy',
    ]);
    expect(result.concreteCases[1]!.matches.map((match) => match.id)).toEqual([
      otherOccurrenceCaseId,
      exactCaseId,
    ]);

    expect(result.causalRelations).toEqual([
      {
        ref: 'relation-existing',
        status: 'existing',
        relation: expect.objectContaining({
          id: existingRelationId,
          causeEventId: exactEventId,
          effectEventId: aliasEventId,
          confidence: 19,
          caseCount: 1,
        }),
      },
      {
        ref: 'relation-reverse',
        status: 'reverse',
        relation: expect.objectContaining({ id: existingRelationId }),
      },
      { ref: 'relation-missing', status: 'missing' },
    ]);
    expect(result.relationCaseLinks).toEqual([
      { relationRef: 'relation-existing', caseRef: 'case-linked', exists: true },
      { relationRef: 'relation-existing', caseRef: 'case-unlinked', exists: false },
    ]);
  });
});
