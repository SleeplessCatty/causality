import type { CausalGraphResponse } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import {
  graphCaseCountOptions,
  graphConfidenceOptions,
  graphLimitOptions,
  graphQueryStatus,
  nextGraphLimit,
  parseGraphQueryState,
  toGraphSearchParams,
} from './graphQueryState';

const centerEventId = '11111111-1111-4111-8111-111111111111';

function graphWith(
  stopReason: CausalGraphResponse['meta']['stopReason'],
  nodeLimit: CausalGraphResponse['meta']['nodeLimit'],
): CausalGraphResponse {
  return {
    nodes: [{ id: centerEventId, name: '原油价格上涨' }],
    relations: [],
    meta: {
      centerEventId,
      direction: 'both',
      nodeLimit,
      relationLimit: nodeLimit === 20 ? 200 : nodeLimit === 50 ? 500 : 1_000,
      minConfidence: 0,
      minCaseCount: 0,
      nodeCount: 1,
      relationCount: 0,
      stopReason,
    },
  };
}

describe('graphQueryState', () => {
  it('parses and serializes all supported query parameters in stable order', () => {
    const parsed = parseGraphQueryState(
      new URLSearchParams(
        `centerEventId=${centerEventId}&direction=downstream&limit=50&minConfidence=60&minCaseCount=2`,
      ),
    );

    expect(parsed).toEqual({
      state: {
        centerEventId,
        direction: 'downstream',
        limit: 50,
        minConfidence: 60,
        minCaseCount: 2,
      },
      needsCanonicalization: false,
    });
    expect(toGraphSearchParams(parsed.state).toString()).toBe(
      `centerEventId=${centerEventId}&direction=downstream&limit=50&minConfidence=60&minCaseCount=2`,
    );
  });

  it('canonicalizes unsupported URL values to safe defaults', () => {
    const parsed = parseGraphQueryState(
      new URLSearchParams(
        `centerEventId=${centerEventId}&direction=sideways&limit=75&minConfidence=101&minCaseCount=-1`,
      ),
    );

    expect(parsed.state).toEqual({
      centerEventId,
      direction: 'both',
      limit: 20,
      minConfidence: 100,
      minCaseCount: 0,
    });
    expect(parsed.needsCanonicalization).toBe(true);
  });

  it('normalizes URL filters to the selectable discrete options', () => {
    const parsed = parseGraphQueryState(
      new URLSearchParams(`centerEventId=${centerEventId}&minConfidence=25&minCaseCount=99`),
    );

    expect(parsed.state).toMatchObject({ minConfidence: 20, minCaseCount: 10 });
    expect(graphLimitOptions).toEqual([20, 50, 100]);
    expect(graphConfidenceOptions).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(graphCaseCountOptions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('keeps an empty graph URL empty while exposing safe defaults', () => {
    const parsed = parseGraphQueryState(new URLSearchParams());
    expect(parsed.state).toEqual({
      centerEventId: '',
      direction: 'both',
      limit: 20,
      minConfidence: 0,
      minCaseCount: 0,
    });
    expect(parsed.needsCanonicalization).toBe(false);
    expect(toGraphSearchParams(parsed.state).toString()).toBe('');
  });

  it('advances only through the approved display tiers', () => {
    expect(nextGraphLimit(20)).toBe(50);
    expect(nextGraphLimit(50)).toBe(100);
    expect(nextGraphLimit(100)).toBeNull();
  });

  it('derives only the approved action for each stop state and tier', () => {
    expect(graphQueryStatus(graphWith('exhausted', 20))).toEqual({
      action: 'none',
      message: '当前条件下已展示全部可达内容',
      nextLimit: null,
    });
    expect(graphQueryStatus(graphWith('node_limit', 20))).toEqual({
      action: 'expand',
      message: '已达到当前节点显示档位',
      nextLimit: 50,
    });
    expect(graphQueryStatus(graphWith('relation_limit', 50))).toEqual({
      action: 'expand',
      message: '关系较密集，已触发展示保护',
      nextLimit: 100,
    });
    expect(graphQueryStatus(graphWith('relation_limit', 100))).toEqual({
      action: 'adjust_filter',
      message: '已达到 100 节点显示上限',
      nextLimit: null,
    });
  });
});
