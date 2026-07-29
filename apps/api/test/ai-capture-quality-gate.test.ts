import {
  aiCaptureCandidateSetSchema,
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AiCaptureQualityIssue,
  type PrepareAiImportPlanInput,
} from '@causality/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AiCaptureQualityGate,
  buildQualityReport,
  mergeQualityReports,
  qualityReportFromZodError,
} from '../src/features/ai-capture/aiCaptureQualityGate.js';

const gate = new AiCaptureQualityGate();
const existingEventId = '10000000-0000-4000-8000-000000000001';
const otherEventId = '10000000-0000-4000-8000-000000000002';
const existingCaseId = '20000000-0000-4000-8000-000000000001';
const updatedAt = '2026-07-29T00:00:00.000Z';

function candidates(overrides: Partial<AiCaptureCandidateSet> = {}): AiCaptureCandidateSet {
  return {
    topic: '供应链韧性',
    clientName: 'Codex',
    atomicEvents: [
      { ref: 'event-a', name: '原材料供应减少', description: null, aliases: [], keywords: [] },
      { ref: 'event-b', name: '生产成本上升', description: null, aliases: [], keywords: [] },
    ],
    concreteCases: [{ ref: 'case-a', content: '某厂因原材料短缺而延迟交付' }],
    causalRelations: [
      {
        ref: 'relation-ab',
        causeEventRef: 'event-a',
        effectEventRef: 'event-b',
        description: null,
      },
    ],
    relationCaseLinks: [{ relationRef: 'relation-ab', caseRef: 'case-a' }],
    ...overrides,
  };
}

function comparison(overrides: Partial<AiCaptureComparison> = {}): AiCaptureComparison {
  return {
    atomicEvents: [],
    concreteCases: [],
    causalRelations: [],
    relationCaseLinks: [],
    qualityReport: buildQualityReport([]),
    ...overrides,
  };
}

function planInput(
  candidateSet: AiCaptureCandidateSet = candidates(),
  comparisonOverrides: Partial<AiCaptureComparison> = {},
): PrepareAiImportPlanInput {
  return {
    candidates: candidateSet,
    comparison: comparison({
      atomicEvents: candidateSet.atomicEvents.map((event) => ({ ref: event.ref, matches: [] })),
      concreteCases: candidateSet.concreteCases.map((concreteCase) => ({
        ref: concreteCase.ref,
        matches: [],
      })),
      causalRelations: candidateSet.causalRelations.map((relation) => ({
        ref: relation.ref,
        status: 'missing',
      })),
      relationCaseLinks: candidateSet.relationCaseLinks.map((link) => ({
        ...link,
        exists: false,
      })),
      ...comparisonOverrides,
    }),
    decisions: {
      atomicEvents: candidateSet.atomicEvents.map((event) => ({
        ref: event.ref,
        action: 'create',
      })),
      concreteCases: candidateSet.concreteCases.map((concreteCase) => ({
        ref: concreteCase.ref,
        action: 'create',
      })),
      causalRelations: candidateSet.causalRelations.map((relation) => ({
        ref: relation.ref,
        action: 'create',
      })),
      relationCaseLinks: candidateSet.relationCaseLinks.map((link) => ({
        ...link,
        action: 'create',
      })),
    },
  };
}

const duplicateEventNameInput = candidates({
  atomicEvents: [
    { ref: 'event-a', name: '原材料供应减少', description: null, aliases: [], keywords: [] },
    { ref: 'event-b', name: '  原材料供应减少  ', description: null, aliases: [], keywords: [] },
  ],
});

const duplicateCaseInput = candidates({
  concreteCases: [
    { ref: 'case-a', content: '某厂因原材料短缺而延迟交付' },
    { ref: 'case-b', content: '  某厂因原材料短缺而延迟交付  ' },
  ],
  relationCaseLinks: [
    { relationRef: 'relation-ab', caseRef: 'case-a' },
    { relationRef: 'relation-ab', caseRef: 'case-b' },
  ],
});

const duplicateRelationInput = candidates({
  causalRelations: [
    {
      ref: 'relation-ab',
      causeEventRef: 'event-a',
      effectEventRef: 'event-b',
      description: null,
    },
    {
      ref: 'relation-ab-duplicate',
      causeEventRef: 'event-a',
      effectEventRef: 'event-b',
      description: null,
    },
  ],
  relationCaseLinks: [
    { relationRef: 'relation-ab', caseRef: 'case-a' },
    { relationRef: 'relation-ab-duplicate', caseRef: 'case-a' },
  ],
});

