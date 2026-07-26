import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { semanticModelSettings } from './semanticModelSettings.js';

export const semanticIndexState = pgTable(
  'semantic_index_state',
  {
    singletonKey: boolean('singleton_key').primaryKey().default(true),
    activeModelCode: varchar('active_model_code', { length: 64 }).references(
      () => semanticModelSettings.modelCode,
      { onDelete: 'restrict' },
    ),
    status: varchar('status', { length: 20 }).notNull().default('empty'),
    stateVersion: integer('state_version').notNull().default(0),
    processedItems: integer('processed_items').notNull().default(0),
    totalItems: integer('total_items').notNull().default(0),
    pendingItems: integer('pending_items').notNull().default(0),
    failedItems: integer('failed_items').notNull().default(0),
    failureStage: varchar('failure_stage', { length: 20 }),
    failureKind: varchar('failure_kind', { length: 20 }),
    failureCode: varchar('failure_code', { length: 100 }),
    error: text('error'),
    lastReadyAt: timestamp('last_ready_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('semantic_index_state_singleton_check', sql`${table.singletonKey} = true`),
    check(
      'semantic_index_state_status_check',
      sql`${table.status} in (
        'empty',
        'waiting_model',
        'loading',
        'index_queued',
        'building',
        'ready',
        'updating',
        'incomplete',
        'failed'
      )`,
    ),
    check(
      'semantic_index_state_progress_check',
      sql`${table.stateVersion} >= 0
        and ${table.processedItems} >= 0
        and ${table.totalItems} >= 0
        and ${table.pendingItems} >= 0
        and ${table.failedItems} >= 0
        and ${table.processedItems} <= ${table.totalItems}`,
    ),
    check(
      'semantic_index_state_active_model_check',
      sql`(${table.activeModelCode} is null and ${table.status} = 'empty')
        or ${table.activeModelCode} is not null`,
    ),
    check(
      'semantic_index_state_failure_stage_check',
      sql`${table.failureStage} is null or ${table.failureStage} in (
        'download',
        'verify',
        'load',
        'full_index',
        'incremental'
      )`,
    ),
    check(
      'semantic_index_state_failure_kind_check',
      sql`${table.failureKind} is null or ${table.failureKind} in ('retryable', 'manual')`,
    ),
    check(
      'semantic_index_state_failure_metadata_check',
      sql`(${table.failureStage} is null
          and ${table.failureKind} is null
          and ${table.failureCode} is null)
        or (${table.failureStage} is not null
          and ${table.failureKind} is not null
          and ${table.failureCode} is not null)`,
    ),
  ],
);
