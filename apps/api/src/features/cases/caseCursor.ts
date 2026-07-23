import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { normalizeSearchQuery } from '../shared/sqlSearch.js';

const associationStateSchema = z
  .object({
    caseId: z.uuid(),
    linkedAt: z.iso.datetime({ offset: true }),
    relationId: z.uuid(),
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

export type AssociationCursorState = z.infer<typeof associationStateSchema>;
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

export function encodeCaseRelationCursor(input: AssociationCursorState): string {
  return encode('relations', associationStateSchema.parse(input));
}

export function decodeCaseRelationCursor(cursor: string, caseId: string): AssociationCursorState {
  return decodeAssociationCursor(cursor, 'relations', 'caseId', caseId);
}

export function encodeRelationCaseCursor(input: AssociationCursorState): string {
  return encode('relation-cases', associationStateSchema.parse(input));
}

export function decodeRelationCaseCursor(
  cursor: string,
  relationId: string,
): AssociationCursorState {
  return decodeAssociationCursor(cursor, 'relation-cases', 'relationId', relationId);
}

function decodeAssociationCursor(
  cursor: string,
  kind: 'relations' | 'relation-cases',
  bindingField: 'caseId' | 'relationId',
  bindingId: string,
): AssociationCursorState {
  try {
    const state = associationStateSchema.parse(decode(cursor, kind));
    if (state[bindingField] !== bindingId) throw new Error('association mismatch');
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
