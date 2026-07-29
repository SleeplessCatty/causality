import type {
  AiCaptureComparison,
  AiImportPlan,
  PrepareAiImportPlanInput,
} from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AiImportPlanRepository } from '../src/features/ai-capture/aiImportPlanRepository.js';
import { AiImportPlanService } from '../src/features/ai-capture/aiImportPlanService.js';
import type { AiSemanticCandidateService } from '../src/features/ai-capture/aiSemanticCandidateService.js';
import { AiCaptureDataError } from '../src/features/ai-capture/aiCaptureErrors.js';
import { AiCaptureQualityGate } from '../src/features/ai-capture/aiCaptureQualityGate.js';
import {
  type AiImportPlanPreparationState,
  prepareAiImportMutations,
  qualityReportForPlanValidationError,
} from '../src/features/ai-capture/aiImportPlanValidator.js';

const eventAId = '10000000-0000-4000-8000-000000000001';
const eventBId = '10000000-0000-4000-8000-000000000002';
const caseId = '20000000-0000-4000-8000-000000000001';
const relationId = '30000000-0000-4000-8000-000000000001';
const otherId = '90000000-0000-4000-8000-000000000001';
const updatedAt = '2026-07-28T10:00:00.000Z';
const arrayIndexPattern = /^(0|[1-9]\d*)$/;

function trackIndexedReads<T>(items: T[]): { values: T[]; readCount: () => number } {
  let reads = 0;
  return {
    values: new Proxy(items, {
      get(target, property, receiver) {
        if (typeof property === 'string' && arrayIndexPattern.test(property)) reads += 1;
        return Reflect.get(target, property, receiver);
      },
    }),
    readCount: () => reads,
  };
}

function comparison(): AiCaptureComparison {
  return {
    atomicEvents: [
      {
        ref: 'event-a',
        matches: [
          {
            id: eventAId,
            name: '港口停止作业',
            description: '港口暂停装卸',
            aliases: ['港口停工'],
            keywords: ['港口'],
            matchKind: 'exact_name',
            similarity: 1,
            updatedAt,
          },
        ],
      },
      {
        ref: 'event-b',
        matches: [
          {
            id: eventBId,
            name: '零部件到货延迟',
            description: null,
            aliases: [],
            keywords: ['供应链'],
            matchKind: 'exact_name',
            similarity: 1,
            updatedAt,
          },
        ],
      },
    ],
    concreteCases: [
      {
        ref: 'case-a',
        matches: [
          {
            id: caseId,
            content: '2025年某港口停运后汽车零部件延迟到货',
            matchKind: 'exact_content',
            similarity: 1,
            updatedAt,
          },
        ],
      },
    ],
    causalRelations: [
      {
        ref: 'relation-a',
        status: 'existing',
        relation: {
          id: relationId,
          causeEventId: eventAId,
          effectEventId: eventBId,
          description: '港口停工导致零部件延迟',
          confidence: 19,
          caseCount: 1,
          updatedAt,
        },
      },
    ],
    relationCaseLinks: [{ relationRef: 'relation-a', caseRef: 'case-a', exists: true }],
    qualityReport: {
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [],
    },
  };
}

function input(): PrepareAiImportPlanInput {
  return {
    candidates: {
      topic: '供应链中断',
      clientName: 'test-client',
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
      concreteCases: [{ ref: 'case-a', content: '2025年某港口停运后汽车零部件延迟到货' }],
      causalRelations: [
        {
          ref: 'relation-a',
          causeEventRef: 'event-a',
          effectEventRef: 'event-b',
          description: '港口停工导致零部件延迟',
        },
      ],
      relationCaseLinks: [{ relationRef: 'relation-a', caseRef: 'case-a' }],
    },
    comparison: comparison(),
    decisions: {
      atomicEvents: [
        {
          ref: 'event-a',
          action: 'reuse',
          existingId: eventAId,
          appendAliases: [],
          appendKeywords: [],
        },
        {
          ref: 'event-b',
          action: 'reuse',
          existingId: eventBId,
          appendAliases: [],
          appendKeywords: [],
        },
      ],
      concreteCases: [{ ref: 'case-a', action: 'reuse', existingId: caseId }],
      causalRelations: [{ ref: 'relation-a', action: 'reuse', existingId: relationId }],
      relationCaseLinks: [{ relationRef: 'relation-a', caseRef: 'case-a', action: 'reuse' }],
    },
  };
}