const orphanEventInput = candidates({
  atomicEvents: [
    { ref: 'event-a', name: '原材料供应减少', description: null, aliases: [], keywords: [] },
    { ref: 'event-b', name: '生产成本上升', description: null, aliases: [], keywords: [] },
    { ref: 'event-c', name: '市场需求下降', description: null, aliases: [], keywords: [] },
  ],
});

const orphanCaseInput = candidates({
  concreteCases: [
    { ref: 'case-a', content: '某厂因原材料短缺而延迟交付' },
    { ref: 'case-b', content: '未关联的案例内容' },
  ],
});

const compoundEventInput = candidates({
  atomicEvents: [
    {
      ref: 'event-a',
      name: '原材料供应减少并且生产成本上升',
      description: null,
      aliases: [],
      keywords: [],
    },
    { ref: 'event-b', name: '产品交付延迟', description: null, aliases: [], keywords: [] },
  ],
});

const aliasCollisionInput = candidates({
  atomicEvents: [
    {
      ref: 'event-a',
      name: '原材料供应减少',
      description: null,
      aliases: ['供给收缩'],
      keywords: [],
    },
    {
      ref: 'event-b',
      name: '生产成本上升',
      description: null,
      aliases: [' 原材料供应减少 '],
      keywords: [],
    },
  ],
});

const relationWithoutCaseInput = candidates({ concreteCases: [], relationCaseLinks: [] });

const transitiveInput = candidates({
  atomicEvents: [
    { ref: 'event-a', name: '原材料供应减少', description: null, aliases: [], keywords: [] },
    { ref: 'event-b', name: '生产成本上升', description: null, aliases: [], keywords: [] },
    { ref: 'event-c', name: '产品交付延迟', description: null, aliases: [], keywords: [] },
  ],
  causalRelations: [
    {
      ref: 'relation-ab',
      causeEventRef: 'event-a',
      effectEventRef: 'event-b',
      description: null,
    },
    {
      ref: 'relation-bc',
      causeEventRef: 'event-b',
      effectEventRef: 'event-c',
      description: null,
    },
    {
      ref: 'relation-ac',
      causeEventRef: 'event-a',
      effectEventRef: 'event-c',
      description: null,
    },
  ],
  relationCaseLinks: [
    { relationRef: 'relation-ab', caseRef: 'case-a' },
    { relationRef: 'relation-bc', caseRef: 'case-a' },
    { relationRef: 'relation-ac', caseRef: 'case-a' },
  ],
});

