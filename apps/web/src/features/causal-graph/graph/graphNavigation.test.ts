import { describe, expect, it } from 'vitest';

import { navigateGraph, type GraphPositionSnapshot } from './graphNavigation';

const snapshot: GraphPositionSnapshot = {
  centerEventId: 'a',
  nodes: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
    { id: 'c', x: 0, y: -100 },
  ],
  relations: [
    { id: 'r1', causeEventId: 'a', effectEventId: 'b' },
    { id: 'r2', causeEventId: 'a', effectEventId: 'c' },
  ],
};

describe('navigateGraph', () => {
  it('starts from the center node', () => {
    expect(navigateGraph(null, 'right', snapshot)).toEqual({ type: 'node', id: 'a' });
  });

  it('moves from a node to the nearest incident relation in the pressed direction', () => {
    expect(navigateGraph({ type: 'node', id: 'a' }, 'right', snapshot)).toEqual({
      type: 'relation',
      id: 'r1',
    });
    expect(navigateGraph({ type: 'node', id: 'a' }, 'up', snapshot)).toEqual({
      type: 'relation',
      id: 'r2',
    });
  });

  it('moves from a relation to its endpoint and retains selection with no candidate', () => {
    expect(navigateGraph({ type: 'relation', id: 'r1' }, 'right', snapshot)).toEqual({
      type: 'node',
      id: 'b',
    });
    expect(navigateGraph({ type: 'node', id: 'a' }, 'left', snapshot)).toEqual({
      type: 'node',
      id: 'a',
    });
  });

  it('uses ID as a deterministic final tie breaker', () => {
    const tied = {
      ...snapshot,
      nodes: [...snapshot.nodes, { id: 'd', x: 100, y: 0 }],
      relations: [
        { id: 'r-z', causeEventId: 'a', effectEventId: 'd' },
        { id: 'r-a', causeEventId: 'a', effectEventId: 'b' },
      ],
    };
    expect(navigateGraph({ type: 'node', id: 'a' }, 'right', tied)).toEqual({
      type: 'relation',
      id: 'r-a',
    });
  });
});
