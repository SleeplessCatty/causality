import { describe, expect, it } from 'vitest';

import {
  decodeRelationCursor,
  encodeRelationCursor,
  InvalidRelationCursorError,
} from '../src/features/relations/relationCursor.js';

const state = {
  rank: 2,
  query: '原油',
  updatedAt: '2026-07-21T03:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
};

describe('relation cursor', () => {
  it('round-trips a cursor and normalizes its query', () => {
    const cursor = encodeRelationCursor({ ...state, query: '  原油  ' });
    expect(decodeRelationCursor(cursor, '原油')).toEqual(state);
  });

  it('round-trips a default-list cursor without a search rank', () => {
    const listState = { ...state, query: '', rank: null };
    expect(decodeRelationCursor(encodeRelationCursor(listState), '')).toEqual(listState);
  });

  it('rejects malformed, modified, or query-mismatched cursors', () => {
    const cursor = encodeRelationCursor(state);
    expect(() => decodeRelationCursor('invalid', state.query)).toThrow(InvalidRelationCursorError);
    expect(() => decodeRelationCursor(`${cursor}changed`, state.query)).toThrow(
      InvalidRelationCursorError,
    );
    expect(() => decodeRelationCursor(cursor, '利率')).toThrow(InvalidRelationCursorError);
  });
});
