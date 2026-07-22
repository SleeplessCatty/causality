import type { Core } from 'cytoscape';
import cytoscape from 'cytoscape';
import { describe, expect, it, vi } from 'vitest';

const { visibleRuntime } = vi.hoisted(() => ({
  visibleRuntime: { destroy: vi.fn() },
}));

vi.mock('cytoscape', () => {
  const cytoscapeMock = Object.assign(
    vi.fn(() => visibleRuntime),
    { use: vi.fn() },
  );
  return { default: cytoscapeMock };
});

import { applyGraphSelection, createGraphRuntime, focusVisibleNode } from './createGraphRuntime';
import { graphStyles } from './graphStyles';

describe('graphStyles', () => {
  it('defines current/context emphasis without dimming unrelated elements', () => {
    const selectors = graphStyles.map((block) => block.selector);
    expect(selectors).toContain('node.is-current');
    expect(selectors).toContain('node.is-context');
    expect(selectors).toContain('edge.is-current');
    expect(selectors).toContain('edge.is-context');
    expect(
      graphStyles.some(
        (block) => 'style' in block && 'opacity' in block.style && block.style.opacity !== 1,
      ),
    ).toBe(false);
  });

  it('uses larger labels and arrows without node underlays', () => {
    const node = graphStyles.find((block) => block.selector === 'node');
    const edge = graphStyles.find((block) => block.selector === 'edge');
    expect(node && 'style' in node ? node.style : {}).not.toHaveProperty('underlay-opacity');
    expect(node && 'style' in node ? node.style : {}).toMatchObject({
      'font-family': 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      'font-size': 22,
    });
    expect(edge && 'style' in edge ? edge.style : {}).toMatchObject({
      'font-size': 12,
      'arrow-scale': 1.3,
    });
  });

  it('defines distinct incoming and outgoing edge colors', () => {
    const incoming = graphStyles.find((block) => block.selector === 'edge.is-incoming');
    const outgoing = graphStyles.find((block) => block.selector === 'edge.is-outgoing');
    expect(incoming && 'style' in incoming ? incoming.style : {}).toMatchObject({
      'line-color': '#2f6f9f',
      'target-arrow-color': '#2f6f9f',
    });
    expect(outgoing && 'style' in outgoing ? outgoing.style : {}).toMatchObject({
      'line-color': '#b56832',
      'target-arrow-color': '#b56832',
    });
  });
});

describe('applyGraphSelection', () => {
  it('assigns deterministic incoming and outgoing classes for a selected node', () => {
    const all = { removeClass: vi.fn() };
    const relations = { addClass: vi.fn(), connectedNodes: vi.fn() };
    const otherNodes = { not: vi.fn(() => ({ addClass: vi.fn() })) };
    relations.connectedNodes.mockReturnValue(otherNodes);
    const incoming = { addClass: vi.fn() };
    const outgoing = { addClass: vi.fn() };
    const current = {
      empty: () => false,
      addClass: vi.fn(),
      connectedEdges: () => relations,
      incomers: vi.fn(() => incoming),
      outgoers: vi.fn(() => outgoing),
    };
    const visible = {
      batch: (callback: () => void) => callback(),
      elements: () => all,
      getElementById: () => current,
    } as unknown as Core;

    applyGraphSelection(visible, { type: 'node', id: 'center' });

    expect(all.removeClass).toHaveBeenCalledWith('is-current is-context is-incoming is-outgoing');
    expect(incoming.addClass).toHaveBeenCalledWith('is-incoming');
    expect(outgoing.addClass).toHaveBeenCalledWith('is-outgoing');
  });
});

describe('createGraphRuntime viewport', () => {
  it('configures Cytoscape with a 10% minimum zoom', () => {
    const runtime = createGraphRuntime(document.createElement('div'));
    expect(cytoscape).toHaveBeenCalledWith(expect.objectContaining({ minZoom: 0.1 }));
    runtime.destroy();
  });

  it('focuses a node without shrinking below the readable zoom floor', () => {
    let zoom = 0.25;
    const center = { empty: () => false };
    const visible = {
      elements: () => 'elements',
      getElementById: (id: string) => (id === 'center' ? center : { empty: () => true }),
      fit: () => undefined,
      zoom: (value?: number) => {
        if (value !== undefined) zoom = value;
        return zoom;
      },
      center: () => undefined,
    } as unknown as Core;

    expect(() => focusVisibleNode(visible, 'center', 48, 0.6)).not.toThrow();
    expect(zoom).toBe(0.6);
    expect(() => focusVisibleNode(visible, 'missing', 48, 0.6)).not.toThrow();
  });
});
