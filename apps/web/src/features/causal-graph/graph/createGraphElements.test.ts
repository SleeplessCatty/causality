import { describe, expect, it } from 'vitest';

import type { CausalGraphResponse } from '@causality/contracts';
import { createGraphElements } from './createGraphElements';

const centerEventId = '11111111-1111-4111-8111-111111111111';
const effectEventId = '22222222-2222-4222-8222-222222222222';

const graph: CausalGraphResponse = {
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
    direction: 'downstream',
    nodeLimit: 20,
    relationLimit: 200,
    minConfidence: 0,
    minCaseCount: 0,
    nodeCount: 2,
    relationCount: 1,
    stopReason: 'exhausted',
  },
};

describe('createGraphElements', () => {
  it('preserves order, marks the center, and keeps cause-to-effect direction', () => {
    const elements = createGraphElements(graph, (name) => ({ text: name, fontSize: 14 }));

    expect(elements.nodes.map((node) => node.data.id)).toEqual([centerEventId, effectEventId]);
    expect(elements.nodes[0]?.data).toMatchObject({
      isCenter: true,
      width: 220,
      height: 96,
    });
    expect(elements.nodes[1]?.data.isCenter).toBe(false);
    expect(elements.edges[0]?.data).toMatchObject({
      source: centerEventId,
      target: effectEventId,
      label: '80% · 6例',
    });
  });
});
