import { describe, expect, it } from 'vitest';

import {
  decodeCaseCandidateCursor,
  decodeCaseRelationCursor,
  decodeRelationCaseCursor,
  encodeCaseCandidateCursor,
  encodeCaseRelationCursor,
  encodeRelationCaseCursor,
} from '../src/features/cases/caseCursor.js';

const caseId = '11111111-1111-4111-8111-111111111111';
const relationId = '22222222-2222-4222-8222-222222222222';

describe('case cursors', () => {
  it('round-trips relation-case state and binds it to the relation', () => {
    const state = {
      relationId,
      linkedAt: '2026-07-21T03:00:00.000Z',
      caseId,
    };
    const cursor = encodeRelationCaseCursor(state);
    expect(decodeRelationCaseCursor(cursor, relationId)).toEqual(state);
    expect(() => decodeRelationCaseCursor(cursor, caseId)).toThrow('Invalid case cursor');
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
    expect(() => decodeRelationCaseCursor('invalid', relationId)).toThrow('Invalid case cursor');
    const unsupported = Buffer.from(JSON.stringify({ version: 2 }), 'utf8').toString('base64url');
    expect(() => decodeRelationCaseCursor(unsupported, relationId)).toThrow('Invalid case cursor');
  });

  it('round-trips candidate state and binds it to the query', () => {
    const cursor = encodeCaseCandidateCursor({
      query: '关税',
      rank: 2,
      updatedAt: '2026-07-22T00:00:00.000Z',
      id: caseId,
    });

    expect(decodeCaseCandidateCursor(cursor, ' 关税 ')).toMatchObject({ rank: 2 });
    expect(() => decodeCaseCandidateCursor(cursor, '油价')).toThrow('Invalid case cursor');
    expect(() => decodeCaseCandidateCursor(`${cursor}x`, '关税')).toThrow('Invalid case cursor');
  });
});
