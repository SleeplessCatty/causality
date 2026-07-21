import { describe, expect, it } from 'vitest';

import { GRAPH_FIT_PADDING, graphLayoutOptions } from './graphLayoutOptions';

describe('graphLayoutOptions', () => {
  it('uses the approved left-to-right layered ELK layout', () => {
    expect(graphLayoutOptions).toMatchObject({
      name: 'elk',
      fit: false,
      animate: false,
      nodeDimensionsIncludeLabels: false,
      elk: {
        algorithm: 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '140',
      },
    });
    expect(GRAPH_FIT_PADDING).toBe(48);
  });
});