function state(): AiImportPlanPreparationState {
  return {
    events: [
      {
        id: eventAId,
        name: '港口停止作业',
        description: '港口暂停装卸',
        aliases: ['港口停工'],
        keywords: ['港口'],
        updatedAt,
      },
      {
        id: eventBId,
        name: '零部件到货延迟',
        description: null,
        aliases: [],
        keywords: ['供应链'],
        updatedAt,
      },
    ],
    cases: [
      {
        id: caseId,
        content: '2025年某港口停运后汽车零部件延迟到货',
        updatedAt,
      },
    ],
    relations: [
      {
        id: relationId,
        causeEventId: eventAId,
        effectEventId: eventBId,
        description: '港口停工导致零部件延迟',
        confidence: 19,
        baselineConfidence: 10,
        baselineCaseCount: 0,
        caseIds: [caseId],
        updatedAt,
      },
    ],
    links: [{ relationId, caseId, exists: true, linkedAt: updatedAt }],
  };
}

describe('AI import plan validation and normalization', () => {
  it('counts an existing relation-case link as reused', () => {
    const result = prepareAiImportMutations(input(), state());

    expect(result.summary).toMatchObject({
      relationCaseCreated: 0,
      relationCaseReused: 1,
    });
  });

  it('rejects a reuse decision without its required existing ID', () => {
    const invalid = input() as unknown as {
      decisions: { atomicEvents: Array<Record<string, unknown>> };
    };
    delete invalid.decisions.atomicEvents[0]!.existingId;

    expect(() => prepareAiImportMutations(invalid, state())).toThrowError(
      expect.objectContaining({ code: 'AI_PLAN_INPUT_INVALID' }),
    );
  });

  it('rejects reuse IDs that were not returned for the same candidate', () => {
    const value = input();
    value.decisions.atomicEvents[0] = {
      ...value.decisions.atomicEvents[0]!,
      action: 'reuse',
      existingId: otherId,
      appendAliases: [],
      appendKeywords: [],
    };

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({
        code: 'AI_PLAN_REUSE_INVALID',
        affectedRefs: ['event-a'],
      }),
    );
  });

  it('rejects an event comparison that no longer matches current aliases', () => {
    const changedState = state();
    changedState.events[0]!.aliases.push('后来新增的别名');

    expect(() => prepareAiImportMutations(input(), changedState)).toThrowError(
      expect.objectContaining({
        code: 'AI_PLAN_COMPARISON_STALE',
        affectedRefs: ['event-a'],
      }),
    );
  });

  it('rejects a relation comparison after its confidence evidence changes', () => {
    const changedState = state();
    changedState.relations[0] = {
      ...changedState.relations[0]!,
      confidence: 27.1,
      caseIds: [caseId, '20000000-0000-4000-8000-000000000002'],
    };

    expect(() => prepareAiImportMutations(input(), changedState)).toThrowError(
      expect.objectContaining({
        code: 'AI_PLAN_COMPARISON_STALE',
        affectedRefs: ['relation-a'],
      }),
    );
  });

  it.each([
    {
      name: 'event',
      change(value: PrepareAiImportPlanInput) {
        value.decisions.atomicEvents[0] = { ref: 'event-a', action: 'create' };
      },
    },
    {
      name: 'case',
      change(value: PrepareAiImportPlanInput) {
        value.decisions.concreteCases[0] = { ref: 'case-a', action: 'create' };
      },
    },
    {
      name: 'relation',
      change(value: PrepareAiImportPlanInput) {
        value.decisions.causalRelations[0] = { ref: 'relation-a', action: 'create' };
      },
    },
    {
      name: 'relation-case link',
      change(value: PrepareAiImportPlanInput) {
        value.decisions.relationCaseLinks[0] = {
          relationRef: 'relation-a',
          caseRef: 'case-a',
          action: 'create',
        };
      },
    },
  ])(
    'uses the exact-existing conflict code for a create decision on an existing $name',
    ({ change }) => {
      const value = input();
      change(value);

      expect(() => prepareAiImportMutations(value, state())).toThrowError(
        expect.objectContaining({ code: 'AI_PLAN_CREATE_EXACT_CONFLICT' }),
      );
    },
  );

  it.each([
    ['event rename', 'atomicEvents', { renameTo: '新名称' }],
    ['alias removal', 'atomicEvents', { removeAliases: ['港口停工'] }],
    ['keyword removal', 'atomicEvents', { removeKeywords: ['港口'] }],
    ['case content update', 'concreteCases', { replaceContent: '修改后的案例' }],
    ['relation endpoint update', 'causalRelations', { causeEventRef: 'event-b' }],
    ['relation description update', 'causalRelations', { replaceDescription: '新说明' }],
    ['stored link deletion', 'relationCaseLinks', { action: 'delete' }],
  ])('rejects forbidden mutation: %s', (_name, section, extra) => {
    const value = input() as unknown as {
      decisions: Record<string, Array<Record<string, unknown>>>;
    };
    value.decisions[section]![0] = {
      ...value.decisions[section]![0],
      ...extra,
    };

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({ code: 'AI_PLAN_INPUT_INVALID' }),
    );
  });

  it('rejects a relation that depends on a skipped event', () => {
    const value = input();
    value.decisions.atomicEvents[0] = {
      ref: 'event-a',
      action: 'skip',
      reason: '暂不入库',
    };

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({
        code: 'AI_PLAN_DEPENDENCY_SKIPPED',
        affectedRefs: ['relation-a', 'event-a'],
      }),
    );
  });

  it('allows a skipped relation and link to follow a skipped event', () => {
    const value = input();
    value.decisions.atomicEvents[0] = {
      ref: 'event-a',
      action: 'skip',
      reason: '事件不入库',
    };
    value.decisions.causalRelations[0] = {
      ref: 'relation-a',
      action: 'skip',
      reason: '关系随事件跳过',
    };
    value.decisions.relationCaseLinks[0] = {
      relationRef: 'relation-a',
      caseRef: 'case-a',
      action: 'skip',
      reason: '关联随关系跳过',
    };

    const result = prepareAiImportMutations(value, state());

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'event', ref: 'event-a' }),
        expect.objectContaining({ type: 'relation', ref: 'relation-a' }),
        expect.objectContaining({ type: 'link', ref: 'relation-a:case-a' }),
      ]),
    );
  });

  it.each([
    ['case', 'concreteCases', 'case-a'],
    ['relation', 'causalRelations', 'relation-a'],
  ])('rejects a link that depends on a skipped %s', (_name, section, ref) => {
    const value = input();
    if (section === 'concreteCases') {
      value.decisions.concreteCases[0] = {
        ref,
        action: 'skip',
        reason: '暂不入库',
      };
    } else {
      value.decisions.causalRelations[0] = {
        ref,
        action: 'skip',
        reason: '暂不入库',
      };
    }
    value.decisions.relationCaseLinks[0] = {
      relationRef: 'relation-a',
      caseRef: 'case-a',
      action: 'create',
    };

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({ code: 'AI_PLAN_DEPENDENCY_SKIPPED' }),
    );
  });

  it.each([
    {
      name: 'event names',
      change(value: PrepareAiImportPlanInput) {
        value.candidates.atomicEvents[0]!.name = '需求下降';
        value.candidates.atomicEvents[1]!.name = '需求下降';
        value.decisions.atomicEvents = [
          { ref: 'event-a', action: 'create' },
          { ref: 'event-b', action: 'create' },
        ];
      },
    },
    {
      name: 'case content',
      change(value: PrepareAiImportPlanInput) {
        value.candidates.concreteCases[0]!.content = '批次内新案例内容';
        value.candidates.concreteCases.push({
          ref: 'case-b',
          content: value.candidates.concreteCases[0]!.content,
        });
        value.comparison.concreteCases.push({ ref: 'case-b', matches: [] });
        value.decisions.concreteCases = [
          { ref: 'case-a', action: 'create' },
          { ref: 'case-b', action: 'create' },
        ];
        value.candidates.relationCaseLinks = [];
        value.comparison.relationCaseLinks = [];
        value.decisions.relationCaseLinks = [];
      },
    },
    {
      name: 'relation direction',
      change(value: PrepareAiImportPlanInput) {
        value.candidates.causalRelations.push({
          ref: 'relation-b',
          causeEventRef: 'event-a',
          effectEventRef: 'event-b',
          description: null,
        });
        value.comparison.causalRelations = [
          { ref: 'relation-a', status: 'missing' },
          { ref: 'relation-b', status: 'missing' },
        ];
        value.decisions.causalRelations = [
          { ref: 'relation-a', action: 'create' },
          { ref: 'relation-b', action: 'create' },
        ];
        value.candidates.relationCaseLinks = [];
        value.comparison.relationCaseLinks = [];
        value.decisions.relationCaseLinks = [];
      },
    },
  ])('rejects final creates with duplicate $name', ({ change }) => {
    const value = input();
    change(value);

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({ code: 'AI_PLAN_UNIQUE_CONFLICT' }),
    );
  });

  it('sorts every mutation collection and records event description changes', () => {
    const value = input();
    value.decisions.atomicEvents = [
      value.decisions.atomicEvents[1]!,
      {
        ref: 'event-a',
        action: 'reuse',
        existingId: eventAId,
        appendAliases: ['码头停工'],
        appendKeywords: ['物流'],
        replaceDescription: '港口停止全部装卸作业',
      },
    ];

    const result = prepareAiImportMutations(value, state());

    expect(result.reuseEvents.map((item) => item.ref)).toEqual(['event-a', 'event-b']);
    expect(result.updateEvents).toEqual([
      {
        ref: 'event-a',
        id: eventAId,
        appendAliases: ['码头停工'],
        appendKeywords: ['物流'],
        oldDescription: '港口暂停装卸',
        newDescription: '港口停止全部装卸作业',
      },
    ]);
    expect(result.dependencies.map((dependency) => dependency.type)).toEqual([
      'case',
      'event',
      'event',
      'link',
      'relation',
    ]);
  });

  it('removes duplicate and already-stored event attributes from append operations', () => {
    const value = input();
    value.decisions.atomicEvents[0] = {
      ref: 'event-a',
      action: 'reuse',
      existingId: eventAId,
      appendAliases: ['港口停工', '码头停工', '码头停工'],
      appendKeywords: ['港口', '物流', '物流'],
    };

    const result = prepareAiImportMutations(value, state());

    expect(result.updateEvents[0]).toMatchObject({
      appendAliases: ['码头停工'],
      appendKeywords: ['物流'],
    });
  });

  it('normalizes duplicate attributes on a newly created event', () => {
    const value = input();
    value.candidates.atomicEvents[0]!.name = '新的港口事件';
    value.candidates.atomicEvents[0]!.aliases = ['港口停摆', '港口停摆'];
    value.candidates.atomicEvents[0]!.keywords = ['港口', '港口'];
    value.comparison.atomicEvents[0]!.matches = [];
    value.decisions.atomicEvents[0] = { ref: 'event-a', action: 'create' };
    value.comparison.causalRelations = [{ ref: 'relation-a', status: 'missing' }];
    value.decisions.causalRelations = [{ ref: 'relation-a', action: 'create' }];
    value.candidates.relationCaseLinks = [];
    value.comparison.relationCaseLinks = [];
    value.decisions.relationCaseLinks = [];

    const result = prepareAiImportMutations(value, state());

    expect(result.createEvents[0]).toMatchObject({
      aliases: ['港口停摆'],
      keywords: ['港口'],
    });
  });

  it('rejects a relation that becomes a self-loop after event reuse is resolved', () => {
    const value = input();
    value.comparison.atomicEvents[1]!.matches = [value.comparison.atomicEvents[0]!.matches[0]!];
    value.decisions.atomicEvents[1] = {
      ref: 'event-b',
      action: 'reuse',
      existingId: eventAId,
      appendAliases: [],
      appendKeywords: [],
    };
    value.comparison.causalRelations = [{ ref: 'relation-a', status: 'missing' }];
    value.decisions.causalRelations = [{ ref: 'relation-a', action: 'create' }];
    value.candidates.relationCaseLinks = [];
    value.comparison.relationCaseLinks = [];
    value.decisions.relationCaseLinks = [];

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({
        code: 'AI_PLAN_UNIQUE_CONFLICT',
        affectedRefs: ['relation-a'],
      }),
    );
  });

  it('rejects two created links that resolve to the same final relation and case', () => {
    const value = input();
    value.candidates.concreteCases.push({
      ref: 'case-b',
      content: '同一案例的另一种候选表达',
    });
    value.comparison.concreteCases.push({
      ref: 'case-b',
      matches: value.comparison.concreteCases[0]!.matches,
    });
    value.decisions.concreteCases.push({
      ref: 'case-b',
      action: 'reuse',
      existingId: caseId,
    });
    value.comparison.causalRelations = [{ ref: 'relation-a', status: 'missing' }];
    value.decisions.causalRelations = [{ ref: 'relation-a', action: 'create' }];
    value.candidates.relationCaseLinks = [
      { relationRef: 'relation-a', caseRef: 'case-a' },
      { relationRef: 'relation-a', caseRef: 'case-b' },
    ];
    value.comparison.relationCaseLinks = [
      { relationRef: 'relation-a', caseRef: 'case-a', exists: false },
      { relationRef: 'relation-a', caseRef: 'case-b', exists: false },
    ];
    value.decisions.relationCaseLinks = [
      { relationRef: 'relation-a', caseRef: 'case-a', action: 'create' },
      { relationRef: 'relation-a', caseRef: 'case-b', action: 'create' },
    ];

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({ code: 'AI_PLAN_UNIQUE_CONFLICT' }),
    );
  });

  it('previews automatic confidence for a new relation with two new links', () => {
    const value = input();
    value.decisions.causalRelations = [{ ref: 'relation-a', action: 'create' }];
    value.comparison.causalRelations = [{ ref: 'relation-a', status: 'missing' }];
    value.candidates.concreteCases.push({
      ref: 'case-b',
      content: '2026年另一港口停运后零部件到货延迟',
    });
    value.comparison.concreteCases.push({ ref: 'case-b', matches: [] });
    value.decisions.concreteCases.push({ ref: 'case-b', action: 'create' });
    value.candidates.relationCaseLinks.push({
      relationRef: 'relation-a',
      caseRef: 'case-b',
    });
    value.comparison.relationCaseLinks = [
      { relationRef: 'relation-a', caseRef: 'case-a', exists: false },
      { relationRef: 'relation-a', caseRef: 'case-b', exists: false },
    ];
    value.decisions.relationCaseLinks = [
      { relationRef: 'relation-a', caseRef: 'case-a', action: 'create' },
      { relationRef: 'relation-a', caseRef: 'case-b', action: 'create' },
    ];

    const result = prepareAiImportMutations(value, state());

    expect(result.confidenceChanges).toEqual([
      {
        relationRef: 'relation-a',
        relationId: null,
        oldConfidence: 10,
        newConfidence: 27.1,
        oldCaseCount: 0,
        newCaseCount: 2,
      },
    ]);
    expect(result.summary).toMatchObject({
      relationCreated: 1,
      relationCaseCreated: 2,
      confidenceChanged: 1,
    });
  });
});