describe('AiCaptureQualityGate', () => {
  it('warns when two candidates share the same unique exact match', () => {
    const input = comparison({
      atomicEvents: ['event-a', 'event-b'].map((ref) => ({
        ref,
        matches: [
          {
            id: existingEventId,
            name: '市场需求下降',
            description: null,
            aliases: [],
            keywords: [],
            matchKind: 'exact_name',
            similarity: null,
            updatedAt,
          },
        ],
      })),
    });

    expect(
      gate.inspectComparison({
        candidates: candidates(),
        comparison: input,
        topicRelevance: [],
      }).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH',
        severity: 'warning',
        phase: 'comparison',
        entityType: 'event',
        refs: ['event-a', 'event-b'],
      }),
    );
  });

  it('warns when two concrete cases share the same unique exact match', () => {
    const input = comparison({
      concreteCases: ['case-a', 'case-b'].map((ref) => ({
        ref,
        matches: [
          {
            id: existingCaseId,
            content: '同一已有具体案例',
            matchKind: 'exact_content',
            similarity: null,
            updatedAt,
          },
        ],
      })),
    });

    expect(
      gate.inspectComparison({
        candidates: candidates(),
        comparison: input,
        topicRelevance: [],
      }).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'AI_QUALITY_CASES_SHARE_EXACT_MATCH',
        severity: 'warning',
        phase: 'comparison',
        entityType: 'case',
        refs: ['case-a', 'case-b'],
      }),
    );
  });

  it('warns when candidate events first match the same semantic event at the threshold', () => {
    const input = comparison({
      atomicEvents: ['event-a', 'event-b'].map((ref) => ({
        ref,
        matches: [
          {
            id: existingEventId,
            name: '市场需求下降',
            description: null,
            aliases: [],
            keywords: [],
            matchKind: 'semantic',
            similarity: 0.9,
            updatedAt,
          },
        ],
      })),
    });

    expect(
      gate.inspectComparison({
        candidates: candidates(),
        comparison: input,
        topicRelevance: [],
      }).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'AI_QUALITY_EVENT_SEMANTIC_DUPLICATE_SUSPECTED',
        refs: ['event-a', 'event-b'],
      }),
    );
  });

  it('warns when candidate cases first match the same semantic case above the threshold', () => {
    const input = comparison({
      concreteCases: ['case-a', 'case-b'].map((ref) => ({
        ref,
        matches: [
          {
            id: existingCaseId,
            content: '同一已有具体案例',
            matchKind: 'semantic',
            similarity: 0.91,
            updatedAt,
          },
        ],
      })),
    });

    expect(
      gate.inspectComparison({
        candidates: candidates(),
        comparison: input,
        topicRelevance: [],
      }).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'AI_QUALITY_CASE_SEMANTIC_DUPLICATE_SUSPECTED',
        refs: ['case-a', 'case-b'],
      }),
    );
  });

  it('does not warn for ambiguous exact identities', () => {
    const exactMatch = (id: string) => ({
      id,
      name: `已有事件 ${id}`,
      description: null,
      aliases: [],
      keywords: [],
      matchKind: 'exact_name' as const,
      similarity: null,
      updatedAt,
    });
    const input = comparison({
      atomicEvents: [
        { ref: 'event-a', matches: [exactMatch(existingEventId), exactMatch(otherEventId)] },
        { ref: 'event-b', matches: [exactMatch(existingEventId)] },
      ],
    });

    const report = gate.inspectComparison({
      candidates: candidates(),
      comparison: input,
      topicRelevance: [],
    });

    expect(report.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH' }),
      ]),
    );
  });

  it('does not warn unless every shared semantic target is the first match at 0.90 or higher', () => {
    const semanticMatch = (id: string, similarity: number) => ({
      id,
      name: `已有事件 ${id}`,
      description: null,
      aliases: [],
      keywords: [],
      matchKind: 'semantic' as const,
      similarity,
      updatedAt,
    });
    const fuzzyMatch = {
      ...semanticMatch(otherEventId, 0.99),
      matchKind: 'fuzzy' as const,
    };

    const belowThreshold = comparison({
      atomicEvents: [
        { ref: 'event-a', matches: [semanticMatch(existingEventId, 0.899)] },
        { ref: 'event-b', matches: [semanticMatch(existingEventId, 0.9)] },
      ],
    });
    const notFirst = comparison({
      atomicEvents: [
        {
          ref: 'event-a',
          matches: [fuzzyMatch, semanticMatch(existingEventId, 0.99)],
        },
        { ref: 'event-b', matches: [semanticMatch(existingEventId, 0.99)] },
      ],
    });

    for (const input of [belowThreshold, notFirst]) {
      expect(
        gate.inspectComparison({
          candidates: candidates(),
          comparison: input,
          topicRelevance: [],
        }).issues,
      ).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'AI_QUALITY_EVENT_SEMANTIC_DUPLICATE_SUSPECTED' }),
        ]),
      );
    }
  });

  it('preserves candidate issues and sorts topic signals without letting signals affect status', () => {
    const report = gate.inspectComparison({
      candidates: compoundEventInput,
      comparison: comparison(),
      topicRelevance: [
        { ref: 'event-b', similarity: 0.01 },
        { ref: 'event-a', similarity: 0.99 },
      ],
    });

    expect(report).toMatchObject({
      status: 'warning',
      issues: [expect.objectContaining({ code: 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED' })],
      topicRelevance: [
        { ref: 'event-a', similarity: 0.99 },
        { ref: 'event-b', similarity: 0.01 },
      ],
    });
  });

  it.each([
    ['duplicate event name', duplicateEventNameInput, 'AI_QUALITY_DUPLICATE_EVENT_NAME'],
    ['duplicate case content', duplicateCaseInput, 'AI_QUALITY_DUPLICATE_CASE_CONTENT'],
    ['duplicate relation', duplicateRelationInput, 'AI_QUALITY_DUPLICATE_RELATION'],
    ['orphan event', orphanEventInput, 'AI_QUALITY_ORPHAN_EVENT'],
    ['orphan case', orphanCaseInput, 'AI_QUALITY_ORPHAN_CASE'],
  ] as const)('%s is blocking', (_name, input, code) => {
    const report = gate.inspectCandidates(input);

    expect(report.status).toBe('blocked');
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it.each([
    ['compound event', compoundEventInput, 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED'],
    ['alias collision', aliasCollisionInput, 'AI_QUALITY_ALIAS_COLLISION'],
    ['relation without case', relationWithoutCaseInput, 'AI_QUALITY_RELATION_WITHOUT_CASE'],
    ['transitive shortcut', transitiveInput, 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED'],
  ] as const)('%s is warning only', (_name, input, code) => {
    const report = gate.inspectCandidates(input);

    expect(report.status).toBe('warning');
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    expect(report.issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('requires two independently recognizable changes before warning about a compound event', () => {
    const report = gate.inspectCandidates(
      candidates({
        atomicEvents: [
          { ref: 'event-a', name: '供应链并且韧性', description: null, aliases: [], keywords: [] },
          { ref: 'event-b', name: '生产成本上升', description: null, aliases: [], keywords: [] },
        ],
      }),
    );

    expect(report.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED' }),
      ]),
    );
  });

  it('returns accurate refs and JSON Pointer paths for candidate issues', () => {
    const report = gate.inspectCandidates(duplicateEventNameInput);

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'AI_QUALITY_DUPLICATE_EVENT_NAME',
        refs: ['event-b'],
        paths: ['/atomicEvents/1/name'],
      }),
    );
  });

  it('does not treat a duplicate event name as an alias collision', () => {
    const report = gate.inspectCandidates(duplicateEventNameInput);

    expect(report.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'AI_QUALITY_ALIAS_COLLISION' })]),
    );
  });

  it('sorts errors before warnings, then code, path, and ref deterministically', () => {
    const issues: AiCaptureQualityIssue[] = [
      {
        code: 'AI_QUALITY_ORPHAN_EVENT',
        severity: 'error',
        phase: 'candidate',
        entityType: 'event',
        refs: ['event-z'],
        paths: ['/atomicEvents/3'],
        message: 'z',
        suggestedAction: 'z',
        aiCanRepair: true,
      },
      {
        code: 'AI_QUALITY_ALIAS_COLLISION',
        severity: 'warning',
        phase: 'candidate',
        entityType: 'event',
        refs: ['event-a'],
        paths: ['/atomicEvents/0/aliases/0'],
        message: 'a',
        suggestedAction: 'a',
        aiCanRepair: true,
      },
      {
        code: 'AI_QUALITY_ORPHAN_EVENT',
        severity: 'error',
        phase: 'candidate',
        entityType: 'event',
        refs: ['event-a'],
        paths: ['/atomicEvents/1'],
        message: 'a',
        suggestedAction: 'a',
        aiCanRepair: true,
      },
    ];

    expect(buildQualityReport(issues).issues.map((issue) => issue.refs[0])).toEqual([
      'event-a',
      'event-z',
      'event-a',
    ]);
    expect(gate.inspectCandidates(transitiveInput)).toEqual(
      gate.inspectCandidates(transitiveInput),
    );
  });

  it('blocks active events and cases orphaned by skipped relation decisions', () => {
    const value = planInput();
    value.decisions.causalRelations[0] = {
      ref: 'relation-ab',
      action: 'skip',
      reason: '关系暂不入库',
    };
    value.decisions.relationCaseLinks[0] = {
      relationRef: 'relation-ab',
      caseRef: 'case-a',
      action: 'skip',
      reason: '关联随关系跳过',
    };

    const report = gate.inspectPlan(value);

    expect(report.status).toBe('blocked');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AI_QUALITY_ACTIVE_EVENT_ORPHANED',
          phase: 'plan',
          refs: ['event-a'],
          paths: ['/decisions/atomicEvents/0'],
        }),
        expect.objectContaining({
          code: 'AI_QUALITY_ACTIVE_CASE_ORPHANED',
          phase: 'plan',
          refs: ['case-a'],
          paths: ['/decisions/concreteCases/0'],
        }),
      ]),
    );
  });

  it('blocks active relations and links that depend on skipped decisions', () => {
    const value = planInput();
    value.decisions.atomicEvents[0] = {
      ref: 'event-a',
      action: 'skip',
      reason: '事件暂不入库',
    };
    value.decisions.concreteCases[0] = {
      ref: 'case-a',
      action: 'skip',
      reason: '案例暂不入库',
    };

    const report = gate.inspectPlan(value);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
          entityType: 'relation',
          refs: ['relation-ab', 'event-a'],
          paths: ['/decisions/causalRelations/0', '/decisions/atomicEvents/0'],
        }),
        expect.objectContaining({
          code: 'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
          entityType: 'link',
          refs: ['relation-ab', 'case-a'],
          paths: ['/decisions/relationCaseLinks/0', '/decisions/concreteCases/0'],
        }),
      ]),
    );
    expect(
      report.issues.every((issue) => issue.paths.every((path) => path.startsWith('/decisions'))),
    ).toBe(true);
  });

  it('keeps recomputed candidate and comparison warnings as plan-phase warnings', () => {
    const sharedMatch = {
      id: existingEventId,
      name: '已有事件',
      description: null,
      aliases: [],
      keywords: [],
      matchKind: 'exact_name' as const,
      similarity: null,
      updatedAt,
    };
    const value = planInput(compoundEventInput, {
      atomicEvents: [
        { ref: 'event-a', matches: [sharedMatch] },
        { ref: 'event-b', matches: [sharedMatch] },
      ],
    });

    const report = gate.inspectPlan(value);

    expect(report.status).toBe('warning');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED',
          severity: 'warning',
          phase: 'plan',
          paths: ['/decisions/atomicEvents/0'],
        }),
        expect.objectContaining({
          code: 'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH',
          severity: 'warning',
          phase: 'plan',
          paths: ['/decisions/atomicEvents/0', '/decisions/atomicEvents/1'],
        }),
      ]),
    );
  });

  it('warns when an active relation loses all cases through final decisions', () => {
    const value = planInput();
    value.decisions.concreteCases[0] = {
      ref: 'case-a',
      action: 'skip',
      reason: '案例暂不入库',
    };
    value.decisions.relationCaseLinks[0] = {
      relationRef: 'relation-ab',
      caseRef: 'case-a',
      action: 'skip',
      reason: '关联随案例跳过',
    };

    const report = gate.inspectPlan(value);

    expect(report).toMatchObject({
      status: 'warning',
      issues: [
        expect.objectContaining({
          code: 'AI_QUALITY_RELATION_WITHOUT_CASE',
          severity: 'warning',
          phase: 'plan',
          refs: ['relation-ab'],
          paths: ['/decisions/causalRelations/0'],
        }),
      ],
    });
  });

  it('ignores a forged blocked client report when recomputed inputs pass', () => {
    const value = planInput();
    value.comparison.qualityReport = buildQualityReport([
      {
        code: 'AI_QUALITY_REPORT_BLOCKED',
        severity: 'error',
        phase: 'plan',
        entityType: 'batch',
        refs: ['forged-ref'],
        paths: ['/decisions'],
        message: '伪造问题',
        suggestedAction: '不应保留',
        aiCanRepair: true,
      },
    ]);

    expect(gate.inspectPlan(value)).toMatchObject({
      status: 'passed',
      issues: [],
      topicRelevance: [],
    });
  });

  it('reports a recomputed blocked candidate set at the plan phase', () => {
    const report = gate.inspectPlan(planInput(duplicateEventNameInput));

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AI_QUALITY_DUPLICATE_EVENT_NAME',
          severity: 'error',
          phase: 'plan',
          refs: ['event-b'],
          paths: ['/decisions/atomicEvents/1'],
        }),
        expect.objectContaining({
          code: 'AI_QUALITY_REPORT_BLOCKED',
          severity: 'error',
          phase: 'plan',
          refs: ['event-b'],
          paths: ['/decisions'],
        }),
      ]),
    );
  });
});

