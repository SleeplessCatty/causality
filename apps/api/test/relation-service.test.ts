import type { RelationDetail } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  RelationCaseContentConflictError,
  RelationCaseNotFoundError,
  type RelationRepository,
} from '../src/features/relations/relationRepository.js';
import { RelationService } from '../src/features/relations/relationService.js';
import type { SemanticQueryService } from '../src/features/semantic/semanticQueryService.js';

const detail: RelationDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  causeEvent: { id: '22222222-2222-4222-8222-222222222222', name: '原油价格上涨' },
  effectEvent: { id: '33333333-3333-4333-8333-333333333333', name: '航空公司成本上升' },
  confidence: 80,
  caseCount: 0,
  listPage: 1,
  description: null,
  createdAt: '2026-07-20T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
  recentCases: [],
};

const input = {
  causeEventId: detail.causeEvent.id,
  effectEventId: detail.effectEvent.id,
  confidence: detail.confidence,
  description: detail.description,
  caseSelections: [],
};

function repository(overrides: Partial<RelationRepository> = {}): RelationRepository {
  return {
    list: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
      semanticIndexUpdating: false,
    }),
    listEnhanced: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
      semanticIndexUpdating: true,
    }),
    checkPair: vi.fn().mockResolvedValue({ sameDirection: null, reverseDirection: null }),
    findById: vi.fn().mockResolvedValue(detail),
    create: vi.fn().mockResolvedValue(detail),
    replace: vi.fn().mockResolvedValue(detail),
    deletionImpact: vi.fn().mockResolvedValue({
      canDelete: true,
      hasEvents: true,
      hasCases: false,
    }),
    delete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function semanticQueryService(): SemanticQueryService {
  return {
    candidateIds: vi.fn().mockResolvedValue({
      ids: ['20000000-0000-4000-8000-000000000001'],
      semanticIndexUpdating: false,
    }),
  } as unknown as SemanticQueryService;
}

describe('RelationService', () => {
  it('merges semantic candidates only for an enhanced relation list query', async () => {
    const relationRepository = repository();
    const semantic = semanticQueryService();
    const service = new RelationService(relationRepository, semantic);

    await service.list({
      q: '融资',
      orphan: false,
      searchMode: 'standard',
      page: 1,
      limit: 50,
    });
    expect(semantic.candidateIds).not.toHaveBeenCalled();

    await service.list({
      q: '融资',
      orphan: false,
      searchMode: 'enhanced',
      page: 1,
      limit: 50,
    });
    expect(semantic.candidateIds).toHaveBeenCalledWith('relation', '融资');
    expect(relationRepository.listEnhanced).toHaveBeenCalledWith(
      expect.objectContaining({ q: '融资' }),
      ['20000000-0000-4000-8000-000000000001'],
      false,
    );
  });

  it('returns a stable not-found error for missing detail and replacement targets', async () => {
    const service = new RelationService(
      repository({
        findById: vi.fn().mockResolvedValue(null),
        replace: vi.fn().mockResolvedValue(null),
      }),
    );
    await expect(service.findById(detail.id)).rejects.toMatchObject({ code: 'RELATION_NOT_FOUND' });
    await expect(service.replace(detail.id, input)).rejects.toMatchObject({
      code: 'RELATION_NOT_FOUND',
    });
  });

  it.each([
    [
      { code: '23505', constraint: 'causal_relations_direction_uidx' },
      'RELATION_DIRECTION_CONFLICT',
    ],
    [{ code: '23503' }, 'RELATION_EVENT_NOT_FOUND'],
    [{ code: '23514', constraint: 'causal_relations_no_self_loop_check' }, 'RELATION_SELF_LOOP'],
  ] as const)('maps database error %# to %s', async (databaseError, expectedCode) => {
    const service = new RelationService(
      repository({ create: vi.fn().mockRejectedValue(databaseError) }),
    );
    await expect(service.create(input)).rejects.toMatchObject({ code: expectedCode });
  });

  it('does not hide unknown repository failures', async () => {
    const error = new Error('connection interrupted');
    const service = new RelationService(repository({ create: vi.fn().mockRejectedValue(error) }));
    await expect(service.create(input)).rejects.toBe(error);
  });

  it('maps missing and conflicting case selections to stable errors', async () => {
    const missingService = new RelationService(
      repository({ create: vi.fn().mockRejectedValue(new RelationCaseNotFoundError()) }),
    );
    await expect(missingService.create(input)).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });

    const existingId = '44444444-4444-4444-8444-444444444444';
    const conflictService = new RelationService(
      repository({
        create: vi.fn().mockRejectedValue(new RelationCaseContentConflictError(existingId)),
      }),
    );
    await expect(conflictService.create(input)).rejects.toMatchObject({
      code: 'CASE_CONTENT_CONFLICT',
      existingId,
    });
  });

  it('returns deletion impact and deletes only an existing relation target', async () => {
    await expect(new RelationService(repository()).deletionImpact(detail.id)).resolves.toEqual({
      canDelete: true,
      hasEvents: true,
      hasCases: false,
    });
    const missing = new RelationService(
      repository({
        deletionImpact: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(false),
      }),
    );
    await expect(missing.deletionImpact(detail.id)).rejects.toMatchObject({
      code: 'RELATION_NOT_FOUND',
    });
    await expect(missing.delete(detail.id)).rejects.toMatchObject({ code: 'RELATION_NOT_FOUND' });
  });
});
