import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CausalGraphQuery,
  CausalGraphResponse,
  CausalGraphStopReason,
  EventCandidate,
} from '@causality/contracts';

import { ApiClientError, getEvent } from '../../events/api/eventApi';
import { getCausalGraph } from '../api/causalGraphApi';
import { CausalGraphPage } from './CausalGraphPage';

vi.mock('../../events/api/eventApi', () => {
  class MockApiClientError extends Error {
    constructor(readonly details: { code: string; message: string }) {
      super(details.message);
    }
  }
  return { ApiClientError: MockApiClientError, getEvent: vi.fn() };
});
vi.mock('../api/causalGraphApi', () => ({ getCausalGraph: vi.fn() }));
vi.mock('../components/CausalGraphToolbar', () => ({
  CausalGraphToolbar: ({
    selectedEvent,
    direction,
    onEventSelect,
    onDirectionChange,
  }: {
    selectedEvent: EventCandidate | null;
    direction: CausalGraphQuery['direction'];
    onEventSelect: (event: EventCandidate) => void;
    onDirectionChange: (direction: CausalGraphQuery['direction']) => void;
  }) => (
    <div>
      <span>
        工具栏：{selectedEvent?.name ?? '未选择'} · {direction}
      </span>
      <button
        type="button"
        onClick={() =>
          onEventSelect({ id: '11111111-1111-4111-8111-111111111111', name: '原油价格上涨' })
        }
      >
        选择原油
      </button>
      <button type="button" onClick={() => onDirectionChange('upstream')}>
        切换上游
      </button>
    </div>
  ),
}));
vi.mock('../components/CausalGraphCanvas', async () => {
  const React = await import('react');
  return {
    CausalGraphCanvas: React.forwardRef(
      (
        {
          graph,
          isInitialLoading,
          isRefreshing,
          overlay,
        }: {
          graph: CausalGraphResponse | null;
          isInitialLoading: boolean;
          isRefreshing: boolean;
          overlay?:
            | {
                message: string;
                actionLabel?: string;
                onAction?: () => void;
              }
            | undefined;
        },
        ref,
      ) => {
        void ref;
        return (
          <div
            data-testid="graph-canvas"
            data-node-count={graph?.meta.nodeCount ?? 0}
            data-relation-count={graph?.meta.relationCount ?? 0}
          >
            {!graph && !isInitialLoading && !overlay ? '搜索并选择一个中心事件' : null}
            {isInitialLoading ? '正在生成因果图…' : null}
            {isRefreshing ? '正在重新生成…' : null}
            {overlay?.message}
            {overlay?.actionLabel ? (
              <button onClick={overlay.onAction}>{overlay.actionLabel}</button>
            ) : null}
          </div>
        );
      },
    ),
  };
});

const centerEventId = '11111111-1111-4111-8111-111111111111';
const effectEventId = '22222222-2222-4222-8222-222222222222';

const eventDetail = {
  id: centerEventId,
  name: '原油价格上涨',
  description: null,
  aliases: [],
  keywords: [],
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

function graph(
  direction: CausalGraphQuery['direction'] = 'both',
  stopReason: CausalGraphStopReason = 'exhausted',
): CausalGraphResponse {
  return {
    nodes: [
      { id: centerEventId, name: '原油价格上涨' },
      { id: effectEventId, name: '航空公司成本上升' },
    ],
    relations: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        causeEventId: centerEventId,
        effectEventId,
        confidence: 80,
        caseCount: 6,
      },
    ],
    meta: {
      centerEventId,
      direction,
      nodeLimit: 20,
      relationLimit: 200,
      minConfidence: 0,
      minCaseCount: 0,
      nodeCount: 2,
      relationCount: 1,
      stopReason,
    },
  };
}

function renderPage(initialEntry = '/graph') {
  const router = createMemoryRouter([{ path: '/graph', element: <CausalGraphPage /> }], {
    initialEntries: [initialEntry],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('CausalGraphPage', () => {
  beforeEach(() => {
    vi.mocked(getEvent).mockResolvedValue(eventDetail);
    vi.mocked(getCausalGraph).mockResolvedValue(graph());
  });

  afterEach(() => vi.clearAllMocks());

  it('waits for a center event without requesting graph data', () => {
    renderPage();
    expect(screen.getByText('搜索并选择一个中心事件')).toBeTruthy();
    expect(getCausalGraph).not.toHaveBeenCalled();
  });

  it('selects a center, writes default both, and loads counts', async () => {
    const router = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '选择原油' }));

    await waitFor(() =>
      expect(router.state.location.search).toBe(`?centerEventId=${centerEventId}&direction=both`),
    );
    await waitFor(() =>
      expect(getCausalGraph).toHaveBeenCalledWith(centerEventId, 'both', expect.anything()),
    );
    expect(await screen.findByText('2 个节点 · 1 条关系')).toBeTruthy();
  });

  it('restores URL state and canonicalizes an invalid direction', async () => {
    const router = renderPage(`/graph?centerEventId=${centerEventId}&direction=sideways`);
    await waitFor(() =>
      expect(router.state.location.search).toBe(`?centerEventId=${centerEventId}&direction=both`),
    );
    expect(await screen.findByText('工具栏：原油价格上涨 · both')).toBeTruthy();
  });

  it('does not request a non-UUID center', async () => {
    renderPage('/graph?centerEventId=not-a-uuid&direction=both');
    expect(await screen.findByText('链接中的中心事件无效')).toBeTruthy();
    expect(getEvent).not.toHaveBeenCalled();
    expect(getCausalGraph).not.toHaveBeenCalled();
  });

  it('automatically requests a changed direction', async () => {
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    await screen.findByText('2 个节点 · 1 条关系');
    fireEvent.click(screen.getByRole('button', { name: '切换上游' }));
    await waitFor(() =>
      expect(getCausalGraph).toHaveBeenCalledWith(centerEventId, 'upstream', expect.anything()),
    );
  });

  it('shows not-found, retryable errors, and relation-limit notice', async () => {
    vi.mocked(getCausalGraph).mockRejectedValueOnce(
      new ApiClientError({ code: 'EVENT_NOT_FOUND', message: '中心事件不存在' }),
    );
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    expect(await screen.findByText('中心事件不存在')).toBeTruthy();
    cleanup();

    vi.mocked(getCausalGraph).mockResolvedValueOnce(graph('both', 'relation_limit'));
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    expect(await screen.findByText('已按关系上限缩小')).toBeTruthy();
  });
});
