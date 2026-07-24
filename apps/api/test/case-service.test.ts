import type { CaseDetail } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { CaseRepository } from '../src/features/cases/caseRepository.js';
import { CaseService } from '../src/features/cases/caseService.js';
import type { SemanticQueryService } from '../src/features/semantic/semanticQueryService.js';

const detail: CaseDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  content: '2025年4月美国宣布新一轮关税措施',
  relationCount: 0,
  listPage: 1,
  createdAt: '2026-07-21T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
};

function repository(overrides: Partial<CaseRepository> = {}): CaseRepository {
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
    listForRelation: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    candidates: vi.fn().mockResolvedValue({ items: [] }),
    findById: vi.fn().mockResolvedValue(detail),
    listRelations: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    create: vi.fn().mockResolvedValue(detail),
    replace: vi.fn().mockResolvedValue(detail),
    findByContent: vi.fn().mockResolvedValue(null),
    deletionImpact: vi.fn().mockResolvedValue({ canDelete: true, hasRelations: false }),
    delete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function semanticQueryService(): SemanticQueryService {
  return {
    candidateIds: vi.fn().mockResolvedValue({
      ids: ['30000000-0000-4000-8000-000000000001'],
      semanticIndexUpdating: true,
    }),
  } as unknown as SemanticQueryService;
}

describe('CaseService', () => {
  it('merges semantic candidates only for an enhanced case list query', async () => {
    const caseRepository = repository();
    const semantic = semanticQueryService();
    const service = new CaseService(caseRepository, semantic);

    await service.list({
      q: '关税',
      relationId: undefined,
      orphan: false,
      searchMode: 'standard',
      page: 1,
      limit: 50,
    });
    expect(semantic.candidateIds).not.toHaveBeenCalled();

    await service.list({
      q: '关税',
      relationId: undefined,
      orphan: false,
      searchMode: 'enhanced',
      page: 1,
      limit: 50,
    });
    expect(semantic.candidateIds).toHaveBeenCalledWith('case', '关税');
    expect(caseRepository.listEnhanced).toHaveBeenCalledWith(
      expect.objectContaining({ q: '关税' }),
      ['30000000-0000-4000-8000-000000000001'],
      true,
    );
  });

  it('returns a stable not-found error for missing detail and replacement targets', async () => {
    const service = new CaseService(
      repository({
        findById: vi.fn().mockResolvedValue(null),
        replace: vi.fn().mockResolvedValue(null),
      }),
    );
    await expect(service.findById(detail.id)).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
    await expect(service.replace(detail.id, { content: detail.content })).rejects.toMatchObject({
      code: 'CASE_NOT_FOUND',
    });
  });

  it('maps duplicate content to a conflict containing the existing case id', async () => {
    const databaseError = { code: '23505', constraint: 'concrete_cases_content_uidx' };
    const service = new CaseService(
      repository({
        create: vi.fn().mockRejectedValue(databaseError),
        findByContent: vi.fn().mockResolvedValue({ id: detail.id, content: detail.content }),
      }),
    );
    await expect(service.create({ content: detail.content })).rejects.toMatchObject({
      code: 'CASE_CONTENT_CONFLICT',
      existingId: detail.id,
    });
  });

  it('does not rewrite unknown repository failures', async () => {
    const failure = new Error('connection interrupted');
    const service = new CaseService(repository({ create: vi.fn().mockRejectedValue(failure) }));
    await expect(service.create({ content: detail.content })).rejects.toBe(failure);
  });

  it('returns deletion impact and deletes only an existing case target', async () => {
    await expect(new CaseService(repository()).deletionImpact(detail.id)).resolves.toEqual({
      canDelete: true,
      hasRelations: false,
    });
    const missing = new CaseService(
      repository({
        deletionImpact: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(false),
      }),
    );
    await expect(missing.deletionImpact(detail.id)).rejects.toMatchObject({
      code: 'CASE_NOT_FOUND',
    });
    await expect(missing.delete(detail.id)).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
  });
});
