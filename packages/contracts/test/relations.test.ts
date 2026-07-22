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
      caseSelections: [],
    });
  });

  it('accepts mixed case selections and rejects duplicates', () => {
    const newContent = '2025年4月美国宣布新一轮关税措施';
    const base = {
      causeEventId,
      effectEventId,
      confidence: 75,
      description: null,
    };
    expect(
      relationFormInputSchema.parse({
        ...base,
        caseSelections: [
          { type: 'existing', caseId: relationId },
          { type: 'new', content: ` ${newContent} ` },
        ],
      }).caseSelections,
    ).toEqual([
      { type: 'existing', caseId: relationId },
      { type: 'new', content: newContent },
    ]);
    expect(
      relationFormInputSchema.safeParse({
        ...base,
        caseSelections: [
          { type: 'existing', caseId: relationId },
          { type: 'existing', caseId: relationId },
        ],
      }).success,
    ).toBe(false);
    expect(
      relationFormInputSchema.safeParse({
        ...base,
        caseSelections: [
          { type: 'new', content: newContent },
          { type: 'new', content: ` ${newContent} ` },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts 1,000 case selections and rejects 1,001 at the caseSelections path', () => {
    const base = {
      causeEventId,
      effectEventId,
      confidence: 75,
      description: null,
    };
    const selections = Array.from({ length: 1_001 }, (_, index) => ({
      type: 'existing' as const,
      caseId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));

    expect(
      relationFormInputSchema.safeParse({ ...base, caseSelections: selections.slice(0, 1_000) })
        .success,
    ).toBe(true);

    const overLimit = relationFormInputSchema.safeParse({ ...base, caseSelections: selections });
    expect(overLimit.success).toBe(false);
    if (!overLimit.success) {
      expect(overLimit.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['caseSelections'],
          message: '单条因果关系最多关联 1000 条具体案例',
        }),
      );
    }
  });

  it('accepts 100-character new cases and rejects 101 characters', () => {
    const base = {
      causeEventId,
      effectEventId,
      confidence: 75,
      description: null,
    };
    expect(
      relationFormInputSchema.safeParse({
        ...base,
        caseSelections: [{ type: 'new', content: '例'.repeat(100) }],
      }).success,
    ).toBe(true);
    expect(
      relationFormInputSchema.safeParse({
        ...base,
        caseSelections: [{ type: 'new', content: '例'.repeat(101) }],
      }).success,
    ).toBe(false);
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

  it('accepts strict list, detail, and pair-check responses with real case data', () => {
    const reference = {
      id: relationId,
      causeEvent: { id: causeEventId, name: '央行提高政策利率' },
      effectEvent: { id: effectEventId, name: '市场流动性收紧' },
    };
    const detail = {
      ...reference,
      confidence: 75,
      description: null,
      caseCount: 2,
      recentCases: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          content: '2025年4月美国宣布新一轮关税措施',
        },
      ],
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
    };

    expect(relationDetailSchema.parse(detail)).toEqual(detail);
    expect(
      relationListResponseSchema.parse({
        items: [{ ...reference, confidence: 75, caseCount: 2, updatedAt: detail.updatedAt }],
        nextCursor: null,
        hasMore: false,
      }),
    ).toBeTruthy();
    expect(
      relationPairCheckResponseSchema.parse({ sameDirection: null, reverseDirection: reference }),
    ).toBeTruthy();
    expect(() =>
      relationDetailSchema.parse({
        ...detail,
        recentCases: Array.from({ length: 6 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          content: `案例 ${index}`,
        })),
      }),
    ).toThrow();
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