describe('qualityReportFromZodError', () => {
  it('preserves Task 1 quality codes, maps event-limit errors, and escapes JSON Pointer tokens', () => {
    const raw = {
      atomicEvents: [{ ref: 'event-1', name: '供应减少' }],
      'field/with~token': 'invalid',
    };
    const error = new z.ZodError([
      {
        code: 'custom',
        message: '重复引用',
        path: ['atomicEvents', 0, 'ref'],
        params: { qualityCode: 'AI_QUALITY_DUPLICATE_REF' },
      },
      {
        code: 'too_big',
        message: '最多 50 条',
        path: ['atomicEvents'],
        origin: 'array',
        maximum: 50,
        inclusive: true,
      },
      {
        code: 'invalid_type',
        message: '字段不合法',
        path: ['field/with~token'],
        expected: 'string',
      },
    ]);

    expect(qualityReportFromZodError(raw, error)).toMatchObject({
      status: 'blocked',
      issues: [
        expect.objectContaining({
          code: 'AI_QUALITY_DUPLICATE_REF',
          entityType: 'event',
          refs: ['event-1'],
          paths: ['/atomicEvents/0/ref'],
        }),
        expect.objectContaining({
          code: 'AI_QUALITY_EVENT_LIMIT_EXCEEDED',
          entityType: 'batch',
          paths: ['/atomicEvents'],
        }),
        expect.objectContaining({
          code: 'AI_QUALITY_SCHEMA_INVALID',
          entityType: 'batch',
          paths: ['/field~1with~0token'],
        }),
      ],
    });
  });

  it('keeps a nested atomic-event size failure as a field-level schema issue', () => {
    const raw = {
      atomicEvents: [{ ref: 'event-1', name: '事'.repeat(51) }],
    };
    const error = new z.ZodError([
      {
        code: 'too_big',
        message: '事件名称最多 50 个字符',
        path: ['atomicEvents', 0, 'name'],
        origin: 'string',
        maximum: 50,
        inclusive: true,
      },
    ]);

    expect(qualityReportFromZodError(raw, error).issues).toEqual([
      expect.objectContaining({
        code: 'AI_QUALITY_SCHEMA_INVALID',
        entityType: 'event',
        refs: ['event-1'],
        paths: ['/atomicEvents/0/name'],
      }),
    ]);
  });

  it('uses contract schema errors without losing their path-derived references', () => {
    const raw = {
      ...candidates(),
      causalRelations: [
        {
          ref: 'relation-ab',
          causeEventRef: 'missing-event',
          effectEventRef: 'event-b',
          description: null,
        },
      ],
    };
    const parsed = aiCaptureCandidateSetSchema.safeParse(raw);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(qualityReportFromZodError(raw, parsed.error).issues).toContainEqual(
      expect.objectContaining({
        code: 'AI_QUALITY_REFERENCE_MISSING',
        entityType: 'relation',
        refs: ['relation-ab'],
        paths: ['/causalRelations/0/causeEventRef'],
      }),
    );
  });
});

