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

import { aiImportBatches } from './aiImportBatches.js';

export const aiImportRecords = pgTable(
  'ai_import_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => aiImportBatches.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    recordType: varchar('record_type', { length: 20 }).notNull(),
    action: varchar('action', { length: 10 }).notNull(),
    primaryRecordId: uuid('primary_record_id').notNull(),
    relatedRecordId: uuid('related_record_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex('ai_import_records_batch_sequence_uidx').on(table.batchId, table.sequence),
    index('ai_import_records_batch_type_sequence_idx').on(
      table.batchId,
      table.recordType,
      table.sequence,
    ),
    check('ai_import_records_sequence_check', sql`${table.sequence} > 0`),
    check(
      'ai_import_records_record_type_check',
      sql`${table.recordType} in ('event', 'case', 'relation', 'relation_case', 'confidence')`,
    ),
    check(
      'ai_import_records_action_check',
      sql`${table.action} in ('created', 'reused', 'updated', 'changed')`,
    ),
    check('ai_import_records_detail_check', sql`jsonb_typeof(${table.detail}) = 'object'`),
  ],
);
