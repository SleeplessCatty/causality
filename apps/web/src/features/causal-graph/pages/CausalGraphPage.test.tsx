import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CausalGraphQuery,
  CausalGraphResponse,
  CausalGraphStopReason,
  EventCandidate,
} from '@causality/contracts';

import { ApiClientError } from '../../../shared/api/httpClient';
import { getEvent } from '../../events/api/eventApi';
import { getCausalGraph } from '../api/causalGraphApi';
import { CausalGraphPage } from './CausalGraphPage';
import type { GraphElementSelection } from '../graph/graphSelection';

const canvasControl = vi.hoisted(() => ({
  autoCommit: true,
  commitCount: 0,
  candidateNodeCount: 0,
  commit: null as (() => void) | null,
  failLayout: null as (() => void) | null,
}));

vi.mock('../../events/api/eventApi', () => {
  return { getEvent: vi.fn() };
});
vi.mock('../api/causalGraphApi', () => ({ getCausalGraph: vi.fn() }));
vi.mock('../components/CausalGraphToolbar', () => ({
  CausalGraphToolbar: ({
    selectedEvent,
    direction,
    limit,
    minConfidence,
    minCaseCount,
    onEventSelect,
    onDirectionChange,
    onLimitChange,
    onMinConfidenceChange,
    onMinCaseCountChange,
  }: {
    selectedEvent: EventCandidate | null;
    direction: CausalGraphQuery['direction'];
    limit: CausalGraphQuery['limit'];
    minConfidence: number;
    minCaseCount: number;
    onEventSelect: (event: EventCandidate) => void;
    onDirectionChange: (direction: CausalGraphQuery['direction']) => void;
    onLimitChange: (limit: CausalGraphQuery['limit']) => void;
    onMinConfidenceChange: (value: number) => void;
    onMinCaseCountChange: (value: number) => void;
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
      <button
        type="button"
        onClick={() => onEventSelect({ id: effectEventId, name: '航空公司成本上升' })}
      >
        选择航空成本
      </button>
      <button type="button" onClick={() => onDirectionChange('upstream')}>
        切换上游
      </button>
      <button type="button" onClick={() => onLimitChange(50)}>
        设置 50 节点
      </button>
      <button type="button" onClick={() => onMinConfidenceChange(70)}>
        设置 70% 置信度
      </button>
      <button type="button" onClick={() => onMinCaseCountChange(3)}>
        设置 3 个案例
      </button>
      <span>
        当前查询：{limit} · {minConfidence}% · {minCaseCount}
      </span>
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
          selection,
          onSelectionChange,
          onClearSelection,
          onToggleInspector,
          onEscape,
          onGraphCommit,
          onLayoutStateChange,
        }: {
          graph: CausalGraphResponse | null;
          isInitialLoading: boolean;
          isRefreshing: boolean;
          selection?: GraphElementSelection | null;
          onSelectionChange?: (selection: GraphElementSelection) => void;
          onClearSelection?: () => void;
          onToggleInspector?: () => void;
          onEscape?: () => void;
          onGraphCommit?: (graph: CausalGraphResponse) => void;
          onLayoutStateChange?: (state: 'idle' | 'loading' | 'ready' | 'error') => void;
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
        const [visibleGraph, setVisibleGraph] = React.useState<CausalGraphResponse | null>(null);
        React.useImperativeHandle(ref, () => ({
          zoomIn: () => undefined,
          zoomOut: () => undefined,
          fit: () => undefined,
          retryLayout: () => canvasControl.commit?.(),
          resize: () => undefined,
          ensureSelectionVisible: () => undefined,
          focus: () => undefined,
        }));
        React.useEffect(() => {
          if (!graph) {
            setVisibleGraph(null);
            onLayoutStateChange?.('idle');
            return;
          }
          canvasControl.candidateNodeCount = graph.meta.nodeCount;
          const commit = () => {
            canvasControl.commitCount += 1;
            setVisibleGraph(graph);
            onLayoutStateChange?.('ready');
            onGraphCommit?.(graph);
          };
          canvasControl.commit = commit;
          canvasControl.failLayout = () => onLayoutStateChange?.('error');
          onLayoutStateChange?.('loading');
          if (canvasControl.autoCommit) commit();
        }, [graph, onGraphCommit, onLayoutStateChange]);
        return (
          <div
            data-testid="graph-canvas"
            data-node-count={visibleGraph?.meta.nodeCount ?? 0}
            data-relation-count={visibleGraph?.meta.relationCount ?? 0}
          >
            {!visibleGraph && !graph && !isInitialLoading && !overlay
              ? '搜索并选择一个中心事件'
              : null}
            {isInitialLoading ? '正在生成因果图…' : null}
            {isRefreshing ? '正在重新生成…' : null}
            {overlay?.message}
            {overlay?.actionLabel ? (
              <button onClick={overlay.onAction}>{overlay.actionLabel}</button>
            ) : null}
            <span>画布选择：{selection ? `${selection.type}:${selection.id}` : '无'}</span>
            <button
              type="button"
              onClick={() => onSelectionChange?.({ type: 'node', id: effectEventId })}
            >
              选择结果节点
            </button>
            <button
              type="button"
              onClick={() =>
                onSelectionChange?.({
                  type: 'relation',
                  id: '33333333-3333-4333-8333-333333333333',
                })
              }
            >
              选择关系
            </button>
            <button type="button" onClick={onClearSelection}>
              点击画布空白
            </button>
            <button type="button" onClick={onToggleInspector}>
              空格
            </button>
            <button type="button" onClick={onEscape}>
              Escape
            </button>
          </div>
        );
      },
    ),
  };
});
vi.mock('../components/CausalGraphInspector', () => ({
  CausalGraphInspector: ({
    open,
    selection,
    onClose,
    onSetCenter,
  }: {
    open: boolean;
    selection: GraphElementSelection | null;
    onClose: () => void;
    onSetCenter: (id: string) => void;
  }) =>
    open ? (
      <aside>
        检查器：{selection ? `${selection.type}:${selection.id}` : '请选择节点或关系'}
        <button type="button" onClick={onClose}>
          关闭检查器
        </button>
        {selection?.type === 'node' ? (
          <button type="button" onClick={() => onSetCenter(selection.id)}>
            设为中心事件
          </button>
        ) : null}
      </aside>
    ) : null,
}));

