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
    atomicEvents: [event('event-1', '原材料供应减少')],
    concreteCases: [concreteCase('case-1', '2026年某地区原材料供应量下降')],
    causalRelations: [],
    relationCaseLinks: [],
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
  it('rejects more than 50 atomic events before querying any dependency', async () => {
    const data = candidateSet({
      atomicEvents: Array.from({ length: 51 }, (_, index) =>
        event(`event-${index + 1}`, `原子事件 ${index + 1}`),
      ),
      concreteCases: [],
    });
    const dataRepository = repository();
    const semanticService = semantic();
    const service = new AiCandidateComparisonService(dataRepository, semanticService);

    await expect(service.compare(data)).rejects.toMatchObject({
      code: 'AI_EVENT_LIMIT_EXCEEDED',
      affectedRefs: ['event-51'],
    });
    expect(dataRepository.findEventMatches).not.toHaveBeenCalled();
    expect(semanticService.compare).not.toHaveBeenCalled();
  });

  it('queries duplicate event and case content once while preserving every candidate ref', async () => {
    const data = candidateSet({
      atomicEvents: [
        { ...event('event-1', '需求下降'), aliases: ['市场需求回落'] },
        { ...event('event-2', '需求下降'), keywords: ['需求'] },
      ],
      concreteCases: [
        concreteCase('case-1', '2026年某企业订单下降'),
        concreteCase('case-2', '2026年某企业订单下降'),
      ],
    });
    const exactEvent = eventMatch(eventIds[0]!, 'exact_name');
    const exactCase = caseMatch(caseIds[0]!, 'exact_content');
    const dataRepository = repository({
      findEventMatches: vi.fn().mockResolvedValue([[exactEvent]]),
      findCaseMatches: vi.fn().mockResolvedValue([[exactCase]]),
    });
    const service = new AiCandidateComparisonService(dataRepository, semantic([[]], [[]]));

    const result = await service.compare(data);

    expect(dataRepository.findEventMatches).toHaveBeenCalledWith([
      expect.objectContaining({
        name: '需求下降',
        aliases: ['市场需求回落'],
        keywords: ['需求'],
      }),
    ]);
    expect(dataRepository.findCaseMatches).toHaveBeenCalledWith([
      expect.objectContaining({ content: '2026年某企业订单下降' }),
    ]);
    expect(result.atomicEvents).toEqual([
      { ref: 'event-1', matches: [exactEvent] },
      { ref: 'event-2', matches: [exactEvent] },
    ]);
    expect(result.concreteCases).toEqual([
      { ref: 'case-1', matches: [exactCase] },
      { ref: 'case-2', matches: [exactCase] },
    ]);
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

  it('reports missing relation endpoint refs as a repairable data error', async () => {
    const data = candidateSet({
      causalRelations: [
        {
          ref: 'relation-1',
          causeEventRef: 'event-1',
          effectEventRef: 'event-missing',
          description: null,
        },
      ],
    });
    const service = new AiCandidateComparisonService(repository(), semantic());

    await expect(service.compare(data)).rejects.toMatchObject({
      code: 'AI_CANDIDATE_DEPENDENCY_INVALID',
      affectedRefs: ['relation-1', 'event-missing'],
    });
  });

  it('reports missing case-link refs as a repairable data error', async () => {
    const data = candidateSet({
      relationCaseLinks: [{ relationRef: 'relation-missing', caseRef: 'case-missing' }],
    });
    const service = new AiCandidateComparisonService(repository(), semantic());

    await expect(service.compare(data)).rejects.toMatchObject({
      code: 'AI_CANDIDATE_DEPENDENCY_INVALID',
      affectedRefs: ['relation-missing', 'case-missing'],
    });
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
