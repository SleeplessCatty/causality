import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CausalGraphResponse } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CausalGraphCanvas,
  type CausalGraphCanvasHandle,
  type GraphRuntime,
} from './CausalGraphCanvas';
import type { GraphElementSelection } from '../graph/graphSelection';

const centerEventId = '11111111-1111-4111-8111-111111111111';

const graph: CausalGraphResponse = {
  nodes: [{ id: centerEventId, name: '原油价格上涨' }],
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

const graph50: CausalGraphResponse = {
  nodes: [
    { id: centerEventId, name: '原油价格上涨' },
    { id: '22222222-2222-4222-8222-222222222222', name: '运输成本上升' },
  ],
  relations: [],
  meta: {
    ...graph.meta,
    nodeLimit: 50,
    relationLimit: 500,
    nodeCount: 2,
    stopReason: 'node_limit',
  },
};

function createFakeRuntime() {
  let zoom = 1;
  let onZoom: (zoom: number) => void = () => undefined;
  let completeLayout: (elements: unknown) => void = () => undefined;
  let failLayout: (error: unknown) => void = () => undefined;

  const runtime: GraphRuntime = {
    layout: vi.fn((_elements, _options, onSuccess, onError) => {
      completeLayout = onSuccess;
      failLayout = onError;
    }),
    commit: vi.fn(),
    fit: vi.fn(),
    focusNode: vi.fn(),
    getZoom: vi.fn(() => zoom),
    setZoom: vi.fn((nextZoom) => {
      zoom = nextZoom;
      onZoom(zoom);
    }),
    onZoom: vi.fn((listener) => {
      onZoom = listener;
      return () => undefined;
    }),
    setSelection: vi.fn(),
    getNavigationSnapshot: vi.fn(() => ({
      centerEventId,
      nodes: [{ id: centerEventId, x: 0, y: 0 }],
      relations: [],
    })),
    resize: vi.fn(),
    ensureVisible: vi.fn(),
    subscribeInteractions: vi.fn(() => () => undefined),
    destroy: vi.fn(),
  };

  return {
    runtime,
    completeLayout: () => completeLayout({ laidOut: true }),
    failLayout: () => failLayout(new Error('layout failed')),
  };
}

describe('CausalGraphCanvas', () => {
  it('creates, lays out, commits, fits, and destroys a graph runtime', () => {
    const fake = createFakeRuntime();
    const createRuntime = vi.fn(() => fake.runtime);
    const { unmount } = render(
      <CausalGraphCanvas
        graph={graph}
        centerEventName="原油价格上涨"
        createRuntime={createRuntime}
      />,
    );

    const canvas = screen.getByRole('application', {
      name: /原油价格上涨.*1 个节点.*0 条关系/,
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(fake.runtime.layout).toHaveBeenCalledOnce();
    expect(canvas.getAttribute('data-layout-state')).toBe('loading');

    act(() => fake.completeLayout());
    expect(fake.runtime.commit).toHaveBeenCalledWith({ laidOut: true });
    expect(fake.runtime.fit).toHaveBeenCalledWith(48, false);
    expect(canvas.getAttribute('data-layout-state')).toBe('ready');
    expect(canvas.getAttribute('data-node-count')).toBe('1');
    expect(canvas.getAttribute('data-relation-count')).toBe('0');
    expect(screen.getByText('当前方向暂无关联事件')).toBeTruthy();

    unmount();
    expect(fake.runtime.destroy).toHaveBeenCalledOnce();
  });

  it('reports a committed graph only after layout and uses a readable large-graph viewport', () => {
    const fake = createFakeRuntime();
    const onGraphCommit = vi.fn();
    render(
      <CausalGraphCanvas
        graph={graph50}
        centerEventName="原油价格上涨"
        createRuntime={() => fake.runtime}
        onGraphCommit={onGraphCommit}
      />,
    );

    expect(onGraphCommit).not.toHaveBeenCalled();
    act(() => fake.completeLayout());
    expect(fake.runtime.commit).toHaveBeenCalledWith({ laidOut: true });
    expect(fake.runtime.focusNode).toHaveBeenCalledWith(centerEventId, 48, 0.6);
    expect(onGraphCommit).toHaveBeenCalledWith(graph50);
  });

  it('keeps committed graph metadata when a replacement layout fails', () => {
    const fake = createFakeRuntime();
    const { rerender } = render(
      <CausalGraphCanvas
        graph={graph}
        centerEventName="原油价格上涨"
        createRuntime={() => fake.runtime}
      />,
    );
    act(() => fake.completeLayout());
    const canvas = screen.getByRole('application');
    expect(canvas.getAttribute('data-node-count')).toBe('1');

    rerender(
      <CausalGraphCanvas
        graph={graph50}
        centerEventName="原油价格上涨"
        createRuntime={() => fake.runtime}
      />,
    );
    expect(canvas.getAttribute('data-node-count')).toBe('1');
    act(() => fake.failLayout());
    expect(canvas.getAttribute('data-node-count')).toBe('1');
    expect(canvas.getAttribute('data-layout-state')).toBe('error');
  });

  it('clamps zoom, reports it, and fits without relayout', () => {
    const fake = createFakeRuntime();
    const ref = createRef<CausalGraphCanvasHandle>();
    const onZoomChange = vi.fn();
    render(
      <CausalGraphCanvas
        ref={ref}
        graph={graph}
        centerEventName="原油价格上涨"
        createRuntime={() => fake.runtime}
        onZoomChange={onZoomChange}
      />,
    );
    act(() => fake.completeLayout());

    act(() => {
      for (let index = 0; index < 20; index += 1) ref.current?.zoomIn();
    });
    expect(fake.runtime.setZoom).toHaveBeenLastCalledWith(2, true);
    expect(onZoomChange).toHaveBeenLastCalledWith(2);

    act(() => {
      for (let index = 0; index < 40; index += 1) ref.current?.zoomOut();
      ref.current?.fit();
    });
    expect(fake.runtime.setZoom).toHaveBeenLastCalledWith(0.25, true);
    expect(fake.runtime.fit).toHaveBeenLastCalledWith(48, true);
    expect(fake.runtime.layout).toHaveBeenCalledOnce();
  });

  it('shows layout failure and retries without changing graph data', () => {
    const fake = createFakeRuntime();
    const ref = createRef<CausalGraphCanvasHandle>();
    render(
      <CausalGraphCanvas
        ref={ref}
        graph={graph}
        centerEventName="原油价格上涨"
        createRuntime={() => fake.runtime}
      />,
    );
    act(() => fake.failLayout());
    expect(screen.getByText('无法生成布局')).toBeTruthy();

    act(() => ref.current?.retryLayout());
    expect(fake.runtime.layout).toHaveBeenCalledTimes(2);
  });

  it('disables viewport animation when reduced motion is preferred', () => {
    const fake = createFakeRuntime();
    const ref = createRef<CausalGraphCanvasHandle>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    render(
      <CausalGraphCanvas
        ref={ref}
        graph={graph}
        centerEventName="原油价格上涨"
        createRuntime={() => fake.runtime}
      />,
    );
    act(() => fake.completeLayout());
    act(() => ref.current?.zoomIn());
    expect(fake.runtime.setZoom).toHaveBeenLastCalledWith(1.2, false);
    vi.unstubAllGlobals();
  });

  it('keeps selection and inspector keyboard commands independent', async () => {
    const fake = createFakeRuntime();
    const onSelectionChange = vi.fn();
    const onToggleInspector = vi.fn();
    const onEscape = vi.fn();
    const selection: GraphElementSelection = { type: 'node', id: centerEventId };
    const { rerender } = render(
      <CausalGraphCanvas
        graph={graph}
        centerEventName="原油价格上涨"
        selection={null}
        inspectorOpen={false}
        onSelectionChange={onSelectionChange}
        onClearSelection={vi.fn()}
        onToggleInspector={onToggleInspector}
        onEscape={onEscape}
        createRuntime={() => fake.runtime}
      />,
    );
    const canvas = screen.getByRole('application');
    fireEvent.pointerUp(canvas);
    await waitFor(() => expect(document.activeElement).toBe(canvas));
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'node', id: centerEventId });
    fireEvent.keyDown(canvas, { key: ' ' });
    expect(onToggleInspector).toHaveBeenCalledOnce();
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledOnce();

    rerender(
      <CausalGraphCanvas
        graph={graph}
        centerEventName="原油价格上涨"
        selection={selection}
        inspectorOpen
        onSelectionChange={onSelectionChange}
        onClearSelection={vi.fn()}
        onToggleInspector={onToggleInspector}
        onEscape={onEscape}
        createRuntime={() => fake.runtime}
      />,
    );
    expect(fake.runtime.setSelection).toHaveBeenLastCalledWith(selection);
  });

  it('restores canvas focus through its imperative handle', () => {
    const fake = createFakeRuntime();
    const ref = createRef<CausalGraphCanvasHandle>();
    render(
      <CausalGraphCanvas
        ref={ref}
        graph={graph}
        centerEventName="原油价格上涨"
        createRuntime={() => fake.runtime}
      />,
    );
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(screen.getByRole('application'));
  });
});
