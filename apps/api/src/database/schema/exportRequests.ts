import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const exportRequests = pgTable(
  'export_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    exportType: varchar('export_type', { length: 10 }).notNull(),
    startEventIds: uuid('start_event_ids').array().notNull().default([]),
    direction: varchar('direction', { length: 10 }),
    depth: smallint('depth'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('export_requests_token_hash_uidx').on(table.tokenHash),
    index('export_requests_expires_at_idx').on(table.expiresAt),
    check('export_requests_token_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('export_requests_type_check', sql`${table.exportType} in ('full', 'filtered')`),
    check(
      'export_requests_direction_check',
      sql`${table.direction} is null or ${table.direction} in ('upstream', 'downstream', 'both')`,
    ),
    check(
      'export_requests_scope_check',
      sql`(
          ${table.exportType} = 'full'
          and cardinality(${table.startEventIds}) = 0
          and ${table.direction} is null
          and ${table.depth} is null
        ) or (
          ${table.exportType} = 'filtered'
          and cardinality(${table.startEventIds}) between 1 and 100
          and ${table.direction} is not null
          and ${table.depth} between 1 and 10
        )`,
    ),
    check('export_requests_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
