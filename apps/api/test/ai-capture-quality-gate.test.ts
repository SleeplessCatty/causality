import {
  aiCaptureCandidateSetSchema,
  type AiCaptureCandidateSet,
  type AiCaptureQualityIssue,
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
