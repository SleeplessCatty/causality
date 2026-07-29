import type { AiCaptureComparison, PrepareAiImportPlanInput } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import {
  type AiImportPlanPreparationState,
  prepareAiImportMutations,
} from '../src/features/ai-capture/aiImportPlanValidator.js';

const eventAId = '10000000-0000-4000-8000-000000000001';
const eventBId = '10000000-0000-4000-8000-000000000002';
const caseId = '20000000-0000-4000-8000-000000000001';
const relationId = '30000000-0000-4000-8000-000000000001';
const otherId = '90000000-0000-4000-8000-000000000001';
const updatedAt = '2026-07-28T10:00:00.000Z';

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
    ['event name', 'atomicEvents'],
    ['case content', 'concreteCases'],
  ])('rejects creating a duplicate existing %s', (_name, section) => {
    const value = input();
    if (section === 'atomicEvents') {
      value.decisions.atomicEvents[0] = { ref: 'event-a', action: 'create' };
    } else {
      value.decisions.concreteCases[0] = { ref: 'case-a', action: 'create' };
      value.candidates.relationCaseLinks = [];
      value.comparison.relationCaseLinks = [];
      value.decisions.relationCaseLinks = [];
    }

    expect(() => prepareAiImportMutations(value, state())).toThrowError(
      expect.objectContaining({ code: 'AI_PLAN_UNIQUE_CONFLICT' }),
    );
  });

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
