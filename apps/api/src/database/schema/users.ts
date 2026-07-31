import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 50 }).notNull(),
    normalizedUsername: varchar('normalized_username', { length: 50 })
      .generatedAlwaysAs(sql`lower(btrim(username))`)
      .notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    mustChangePassword: boolean('must_change_password').default(true).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    failedLoginCount: integer('failed_login_count').default(0).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_normalized_username_uidx').on(table.normalizedUsername),
    check(
      'users_username_length_check',
      sql`char_length(btrim(${table.username})) between 3 and 50`,
    ),
    check('users_username_format_check', sql`${table.username} ~ '^[[:alnum:]_.-]+$'`),
    check('users_password_hash_check', sql`char_length(${table.passwordHash}) between 1 and 255`),
    check('users_failed_login_count_check', sql`${table.failedLoginCount} >= 0`),
  ],
);
