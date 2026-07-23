import { describe, expect, it } from 'vitest';

import { mergeNormalFirst } from '../src/index.js';

describe('normal-first semantic result merging', () => {
  it('keeps normal order and appends only new semantic rows', () => {
    expect(
      mergeNormalFirst(
        [{ id: 'normal-1' }, { id: 'shared' }],
        [{ id: 'shared' }, { id: 'semantic-1' }],
      ).map((item) => item.id),
    ).toEqual(['normal-1', 'shared', 'semantic-1']);
  });

  it('deduplicates repeated semantic rows while preserving their first order', () => {
    expect(
      mergeNormalFirst([], [{ id: 'semantic-2' }, { id: 'semantic-1' }, { id: 'semantic-2' }]).map(
        (item) => item.id,
      ),
    ).toEqual(['semantic-2', 'semantic-1']);
  });
});
