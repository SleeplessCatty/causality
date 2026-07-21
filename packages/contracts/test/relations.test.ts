import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  relationDetailSchema,
  relationFormInputSchema,
  relationListQuerySchema,
  relationListResponseSchema,
  relationPairCheckQuerySchema,
  relationPairCheckResponseSchema,
} from '../src/index.js';

const causeEventId = '11111111-1111-4111-8111-111111111111';
const effectEventId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';

describe('relation contracts', () => {
  it('normalizes a valid relation form', () => {
    expect(
      relationFormInputSchema.parse({
        causeEventId,
        effectEventId,
        confidence: 75,
        description: '  利率上升促使流动性收紧  ',
      }),
    ).toEqual({
      causeEventId,
      effectEventId,
      confidence: 75,
      description: '利率上升促使流动性收紧',
    });
  });

  it('rejects self loops, null confidence, decimals, and out-of-range values', () => {
    const base = { causeEventId, effectEventId, description: null };
    expect(
      relationFormInputSchema.safeParse({ ...base, effectEventId: causeEventId, confidence: 50 })
        .success,
    ).toBe(false);
    expect(relationFormInputSchema.safeParse({ ...base, confidence: null }).success).toBe(false);
    expect(relationFormInputSchema.safeParse({ ...base, confidence: 50.5 }).success).toBe(false);
    expect(relationFormInputSchema.safeParse({ ...base, confidence: 101 }).success).toBe(false);
  });

  it('normalizes list and pair-check queries', () => {
    expect(relationListQuerySchema.parse({ q: '  流动性  ', limit: '30' })).toEqual({
      q: '流动性',
      limit: 30,
    });
    expect(
      relationPairCheckQuerySchema.parse({ causeEventId, effectEventId, excludeId: relationId }),
    ).toEqual({ causeEventId, effectEventId, excludeId: relationId });
  });

  it('accepts strict list, detail, and pair-check responses with case count zero', () => {
    const reference = {
      id: relationId,
      causeEvent: { id: causeEventId, name: '央行提高政策利率' },
      effectEvent: { id: effectEventId, name: '市场流动性收紧' },
    };
    const detail = {
      ...reference,
      confidence: 75,
      description: null,
      caseCount: 0,
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
    };

    expect(relationDetailSchema.parse(detail)).toEqual(detail);
    expect(
      relationListResponseSchema.parse({
        items: [{ ...reference, confidence: 75, caseCount: 0, updatedAt: detail.updatedAt }],
        nextCursor: null,
        hasMore: false,
      }),
    ).toBeTruthy();
    expect(
      relationPairCheckResponseSchema.parse({ sameDirection: null, reverseDirection: reference }),
    ).toBeTruthy();
    expect(() => relationDetailSchema.parse({ ...detail, caseCount: 1 })).toThrow();
  });

  it('accepts relation error codes', () => {
    for (const code of [
      'RELATION_NOT_FOUND',
      'RELATION_EVENT_NOT_FOUND',
      'RELATION_SELF_LOOP',
      'RELATION_DIRECTION_CONFLICT',
    ]) {
      expect(apiErrorSchema.parse({ code, message: '关系错误' })).toBeTruthy();
    }
  });
});
