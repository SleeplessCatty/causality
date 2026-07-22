import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  caseCandidateListResponseSchema,
  caseCandidateQuerySchema,
  caseDetailSchema,
  caseFormInputSchema,
  caseListQuerySchema,
  caseListResponseSchema,
  caseRelationListQuerySchema,
  caseRelationListResponseSchema,
} from '../src/index.js';

const caseId = '11111111-1111-4111-8111-111111111111';
const relationId = '22222222-2222-4222-8222-222222222222';
const causeEventId = '33333333-3333-4333-8333-333333333333';
const effectEventId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-07-21T03:00:00.000Z';

describe('concrete case contracts', () => {
  it('trims a case statement and enforces the 1–50 character boundary', () => {
    expect(caseFormInputSchema.parse({ content: '  2025年4月美国宣布新一轮关税措施  ' })).toEqual({
      content: '2025年4月美国宣布新一轮关税措施',
    });
    expect(caseFormInputSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(caseFormInputSchema.safeParse({ content: '事'.repeat(51) }).success).toBe(false);
    expect(caseFormInputSchema.safeParse({ content: '案例', source: '公告' }).success).toBe(false);
  });

  it('normalizes list, candidate, and relation-list queries', () => {
    expect(caseListQuerySchema.parse({ q: '  关税  ', relationId, limit: '30' })).toEqual({
      q: '关税',
      relationId,
      limit: 30,
    });
    expect(
      caseCandidateQuerySchema.parse({ q: ' 关税 ', limit: '100', cursor: 'cursor-value' }),
    ).toEqual({
      q: '关税',
      limit: 100,
      cursor: 'cursor-value',
    });
    expect(caseRelationListQuerySchema.parse({ limit: '30' })).toEqual({ limit: 30 });
    expect(caseCandidateQuerySchema.safeParse({ q: '案例', limit: '101' }).success).toBe(false);
  });

  it('accepts strict case, candidate, list, and linked-relation responses', () => {
    const reference = { id: caseId, content: '2025年4月美国宣布新一轮关税措施' };
    const detail = {
      ...reference,
      relationCount: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const relation = {
      id: relationId,
      causeEvent: { id: causeEventId, name: '美国提高关税' },
      effectEvent: { id: effectEventId, name: '进口成本上升' },
      linkedAt: timestamp,
    };

    expect(caseDetailSchema.parse(detail)).toEqual(detail);
    expect(
      caseListResponseSchema.parse({
        items: [{ ...reference, relationCount: 2, updatedAt: timestamp }],
        nextCursor: null,
        hasMore: false,
      }),
    ).toBeTruthy();
    expect(
      caseCandidateListResponseSchema.parse({
        items: [reference],
        nextCursor: null,
        hasMore: false,
      }),
    ).toEqual({ items: [reference], nextCursor: null, hasMore: false });
    expect(() =>
      caseCandidateListResponseSchema.parse({
        items: [{ ...reference, matchReason: '内容命中' }],
        nextCursor: null,
        hasMore: false,
      }),
    ).toThrow();
    expect(
      caseRelationListResponseSchema.parse({
        items: [relation],
        nextCursor: null,
        hasMore: false,
      }),
    ).toBeTruthy();
  });

  it('accepts case errors with an existing resource id', () => {
    expect(
      apiErrorSchema.parse({
        code: 'CASE_CONTENT_CONFLICT',
        message: '案例内容已存在',
        existingId: caseId,
      }),
    ).toMatchObject({ code: 'CASE_CONTENT_CONFLICT', existingId: caseId });
    expect(apiErrorSchema.parse({ code: 'CASE_NOT_FOUND', message: '案例不存在' })).toBeTruthy();
    expect(
      apiErrorSchema.parse({ code: 'CASE_SELECTION_DUPLICATE', message: '案例不能重复' }),
    ).toBeTruthy();
  });
});
