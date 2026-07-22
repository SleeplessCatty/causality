import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const listCursorStateSchema = z
  .object({
    kind: z.literal('list'),
    query: z.literal(''),
    updatedAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();

const searchCursorStateSchema = z
  .object({
    kind: z.literal('search'),
    query: z.string().min(1).max(80),
    rank: z.number().int().min(1).max(6),
    normalizedName: z.string().min(1).max(50),
    id: z.uuid(),
  })
  .strict();

const candidateCursorStateSchema = z
  .object({
    kind: z.literal('candidate'),
    query: z.string().min(1).max(80),
    excludeId: z.uuid().nullable(),
    rank: z.number().int().min(1).max(6),
    normalizedName: z.string().min(1).max(50),
    id: z.uuid(),
  })
  .strict();

const eventCursorStateSchema = z.discriminatedUnion('kind', [
  listCursorStateSchema,
  searchCursorStateSchema,
  candidateCursorStateSchema,
]);

const eventCursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    state: eventCursorStateSchema,
    checksum: z.string().min(1),
  })
  .strict();

export type EventCursorState = z.infer<typeof eventCursorStateSchema>;
export type EventCandidateCursorState = z.infer<typeof candidateCursorStateSchema>;

export class InvalidEventCursorError extends Error {
  constructor() {
    super('Invalid event cursor');
    this.name = 'InvalidEventCursorError';
  }
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function checksum(state: EventCursorState): string {
  return createHash('sha256')
    .update(`causality:event-cursor:v1:${JSON.stringify(state)}`)
    .digest('base64url');
}

export function encodeEventCursor(input: EventCursorState): string {
  const state = eventCursorStateSchema.parse({
    ...input,
    query: normalizeQuery(input.query),
  });
  return Buffer.from(
    JSON.stringify({ version: 1, state, checksum: checksum(state) }),
    'utf8',
  ).toString('base64url');
}

function decodeVerifiedEventEnvelope(cursor: string): EventCursorState {
  try {
    const envelope = eventCursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    const expected = Buffer.from(checksum(envelope.state));
    const actual = Buffer.from(envelope.checksum);

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('checksum mismatch');
    }
    return envelope.state;
  } catch {
    throw new InvalidEventCursorError();
  }
}

export function decodeEventCursor(cursor: string, query: string): EventCursorState {
  const state = decodeVerifiedEventEnvelope(cursor);
  const normalized = normalizeQuery(query);
  if (
    state.query !== normalized ||
    (normalized === '' && state.kind !== 'list') ||
    (normalized !== '' && state.kind !== 'search')
  ) {
    throw new InvalidEventCursorError();
  }
  return state;
}

export function encodeEventCandidateCursor(input: Omit<EventCandidateCursorState, 'kind'>): string {
  return encodeEventCursor({ kind: 'candidate', ...input });
}

export function decodeEventCandidateCursor(
  cursor: string,
  query: string,
  excludeId?: string,
): EventCandidateCursorState {
  const state = decodeVerifiedEventEnvelope(cursor);
  if (
    state.kind !== 'candidate' ||
    state.query !== normalizeQuery(query) ||
    state.excludeId !== (excludeId ?? null)
  ) {
    throw new InvalidEventCursorError();
  }
  return state;
}