describe('mergeQualityReports', () => {
  it('rebuilds status and deterministically orders issues and topic relevance', () => {
    const warning = buildQualityReport(
      [
        {
          code: 'AI_QUALITY_ALIAS_COLLISION',
          severity: 'warning',
          phase: 'candidate',
          entityType: 'event',
          refs: ['event-b'],
          paths: ['/atomicEvents/1/aliases/0'],
          message: '别名冲突',
          suggestedAction: '确认是否应合并为同一事件',
          aiCanRepair: true,
        },
      ],
      [
        { ref: 'event-z', similarity: 0.2 },
        { ref: 'event-b', similarity: 0.8 },
      ],
    );
    const blocked = buildQualityReport([
      {
        code: 'AI_QUALITY_ORPHAN_CASE',
        severity: 'error',
        phase: 'candidate',
        entityType: 'case',
        refs: ['case-a'],
        paths: ['/concreteCases/0'],
        message: '案例未关联',
        suggestedAction: '补充有效关联',
        aiCanRepair: true,
      },
    ]);

    expect(mergeQualityReports(warning, blocked)).toMatchObject({
      status: 'blocked',
      issues: [
        expect.objectContaining({ code: 'AI_QUALITY_ORPHAN_CASE' }),
        expect.objectContaining({ code: 'AI_QUALITY_ALIAS_COLLISION' }),
      ],
      topicRelevance: [
        { ref: 'event-b', similarity: 0.8 },
        { ref: 'event-z', similarity: 0.2 },
      ],
    });
  });
});
