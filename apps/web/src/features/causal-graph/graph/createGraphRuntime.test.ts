import type { Core } from 'cytoscape';
import { describe, expect, it } from 'vitest';

import { focusVisibleNode } from './createGraphRuntime';
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
