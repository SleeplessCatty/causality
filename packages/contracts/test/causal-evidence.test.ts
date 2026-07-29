import {
  causalEvidenceBundleInputSchema,
  causalEvidenceBundleResponseSchema,
  causalPathQuerySchema,
  causalPathResponseSchema,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const eventAId = '10000000-0000-4000-8000-000000000001';
const eventBId = '10000000-0000-4000-8000-000000000002';
const eventCId = '10000000-0000-4000-8000-000000000003';
const relationAId = '20000000-0000-4000-8000-000000000001';
const relationBId = '20000000-0000-4000-8000-000000000002';
const caseId = '30000000-0000-4000-8000-000000000001';
const linkedAt = '2026-07-30T02:30:00.000Z';

describe('causal path contracts', () => {
  it('applies bounded path defaults', () => {
    expect(
      causalPathQuerySchema.parse({
        sourceEventId: eventAId,
        targetEventId: eventCId,
      }),
    ).toEqual({
      sourceEventId: eventAId,
      targetEventId: eventCId,
      maxDepth: 5,
      pathLimit: 10,
      minConfidence: 0,
      minCaseCount: 0,
    });
  });

  it.each([{ maxDepth: 11 }, { pathLimit: 11 }, { minConfidence: 101 }, { minCaseCount: 1_001 }])(
    'rejects an out-of-range path query: %o',
    (override) => {
      expect(() =>
        causalPathQuerySchema.parse({
          sourceEventId: eventAId,
          targetEventId: eventCId,
          ...override,
        }),
      ).toThrow();
    },
  );

  it('rejects identical endpoints and unknown fields', () => {
    expect(() =>
      causalPathQuerySchema.parse({
        sourceEventId: eventAId,
        targetEventId: eventAId,
      }),
    ).toThrow('起点事件和终点事件不能相同');

    expect(() =>
      causalPathQuerySchema.parse({
        sourceEventId: eventAId,
        targetEventId: eventCId,
        extra: true,
      }),
    ).toThrow();
  });

  it('parses a strict two-hop path response', () => {
    const response = {
      sourceEvent: { id: eventAId, name: '事件 A' },
      targetEvent: { id: eventCId, name: '事件 C' },
      paths: [
        {
          events: [
            { id: eventAId, name: '事件 A' },
            { id: eventBId, name: '事件 B' },
            { id: eventCId, name: '事件 C' },
          ],
          relations: [
            {
              id: relationAId,
              causeEventId: eventAId,
              effectEventId: eventBId,
              confidence: 60,
              caseCount: 2,
            },
            {
              id: relationBId,
              causeEventId: eventBId,
              effectEventId: eventCId,
              confidence: 40,
              caseCount: 3,
            },
          ],
          hopCount: 2,
          minimumConfidence: 40,
          totalCaseCount: 5,
        },
      ],
      truncated: false,
      truncatedReason: null,
      expandedStateCount: 4,
    };

    expect(causalPathResponseSchema.parse(response)).toEqual(response);
    expect(() => causalPathResponseSchema.parse({ ...response, extra: true })).toThrow();
  });

  it('accepts the two explicit truncation reasons', () => {
    for (const truncatedReason of ['path_limit', 'expansion_limit'] as const) {
      const result = causalPathResponseSchema.parse({
        sourceEvent: { id: eventAId, name: '事件 A' },
        targetEvent: { id: eventCId, name: '事件 C' },
        paths: [],
        truncated: true,
        truncatedReason,
        expandedStateCount: 10_000,
      });
      expect(result.truncatedReason).toBe(truncatedReason);
    }
  });
});

describe('causal evidence bundle contracts', () => {
  it('applies the default case limit', () => {
    expect(causalEvidenceBundleInputSchema.parse({ relationIds: [relationAId] })).toEqual({
      relationIds: [relationAId],
      caseLimitPerRelation: 5,
    });
  });

  it('rejects too many relations, too many cases, duplicate relations, and unknown fields', () => {
    expect(() =>
      causalEvidenceBundleInputSchema.parse({
        relationIds: Array.from(
          { length: 11 },
          (_, index) => '20000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
        ),
      }),
    ).toThrow();

    expect(() =>
      causalEvidenceBundleInputSchema.parse({
        relationIds: [relationAId],
        caseLimitPerRelation: 21,
      }),
    ).toThrow();

    expect(() =>
      causalEvidenceBundleInputSchema.parse({
        relationIds: [relationAId, relationAId],
      }),
    ).toThrow('路径不能重复包含同一关系');

    expect(() =>
      causalEvidenceBundleInputSchema.parse({
        relationIds: [relationAId],
        extra: true,
      }),
    ).toThrow();
  });

  it('parses readable relation evidence including no-case state', () => {
    const response = {
      events: [
        { id: eventAId, name: '事件 A' },
        { id: eventBId, name: '事件 B' },
        { id: eventCId, name: '事件 C' },
      ],
      relations: [
        {
          id: relationAId,
          causeEventId: eventAId,
          effectEventId: eventBId,
          description: '事件 A 导致事件 B',
          confidence: 60,
          caseCount: 2,
          cases: [
            {
              id: caseId,
              content: '2026年事件 A 发生后事件 B 随后发生',
              linkedAt,
            },
          ],
          returnedCaseCount: 1,
          casesTruncated: true,
          evidenceStatus: 'supported',
        },
        {
          id: relationBId,
          causeEventId: eventBId,
          effectEventId: eventCId,
          description: null,
          confidence: 10,
          caseCount: 0,
          cases: [],
          returnedCaseCount: 0,
          casesTruncated: false,
          evidenceStatus: 'no_cases',
        },
      ],
      hopCount: 2,
      minimumConfidence: 10,
      totalCaseCount: 2,
    };

    expect(causalEvidenceBundleResponseSchema.parse(response)).toEqual(response);
    expect(() =>
      causalEvidenceBundleResponseSchema.parse({
        ...response,
        relations: [{ ...response.relations[0], evidenceStatus: 'verified' }],
      }),
    ).toThrow();
  });
});
