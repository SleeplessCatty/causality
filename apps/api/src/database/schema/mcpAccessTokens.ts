import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { binaryDigest } from './webSessions.js';
import { users } from './users.js';

export const mcpAccessTokens = pgTable(
  'mcp_access_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenDigest: binaryDigest('token_digest').notNull(),
    deviceName: varchar('device_name', { length: 80 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastClientName: varchar('last_client_name', { length: 120 }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('mcp_access_tokens_digest_uidx').on(table.tokenDigest),
    index('mcp_access_tokens_user_active_idx').on(table.userId, table.revokedAt),
    check('mcp_access_tokens_digest_length_check', sql`octet_length(${table.tokenDigest}) = 32`),
    check(
      'mcp_access_tokens_device_name_length_check',
      sql`char_length(btrim(${table.deviceName})) between 1 and 80`,
    ),
  ],
);
