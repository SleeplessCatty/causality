import type { CausalGraphResponse } from '@causality/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GraphQueryState } from '../graph/graphQueryState';
import { GraphQueryStatus } from './GraphQueryStatus';

const centerEventId = '11111111-1111-4111-8111-111111111111';
const query: GraphQueryState = {
  centerEventId,
  direction: 'both',
  limit: 20,
  minConfidence: 60,
  minCaseCount: 2,
};

function graph(
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
      minConfidence: 60,
      minCaseCount: 2,
      nodeCount: 1,
      relationCount: 0,
      stopReason,
    },
  };
}

function renderStatus(
  displayedGraph: CausalGraphResponse,
  options: { isPending?: boolean; errorKind?: 'query' | 'layout' | null } = {},
) {
  const onExpand = vi.fn();
  const onAdjustFilter = vi.fn();
  const onRetry = vi.fn();
  render(
    <GraphQueryStatus
      displayedGraph={displayedGraph}
      requestedQuery={{ ...query, limit: displayedGraph.meta.nodeLimit }}
      isPending={options.isPending ?? false}
      errorKind={options.errorKind ?? null}
      onExpand={onExpand}
      onAdjustFilter={onAdjustFilter}
      onRetry={onRetry}
    />,
  );
  return { onExpand, onAdjustFilter, onRetry };
}

describe('GraphQueryStatus', () => {
  it('shows applied filters and no expansion for exhausted graphs', () => {
    renderStatus(graph('exhausted', 20));
    expect(screen.getByText('20 节点档')).toBeTruthy();
    expect(screen.getByText('置信度 ≥ 60%')).toBeTruthy();
    expect(screen.getByText('案例 ≥ 2')).toBeTruthy();
    expect(screen.getByText('当前条件下已展示全部可达内容')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /扩展至/ })).toBeNull();
  });

  it('offers the exact next tier for node or relation limits', () => {
    const first = renderStatus(graph('node_limit', 20));
    fireEvent.click(screen.getByRole('button', { name: '扩展至 50 节点' }));
    expect(first.onExpand).toHaveBeenCalledWith(50);

    cleanup();
    const second = renderStatus(graph('relation_limit', 50));
    expect(screen.getByText('关系较密集，已触发展示保护')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '扩展至 100 节点' }));
    expect(second.onExpand).toHaveBeenCalledWith(100);
  });

  it('guides the user to filters at the 100-node maximum', () => {
    const callbacks = renderStatus(graph('node_limit', 100));
    expect(screen.getByText('已达到 100 节点显示上限')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '调整筛选' }));
    expect(callbacks.onAdjustFilter).toHaveBeenCalledOnce();
  });

  it('disables expansion while a replacement is pending', () => {
    renderStatus(graph('node_limit', 20), { isPending: true });
    const button = screen.getByRole('button', { name: '正在扩展至 50 节点' });
    expect(button).toHaveProperty('disabled', true);
  });

  it('reports query and layout failures while preserving the old result', () => {
    const queryFailure = renderStatus(graph('node_limit', 20), { errorKind: 'query' });
    expect(screen.getByText('查询失败，仍显示上一查询结果')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(queryFailure.onRetry).toHaveBeenCalledOnce();

    cleanup();
    renderStatus(graph('node_limit', 20), { errorKind: 'layout' });
    expect(screen.getByText('布局失败，仍显示上一查询结果')).toBeTruthy();
  });
});
