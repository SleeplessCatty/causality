import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { importBatches } from './importBatches.js';

export const importRecords = pgTable(
  'import_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    sourceSequence: integer('source_sequence').notNull(),
    itemSequence: integer('item_sequence').notNull(),
    recordType: varchar('record_type', { length: 20 }).notNull(),
    outcome: varchar('outcome', { length: 10 }).notNull(),
    primaryRecordId: uuid('primary_record_id').notNull(),
    relatedRecordId: uuid('related_record_id'),
    textSnapshot: jsonb('text_snapshot').notNull(),
  },
  (table) => [
    uniqueIndex('import_records_batch_source_item_sequence_uidx').on(
      table.batchId,
      table.sourceSequence,
      table.itemSequence,
    ),
    index('import_records_batch_type_sequence_idx').on(
      table.batchId,
      table.recordType,
      table.sourceSequence,
      table.itemSequence,
    ),
    check(
      'import_records_sequence_check',
      sql`${table.sourceSequence} > 0 and ${table.itemSequence} > 0`,
    ),
    check(
      'import_records_record_type_check',
      sql`${table.recordType} in ('event', 'case', 'relation', 'relation_case')`,
    ),
    check('import_records_outcome_check', sql`${table.outcome} in ('created', 'reused')`),
    check(
      'import_records_related_record_check',
      sql`(${table.recordType} = 'relation_case' and ${table.relatedRecordId} is not null)
        or (${table.recordType} <> 'relation_case' and ${table.relatedRecordId} is null)`,
    ),
    check(
      'import_records_text_snapshot_check',
      sql`jsonb_typeof(${table.textSnapshot}) = 'object'`,
    ),
  ],
);
