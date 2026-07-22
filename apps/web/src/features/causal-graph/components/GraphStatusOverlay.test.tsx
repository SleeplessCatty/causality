import type { CausalGraphResponse } from '@causality/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GraphStatusOverlay } from './GraphStatusOverlay';

const graph: CausalGraphResponse = {
  nodes: [{ id: '11111111-1111-4111-8111-111111111111', name: '原油价格上涨' }],
  relations: [],
  meta: {
    centerEventId: '11111111-1111-4111-8111-111111111111',
    direction: 'both',
    nodeLimit: 20,
    relationLimit: 200,
    minConfidence: 0,
    minCaseCount: 0,
    nodeCount: 21,
    relationCount: 37,
    stopReason: 'node_limit',
  },
};

describe('GraphStatusOverlay', () => {
  it('keeps graph counts visible through pending and retryable error states', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <GraphStatusOverlay
        graph={graph}
        isPending={false}
        errorKind={null}
        empty={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('节点 21')).toBeTruthy();
    expect(screen.getByText('关系 37')).toBeTruthy();

    rerender(
      <GraphStatusOverlay
        graph={graph}
        isPending
        errorKind={null}
        empty={false}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('更新中')).toBeTruthy();

    rerender(
      <GraphStatusOverlay
        graph={graph}
        isPending={false}
        errorKind="query"
        empty={false}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('查询失败，保留当前图')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试因果图查询' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('prompts for a center event only in the empty state', () => {
    render(
      <GraphStatusOverlay
        graph={null}
        isPending={false}
        errorKind={null}
        empty
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('请选择中心事件')).toBeTruthy();
  });
});
