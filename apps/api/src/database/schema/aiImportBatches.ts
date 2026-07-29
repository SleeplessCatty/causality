import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { aiImportPlans } from './aiImportPlans.js';

export const aiImportBatches = pgTable(
  'ai_import_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => aiImportPlans.id),
    topic: varchar('topic', { length: 200 }).notNull(),
    planVersion: integer('plan_version').notNull(),
    clientName: varchar('client_name', { length: 100 }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    eventCreated: integer('event_created').notNull(),
    eventReused: integer('event_reused').notNull(),
    eventUpdated: integer('event_updated').notNull(),
    caseCreated: integer('case_created').notNull(),
    caseReused: integer('case_reused').notNull(),
    relationCreated: integer('relation_created').notNull(),
    relationReused: integer('relation_reused').notNull(),
    relationCaseCreated: integer('relation_case_created').notNull(),
    relationCaseReused: integer('relation_case_reused').notNull(),
    confidenceChanged: integer('confidence_changed').notNull(),
  },
  (table) => [
    uniqueIndex('ai_import_batches_plan_id_uidx').on(table.planId),
    index('ai_import_batches_completed_id_idx').on(table.completedAt.desc(), table.id.desc()),
    check('ai_import_batches_plan_version_check', sql`${table.planVersion} > 0`),
    check(
      'ai_import_batches_topic_check',
      sql`char_length(btrim(${table.topic})) between 1 and 200`,
    ),
    check(
      'ai_import_batches_client_name_check',
      sql`char_length(btrim(${table.clientName})) between 1 and 100`,
    ),
    check(
      'ai_import_batches_counts_check',
      sql`${table.eventCreated} >= 0
        and ${table.eventReused} >= 0
        and ${table.eventUpdated} >= 0
        and ${table.caseCreated} >= 0
        and ${table.caseReused} >= 0
        and ${table.relationCreated} >= 0
        and ${table.relationReused} >= 0
        and ${table.relationCaseCreated} >= 0
        and ${table.relationCaseReused} >= 0
        and ${table.confidenceChanged} >= 0`,
    ),
  ],
);
