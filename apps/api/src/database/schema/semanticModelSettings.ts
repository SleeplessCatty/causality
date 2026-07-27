import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const semanticModelSettings = pgTable(
  'semantic_model_settings',
  {
    modelCode: varchar('model_code', { length: 64 }).primaryKey(),
    revision: varchar('revision', { length: 64 }).notNull(),
    threshold: smallint('threshold').notNull(),
    dedupeThreshold: smallint('dedupe_threshold').notNull().default(100),
    fileStatus: varchar('file_status', { length: 20 }).notNull().default('not_downloaded'),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
    failureKind: varchar('failure_kind', { length: 20 }),
    failureCode: varchar('failure_code', { length: 100 }),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'semantic_model_settings_model_code_check',
      sql`${table.modelCode} in (
        'bge-small-zh-v1.5',
        'multilingual-e5-small',
        'granite-embedding-97m-multilingual-r2',
        'bge-m3'
      )`,
    ),
    check('semantic_model_settings_threshold_check', sql`${table.threshold} between 0 and 100`),
    check(
      'semantic_model_settings_dedupe_threshold_check',
      sql`${table.dedupeThreshold} between 0 and 100`,
    ),
    check(
      'semantic_model_settings_file_status_check',
      sql`${table.fileStatus} in (
        'not_downloaded',
        'download_queued',
        'downloading',
        'verifying',
        'downloaded',
        'invalid',
        'failed'
      )`,
    ),
    check(
      'semantic_model_settings_downloaded_at_check',
      sql`(${table.fileStatus} = 'downloaded' and ${table.downloadedAt} is not null)
        or (${table.fileStatus} <> 'downloaded' and ${table.downloadedAt} is null)`,
    ),
    check(
      'semantic_model_settings_failure_kind_check',
      sql`${table.failureKind} is null or ${table.failureKind} in ('retryable', 'manual')`,
    ),
    check(
      'semantic_model_settings_failure_metadata_check',
      sql`(${table.failureKind} is null and ${table.failureCode} is null)
        or (${table.failureKind} is not null and ${table.failureCode} is not null)`,
    ),
  ],
);
