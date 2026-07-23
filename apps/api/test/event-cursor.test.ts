import { describe, expect, it } from 'vitest';

import {
  decodeEventCandidateCursor,
  decodeEventRelationCursor,
  encodeEventCandidateCursor,
  encodeEventRelationCursor,
} from '../src/features/events/eventCursor.js';

const eventId = '11111111-1111-4111-8111-111111111111';

describe('event cursor', () => {
  it('round-trips event relations and binds them to the event', () => {
    const state = {
      eventId,
      linkedAt: '2026-07-21T03:00:00.000Z',
      relationId: '22222222-2222-4222-8222-222222222222',
    };
    const cursor = encodeEventRelationCursor(state);
    expect(decodeEventRelationCursor(cursor, eventId)).toMatchObject(state);
    expect(() => decodeEventRelationCursor(cursor, state.relationId)).toThrow(
      'Invalid event cursor',
    );
  });

  it('rejects malformed and tampered cursors', () => {
    expect(() => decodeEventRelationCursor('not-base64!', eventId)).toThrow('Invalid event cursor');

    const valid = encodeEventRelationCursor({
      eventId,
      linkedAt: '2026-07-21T03:00:00.000Z',
      relationId: '22222222-2222-4222-8222-222222222222',
    });
    const position = Math.floor(valid.length / 2);
    const replacement = valid[position] === 'a' ? 'b' : 'a';
    const tampered = `${valid.slice(0, position)}${replacement}${valid.slice(position + 1)}`;

    expect(() => decodeEventRelationCursor(tampered, eventId)).toThrow('Invalid event cursor');
  });

  it('rejects unsupported versions', () => {
    const unsupported = Buffer.from(JSON.stringify({ version: 2 }), 'utf8').toString('base64url');
    expect(() => decodeEventRelationCursor(unsupported, eventId)).toThrow('Invalid event cursor');
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
