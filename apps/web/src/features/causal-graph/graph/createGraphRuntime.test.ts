import { describe, expect, it } from 'vitest';

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
