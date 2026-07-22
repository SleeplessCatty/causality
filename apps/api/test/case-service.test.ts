import type { CaseDetail } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { CaseRepository } from '../src/features/cases/caseRepository.js';
import { CaseService } from '../src/features/cases/caseService.js';

const detail: CaseDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  content: '2025年4月美国宣布新一轮关税措施',
  relationCount: 0,
  createdAt: '2026-07-21T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
};

function repository(overrides: Partial<CaseRepository> = {}): CaseRepository {
  return {
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    listForRelation: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    candidates: vi.fn().mockResolvedValue({ items: [] }),
    findById: vi.fn().mockResolvedValue(detail),
    listRelations: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    create: vi.fn().mockResolvedValue(detail),
    replace: vi.fn().mockResolvedValue(detail),
    findByContent: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('CaseService', () => {
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
});
