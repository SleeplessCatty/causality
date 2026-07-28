import { describe, expect, it } from 'vitest';

import {
  causalGraphQuerySchema,
  causalGraphResponseSchema,
  type CausalGraphResponse,
} from '../src/index.js';

const centerEventId = '11111111-1111-4111-8111-111111111111';
const relatedEventId = '22222222-2222-4222-8222-222222222222';
const relationId = '33333333-3333-4333-8333-333333333333';

describe('causal graph contracts', () => {
  it('applies defaults to the required center and direction', () => {
    expect(causalGraphQuerySchema.parse({ centerEventId, direction: 'both' })).toEqual({
      centerEventId,
      direction: 'both',
      limit: 20,
      minConfidence: 0,
      minCaseCount: 0,
    });
  });

  it('coerces supported limits and filters from query strings', () => {
    expect(
      causalGraphQuerySchema.parse({
        centerEventId,
        direction: 'upstream',
        limit: '100',
        minConfidence: '75',
        minCaseCount: '3',
      }),
    ).toEqual({
      centerEventId,
      direction: 'upstream',
      limit: 100,
      minConfidence: 75,
      minCaseCount: 3,
    });
  });

  it('rejects invalid directions, unsupported limits, and invalid filters', () => {
    for (const invalid of [
      { centerEventId, direction: 'sideways' },
      { centerEventId, direction: 'both', limit: 30 },
      { centerEventId, direction: 'both', minConfidence: 101 },
      { centerEventId, direction: 'both', minConfidence: 1.5 },
      { centerEventId, direction: 'both', minCaseCount: -1 },
      { centerEventId, direction: 'both', minCaseCount: 1.5 },
    ]) {
      expect(causalGraphQuerySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('accepts the strict graph response shape', () => {
    const response: CausalGraphResponse = {
      nodes: [
        { id: centerEventId, name: '利率上升' },
        { id: relatedEventId, name: '融资成本上升' },
      ],
      relations: [
        {
          id: relationId,
          causeEventId: centerEventId,
          effectEventId: relatedEventId,
          confidence: 80.4321,
          caseCount: 3,
        },
      ],
      meta: {
        centerEventId,
        direction: 'downstream',
        nodeLimit: 20,
        relationLimit: 200,
        minConfidence: 0,
        minCaseCount: 0,
        nodeCount: 2,
        relationCount: 1,
        stopReason: 'exhausted',
      },
    };

    expect(causalGraphResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects extra response fields and invalid response limits', () => {
    const base = {
      nodes: [{ id: centerEventId, name: '利率上升' }],
      relations: [],
      meta: {
        centerEventId,
        direction: 'both',
        nodeLimit: 20,
        relationLimit: 200,
        minConfidence: 0,
        minCaseCount: 0,
        nodeCount: 1,
        relationCount: 0,
        stopReason: 'exhausted',
      },
    };

    expect(
      causalGraphResponseSchema.safeParse({
        ...base,
        nodes: [{ ...base.nodes[0], description: '不应出现在图响应中' }],
      }).success,
    ).toBe(false);
    expect(
      causalGraphResponseSchema.safeParse({
        ...base,
        relations: [
          {
            id: relationId,
            causeEventId: centerEventId,
            effectEventId: relatedEventId,
            confidence: 80,
            caseCount: 3,
            description: '不应出现在图响应中',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      causalGraphResponseSchema.safeParse({
        ...base,
        meta: { ...base.meta, relationLimit: 300 },
      }).success,
    ).toBe(false);
  });
});