describe('plan validation quality reports', () => {
  it.each([
    [
      'AI_PLAN_INPUT_INVALID',
      'AI_QUALITY_COMPARISON_COVERAGE_INVALID',
      '方案候选与对比结果的覆盖范围不一致',
      '重新对比完整候选集合并提交全部对比结果',
    ],
    [
      'AI_PLAN_DECISIONS_INVALID',
      'AI_QUALITY_DECISION_COVERAGE_INVALID',
      '方案决策未完整且唯一覆盖全部候选',
      '为每个候选和案例关联补齐唯一决策',
    ],
    [
      'AI_PLAN_REUSE_INVALID',
      'AI_QUALITY_REUSE_TARGET_INVALID',
      '复用决策未指向该候选对比结果中的有效已有记录',
      '仅复用同一候选对比结果中的已有记录',
    ],
    [
      'AI_PLAN_DEPENDENCY_SKIPPED',
      'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
      '有效决策依赖了已跳过的上游候选',
      '同步跳过依赖项或恢复其上游决策',
    ],
    [
      'AI_PLAN_CREATE_EXACT_CONFLICT',
      'AI_QUALITY_CREATE_EXACT_CONFLICT',
      '创建决策对应的数据已存在',
      '复用精确匹配的已有记录，或跳过该候选或关联',
    ],
    [
      'AI_PLAN_UNIQUE_CONFLICT',
      'AI_QUALITY_BATCH_UNIQUE_CONFLICT',
      '批次内多个创建决策指向同一唯一目标',
      '合并最终指向同一记录或唯一键的批次项',
    ],
    [
      'AI_PLAN_COMPARISON_STALE',
      'AI_QUALITY_COMPARISON_STALE',
      '对比完成后相关已有记录已发生变化',
      '基于当前数据库状态重新执行候选对比',
    ],
  ] as const)(
    'maps %s to %s with readable repair metadata and a stable decision path',
    (errorCode, qualityCode, message, suggestedAction) => {
      const report = qualityReportForPlanValidationError(
        new AiCaptureDataError(errorCode, ['event-a']),
        input(),
      );

      expect(report).toMatchObject({
        status: 'blocked',
        issues: [
          expect.objectContaining({
            code: qualityCode,
            severity: 'error',
            phase: 'plan',
            entityType: 'event',
            refs: ['event-a'],
            paths: ['/candidates/atomicEvents/0', '/decisions/atomicEvents/0'],
            message,
            suggestedAction,
          }),
        ],
      });
    },
  );

  it('falls back to the decisions batch path when an error has no locatable ref', () => {
    const report = qualityReportForPlanValidationError(
      new AiCaptureDataError('AI_PLAN_INPUT_INVALID'),
      input(),
    );

    expect(report.issues[0]).toMatchObject({
      entityType: 'batch',
      refs: [],
      paths: ['/decisions'],
    });
  });

  it('uses a batch entity when the same ref is ambiguous across decision types', () => {
    const value = input();
    value.candidates.causalRelations[0]!.ref = 'event-a';
    value.candidates.relationCaseLinks[0]!.relationRef = 'event-a';
    value.comparison.causalRelations[0]!.ref = 'event-a';
    value.comparison.relationCaseLinks[0]!.relationRef = 'event-a';
    value.decisions.causalRelations[0] = {
      ref: 'event-a',
      action: 'reuse',
      existingId: relationId,
    };
    value.decisions.relationCaseLinks[0] = {
      relationRef: 'event-a',
      caseRef: 'case-a',
      action: 'reuse',
    };

    const report = qualityReportForPlanValidationError(
      new AiCaptureDataError('AI_PLAN_REUSE_INVALID', ['event-a']),
      value,
    );

    expect(report.issues[0]).toMatchObject({
      entityType: 'batch',
      refs: ['event-a'],
      paths: [
        '/candidates/atomicEvents/0',
        '/decisions/atomicEvents/0',
        '/candidates/causalRelations/0',
        '/decisions/causalRelations/0',
      ],
    });
  });

  it('maps high-cardinality validator refs to candidate and decision paths with indexed reads', () => {
    const concreteCases = Array.from({ length: 300 }, (_, index) => ({
      ref: `case-${index.toString().padStart(3, '0')}`,
      content: `具体案例 ${index}`,
    }));
    const decisions = concreteCases.map(({ ref }) => ({ ref, action: 'create' as const }));
    const trackedCandidates = trackIndexedReads(concreteCases);
    const trackedDecisions = trackIndexedReads(decisions);
    const value = input();
    value.candidates = {
      ...value.candidates,
      atomicEvents: [],
      concreteCases: trackedCandidates.values,
      causalRelations: [],
      relationCaseLinks: [],
    };
    value.decisions = {
      atomicEvents: [],
      concreteCases: trackedDecisions.values,
      causalRelations: [],
      relationCaseLinks: [],
    };

    const report = qualityReportForPlanValidationError(
      new AiCaptureDataError(
        'AI_PLAN_REUSE_INVALID',
        concreteCases.map(({ ref }) => ref),
      ),
      value,
    );

    expect(report.issues[0]).toMatchObject({
      entityType: 'case',
      paths: expect.arrayContaining([
        '/candidates/concreteCases/0',
        '/decisions/concreteCases/0',
        '/candidates/concreteCases/299',
        '/decisions/concreteCases/299',
      ]),
    });
    expect(report.issues[0]!.paths).toHaveLength(concreteCases.length * 2);
    expect(trackedCandidates.readCount() + trackedDecisions.readCount()).toBeLessThan(
      concreteCases.length * 12,
    );
  });
});

