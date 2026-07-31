import { sql } from 'drizzle-orm';
import { check, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { binaryDigest } from './webSessions.js';

export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceDigest: binaryDigest('source_digest').notNull(),
    failureCount: integer('failure_count').default(0).notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('auth_rate_limits_source_digest_uidx').on(table.sourceDigest),
    check(
      'auth_rate_limits_source_digest_length_check',
      sql`octet_length(${table.sourceDigest}) = 32`,
    ),
    check('auth_rate_limits_failure_count_check', sql`${table.failureCount} >= 0`),
  ],
);
