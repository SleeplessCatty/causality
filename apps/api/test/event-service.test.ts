import type { EventDetail } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { EventRepository } from '../src/features/events/eventRepository.js';
import { EventService } from '../src/features/events/eventService.js';
import type { SemanticQueryService } from '../src/features/semantic/semanticQueryService.js';

const detail: EventDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '原油价格上涨',
  description: null,
  aliases: ['油价上涨'],
  keywords: ['原油'],
  relationCount: 0,
  listPage: 1,
  createdAt: '2026-07-20T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
};

const input = {
  name: detail.name,
  description: detail.description,
  aliases: detail.aliases,
  keywords: detail.keywords,
};

function repository(overrides: Partial<EventRepository> = {}): EventRepository {
  return {
    list: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
      semanticIndexNotice: null,
    }),
    listEnhanced: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
      semanticIndexNotice: 'incomplete',
    }),
    findCandidates: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(detail),
    existsById: vi.fn().mockResolvedValue(true),
    listRelations: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    create: vi.fn().mockResolvedValue(detail),
    replace: vi.fn().mockResolvedValue(detail),
    deletionImpact: vi.fn().mockResolvedValue({ canDelete: true, hasRelations: false }),
    delete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function semanticQueryService(): SemanticQueryService {
  return {
    candidateIds: vi.fn().mockResolvedValue({
      ids: ['10000000-0000-4000-8000-000000000001'],
      semanticIndexNotice: 'incomplete',
    }),
  } as unknown as SemanticQueryService;
}

describe('EventService', () => {
  it('uses semantic candidates only for an enhanced event list query', async () => {
    const eventRepository = repository();
    const semantic = semanticQueryService();
    const service = new EventService(eventRepository, semantic);

    await service.list({
      q: '政策',
      orphan: false,
      searchMode: 'standard',
      page: 1,
      limit: 50,
    });
    expect(semantic.candidateIds).not.toHaveBeenCalled();
    expect(eventRepository.list).toHaveBeenCalledTimes(1);

    await service.list({
      q: '政策',
      orphan: false,
      searchMode: 'enhanced',
      page: 1,
      limit: 50,
    });
    expect(semantic.candidateIds).toHaveBeenCalledWith('event', '政策');
    expect(eventRepository.listEnhanced).toHaveBeenCalledWith(
      expect.objectContaining({ q: '政策', searchMode: 'enhanced' }),
      ['10000000-0000-4000-8000-000000000001'],
      'incomplete',
    );
  });

  it('returns a stable not-found error for missing detail and replacement targets', async () => {
    const service = new EventService(
      repository({
        findById: vi.fn().mockResolvedValue(null),
        existsById: vi.fn().mockResolvedValue(false),
        replace: vi.fn().mockResolvedValue(null),
      }),
    );

    await expect(service.findById(detail.id)).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
      message: '事件不存在',
    });
    await expect(service.listRelations(detail.id, { limit: 20 })).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
      message: '事件不存在',
    });
    await expect(service.replace(detail.id, input)).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
      message: '事件不存在',
    });
  });

  it.each([
    ['abstract_events_normalized_name_uidx', 'EVENT_NAME_CONFLICT', '该标准名称已被使用', 'name'],
    [
      'event_aliases_event_normalized_uidx',
      'EVENT_ALIAS_CONFLICT',
      '同一事件不能有重复别名',
      'aliases',
    ],
  ] as const)(
    'maps PostgreSQL constraint %s to a stable service error',
    async (constraint, code, message, field) => {
      const databaseError = { code: '23505', constraint };
      const service = new EventService(
        repository({ create: vi.fn().mockRejectedValue(databaseError) }),
      );

      await expect(service.create(input)).rejects.toEqual(
        expect.objectContaining({ code, message, field }),
      );
    },
  );

  it('does not hide or rewrite unknown repository failures', async () => {
    const databaseError = new Error('connection interrupted');
    const service = new EventService(
      repository({ create: vi.fn().mockRejectedValue(databaseError) }),
    );

    await expect(service.create(input)).rejects.toBe(databaseError);
  });

  it('returns deletion impact and stable missing-target errors', async () => {
    const missing = new EventService(
      repository({
        deletionImpact: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(false),
      }),
    );
    await expect(new EventService(repository()).deletionImpact(detail.id)).resolves.toEqual({
      canDelete: true,
      hasRelations: false,
    });
    await expect(missing.deletionImpact(detail.id)).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
    });
    await expect(missing.delete(detail.id)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  it('maps a concurrently linked event deletion to the blocked error', async () => {
    const service = new EventService(
      repository({
        delete: vi.fn().mockRejectedValue({ code: 'EVENT_DELETE_BLOCKED' }),
      }),
    );

    await expect(service.delete(detail.id)).rejects.toMatchObject({
      code: 'EVENT_DELETE_BLOCKED',
      message: '这个原子事件存在关联因果关系，必须先删除相关因果关系',
    });
  });
});
