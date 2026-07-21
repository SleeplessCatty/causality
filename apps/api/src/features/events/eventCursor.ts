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
    query: z.string().min(1).max(120),
    rank: z.number().int().min(1).max(6),
    normalizedName: z.string().min(1).max(120),
    id: z.uuid(),
  })
  .strict();

const eventCursorStateSchema = z.discriminatedUnion('kind', [
  listCursorStateSchema,
  searchCursorStateSchema,
]);

const eventCursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    state: eventCursorStateSchema,
    checksum: z.string().min(1),
  })
  .strict();

export type EventCursorState = z.infer<typeof eventCursorStateSchema>;

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

export function decodeEventCursor(cursor: string, query: string): EventCursorState {
  try {
    const envelope = eventCursorEnvelopeSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    const expected = Buffer.from(checksum(envelope.state));
    const actual = Buffer.from(envelope.checksum);

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('checksum mismatch');
    }
    if (envelope.state.query !== normalizeQuery(query)) {
      throw new Error('query mismatch');
    }
    if (query.trim() === '' && envelope.state.kind !== 'list') {
      throw new Error('cursor kind mismatch');
    }
    if (query.trim() !== '' && envelope.state.kind !== 'search') {
      throw new Error('cursor kind mismatch');
    }

    return envelope.state;
  } catch {
    throw new InvalidEventCursorError();
  }
}
