import type { EventDetail } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { EventRepository } from '../src/features/events/eventRepository.js';
import { EventService } from '../src/features/events/eventService.js';

const detail: EventDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '原油价格上涨',
  description: null,
  aliases: ['油价上涨'],
  keywords: ['原油'],
  relationCount: 0,
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
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    findCandidates: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(detail),
    existsById: vi.fn().mockResolvedValue(true),
    listRelations: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    create: vi.fn().mockResolvedValue(detail),
    replace: vi.fn().mockResolvedValue(detail),
    ...overrides,
  };
}

describe('EventService', () => {
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
});
