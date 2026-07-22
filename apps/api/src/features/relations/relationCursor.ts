import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { normalizeSearchQuery } from '../shared/sqlSearch.js';

const relationCursorStateSchema = z
  .object({
    query: z.string().max(120),
    rank: z.number().int().min(1).max(6).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict()
  .superRefine((state, context) => {
    if ((state.query === '') !== (state.rank === null)) {
      context.addIssue({ code: 'custom', message: 'cursor rank does not match query' });
    }
  });

const relationCursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    state: relationCursorStateSchema,
    checksum: z.string().min(1),
  })
  .strict();

export type RelationCursorState = z.infer<typeof relationCursorStateSchema>;

export class InvalidRelationCursorError extends Error {
  constructor() {
    super('Invalid relation cursor');
    this.name = 'InvalidRelationCursorError';
  }
}

function checksum(state: RelationCursorState): string {
  return createHash('sha256')
    .update(`causality:relation-cursor:v1:${JSON.stringify(state)}`)
    .digest('base64url');
}

export function encodeRelationCursor(input: RelationCursorState): string {
  const state = relationCursorStateSchema.parse({
    ...input,
    query: normalizeSearchQuery(input.query),
  });
  return Buffer.from(
    JSON.stringify({ version: 1, state, checksum: checksum(state) }),
    'utf8',
  ).toString('base64url');
}

export function decodeRelationCursor(cursor: string, query: string): RelationCursorState {
  try {
    const envelope = relationCursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    const expected = Buffer.from(checksum(envelope.state));
    const actual = Buffer.from(envelope.checksum);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('checksum mismatch');
    }
    if (envelope.state.query !== normalizeSearchQuery(query)) throw new Error('query mismatch');
    return envelope.state;
  } catch {
    throw new InvalidRelationCursorError();
  }
}
