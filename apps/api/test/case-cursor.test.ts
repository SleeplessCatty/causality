import { describe, expect, it } from 'vitest';

import {
  decodeCaseListCursor,
  decodeCaseRelationCursor,
  encodeCaseListCursor,
  encodeCaseRelationCursor,
} from '../src/features/cases/caseCursor.js';

const caseId = '11111111-1111-4111-8111-111111111111';
const relationId = '22222222-2222-4222-8222-222222222222';

describe('case cursors', () => {
  it('round-trips list state bound to search and relation filters', () => {
    const state = {
      query: '关税',
      filterRelationId: relationId,
      rank: 2,
      updatedAt: '2026-07-21T03:00:00.000Z',
      id: caseId,
    };
    const cursor = encodeCaseListCursor(state);
    expect(decodeCaseListCursor(cursor, ' 关税 ', relationId)).toEqual(state);
    expect(() => decodeCaseListCursor(cursor, '油价', relationId)).toThrow('Invalid case cursor');
    expect(() => decodeCaseListCursor(cursor, '关税', undefined)).toThrow('Invalid case cursor');
  });

  it('round-trips case-relation state and rejects tampering', () => {
    const state = {
      caseId,
      linkedAt: '2026-07-21T03:00:00.000Z',
      relationId,
    };
    const cursor = encodeCaseRelationCursor(state);
    expect(decodeCaseRelationCursor(cursor, caseId)).toEqual(state);
    expect(() => decodeCaseRelationCursor(cursor, relationId)).toThrow('Invalid case cursor');
    const position = Math.floor(cursor.length / 2);
    const replacement = cursor[position] === 'a' ? 'b' : 'a';
    const tampered = `${cursor.slice(0, position)}${replacement}${cursor.slice(position + 1)}`;
    expect(() => decodeCaseRelationCursor(tampered, caseId)).toThrow('Invalid case cursor');
  });

  it('rejects malformed and unsupported cursor envelopes', () => {
    expect(() => decodeCaseListCursor('invalid', '', undefined)).toThrow('Invalid case cursor');
    const unsupported = Buffer.from(JSON.stringify({ version: 2 }), 'utf8').toString('base64url');
    expect(() => decodeCaseListCursor(unsupported, '', undefined)).toThrow('Invalid case cursor');
  });
});
