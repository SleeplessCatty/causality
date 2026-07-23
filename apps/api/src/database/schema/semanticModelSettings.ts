import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const semanticModelSettings = pgTable(
  'semantic_model_settings',
  {
    modelCode: varchar('model_code', { length: 64 }).primaryKey(),
    revision: varchar('revision', { length: 64 }).notNull(),
    threshold: smallint('threshold').notNull(),
    downloadStatus: varchar('download_status', { length: 20 }).notNull().default('not_downloaded'),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
    error: text('error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'semantic_model_settings_model_code_check',
      sql`${table.modelCode} in ('multilingual-e5-small', 'bge-m3')`,
    ),
    check('semantic_model_settings_threshold_check', sql`${table.threshold} between 0 and 100`),
    check(
      'semantic_model_settings_download_status_check',
      sql`${table.downloadStatus} in (
        'not_downloaded',
        'downloading',
        'verifying',
        'downloaded',
        'failed'
      )`,
    ),
    check(
      'semantic_model_settings_downloaded_at_check',
      sql`(${table.downloadStatus} = 'downloaded' and ${table.downloadedAt} is not null)
        or (${table.downloadStatus} <> 'downloaded' and ${table.downloadedAt} is null)`,
    ),
  ],
);
