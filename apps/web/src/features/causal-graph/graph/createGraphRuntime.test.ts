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

import { createGraphRuntime, focusVisibleNode } from './createGraphRuntime';
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
