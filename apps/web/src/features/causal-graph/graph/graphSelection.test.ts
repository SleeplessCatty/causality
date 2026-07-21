import { describe, expect, it } from 'vitest';

import { adjacentSelectionIds } from './graphSelection';

const relations = [
  { id: 'r1', causeEventId: 'a', effectEventId: 'b' },
  { id: 'r2', causeEventId: 'c', effectEventId: 'a' },
  { id: 'r3', causeEventId: 'b', effectEventId: 'd' },
];

describe('adjacentSelectionIds', () => {
  it('returns every one-hop edge and opposite node for a node', () => {
    expect(adjacentSelectionIds({ type: 'node', id: 'a' }, { relations })).toEqual({
      currentId: 'a',
      contextNodeIds: ['b', 'c'],
      contextRelationIds: ['r1', 'r2'],
    });
  });

  it('returns only two endpoints for a relation', () => {
    expect(adjacentSelectionIds({ type: 'relation', id: 'r1' }, { relations })).toEqual({
      currentId: 'r1',
      contextNodeIds: ['a', 'b'],
      contextRelationIds: [],
    });
  });
});
