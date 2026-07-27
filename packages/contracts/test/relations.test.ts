import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  relationDetailSchema,
  relationFormInputSchema,
  relationListQuerySchema,
  relationListResponseSchema,
  relationCaseListQuerySchema,
  relationCaseListResponseSchema,
  relationPairCheckQuerySchema,
  relationPairCheckResponseSchema,
  relationConfidenceSchema,
  relationDescriptionSchema,
} from '../src/index.js';

const causeEventId = '11111111-1111-4111-8111-111111111111';
const effectEventId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';

describe('relation contracts', () => {
  it('exports reusable confidence and description field schemas', () => {
    expect(relationConfidenceSchema.parse(75)).toBe(75);
    expect(relationConfidenceSchema.safeParse(75.5).success).toBe(false);
    expect(relationDescriptionSchema.parse('  利率上升促使流动性收紧  ')).toBe(
      '利率上升促使流动性收紧',
    );
    expect(relationDescriptionSchema.parse('   ')).toBeNull();
  });

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

  it('normalizes page-based list queries and rejects invalid page bounds', () => {
    expect(
      relationListQuerySchema.parse({
        q: '  流动性  ',
        limit: '30',
        orphan: 'true',
        eventId: causeEventId,
      }),
    ).toEqual({
      q: '流动性',
      page: 1,
      limit: 30,
      orphan: true,
      eventId: causeEventId,
      searchMode: 'standard',
    });
    expect(relationListQuerySchema.parse({})).toEqual({
      q: '',
      page: 1,
      limit: 50,
      orphan: false,
      searchMode: 'standard',
    });
    expect(relationListQuerySchema.parse({ page: '100000' })).toEqual({
      q: '',
      page: 100_000,
      limit: 50,
      orphan: false,
      searchMode: 'standard',
    });
    expect(relationListQuerySchema.parse({ orphan: 'false' }).orphan).toBe(false);
    for (const page of ['0', '-1', '1.5', '100001']) {
      expect(relationListQuerySchema.safeParse({ page }).success).toBe(false);
    }
    expect(relationListQuerySchema.safeParse({ eventId: 'invalid' }).success).toBe(false);
  });

  it('normalizes pair-check queries', () => {
    expect(
      relationPairCheckQuerySchema.parse({ causeEventId, effectEventId, excludeId: relationId }),
    ).toEqual({ causeEventId, effectEventId, excludeId: relationId });
  });

  it('keeps relation-detail cases cursor-based with a 20-item default', () => {
    expect(relationCaseListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(relationCaseListQuerySchema.parse({ limit: '30', cursor: 'next-page' })).toEqual({
      limit: 30,
      cursor: 'next-page',
    });
    expect(
      relationCaseListResponseSchema.parse({
        items: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            content: '2025年4月美国宣布新一轮关税措施',
            relationCount: 1,
            updatedAt: '2026-07-21T00:00:00.000Z',
            linkedAt: '2026-07-20T08:30:00.000Z',
          },
        ],
        nextCursor: 'next-page',
        hasMore: true,
      }),
    ).toMatchObject({ nextCursor: 'next-page', hasMore: true });
    expect(() =>
      relationCaseListResponseSchema.parse({
        items: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            content: '缺少关联时间的案例',
            relationCount: 1,
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    ).toThrow();
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
      listPage: 3,
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
        page: 1,
        pageSize: 30,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toBeTruthy();
    expect(() =>
      relationListResponseSchema.parse({
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
