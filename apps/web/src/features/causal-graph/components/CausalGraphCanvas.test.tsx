import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import type { CausalGraphResponse } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CausalGraphCanvas,
  type CausalGraphCanvasHandle,
  type GraphRuntime,
} from './CausalGraphCanvas';

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
    getZoom: vi.fn(() => zoom),
    setZoom: vi.fn((nextZoom) => {
      zoom = nextZoom;
      onZoom(zoom);
    }),
    onZoom: vi.fn((listener) => {
      onZoom = listener;
      return () => undefined;
    }),
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

    const canvas = screen.getByRole('img', { name: /原油价格上涨.*1 个节点.*0 条关系/ });
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
});
