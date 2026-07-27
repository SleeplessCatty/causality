import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    filename: varchar('filename', { length: 255 }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    recordTypes: varchar('record_types', { length: 20 }).array().notNull(),
    eventCreated: integer('event_created').notNull(),
    eventReused: integer('event_reused').notNull(),
    caseCreated: integer('case_created').notNull(),
    caseReused: integer('case_reused').notNull(),
    relationCreated: integer('relation_created').notNull(),
    relationReused: integer('relation_reused').notNull(),
    relationCaseCreated: integer('relation_case_created').notNull(),
    relationCaseReused: integer('relation_case_reused').notNull(),
  },
  (table) => [
    index('import_batches_completed_id_idx').on(table.completedAt.desc(), table.id.desc()),
    check(
      'import_batches_filename_check',
      sql`char_length(btrim(${table.filename})) between 1 and 255
        and ${table.filename} !~ '[[:cntrl:]]'`,
    ),
    check(
      'import_batches_record_types_check',
      sql`cardinality(${table.recordTypes}) between 1 and 4
        and ${table.recordTypes} <@ array['event', 'case', 'relation', 'relation_case']::varchar[]`,
    ),
    check(
      'import_batches_counts_check',
      sql`${table.eventCreated} >= 0
        and ${table.eventReused} >= 0
        and ${table.caseCreated} >= 0
        and ${table.caseReused} >= 0
        and ${table.relationCreated} >= 0
        and ${table.relationReused} >= 0
        and ${table.relationCaseCreated} >= 0
        and ${table.relationCaseReused} >= 0`,
    ),
  ],
);
