import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const dataCheckState = pgTable(
  'data_check_state',
  {
    singletonKey: boolean('singleton_key').primaryKey().default(true),
    status: varchar('status', { length: 20 }).notNull().default('never_run'),
    attemptStartedAt: timestamp('attempt_started_at', { withTimezone: true }),
    attemptFinishedAt: timestamp('attempt_finished_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastFailureMessage: varchar('last_failure_message', { length: 500 }),
    lastSnapshotId: uuid('last_snapshot_id'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    orphanEventCount: integer('orphan_event_count').notNull().default(0),
    orphanRelationCount: integer('orphan_relation_count').notNull().default(0),
    orphanCaseCount: integer('orphan_case_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    warningCount: integer('warning_count').notNull().default(0),
    openCount: integer('open_count').notNull().default(0),
    handledCount: integer('handled_count').notNull().default(0),
    semanticStatus: varchar('semantic_status', { length: 20 }),
    semanticReason: varchar('semantic_reason', { length: 30 }),
  },
  (table) => [
    check('data_check_state_singleton_check', sql`${table.singletonKey} = true`),
    check(
      'data_check_state_status_check',
      sql`${table.status} in ('never_run', 'running', 'succeeded', 'failed')`,
    ),
    check(
      'data_check_state_counts_check',
      sql`${table.orphanEventCount} >= 0
        and ${table.orphanRelationCount} >= 0
        and ${table.orphanCaseCount} >= 0
        and ${table.errorCount} >= 0
        and ${table.warningCount} >= 0
        and ${table.openCount} >= 0
        and ${table.handledCount} >= 0`,
    ),
    check(
      'data_check_state_semantic_snapshot_check',
      sql`(
          ${table.lastSnapshotId} is null
          and ${table.semanticStatus} is null
          and ${table.semanticReason} is null
        ) or (
          ${table.lastSnapshotId} is not null
          and ${table.semanticStatus} is not null
          and (
            (${table.semanticStatus} = 'completed' and ${table.semanticReason} is null)
            or (
              ${table.semanticStatus} = 'truncated'
              and ${table.semanticReason} = 'candidate_limit'
            )
            or (
              ${table.semanticStatus} = 'failed'
              and ${table.semanticReason} = 'internal_failure'
            )
            or (
              ${table.semanticStatus} = 'skipped'
              and ${table.semanticReason} in (
                'not_recorded',
                'no_active_model',
                'worker_unreachable',
                'index_not_ready',
                'no_embeddings'
              )
            )
          )
        )`,
    ),
  ],
);
