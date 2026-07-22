import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  eventCandidateListResponseSchema,
  eventCandidateQuerySchema,
  eventCandidateSchema,
  eventDetailSchema,
  eventFormInputSchema,
  eventListQuerySchema,
  eventListResponseSchema,
} from '../src/index.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-07-21T03:00:00.000Z';

describe('event contracts', () => {
  it('normalizes a valid event form payload', () => {
    expect(
      eventFormInputSchema.parse({
        name: '  原油价格上涨  ',
        description: '  国际原油价格持续上行  ',
        aliases: [' 油价上涨 ', '原油上涨'],
        keywords: [' 原油 ', '能源价格'],
      }),
    ).toEqual({
      name: '原油价格上涨',
      description: '国际原油价格持续上行',
      aliases: ['油价上涨', '原油上涨'],
      keywords: ['原油', '能源价格'],
    });
  });

  it('turns a blank optional description into null and defaults arrays', () => {
    expect(eventFormInputSchema.parse({ name: '市场流动性收紧', description: '   ' })).toEqual({
      name: '市场流动性收紧',
      description: null,
      aliases: [],
      keywords: [],
    });
  });

  it('enforces event, alias, and keyword length boundaries', () => {
    expect(() => eventFormInputSchema.parse({ name: '   ' })).toThrow();
    expect(eventFormInputSchema.safeParse({ name: '事'.repeat(50) }).success).toBe(true);
    expect(eventFormInputSchema.safeParse({ name: '事'.repeat(51) }).success).toBe(false);
    expect(
      eventFormInputSchema.safeParse({ name: '事件', aliases: ['别'.repeat(80)] }).success,
    ).toBe(true);
    expect(
      eventFormInputSchema.safeParse({ name: '事件', aliases: ['别'.repeat(81)] }).success,
    ).toBe(false);
    expect(
      eventFormInputSchema.safeParse({ name: '事件', keywords: ['词'.repeat(50)] }).success,
    ).toBe(true);
    expect(
      eventFormInputSchema.safeParse({ name: '事件', keywords: ['词'.repeat(51)] }).success,
    ).toBe(false);
  });

  it('rejects invalid collection limits and blank aliases', () => {
    expect(() =>
      eventFormInputSchema.parse({
        name: '事件',
        aliases: Array.from({ length: 21 }, (_, i) => `a${i}`),
      }),
    ).toThrow();
    expect(() =>
      eventFormInputSchema.parse({
        name: '事件',
        keywords: Array.from({ length: 21 }, (_, i) => `k${i}`),
      }),
    ).toThrow();
    expect(() => eventFormInputSchema.parse({ name: '事件', aliases: [' '] })).toThrow();
  });

  it('rejects aliases and keywords duplicated after trim and case normalization', () => {
    const duplicateAlias = eventFormInputSchema.safeParse({
      name: '事件',
      aliases: ['Oil Price', ' oil price '],
    });
    const duplicateKeyword = eventFormInputSchema.safeParse({
      name: '事件',
      keywords: ['ENERGY', 'energy'],
    });

    expect(duplicateAlias.success).toBe(false);
    expect(duplicateAlias.error?.issues[0]?.path).toEqual(['aliases', 1]);
    expect(duplicateKeyword.success).toBe(false);
    expect(duplicateKeyword.error?.issues[0]?.path).toEqual(['keywords', 1]);
  });

  it('normalizes page-based list queries and rejects invalid page bounds', () => {
    expect(eventListQuerySchema.parse({ q: '  原油 ', limit: '30' })).toEqual({
      q: '原油',
      page: 1,
      limit: 30,
    });
    expect(eventListQuerySchema.parse({})).toEqual({ q: '', page: 1, limit: 30 });
    expect(eventListQuerySchema.parse({ page: '100000' })).toEqual({
      q: '',
      page: 100_000,
      limit: 30,
    });
    for (const page of ['0', '-1', '1.5', '100001']) {
      expect(eventListQuerySchema.safeParse({ page }).success).toBe(false);
    }
  });

  it('keeps candidate queries cursor-based and rejects invalid bounds', () => {
    expect(
      eventCandidateQuerySchema.parse({
        q: ' 加息 ',
        limit: '100',
        cursor: 'cursor-value',
        excludeId: eventId,
      }),
    ).toEqual({
      q: '加息',
      limit: 100,
      cursor: 'cursor-value',
      excludeId: eventId,
    });

    expect(() => eventListQuerySchema.parse({ limit: '0' })).toThrow();
    expect(() => eventListQuerySchema.parse({ limit: '101' })).toThrow();
    expect(() => eventCandidateQuerySchema.parse({ q: ' ' })).toThrow();
    expect(() => eventCandidateQuerySchema.parse({ q: '事件', limit: '101' })).toThrow();
    expect(() => eventCandidateQuerySchema.parse({ q: '事件', excludeId: 'invalid' })).toThrow();
    expect(eventListQuerySchema.safeParse({ q: '查'.repeat(80) }).success).toBe(true);
    expect(eventListQuerySchema.safeParse({ q: '查'.repeat(81) }).success).toBe(false);
    expect(eventCandidateQuerySchema.safeParse({ q: '查'.repeat(80) }).success).toBe(true);
    expect(eventCandidateQuerySchema.safeParse({ q: '查'.repeat(81) }).success).toBe(false);
  });

  it('accepts documented detail, list, and API error responses', () => {
    const detail = {
      id: eventId,
      name: '原油价格上涨',
      description: null,
      aliases: ['油价上涨'],
      keywords: ['原油'],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(eventDetailSchema.parse(detail)).toEqual(detail);
    expect(
      eventListResponseSchema.parse({
        items: [
          {
            id: eventId,
            name: detail.name,
            aliases: detail.aliases,
            keywords: detail.keywords,
            updatedAt: timestamp,
          },
        ],
        page: 1,
        pageSize: 30,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toMatchObject({ page: 1, pageSize: 30, totalItems: 1, totalPages: 1 });
    expect(() =>
      eventListResponseSchema.parse({
        items: [],
        page: 1,
        pageSize: 30,
        totalItems: 0,
        totalPages: 1,
        nextCursor: null,
        hasMore: false,
      }),
    ).toThrow();
    expect(
      apiErrorSchema.parse({
        code: 'EVENT_NAME_CONFLICT',
        message: '该标准名称已被使用',
        fields: { name: '该标准名称已被使用' },
      }),
    ).toMatchObject({ code: 'EVENT_NAME_CONFLICT' });
  });

  it('keeps candidates minimal and rejects match metadata', () => {
    expect(eventCandidateSchema.parse({ id: eventId, name: '原油价格上涨' })).toEqual({
      id: eventId,
      name: '原油价格上涨',
    });
    expect(() =>
      eventCandidateSchema.parse({
        id: eventId,
        name: '原油价格上涨',
        matchReason: '命中别名',
      }),
    ).toThrow();
    expect(
      eventCandidateListResponseSchema.parse({
        items: [{ id: eventId, name: '原油价格上涨' }],
        nextCursor: 'next',
        hasMore: true,
      }),
    ).toMatchObject({ nextCursor: 'next', hasMore: true });
  });
});
