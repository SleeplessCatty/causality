import { describe, expect, it } from 'vitest';

import type { ParsedImportRecord } from '../src/features/data-transfer/csvCodec.js';
import { planFileRecords } from '../src/features/data-transfer/importPlanner.js';

function event(
  sequence: number,
  name: string,
  options: {
    description?: string | null;
    aliases?: string[];
    keywords?: string[];
  } = {},
): ParsedImportRecord {
  return {
    type: 'event',
    sequence,
    name,
    description: options.description ?? null,
    aliases: options.aliases ?? [],
    keywords: options.keywords ?? [],
  };
}

function concreteCase(sequence: number, content: string): ParsedImportRecord {
  return { type: 'case', sequence, content };
}

function relation(
  sequence: number,
  causeEventName: string,
  effectEventName: string,
  caseContents: string[] = [],
  options: { confidence?: number; description?: string | null } = {},
): ParsedImportRecord {
  return {
    type: 'relation',
    sequence,
    causeEventName,
    effectEventName,
    confidence: options.confidence ?? 10,
    confidenceManuallyEdited: options.confidence !== undefined,
    description: options.description ?? null,
    caseContents,
  };
}

describe('file-local import planner', () => {
  it('resolves a relation that appears before both file-local event rows', () => {
    const plan = planFileRecords([
      relation(1, '需求增长', '企业扩产', ['某企业宣布新增生产线']),
      event(2, '需求增长'),
      event(3, '企业扩产'),
    ]);

    expect(plan.events.map((item) => item.creator.name)).toEqual(['需求增长', '企业扩产']);
    expect(plan.relations).toHaveLength(1);
    expect(plan.relations[0]).toMatchObject({
      key: '需求增长\u0000企业扩产',
      creator: {
        sequence: 1,
        causeEventName: '需求增长',
        effectEventName: '企业扩产',
      },
      occurrences: [{ sourceSequence: 1, itemSequence: 1 }],
    });
    expect(plan.cases[0]).toMatchObject({
      creator: { content: '某企业宣布新增生产线' },
      occurrences: [{ sourceSequence: 1, itemSequence: 2 }],
    });
    expect(plan.relationCases[0]?.occurrences).toEqual([{ sourceSequence: 1, itemSequence: 3 }]);
  });

  it('collapses strict duplicate event and case rows into one file-local occurrence', () => {
    const plan = planFileRecords([
      event(1, '需求增长', { aliases: ['需求上升'] }),
      concreteCase(2, '某地区销量增长'),
      event(3, ' 需求增长 ', {
        description: '后续说明不得补写',
        aliases: ['需求增强'],
        keywords: ['后续关键词'],
      }),
      concreteCase(4, '某地区销量增长'),
    ]);

    expect(plan.events).toEqual([
      {
        key: '需求增长',
        creator: event(1, '需求增长', { aliases: ['需求上升'] }),
        occurrences: [
          {
            sourceSequence: 1,
            itemSequence: 1,
          },
        ],
      },
    ]);
    expect(plan.cases).toEqual([
      {
        key: '某地区销量增长',
        creator: concreteCase(2, '某地区销量增长'),
        occurrences: [
          {
            sourceSequence: 2,
            itemSequence: 1,
          },
        ],
      },
    ]);
  });

  it('lets duplicate relation rows add cases while retaining the first relation fields', () => {
    const plan = planFileRecords([
      event(1, '原因'),
      event(2, '结果'),
      relation(3, '原因', '结果', ['案例一'], {
        confidence: 70,
        description: '首次说明',
      }),
      relation(4, '原因', '结果', ['案例一', '案例二'], {
        confidence: 90,
        description: '后续说明不得覆盖',
      }),
    ]);

    expect(plan.relations).toEqual([
      expect.objectContaining({
        creator: relation(3, '原因', '结果', ['案例一'], {
          confidence: 70,
          description: '首次说明',
        }),
        occurrences: [{ sourceSequence: 3, itemSequence: 1 }],
      }),
    ]);
    expect(plan.cases.map((item) => item.key)).toEqual(['案例一', '案例二']);
    expect(plan.relationCases).toEqual([
      expect.objectContaining({
        caseKey: '案例一',
        occurrences: [{ sourceSequence: 3, itemSequence: 3 }],
      }),
      expect.objectContaining({
        caseKey: '案例二',
        occurrences: [{ sourceSequence: 4, itemSequence: 5 }],
      }),
    ]);
  });

  it('removes self-loop relations and all of their embedded cases from the plan', () => {
    const plan = planFileRecords([
      event(1, '同一事件'),
      relation(2, '同一事件', ' 同一事件 ', ['不应独立创建的案例']),
      concreteCase(3, '仍应保留的独立案例'),
    ]);

    expect(plan.events).toHaveLength(1);
    expect(plan.relations).toEqual([]);
    expect(plan.relationCases).toEqual([]);
    expect(plan.cases.map((item) => item.key)).toEqual(['仍应保留的独立案例']);
  });

  it('retains unresolved endpoint names for authoritative database matching', () => {
    const plan = planFileRecords([relation(1, '数据库已有原因', '数据库已有结果', ['待关联案例'])]);

    expect(plan.relations).toHaveLength(1);
    expect(plan.cases.map((item) => item.key)).toEqual(['待关联案例']);
    expect(plan.relationCases).toHaveLength(1);
  });
});