describe('AiImportPlanService quality gate', () => {
  function dependencies() {
    const repository = {
      loadPreparationState: vi.fn().mockResolvedValue(state()),
      createPlan: vi.fn().mockResolvedValue({ id: 'plan-id' } as AiImportPlan),
      status: vi.fn(),
      get: vi.fn(),
    } satisfies AiImportPlanRepository;
    const semantic = {
      topicRelevance: vi.fn().mockResolvedValue([
        { ref: 'event-a', similarity: 0.4 },
        { ref: 'event-b', similarity: 0.6 },
      ]),
    } satisfies Pick<AiSemanticCandidateService, 'topicRelevance'>;
    return { repository, semantic };
  }

  it('recomputes and replaces a forged client quality report', async () => {
    const { repository, semantic } = dependencies();
    const value = input();
    value.comparison.qualityReport = {
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [{ ref: 'event-a', similarity: 1 }],
    };
    const service = new AiImportPlanService(repository, semantic);

    await service.prepare(value);

    expect(repository.loadPreparationState).toHaveBeenCalledWith(value);
    expect(semantic.topicRelevance).toHaveBeenCalledWith(
      value.candidates.topic,
      value.candidates.atomicEvents,
    );
    expect(repository.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        comparison: expect.objectContaining({
          qualityReport: {
            version: 1,
            status: 'passed',
            issues: [],
            topicRelevance: [
              { ref: 'event-a', similarity: 0.4 },
              { ref: 'event-b', similarity: 0.6 },
            ],
          },
        }),
      }),
      expect.anything(),
    );
  });

  it('loads current state before semantic recomputation and plan inspection', async () => {
    const { repository, semantic } = dependencies();
    const calls: string[] = [];
    repository.loadPreparationState.mockImplementation(async () => {
      calls.push('load-state');
      return state();
    });
    semantic.topicRelevance.mockImplementation(async () => {
      calls.push('topic-relevance');
      return [];
    });
    repository.createPlan.mockImplementation(async () => {
      calls.push('create-plan');
      return { id: 'plan-id' } as AiImportPlan;
    });
    const qualityGate = new AiCaptureQualityGate();
    const inspectPlan = qualityGate.inspectPlan.bind(qualityGate);
    vi.spyOn(qualityGate, 'inspectPlan').mockImplementation((value) => {
      calls.push('inspect-plan');
      return inspectPlan(value);
    });
    const service = new AiImportPlanService(repository, semantic, qualityGate);

    await service.prepare(input());

    expect(calls).toEqual(['load-state', 'topic-relevance', 'inspect-plan', 'create-plan']);
  });

  it('rejects malformed input before loading state or calling semantic services', async () => {
    const { repository, semantic } = dependencies();
    const service = new AiImportPlanService(repository, semantic);

    await expect(service.prepare({})).rejects.toMatchObject({ code: 'AI_PLAN_INPUT_INVALID' });
    expect(repository.loadPreparationState).not.toHaveBeenCalled();
    expect(semantic.topicRelevance).not.toHaveBeenCalled();
    expect(repository.createPlan).not.toHaveBeenCalled();
  });

  it('does not create a plan when an active event becomes orphaned', async () => {
    const { repository, semantic } = dependencies();
    const value = input();
    value.decisions.causalRelations[0] = {
      ref: 'relation-a',
      action: 'skip',
      reason: '关系暂不入库',
    };
    value.decisions.relationCaseLinks[0] = {
      relationRef: 'relation-a',
      caseRef: 'case-a',
      action: 'skip',
      reason: '关联随关系跳过',
    };
    const service = new AiImportPlanService(repository, semantic);

    await expect(service.prepare(value)).rejects.toMatchObject({
      code: 'AI_PLAN_QUALITY_BLOCKED',
      qualityReport: {
        status: 'blocked',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'AI_QUALITY_ACTIVE_EVENT_ORPHANED',
            phase: 'plan',
            paths: expect.arrayContaining(['/decisions/atomicEvents/0']),
          }),
        ]),
      },
    });
    expect(repository.createPlan).not.toHaveBeenCalled();
  });

  it('maps existing mutation validation failures and does not create a plan', async () => {
    const { repository, semantic } = dependencies();
    const changedState = state();
    changedState.events[0]!.aliases.push('对比完成后新增的别名');
    repository.loadPreparationState.mockResolvedValue(changedState);
    const service = new AiImportPlanService(repository, semantic);

    await expect(service.prepare(input())).rejects.toMatchObject({
      code: 'AI_PLAN_QUALITY_BLOCKED',
      qualityReport: {
        status: 'blocked',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'AI_QUALITY_COMPARISON_STALE',
            phase: 'plan',
            refs: ['event-a'],
            paths: ['/candidates/atomicEvents/0', '/decisions/atomicEvents/0'],
          }),
        ]),
      },
    });
    expect(repository.createPlan).not.toHaveBeenCalled();
  });
});
