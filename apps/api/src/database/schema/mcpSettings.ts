import { sql } from 'drizzle-orm';
import { boolean, char, check, integer, pgTable, timestamp } from 'drizzle-orm/pg-core';

export const mcpSettings = pgTable(
  'mcp_settings',
  {
    singletonKey: boolean('singleton_key').default(true).primaryKey(),
    accessToken: char('access_token', { length: 64 }).notNull(),
    tokenVersion: integer('token_version').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    check('mcp_settings_singleton_check', sql`${table.singletonKey} = true`),
    check('mcp_settings_access_token_check', sql`${table.accessToken} ~ '^[0-9a-f]{64}$'`),
    check('mcp_settings_token_version_check', sql`${table.tokenVersion} > 0`),
  ],
);
