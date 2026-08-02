import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorType: varchar('actor_type', { length: 10 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorUsername: varchar('actor_username', { length: 50 }),
    actorLabel: varchar('actor_label', { length: 50 }),
    actorChannel: varchar('actor_channel', { length: 10 }).notNull(),
    requestId: varchar('request_id', { length: 100 }).notNull(),
    sessionId: uuid('session_id'),
    mcpTokenId: uuid('mcp_token_id'),
    action: varchar('action', { length: 50 }).notNull(),
    targetType: varchar('target_type', { length: 30 }).notNull(),
    targetId: varchar('target_id', { length: 100 }),
    result: varchar('result', { length: 10 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_occurred_id_idx').on(table.occurredAt.desc(), table.id.desc()),
    index('audit_logs_actor_user_occurred_idx').on(table.actorUserId, table.occurredAt.desc()),
    check(
      'audit_logs_actor_type_check',
      sql`${table.actorType} in ('user', 'system', 'anonymous')`,
    ),
    check('audit_logs_actor_channel_check', sql`${table.actorChannel} in ('web', 'mcp', 'cli')`),
    check(
      'audit_logs_actor_shape_check',
      sql`(
          ${table.actorType} = 'user'
          and ${table.actorUserId} is not null
          and ${table.actorUsername} is not null
          and ${table.actorLabel} is null
          and ${table.actorChannel} in ('web', 'mcp')
        ) or (
          ${table.actorType} = 'system'
          and ${table.actorUserId} is null
          and ${table.actorUsername} is null
          and ${table.actorLabel} = 'server-cli'
          and ${table.actorChannel} = 'cli'
        ) or (
          ${table.actorType} = 'anonymous'
          and ${table.actorUserId} is null
          and ${table.actorUsername} is not null
          and ${table.actorLabel} is null
          and ${table.actorChannel} = 'web'
        )`,
    ),
    check(
      'audit_logs_action_check',
      sql`${table.action} in (
        'auth.login_succeeded', 'auth.login_failed', 'auth.account_locked',
        'auth.password_changed', 'auth.session_logged_out', 'auth.sessions_revoked',
        'account.created', 'account.password_reset', 'account.enabled', 'account.disabled',
        'account.unlocked', 'mcp_token.created', 'mcp_token.revoked', 'mcp_token.deleted',
        'mcp_token.auth_failed',
        'event.created', 'event.updated', 'event.deleted', 'relation.created', 'relation.updated',
        'relation.deleted', 'case.created', 'case.updated', 'case.deleted',
        'data_check.executed', 'data_check.issue_processed', 'data_import.committed',
        'data_export.prepared', 'ai_import.committed', 'semantic.model_changed',
        'semantic.reindex_started', 'setting.updated', 'maintenance.enabled',
        'maintenance.disabled'
      )`,
    ),
    check(
      'audit_logs_target_type_check',
      sql`${table.targetType} in (
        'user', 'session', 'mcp_token', 'event', 'relation', 'case', 'data_check',
        'data_import', 'data_export', 'ai_import', 'semantic_model', 'setting',
        'maintenance', 'system'
      )`,
    ),
    check('audit_logs_result_check', sql`${table.result} in ('success', 'failure', 'conflict')`),
  ],
);
