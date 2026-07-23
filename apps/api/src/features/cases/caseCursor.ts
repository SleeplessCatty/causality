import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { normalizeSearchQuery } from '../shared/sqlSearch.js';

const relationStateSchema = z
  .object({
    caseId: z.uuid(),
    linkedAt: z.iso.datetime({ offset: true }),
    relationId: z.uuid(),
  })
  .strict();

const relationCaseStateSchema = z
  .object({
    relationId: z.uuid(),
    linkedAt: z.iso.datetime({ offset: true }),
    caseId: z.uuid(),
  })
  .strict();

const candidateStateSchema = z
  .object({
    query: z.string().min(1).max(100),
    rank: z.number().int().min(1).max(3),
    updatedAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();

const envelopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['relations', 'relation-cases', 'candidates']),
    state: z.unknown(),
    checksum: z.string().min(1),
  })
  .strict();

export type CaseRelationCursorState = z.infer<typeof relationStateSchema>;
export type RelationCaseCursorState = z.infer<typeof relationCaseStateSchema>;
export type CaseCandidateCursorState = z.infer<typeof candidateStateSchema>;

export class InvalidCaseCursorError extends Error {
  constructor() {
    super('Invalid case cursor');
    this.name = 'InvalidCaseCursorError';
  }
}

function checksum(kind: string, state: unknown): string {
  return createHash('sha256')
    .update(`causality:case-cursor:v1:${kind}:${JSON.stringify(state)}`)
    .digest('base64url');
}

function encode(kind: 'relations' | 'relation-cases' | 'candidates', state: unknown): string {
  return Buffer.from(
    JSON.stringify({ version: 1, kind, state, checksum: checksum(kind, state) }),
    'utf8',
  ).toString('base64url');
}

function decode(cursor: string, kind: 'relations' | 'relation-cases' | 'candidates'): unknown {
  const envelope = envelopeSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
  const expected = Buffer.from(checksum(envelope.kind, envelope.state));
  const actual = Buffer.from(envelope.checksum);
  if (
    envelope.kind !== kind ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new Error('cursor mismatch');
  }
  return envelope.state;
}

export function encodeCaseRelationCursor(input: CaseRelationCursorState): string {
  return encode('relations', relationStateSchema.parse(input));
}

export function decodeCaseRelationCursor(cursor: string, caseId: string): CaseRelationCursorState {
  try {
    const state = relationStateSchema.parse(decode(cursor, 'relations'));
    if (state.caseId !== caseId) throw new Error('case mismatch');
    return state;
  } catch {
    throw new InvalidCaseCursorError();
  }
}

export function encodeRelationCaseCursor(input: RelationCaseCursorState): string {
  return encode('relation-cases', relationCaseStateSchema.parse(input));
}

export function decodeRelationCaseCursor(
  cursor: string,
  relationId: string,
): RelationCaseCursorState {
  try {
    const state = relationCaseStateSchema.parse(decode(cursor, 'relation-cases'));
    if (state.relationId !== relationId) throw new Error('relation mismatch');
    return state;
  } catch {
    throw new InvalidCaseCursorError();
  }
}

export function encodeCaseCandidateCursor(input: CaseCandidateCursorState): string {
  const state = candidateStateSchema.parse({ ...input, query: normalizeSearchQuery(input.query) });
  return encode('candidates', state);
}

export function decodeCaseCandidateCursor(cursor: string, query: string): CaseCandidateCursorState {
  try {
    const state = candidateStateSchema.parse(decode(cursor, 'candidates'));
    if (state.query !== normalizeSearchQuery(query)) throw new Error('query mismatch');
    return state;
  } catch {
    throw new InvalidCaseCursorError();
  }
}
