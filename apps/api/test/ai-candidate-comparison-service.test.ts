import type {
  AiCaptureCandidateSet,
  AtomicEventCandidate,
  ConcreteCaseCandidate,
} from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  type AiCandidateComparisonRepository,
  type CaseMatchRow,
  type EventMatchRow,
} from '../src/features/ai-capture/aiCandidateComparisonRepository.js';
import { AiCandidateComparisonService } from '../src/features/ai-capture/aiCandidateComparisonService.js';
import type { AiSemanticCandidateService } from '../src/features/ai-capture/aiSemanticCandidateService.js';

const eventIds = Array.from(
  { length: 14 },
  (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const caseIds = Array.from(
  { length: 14 },
  (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const relationId = '30000000-0000-4000-8000-000000000001';
const updatedAt = '2026-07-28T00:00:00.000Z';

function event(ref: string, name: string): AtomicEventCandidate {
  return { ref, name, description: null, aliases: [], keywords: [] };
}

function concreteCase(ref: string, content: string): ConcreteCaseCandidate {
  return { ref, content };
}

function candidateSet(overrides: Partial<AiCaptureCandidateSet> = {}): AiCaptureCandidateSet {
  return {
    topic: '供应链分析',
    clientName: 'Codex',
    atomicEvents: [event('event-1', '原材料供应减少'), event('event-2', '生产成本上升')],
    concreteCases: [concreteCase('case-1', '2026年某地区原材料供应量下降')],
    causalRelations: [
      {
        ref: 'relation-1',
        causeEventRef: 'event-1',
        effectEventRef: 'event-2',
        description: null,
      },
    ],
    relationCaseLinks: [{ relationRef: 'relation-1', caseRef: 'case-1' }],
    ...overrides,
  };
}

function eventMatch(
  id: string,
  matchKind: EventMatchRow['matchKind'],
  similarity: number | null = null,
): EventMatchRow {
  return {
    id,
    name: `已有事件 ${id.slice(-2)}`,
    description: null,
    aliases: [],
    keywords: [],
    matchKind,
    similarity,
    updatedAt,
  };
}

function caseMatch(
  id: string,
  matchKind: CaseMatchRow['matchKind'],
  similarity: number | null = null,
): CaseMatchRow {
  return {
    id,
    content: `已有案例 ${id.slice(-2)}`,
    matchKind,
    similarity,
    updatedAt,
  };
}

function repository(
  overrides: Partial<AiCandidateComparisonRepository> = {},
): AiCandidateComparisonRepository {
  return {
    findEventMatches: vi.fn().mockResolvedValue([]),
    findCaseMatches: vi.fn().mockResolvedValue([]),
    findEventsByIds: vi.fn().mockResolvedValue([]),
    findCasesByIds: vi.fn().mockResolvedValue([]),
    findRelationMatches: vi.fn().mockResolvedValue([]),
    findLinkMatches: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function semantic(
  eventResults: Array<Array<{ id: string; similarity: number }>> = [],
  caseResults: Array<Array<{ id: string; similarity: number }>> = [],
): Pick<AiSemanticCandidateService, 'compare'> {
  return {
    compare: vi
      .fn()
      .mockImplementation(async (entityType) =>
        entityType === 'event' ? eventResults : caseResults,
      ),
  };
}

describe('AiCandidateComparisonService', () => {
  async function expectBlockedBeforeDependencies(rawInput: unknown, issueCode: string) {
    const dataRepository = repository();
    const semanticService = semantic();
    const service = new AiCandidateComparisonService(dataRepository, semanticService);

    await expect(service.compare(rawInput)).rejects.toMatchObject({
      code: 'AI_CANDIDATE_QUALITY_BLOCKED',
      qualityReport: {
        status: 'blocked',
        issues: expect.arrayContaining([expect.objectContaining({ code: issueCode })]),
      },
    });
    expect(dataRepository.findEventMatches).not.toHaveBeenCalled();
    expect(dataRepository.findCaseMatches).not.toHaveBeenCalled();
    expect(dataRepository.findEventsByIds).not.toHaveBeenCalled();
    expect(dataRepository.findCasesByIds).not.toHaveBeenCalled();
    expect(dataRepository.findRelationMatches).not.toHaveBeenCalled();
    expect(dataRepository.findLinkMatches).not.toHaveBeenCalled();
    expect(semanticService.compare).not.toHaveBeenCalled();
  }

  it.each([
    [
      'field length errors',
      candidateSet({
        atomicEvents: [event('event-1', '事'.repeat(51)), event('event-2', '生产成本上升')],
      }),
      'AI_QUALITY_SCHEMA_INVALID',
    ],
    [
      'missing references',
      candidateSet({
        causalRelations: [
          {
            ref: 'relation-1',
            causeEventRef: 'event-missing',
            effectEventRef: 'event-2',
            description: null,
          },
        ],
      }),
      'AI_QUALITY_REFERENCE_MISSING',
    ],
    [
      'self loops',
      candidateSet({
        causalRelations: [
          {
            ref: 'relation-1',
            causeEventRef: 'event-1',
            effectEventRef: 'event-1',
            description: null,
          },
        ],
      }),
      'AI_QUALITY_SELF_LOOP',
    ],
    [
      'duplicate refs',
      candidateSet({
        atomicEvents: [event('event-1', '原材料供应减少'), event('event-1', '生产成本上升')],
      }),
      'AI_QUALITY_DUPLICATE_REF',
    ],
    [
      'duplicate links',
      candidateSet({
        relationCaseLinks: [
          { relationRef: 'relation-1', caseRef: 'case-1' },
          { relationRef: 'relation-1', caseRef: 'case-1' },
        ],
      }),
      'AI_QUALITY_DUPLICATE_LINK',
    ],
    [
      'the event limit',
      candidateSet({
        atomicEvents: Array.from({ length: 51 }, (_, index) =>
          event(`event-${index + 1}`, `原子事件 ${index + 1}`),
        ),
      }),
      'AI_QUALITY_EVENT_LIMIT_EXCEEDED',
    ],
  ] as const)('blocks %s before querying any dependency', async (_name, rawInput, issueCode) => {
    await expectBlockedBeforeDependencies(rawInput, issueCode);
  });

  it.each([
    [
      'duplicate event names',
      candidateSet({
        atomicEvents: [event('event-1', '需求下降'), event('event-2', '  需求下降  ')],
      }),
      'AI_QUALITY_DUPLICATE_EVENT_NAME',
    ],
    [
      'duplicate case content',
      candidateSet({
        concreteCases: [
          concreteCase('case-1', '2026年某企业订单下降'),
          concreteCase('case-2', '  2026年某企业订单下降  '),
        ],
        relationCaseLinks: [
          { relationRef: 'relation-1', caseRef: 'case-1' },
          { relationRef: 'relation-1', caseRef: 'case-2' },
        ],
      }),
      'AI_QUALITY_DUPLICATE_CASE_CONTENT',
    ],
    [
      'duplicate relations',
      candidateSet({
        causalRelations: [
          {
            ref: 'relation-1',
            causeEventRef: 'event-1',
            effectEventRef: 'event-2',
            description: null,
          },
          {
            ref: 'relation-2',
            causeEventRef: 'event-1',
            effectEventRef: 'event-2',
            description: null,
          },
        ],
      }),
      'AI_QUALITY_DUPLICATE_RELATION',
    ],
    [
      'orphan events',
      candidateSet({
        atomicEvents: [
          event('event-1', '原材料供应减少'),
          event('event-2', '生产成本上升'),
          event('event-3', '市场需求下降'),
        ],
      }),
      'AI_QUALITY_ORPHAN_EVENT',
    ],
    [
      'orphan cases',
      candidateSet({
        concreteCases: [
          concreteCase('case-1', '2026年某地区原材料供应量下降'),
          concreteCase('case-2', '未关联的具体案例'),
        ],
      }),
      'AI_QUALITY_ORPHAN_CASE',
    ],
  ] as const)(
    'blocks parsed %s before querying any dependency',
    async (_name, input, issueCode) => {
      await expectBlockedBeforeDependencies(input, issueCode);
    },
  );

  it('queries and maps every accepted candidate one-to-one in input order', async () => {
    const firstEvent = eventMatch(eventIds[0]!, 'exact_name');
    const secondEvent = eventMatch(eventIds[1]!, 'exact_name');
    const firstCase = caseMatch(caseIds[0]!, 'exact_content');
    const secondCase = caseMatch(caseIds[1]!, 'exact_content');
    const data = candidateSet({
      concreteCases: [
        concreteCase('case-1', '2026年某企业订单下降'),
        concreteCase('case-2', '2026年另一企业成本上升'),
      ],
      relationCaseLinks: [
        { relationRef: 'relation-1', caseRef: 'case-1' },
        { relationRef: 'relation-1', caseRef: 'case-2' },
      ],
    });
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[firstEvent], [secondEvent]]),
      findCaseMatches: vi.fn().mockResolvedValue([[firstCase], [secondCase]]),
    });
    const service = new AiCandidateComparisonService(dataRepository, semantic([[], []], [[], []]));

    const result = await service.compare(data);

    expect(dataRepository.findEventMatches).toHaveBeenCalledWith(data.atomicEvents);
    expect(dataRepository.findCaseMatches).toHaveBeenCalledWith(data.concreteCases);
    expect(result.atomicEvents).toEqual([
      { ref: 'event-1', matches: [firstEvent] },
      { ref: 'event-2', matches: [secondEvent] },
    ]);
    expect(result.concreteCases).toEqual([
      { ref: 'case-1', matches: [firstCase] },
      { ref: 'case-2', matches: [secondCase] },
    ]);
    expect(result.qualityReport).toEqual({
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [],
    });
  });

  it('continues to PostgreSQL and semantic comparison for warning-only candidates', async () => {
    const data = candidateSet({
      atomicEvents: [
        event('event-1', '原材料供应减少并且生产成本上升'),
        event('event-2', '产品交付延迟'),
      ],
    });
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[], []]),
      findCaseMatches: vi.fn().mockResolvedValue([[]]),
    });
    const semanticService = semantic([[], []], [[]]);
    const service = new AiCandidateComparisonService(dataRepository, semanticService);

    const result = await service.compare(data);

    expect(dataRepository.findEventMatches).toHaveBeenCalledOnce();
    expect(dataRepository.findCaseMatches).toHaveBeenCalledOnce();
    expect(semanticService.compare).toHaveBeenCalledTimes(2);
    expect(result.qualityReport).toMatchObject({
      status: 'warning',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED' }),
      ]),
    });
  });

  it('does not collapse case-sensitive content that PostgreSQL stores as separate cases', async () => {
    const upperCase = caseMatch(caseIds[0]!, 'exact_content');
    const titleCase = caseMatch(caseIds[1]!, 'exact_content');
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[]]),
      findCaseMatches: vi.fn().mockResolvedValue([[upperCase], [titleCase]]),
    });
    const service = new AiCandidateComparisonService(dataRepository, semantic([[]], [[], []]));

    const result = await service.compare(
      candidateSet({
        concreteCases: [
          concreteCase('case-1', 'ACME库存上升'),
          concreteCase('case-2', 'Acme库存上升'),
        ],
        relationCaseLinks: [
          { relationRef: 'relation-1', caseRef: 'case-1' },
          { relationRef: 'relation-1', caseRef: 'case-2' },
        ],
      }),
    );

    expect(dataRepository.findCaseMatches).toHaveBeenCalledWith([
      expect.objectContaining({ content: 'ACME库存上升' }),
      expect.objectContaining({ content: 'Acme库存上升' }),
    ]);
    expect(result.concreteCases).toEqual([
      { ref: 'case-1', matches: [upperCase] },
      { ref: 'case-2', matches: [titleCase] },
    ]);
  });

  it('ranks exact event matches before fuzzy and semantic matches and keeps 10 unique IDs', async () => {
    const normalMatches = [
      eventMatch(eventIds[2]!, 'fuzzy', 0.71),
      eventMatch(eventIds[1]!, 'exact_alias'),
      eventMatch(eventIds[0]!, 'exact_name'),
      eventMatch(eventIds[3]!, 'fuzzy', 0.69),
    ];
    const semanticMatches = [
      { id: eventIds[3]!, similarity: 0.99 },
      ...eventIds.slice(4, 14).map((id, index) => ({ id, similarity: 0.95 - index / 100 })),
    ];
    const semanticRecords = eventIds.slice(4, 14).map((id) => eventMatch(id, 'semantic', null));
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([normalMatches]),
      findCaseMatches: vi.fn().mockResolvedValue([[]]),
      findEventsByIds: vi.fn().mockResolvedValue(semanticRecords),
    });
    const service = new AiCandidateComparisonService(
      dataRepository,
      semantic([semanticMatches], [[]]),
    );

    const result = await service.compare(candidateSet());

    expect(result.atomicEvents[0]!.matches).toHaveLength(10);
    expect(result.atomicEvents[0]!.matches.map((match) => match.id)).toEqual([
      eventIds[0],
      eventIds[1],
      eventIds[2],
      eventIds[3],
      ...eventIds.slice(4, 10),
    ]);
    expect(result.atomicEvents[0]!.matches.map((match) => match.matchKind)).toEqual([
      'exact_name',
      'exact_alias',
      'fuzzy',
      'fuzzy',
      ...Array.from({ length: 6 }, () => 'semantic'),
    ]);
    expect(result.atomicEvents[0]!.matches[4]!.similarity).toBe(0.95);
  });

  it('ranks exact case content before fuzzy and semantic case candidates', async () => {
    const normalMatches = [
      caseMatch(caseIds[1]!, 'fuzzy', 0.72),
      caseMatch(caseIds[0]!, 'exact_content'),
    ];
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[]]),
      findCaseMatches: vi.fn().mockResolvedValue([normalMatches]),
      findCasesByIds: vi.fn().mockResolvedValue([caseMatch(caseIds[2]!, 'semantic')]),
    });
    const service = new AiCandidateComparisonService(
      dataRepository,
      semantic([[]], [[{ id: caseIds[2]!, similarity: 0.91 }]]),
    );

    const result = await service.compare(candidateSet());

    expect(result.concreteCases[0]!.matches.map((match) => match.id)).toEqual([
      caseIds[0],
      caseIds[1],
      caseIds[2],
    ]);
    expect(result.concreteCases[0]!.matches.map((match) => match.matchKind)).toEqual([
      'exact_content',
      'fuzzy',
      'semantic',
    ]);
    expect(result.concreteCases[0]!.matches[2]!.similarity).toBe(0.91);
  });

  it('keeps no more than 10 unique case candidates', async () => {
    const semanticMatches = caseIds.map((id, index) => ({
      id,
      similarity: 0.99 - index / 100,
    }));
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[]]),
      findCaseMatches: vi.fn().mockResolvedValue([[]]),
      findCasesByIds: vi.fn().mockResolvedValue(caseIds.map((id) => caseMatch(id, 'semantic'))),
    });
    const service = new AiCandidateComparisonService(
      dataRepository,
      semantic([[]], [semanticMatches]),
    );

    const result = await service.compare(candidateSet());

    expect(result.concreteCases[0]!.matches).toHaveLength(10);
    expect(new Set(result.concreteCases[0]!.matches.map((match) => match.id)).size).toBe(10);
  });

  it('keeps semantic similarity inside the public comparison contract', async () => {
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[]]),
      findCaseMatches: vi.fn().mockResolvedValue([[]]),
      findEventsByIds: vi.fn().mockResolvedValue([eventMatch(eventIds[0]!, 'semantic')]),
      findCasesByIds: vi.fn().mockResolvedValue([caseMatch(caseIds[0]!, 'semantic')]),
    });
    const service = new AiCandidateComparisonService(
      dataRepository,
      semantic(
        [[{ id: eventIds[0]!, similarity: 1.2 }]],
        [[{ id: caseIds[0]!, similarity: -0.2 }]],
      ),
    );

    const result = await service.compare(candidateSet());

    expect(result.atomicEvents[0]!.matches[0]!.similarity).toBe(1);
    expect(result.concreteCases[0]!.matches[0]!.similarity).toBe(0);
  });

  it('checks relations and links only through uniquely resolved exact identities', async () => {
    const cause = eventMatch(eventIds[0]!, 'exact_name');
    const effect = eventMatch(eventIds[1]!, 'exact_alias');
    const exactCase = caseMatch(caseIds[0]!, 'exact_content');
    const relation = {
      id: relationId,
      causeEventId: eventIds[0]!,
      effectEventId: eventIds[1]!,
      description: '供应减少导致成本上升',
      confidence: 34.39,
      caseCount: 3,
      updatedAt,
    };
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[cause], [effect]]),
      findCaseMatches: vi.fn().mockResolvedValue([[exactCase]]),
      findRelationMatches: vi
        .fn()
        .mockResolvedValue([{ ref: 'relation-1', direction: 'existing', relation }]),
      findLinkMatches: vi
        .fn()
        .mockResolvedValue([{ relationRef: 'relation-1', caseRef: 'case-1' }]),
    });
    const service = new AiCandidateComparisonService(dataRepository, semantic([[], []], [[]]));

    const result = await service.compare(
      candidateSet({
        atomicEvents: [event('event-1', '供应减少'), event('event-2', '成本上升')],
        causalRelations: [
          {
            ref: 'relation-1',
            causeEventRef: 'event-1',
            effectEventRef: 'event-2',
            description: '供应减少导致成本上升',
          },
        ],
        relationCaseLinks: [{ relationRef: 'relation-1', caseRef: 'case-1' }],
      }),
    );

    expect(result.causalRelations).toEqual([{ ref: 'relation-1', status: 'existing', relation }]);
    expect(result.relationCaseLinks).toEqual([
      { relationRef: 'relation-1', caseRef: 'case-1', exists: true },
    ]);
    expect(dataRepository.findRelationMatches).toHaveBeenCalledWith([
      {
        ref: 'relation-1',
        causeEventId: eventIds[0],
        effectEventId: eventIds[1],
      },
    ]);
    expect(dataRepository.findLinkMatches).toHaveBeenCalledWith([
      {
        relationRef: 'relation-1',
        relationId,
        caseRef: 'case-1',
        caseId: caseIds[0],
      },
    ]);
  });
});
