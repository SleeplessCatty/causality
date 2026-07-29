import { describe, expect, it } from 'vitest';

import {
  EMPTY_AI_CAPTURE_QUALITY_REPORT,
  aiCaptureCandidateSetOutputSchema,
  aiCaptureCandidateSetSchema,
  aiCaptureComparisonSchema,
  aiCaptureDecisionSetSchema,
  aiCaptureQualityReportSchema,
  aiImportBatchListResponseSchema,
  aiImportCommitResultSchema,
  aiImportPlanSchema,
  aiImportPlanStatusSchema,
  aiImportRecordListResponseSchema,
  aiWorkflowErrorSchema,
  prepareAiImportPlanInputSchema,
} from '../src/index.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const caseId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';
const planId = '44444444-4444-4444-8444-444444444444';
const historyId = '55555555-5555-4555-8555-555555555555';
const recordId = '66666666-6666-4666-8666-666666666666';
const createdAt = '2026-07-28T10:00:00.000Z';
const expiresAt = '2026-07-28T10:30:00.000Z';

const candidateSet = {
  topic: '供应链中断的影响',
  clientName: 'test-client',
  atomicEvents: [
    {
      ref: 'event-1',
      name: '港口停止作业',
      description: null,
      aliases: [],
      keywords: [],
    },
    {
      ref: 'event-2',
      name: '零部件到货延迟',
      description: null,
      aliases: [],
      keywords: [],
    },
  ],
  concreteCases: [{ ref: 'case-1', content: '2025年某港口停运后汽车零部件延迟到货' }],
  causalRelations: [
    {
      ref: 'relation-1',
      causeEventRef: 'event-1',
      effectEventRef: 'event-2',
      description: null,
    },
  ],
  relationCaseLinks: [{ relationRef: 'relation-1', caseRef: 'case-1' }],
};

const comparison = {
  atomicEvents: [
    {
      ref: 'event-1',
      matches: [
        {
          id: eventId,
          name: '港口停止作业',
          description: null,
          aliases: [],
          keywords: [],
          matchKind: 'exact_name',
          similarity: 1,
          updatedAt: createdAt,
        },
      ],
    },
  ],
  concreteCases: [
    {
      ref: 'case-1',
      matches: [
        {
          id: caseId,
          content: '2025年某港口停运后汽车零部件延迟到货',
          matchKind: 'exact_content',
          similarity: 1,
          updatedAt: createdAt,
        },
      ],
    },
  ],
  causalRelations: [
    {
      ref: 'relation-1',
      status: 'existing',
      relation: {
        id: relationId,
        causeEventId: eventId,
        effectEventId: eventId,
        description: null,
        confidence: 19,
        caseCount: 1,
        updatedAt: createdAt,
      },
    },
  ],
  relationCaseLinks: [{ relationRef: 'relation-1', caseRef: 'case-1', exists: true }],
  qualityReport: {
    version: 1,
    status: 'passed' as const,
    issues: [],
    topicRelevance: [],
  },
};

const decisions = {
  atomicEvents: [
    {
      ref: 'event-1',
      action: 'reuse',
      existingId: eventId,
      appendAliases: ['港口停工'],
      appendKeywords: ['供应链'],
      replaceDescription: '港口因外部因素停止装卸作业',
    },
    { ref: 'event-2', action: 'create' },
  ],
  concreteCases: [{ ref: 'case-1', action: 'reuse', existingId: caseId }],
  causalRelations: [{ ref: 'relation-1', action: 'reuse', existingId: relationId }],
  relationCaseLinks: [{ relationRef: 'relation-1', caseRef: 'case-1', action: 'reuse' }],
};

const zeroCounts = {
  eventCreated: 0,
  eventReused: 0,
  eventUpdated: 0,
  caseCreated: 0,
  caseReused: 0,
  relationCreated: 0,
  relationReused: 0,
  relationCaseCreated: 0,
  relationCaseReused: 0,
  confidenceChanged: 0,
};

