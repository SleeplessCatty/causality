import { describe, expect, it } from 'vitest';

import {
  decodeEventCandidateCursor,
  decodeEventCursor,
  encodeEventCandidateCursor,
  encodeEventCursor,
} from '../src/features/events/eventCursor.js';

const eventId = '11111111-1111-4111-8111-111111111111';

describe('event cursor', () => {
  it('round-trips a default-list cursor', () => {
    const state = {
      kind: 'list' as const,
      query: '' as const,
      updatedAt: '2026-07-21T03:00:00.000Z',
      id: eventId,
    };

    expect(decodeEventCursor(encodeEventCursor(state), '')).toEqual(state);
  });

  it('round-trips a ranked-search cursor', () => {
    const state = {
      kind: 'search' as const,
      query: '原油',
      rank: 2,
      normalizedName: '原油价格上涨',
      id: eventId,
    };

    expect(decodeEventCursor(encodeEventCursor(state), '原油')).toEqual(state);
  });

  it('rejects malformed and tampered cursors', () => {
    expect(() => decodeEventCursor('not-base64!', '')).toThrow('Invalid event cursor');

    const valid = encodeEventCursor({
      kind: 'list',
      query: '',
      updatedAt: '2026-07-21T03:00:00.000Z',
      id: eventId,
    });
    const position = Math.floor(valid.length / 2);
    const replacement = valid[position] === 'a' ? 'b' : 'a';
    const tampered = `${valid.slice(0, position)}${replacement}${valid.slice(position + 1)}`;

    expect(() => decodeEventCursor(tampered, '')).toThrow('Invalid event cursor');
  });

  it('rejects unsupported versions and query mismatches', () => {
    const unsupported = Buffer.from(JSON.stringify({ version: 2 }), 'utf8').toString('base64url');
    expect(() => decodeEventCursor(unsupported, '')).toThrow('Invalid event cursor');

    const cursor = encodeEventCursor({
      kind: 'search',
      query: '原油',
      rank: 1,
      normalizedName: '原油价格上涨',
      id: eventId,
    });
    expect(() => decodeEventCursor(cursor, '油价')).toThrow('Invalid event cursor');
  });

  it('round-trips candidates and binds them to query and exclusion', () => {
    const cursor = encodeEventCandidateCursor({
      query: '油价',
      excludeId: null,
      rank: 2,
      normalizedName: '原油价格上涨',
      id: eventId,
    });

    expect(decodeEventCandidateCursor(cursor, ' 油价 ')).toMatchObject({
      rank: 2,
      normalizedName: '原油价格上涨',
    });
    expect(() => decodeEventCandidateCursor(cursor, '利率')).toThrow('Invalid event cursor');
    expect(() => decodeEventCandidateCursor(cursor, '油价', eventId)).toThrow(
      'Invalid event cursor',
    );
  });
});
