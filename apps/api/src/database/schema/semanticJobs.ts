import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { semanticModelSettings } from './semanticModelSettings.js';

export const semanticJobs = pgTable(
  'semantic_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobType: varchar('job_type', { length: 20 }).notNull(),
    modelCode: varchar('model_code', { length: 64 })
      .notNull()
      .references(() => semanticModelSettings.modelCode, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 20 }),
    entityId: uuid('entity_id'),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    stateVersion: integer('state_version').notNull(),
    processedItems: integer('processed_items').notNull().default(0),
    totalItems: integer('total_items').notNull().default(0),
    downloadedBytes: integer('downloaded_bytes').notNull().default(0),
    totalBytes: integer('total_bytes').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    leaseOwner: varchar('lease_owner', { length: 100 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('semantic_jobs_incremental_queued_uidx')
      .on(table.entityType, table.entityId)
      .where(sql`${table.jobType} = 'incremental' and ${table.status} = 'queued'`),
    index('semantic_jobs_queue_claim_idx')
      .on(table.status, table.createdAt, table.id)
      .where(sql`${table.status} in ('queued', 'running')`),
    index('semantic_jobs_model_status_idx').on(table.modelCode, table.status, table.createdAt),
    check(
      'semantic_jobs_job_type_check',
      sql`${table.jobType} in ('download', 'full_index', 'incremental')`,
    ),
    check(
      'semantic_jobs_entity_type_check',
      sql`${table.entityType} is null or ${table.entityType} in ('event', 'relation', 'case')`,
    ),
    check(
      'semantic_jobs_status_check',
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed')`,
    ),
    check(
      'semantic_jobs_entity_target_check',
      sql`(${table.jobType} = 'incremental'
          and ${table.entityType} is not null
          and ${table.entityId} is not null)
        or (${table.jobType} in ('download', 'full_index')
          and ${table.entityType} is null
          and ${table.entityId} is null)`,
    ),
    check(
      'semantic_jobs_progress_check',
      sql`${table.stateVersion} >= 0
        and ${table.processedItems} >= 0
        and ${table.totalItems} >= 0
        and ${table.processedItems} <= ${table.totalItems}
        and ${table.downloadedBytes} >= 0
        and ${table.totalBytes} >= 0
        and ${table.downloadedBytes} <= ${table.totalBytes}
        and ${table.attempts} >= 0`,
    ),
    check(
      'semantic_jobs_lease_check',
      sql`(${table.status} = 'running'
          and ${table.leaseOwner} is not null
          and ${table.leaseExpiresAt} is not null)
        or (${table.status} <> 'running')`,
    ),
    check(
      'semantic_jobs_terminal_timestamp_check',
      sql`(${table.status} = 'queued'
          and ${table.startedAt} is null
          and ${table.completedAt} is null)
        or (${table.status} = 'running'
          and ${table.startedAt} is not null
          and ${table.completedAt} is null)
        or (${table.status} in ('succeeded', 'failed')
          and ${table.startedAt} is not null
          and ${table.completedAt} is not null)`,
    ),
  ],
);