const qualityReport = {
  version: 1,
  status: 'warning' as const,
  issues: [
    {
      code: 'AI_QUALITY_ORPHAN_EVENT' as const,
      severity: 'warning' as const,
      phase: 'candidate' as const,
      entityType: 'event' as const,
      refs: ['event-1'],
      paths: ['/atomicEvents/0'],
      message: '原子事件尚未关联因果关系',
      suggestedAction: '补充因果关系或确认保留',
      aiCanRepair: true,
    },
  ],
  topicRelevance: [{ ref: 'event-1', similarity: 0.7 }],
};

describe('AI capture candidate contracts', () => {
  it('accepts a complete strict candidate set', () => {
    expect(aiCaptureCandidateSetSchema.parse(candidateSet)).toEqual(candidateSet);
  });

  it('defaults optional event attributes and relation descriptions', () => {
    expect(
      aiCaptureCandidateSetSchema.parse({
        topic: '需求变化',
        clientName: 'test-client',
        atomicEvents: [
          { ref: 'event-1', name: '市场需求下降' },
          { ref: 'event-2', name: '企业库存上升' },
        ],
        concreteCases: [],
        causalRelations: [
          {
            ref: 'relation-1',
            causeEventRef: 'event-1',
            effectEventRef: 'event-2',
          },
        ],
        relationCaseLinks: [],
      }),
    ).toMatchObject({
      atomicEvents: [
        { description: null, aliases: [], keywords: [] },
        { description: null, aliases: [], keywords: [] },
      ],
      causalRelations: [{ description: null }],
    });
  });

  it('rejects more than 50 atomic events', () => {
    expect(
      aiCaptureCandidateSetSchema.safeParse({
        ...candidateSet,
        atomicEvents: Array.from({ length: 51 }, (_, index) => ({
          ref: `event-${index}`,
          name: `原子事件 ${index}`,
          description: null,
          aliases: [],
          keywords: [],
        })),
        causalRelations: [],
        relationCaseLinks: [],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: 'duplicate event refs',
      value: {
        ...candidateSet,
        atomicEvents: [candidateSet.atomicEvents[0], candidateSet.atomicEvents[0]],
        causalRelations: [],
        relationCaseLinks: [],
      },
    },
    {
      name: 'missing relation endpoints',
      value: {
        ...candidateSet,
        causalRelations: [
          {
            ...candidateSet.causalRelations[0],
            causeEventRef: 'missing-event',
          },
        ],
      },
    },
    {
      name: 'links to an unknown relation',
      value: {
        ...candidateSet,
        relationCaseLinks: [{ relationRef: 'missing-relation', caseRef: 'case-1' }],
      },
    },
    {
      name: 'links to an unknown case',
      value: {
        ...candidateSet,
        relationCaseLinks: [{ relationRef: 'relation-1', caseRef: 'missing-case' }],
      },
    },
  ])('rejects $name', ({ value }) => {
    expect(aiCaptureCandidateSetSchema.safeParse(value).success).toBe(false);
    expect(aiCaptureCandidateSetOutputSchema.safeParse(value).success).toBe(false);
  });

  it('reuses the 100-character concrete-case limit', () => {
    expect(
      aiCaptureCandidateSetSchema.safeParse({
        ...candidateSet,
        concreteCases: [{ ref: 'case-1', content: '案'.repeat(101) }],
      }).success,
    ).toBe(false);
  });

  it.each(['conversationTranscript', 'sourceUrl', 'modelReasoning'])(
    'rejects the non-business property %s',
    (property) => {
      expect(
        aiCaptureCandidateSetSchema.safeParse({ ...candidateSet, [property]: '不得保存' }).success,
      ).toBe(false);
    },
  );
});

describe('AI capture workflow contracts', () => {
  it('defaults a missing comparison quality report to an empty V1 report', () => {
    const comparisonWithoutQuality = { ...comparison };
    delete (comparisonWithoutQuality as Partial<typeof comparison>).qualityReport;
    expect(aiCaptureComparisonSchema.parse(comparisonWithoutQuality).qualityReport).toEqual({
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [],
    });
  });

  it('isolates the empty quality report across legacy comparison parses', () => {
    const comparisonWithoutQuality = { ...comparison };
    delete (comparisonWithoutQuality as Partial<typeof comparison>).qualityReport;
    const firstReport = aiCaptureComparisonSchema.parse(comparisonWithoutQuality).qualityReport;

    firstReport.issues.push(qualityReport.issues[0]!);
    firstReport.topicRelevance.push(qualityReport.topicRelevance[0]!);

    expect(aiCaptureComparisonSchema.parse(comparisonWithoutQuality).qualityReport).toEqual({
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [],
    });
    expect(EMPTY_AI_CAPTURE_QUALITY_REPORT).toEqual({
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [],
    });
  });

  it('accepts an optional workflow quality report and rejects unknown fields', () => {
    const workflowError = {
      category: 'data' as const,
      code: 'AI_PLAN_STALE',
      message: '依赖数据已经变化',
      affectedRefs: ['event-1'],
      aiCanRepair: true,
      retryCurrentPlan: false,
      suggestedAction: '重新对比并生成方案',
    };
    expect(aiWorkflowErrorSchema.parse({ ...workflowError, qualityReport }).qualityReport).toEqual(
      qualityReport,
    );
    expect(aiCaptureQualityReportSchema.safeParse({ ...qualityReport, extra: true }).success).toBe(
      false,
    );
  });

  it('accepts strict decisions and immutable plan preparation input', () => {
    expect(aiCaptureDecisionSetSchema.parse(decisions)).toEqual(decisions);
    expect(
      prepareAiImportPlanInputSchema.parse({
        candidates: candidateSet,
        comparison,
        decisions,
      }),
    ).toMatchObject({ candidates: { topic: candidateSet.topic }, decisions });
  });

  it('accepts every approved plan status and rejects unknown states', () => {
    const statuses = [
      'pending',
      'replaced',
      'invalidated',
      'expired',
      'submitting',
      'committed',
      'data_failed',
      'system_failed',
    ] as const;
    for (const status of statuses) {
      expect(aiImportPlanStatusSchema.parse(status)).toBe(status);
    }
    expect(aiImportPlanStatusSchema.safeParse('cancelled').success).toBe(false);
  });

  it('accepts plans, commit results, and paginated successful history', () => {
    const plan = {
      id: planId,
      version: 1,
      replacesPlanId: null,
      status: 'pending',
      topic: candidateSet.topic,
      clientName: candidateSet.clientName,
      candidates: candidateSet,
      comparison,
      decisions,
      summary: zeroCounts,
      createdAt,
      expiresAt,
      committedAt: null,
      error: null,
      result: null,
    };
    expect(aiImportPlanSchema.parse(plan)).toEqual(plan);

    const result = {
      planId,
      historyId,
      marker: `[Causality-Capture: ${historyId}]`,
      noChanges: true,
      counts: zeroCounts,
      completedAt: expiresAt,
    };
    expect(aiImportCommitResultSchema.parse(result)).toEqual(result);

    const batch = {
      id: historyId,
      planId,
      topic: candidateSet.topic,
      planVersion: 1,
      clientName: candidateSet.clientName,
      completedAt: expiresAt,
      counts: zeroCounts,
    };
    expect(
      aiImportBatchListResponseSchema.parse({
        items: [batch],
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
      }).items,
    ).toEqual([batch]);

    expect(
      aiImportRecordListResponseSchema.parse({
        items: [
          {
            id: recordId,
            sequence: 1,
            recordType: 'event',
            action: 'reused',
            primaryRecordId: eventId,
            relatedRecordId: null,
            detail: { name: '港口停止作业' },
          },
        ],
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
      }).items,
    ).toHaveLength(1);
  });

  it('accepts structured repairable data errors and rejects extra details', () => {
    const error = {
      category: 'data',
      code: 'AI_PLAN_STALE',
      message: '依赖数据已经变化',
      affectedRefs: ['event-1'],
      aiCanRepair: true,
      retryCurrentPlan: false,
      suggestedAction: '重新对比并生成方案',
    };
    expect(aiWorkflowErrorSchema.parse(error)).toEqual(error);
    expect(aiWorkflowErrorSchema.safeParse({ ...error, stack: 'internal detail' }).success).toBe(
      false,
    );
  });
});
