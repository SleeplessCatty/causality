import type { CausalGraphResponse } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import {
  activeGraphFilterCount,
  graphQueryStatus,
  nextGraphLimit,
  parseGraphQueryState,
  toGraphSearchParams,
  validateGraphFilterDraft,
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
      minConfidence: 0,
      minCaseCount: 0,
    });
    expect(parsed.needsCanonicalization).toBe(true);
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

  it('counts only active non-default filters', () => {
    expect(activeGraphFilterCount({ minConfidence: 0, minCaseCount: 0 })).toBe(0);
    expect(activeGraphFilterCount({ minConfidence: 60, minCaseCount: 0 })).toBe(1);
    expect(activeGraphFilterCount({ minConfidence: 60, minCaseCount: 2 })).toBe(2);
  });

  it('validates integer filter drafts without accepting blanks or coercing decimals', () => {
    expect(validateGraphFilterDraft({ minConfidence: '60', minCaseCount: '2' })).toEqual({
      success: true,
      values: { minConfidence: 60, minCaseCount: 2 },
    });
    expect(validateGraphFilterDraft({ minConfidence: '', minCaseCount: '1.5' })).toEqual({
      success: false,
      errors: {
        minConfidence: '请输入 0 到 100 的整数',
        minCaseCount: '请输入大于等于 0 的整数',
      },
    });
    expect(validateGraphFilterDraft({ minConfidence: '101', minCaseCount: '-1' })).toEqual({
      success: false,
      errors: {
        minConfidence: '请输入 0 到 100 的整数',
        minCaseCount: '请输入大于等于 0 的整数',
      },
    });
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
