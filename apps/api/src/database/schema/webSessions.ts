import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const binaryDigest = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const webSessions = pgTable(
  'web_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: binaryDigest('token_hash').notNull(),
    csrfTokenHash: binaryDigest('csrf_token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('web_sessions_token_hash_uidx').on(table.tokenHash),
    index('web_sessions_user_active_idx').on(table.userId, table.revokedAt),
    check('web_sessions_token_hash_length_check', sql`octet_length(${table.tokenHash}) = 32`),
    check(
      'web_sessions_csrf_token_hash_length_check',
      sql`octet_length(${table.csrfTokenHash}) = 32`,
    ),
    check(
      'web_sessions_absolute_expiry_check',
      sql`${table.absoluteExpiresAt} > ${table.createdAt}`,
    ),
    check('web_sessions_last_seen_check', sql`${table.lastSeenAt} >= ${table.createdAt}`),
  ],
);
