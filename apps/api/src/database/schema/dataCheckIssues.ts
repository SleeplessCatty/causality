import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const dataCheckIssues = pgTable(
  'data_check_issues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotId: uuid('snapshot_id').notNull(),
    severity: varchar('severity', { length: 10 }).notNull(),
    issueType: varchar('issue_type', { length: 80 }).notNull(),
    description: varchar('description', { length: 300 }).notNull(),
    suggestion: varchar('suggestion', { length: 300 }).notNull(),
    actionMode: varchar('action_mode', { length: 10 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('open'),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: varchar('target_id', { length: 100 }).notNull(),
    relatedId: varchar('related_id', { length: 100 }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
  },
  (table) => [
    index('data_check_issues_snapshot_filter_idx').on(
      table.snapshotId,
      table.severity,
      table.issueType,
      table.status,
      table.id,
    ),
    index('data_check_issues_snapshot_status_idx').on(table.snapshotId, table.status, table.id),
    check('data_check_issues_severity_check', sql`${table.severity} in ('error', 'warning')`),
    check('data_check_issues_action_mode_check', sql`${table.actionMode} in ('auto', 'manual')`),
    check('data_check_issues_status_check', sql`${table.status} in ('open', 'handled')`),
    check(
      'data_check_issues_target_type_check',
      sql`${table.targetType} in ('event', 'relation', 'case', 'alias', 'keyword', 'relation_case')`,
    ),
    check(
      'data_check_issues_issue_type_check',
      sql`char_length(btrim(${table.issueType})) between 1 and 80`,
    ),
    check(
      'data_check_issues_description_check',
      sql`char_length(btrim(${table.description})) between 1 and 300`,
    ),
    check(
      'data_check_issues_suggestion_check',
      sql`char_length(btrim(${table.suggestion})) between 1 and 300`,
    ),
    check(
      'data_check_issues_target_id_check',
      sql`char_length(btrim(${table.targetId})) between 1 and 100`,
    ),
    check(
      'data_check_issues_related_id_check',
      sql`${table.relatedId} is null
        or char_length(btrim(${table.relatedId})) between 1 and 100`,
    ),
    check(
      'data_check_issues_handled_at_check',
      sql`(${table.status} = 'open' and ${table.handledAt} is null)
        or (${table.status} = 'handled' and ${table.handledAt} is not null)`,
    ),
  ],
);
