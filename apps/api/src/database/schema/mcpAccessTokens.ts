import { sql } from 'drizzle-orm';
import { check, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

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
    name: varchar('name', { length: 80 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastClientName: varchar('last_client_name', { length: 120 }),
    maskedToken: varchar('masked_token', { length: 25 }).notNull(),
    tokenCiphertext: binaryDigest('token_ciphertext').notNull(),
    tokenIv: binaryDigest('token_iv').notNull(),
    tokenAuthTag: binaryDigest('token_auth_tag').notNull(),
  },
  (table) => [
    uniqueIndex('mcp_access_tokens_digest_uidx').on(table.tokenDigest),
    uniqueIndex('mcp_access_tokens_user_name_uidx').on(
      table.userId,
      sql`lower(btrim(${table.name}))`,
    ),
    check('mcp_access_tokens_digest_length_check', sql`octet_length(${table.tokenDigest}) = 32`),
    check(
      'mcp_access_tokens_name_length_check',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) between 1 and 80`,
    ),
    check(
      'mcp_access_tokens_mask_check',
      sql`${table.maskedToken} ~ '^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$'`,
    ),
    check('mcp_access_tokens_iv_length_check', sql`octet_length(${table.tokenIv}) = 12`),
    check('mcp_access_tokens_auth_tag_length_check', sql`octet_length(${table.tokenAuthTag}) = 16`),
    check(
      'mcp_access_tokens_ciphertext_length_check',
      sql`octet_length(${table.tokenCiphertext}) > 0`,
    ),
  ],
);