const centerEventId = '11111111-1111-4111-8111-111111111111';
const effectEventId = '22222222-2222-4222-8222-222222222222';

const eventDetail = {
  id: centerEventId,
  name: '原油价格上涨',
  description: null,
  aliases: [],
  keywords: [],
  relationCount: 0,
  listPage: 1,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

function graph(
  direction: CausalGraphQuery['direction'] = 'both',
  stopReason: CausalGraphStopReason = 'exhausted',
  overrides: Partial<CausalGraphQuery> & { nodeCount?: number } = {},
): CausalGraphResponse {
  const nodeLimit = overrides.limit ?? 20;
  const nodeCount = overrides.nodeCount ?? 2;
  return {
    nodes: [
      { id: centerEventId, name: '原油价格上涨' },
      { id: effectEventId, name: '航空公司成本上升' },
      ...(nodeCount > 2
        ? [{ id: '44444444-4444-4444-8444-444444444444', name: '燃油附加费上涨' }]
        : []),
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
      centerEventId: overrides.centerEventId ?? centerEventId,
      direction,
      nodeLimit,
      relationLimit: nodeLimit === 20 ? 200 : nodeLimit === 50 ? 500 : 1_000,
      minConfidence: overrides.minConfidence ?? 0,
      minCaseCount: overrides.minCaseCount ?? 0,
      nodeCount,
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
    canvasControl.autoCommit = true;
    canvasControl.commitCount = 0;
    canvasControl.candidateNodeCount = 0;
    canvasControl.commit = null;
    canvasControl.failLayout = null;
    vi.mocked(getEvent).mockResolvedValue(eventDetail);
    vi.mocked(getCausalGraph).mockImplementation(async (query) =>
      graph(query.direction, 'exhausted', query),
    );
  });

  afterEach(() => vi.clearAllMocks());

  it('waits for a center event without requesting graph data', () => {
    renderPage();
    expect(screen.getByRole('region', { name: '局部因果图工作台' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '局部因果图' })).toBeNull();
    expect(screen.getByRole('complementary', { name: '因果图状态' })).toBeTruthy();
    expect(screen.getByText('搜索并选择一个中心事件')).toBeTruthy();
    expect(getCausalGraph).not.toHaveBeenCalled();
  });

  it('selects a center, writes default both, and loads counts', async () => {
    const router = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '选择原油' }));

    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${centerEventId}&direction=both&limit=20&minConfidence=0&minCaseCount=0`,
      ),
    );
    await waitFor(() =>
      expect(getCausalGraph).toHaveBeenCalledWith(
        {
          centerEventId,
          direction: 'both',
          limit: 20,
          minConfidence: 0,
          minCaseCount: 0,
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText('节点 2')).toBeTruthy();
    expect(screen.getByText('关系 1')).toBeTruthy();
  });

  it('loads a URL center through the graph query without requesting event detail', async () => {
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);

    await screen.findByText('节点 2');

    expect(getEvent).not.toHaveBeenCalled();
  });

  it('restores URL state and canonicalizes an invalid direction', async () => {
    const router = renderPage(`/graph?centerEventId=${centerEventId}&direction=sideways`);
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${centerEventId}&direction=both&limit=20&minConfidence=0&minCaseCount=0`,
      ),
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
    await screen.findByText('节点 2');
    fireEvent.click(screen.getByRole('button', { name: '切换上游' }));
    await waitFor(() =>
      expect(getCausalGraph).toHaveBeenCalledWith(
        expect.objectContaining({
          centerEventId,
          direction: 'upstream',
          limit: 20,
          minConfidence: 0,
          minCaseCount: 0,
        }),
        expect.anything(),
      ),
    );
  });

  it('shows a not-found error when the initial query has no graph to preserve', async () => {
    vi.mocked(getCausalGraph).mockRejectedValueOnce(
      new ApiClientError({ code: 'EVENT_NOT_FOUND', message: '中心事件不存在' }),
    );
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    expect(await screen.findByText('中心事件不存在')).toBeTruthy();
  });

  it('keeps selection and inspector open state independent', async () => {
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    await screen.findByText('节点 2');

    fireEvent.click(screen.getByRole('button', { name: '选择结果节点' }));
    expect(screen.getByText(`画布选择：node:${effectEventId}`)).toBeTruthy();
    expect(screen.queryByText(/检查器：/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '空格' }));
    expect(screen.getByText(`检查器：node:${effectEventId}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择关系' }));
    expect(screen.getByText(/检查器：relation:33333333/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '点击画布空白' }));
    expect(screen.getByText('检查器：请选择节点或关系')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Escape' }));
    expect(screen.queryByText(/检查器：/)).toBeNull();
    expect(screen.getByText('画布选择：无')).toBeTruthy();
  });

  it('sets a selected node as center while preserving direction and resetting interaction state', async () => {
    const router = renderPage(`/graph?centerEventId=${centerEventId}&direction=upstream`);
    await screen.findByText('节点 2');
    fireEvent.click(screen.getByRole('button', { name: '选择结果节点' }));
    fireEvent.click(screen.getByRole('button', { name: '空格' }));
    const commitsBeforeCenterChange = canvasControl.commitCount;
    fireEvent.click(screen.getByRole('button', { name: '设为中心事件' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${effectEventId}&direction=upstream&limit=20&minConfidence=0&minCaseCount=0`,
      ),
    );
    await waitFor(() =>
      expect(canvasControl.commitCount).toBeGreaterThan(commitsBeforeCenterChange),
    );
    await waitFor(() => expect(screen.queryByText(/检查器：/)).toBeNull());
    expect(screen.getByText('画布选择：无')).toBeTruthy();
  });

  it('preserves the other parameters when direction or inspector center changes', async () => {
    const router = renderPage(
      `/graph?centerEventId=${centerEventId}&direction=both&limit=50&minConfidence=60&minCaseCount=2`,
    );
    await screen.findByText('节点 2');
    const commitsBeforeDirectionChange = canvasControl.commitCount;
    fireEvent.click(screen.getByRole('button', { name: '切换上游' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${centerEventId}&direction=upstream&limit=50&minConfidence=60&minCaseCount=2`,
      ),
    );
    await waitFor(() =>
      expect(canvasControl.commitCount).toBeGreaterThan(commitsBeforeDirectionChange),
    );
    await waitFor(() => expect(screen.queryByText('正在重新生成…')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '选择结果节点' }));
    fireEvent.click(screen.getByRole('button', { name: '空格' }));
    fireEvent.click(screen.getByRole('button', { name: '设为中心事件' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${effectEventId}&direction=upstream&limit=50&minConfidence=60&minCaseCount=2`,
      ),
    );
  });

  it('resets all query parameters when the toolbar selects a different center', async () => {
    const router = renderPage(
      `/graph?centerEventId=${centerEventId}&direction=upstream&limit=100&minConfidence=60&minCaseCount=2`,
    );
    await screen.findByText('节点 2');

    fireEvent.click(screen.getByRole('button', { name: '选择航空成本' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${effectEventId}&direction=both&limit=20&minConfidence=0&minCaseCount=0`,
      ),
    );
  });

  it('applies discrete filters immediately while preserving the selected node tier', async () => {
    const router = renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    await screen.findByText('节点 2');
    fireEvent.click(screen.getByRole('button', { name: '设置 50 节点' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${centerEventId}&direction=both&limit=50&minConfidence=0&minCaseCount=0`,
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '设置 70% 置信度' }));
    fireEvent.click(screen.getByRole('button', { name: '设置 3 个案例' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?centerEventId=${centerEventId}&direction=both&limit=50&minConfidence=70&minCaseCount=3`,
      ),
    );
  });

  it('changes the node tier directly without waiting for a limited graph', async () => {
    const router = renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    await screen.findByText('节点 2');
    fireEvent.click(screen.getByRole('button', { name: '设置 50 节点' }));
    await waitFor(() => expect(router.state.location.search).toContain('limit=50'));
  });

  it('keeps old interaction state until a replacement graph is committed', async () => {
    vi.mocked(getCausalGraph).mockImplementation(async (query) =>
      graph(query.direction, 'exhausted', {
        ...query,
        nodeCount: query.direction === 'upstream' ? 3 : 2,
      }),
    );
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    await screen.findByText('节点 2');
    fireEvent.click(screen.getByRole('button', { name: '选择结果节点' }));
    fireEvent.click(screen.getByRole('button', { name: '空格' }));
    expect(screen.getByText(`检查器：node:${effectEventId}`)).toBeTruthy();

    canvasControl.autoCommit = false;
    canvasControl.commit = null;
    fireEvent.click(screen.getByRole('button', { name: '切换上游' }));
    await waitFor(() => expect(canvasControl.candidateNodeCount).toBe(3));
    expect(screen.getByText('节点 2')).toBeTruthy();
    expect(screen.getByText(`检查器：node:${effectEventId}`)).toBeTruthy();

    act(() => canvasControl.commit?.());
    expect(await screen.findByText('节点 3')).toBeTruthy();
    expect(screen.queryByText(/检查器：/)).toBeNull();
    expect(screen.getByText('画布选择：无')).toBeTruthy();
  });

  it('keeps the old graph and interaction state when a replacement query fails', async () => {
    let rejectReplacement: ((reason: Error) => void) | undefined;
    vi.mocked(getCausalGraph).mockImplementation((query) => {
      if (query.direction === 'upstream') {
        return new Promise((_resolve, reject) => {
          rejectReplacement = reject;
        });
      }
      return Promise.resolve(graph(query.direction, 'exhausted', query));
    });
    renderPage(`/graph?centerEventId=${centerEventId}&direction=both`);
    await screen.findByText('节点 2');
    fireEvent.click(screen.getByRole('button', { name: '选择结果节点' }));
    fireEvent.click(screen.getByRole('button', { name: '空格' }));
    fireEvent.click(screen.getByRole('button', { name: '切换上游' }));
    await waitFor(() => expect(rejectReplacement).toBeTypeOf('function'));
    expect(screen.getByTestId('graph-canvas').getAttribute('data-node-count')).toBe('2');
    act(() => rejectReplacement?.(new Error('network failed')));

    expect(await screen.findByText('查询失败，保留当前图')).toBeTruthy();
    expect(screen.getByTestId('graph-canvas').getAttribute('data-node-count')).toBe('2');
    expect(screen.getByText('节点 2')).toBeTruthy();
    expect(screen.getByText('工具栏：原油价格上涨 · upstream')).toBeTruthy();
    expect(screen.getByText(`检查器：node:${effectEventId}`)).toBeTruthy();
    const retry = screen.getByRole('button', { name: '重试因果图查询' });
    const graphCallsBeforeRetry = vi.mocked(getCausalGraph).mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(vi.mocked(getCausalGraph)).toHaveBeenCalledTimes(graphCallsBeforeRetry + 1),
    );
    expect(getEvent).not.toHaveBeenCalled();
  });
});
