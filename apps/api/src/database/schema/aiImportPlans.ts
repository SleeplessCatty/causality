import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const aiImportPlans = pgTable(
  'ai_import_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    version: integer('version').notNull(),
    replacesPlanId: uuid('replaces_plan_id').references((): AnyPgColumn => aiImportPlans.id),
    status: varchar('status', { length: 20 }).notNull(),
    topic: varchar('topic', { length: 200 }).notNull(),
    clientName: varchar('client_name', { length: 100 }).notNull(),
    candidatePayload: jsonb('candidate_payload').$type<Record<string, unknown>>().notNull(),
    planPayload: jsonb('plan_payload').$type<Record<string, unknown>>().notNull(),
    resultPayload: jsonb('result_payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('ai_import_plans_replaces_plan_id_uidx').on(table.replacesPlanId),
    index('ai_import_plans_status_expires_idx').on(table.status, table.expiresAt),
    check('ai_import_plans_version_check', sql`${table.version} > 0`),
    check(
      'ai_import_plans_status_check',
      sql`${table.status} in (
        'pending',
        'replaced',
        'invalidated',
        'expired',
        'submitting',
        'committed',
        'data_failed',
        'system_failed'
      )`,
    ),
    check('ai_import_plans_topic_check', sql`char_length(btrim(${table.topic})) between 1 and 200`),
    check(
      'ai_import_plans_client_name_check',
      sql`char_length(btrim(${table.clientName})) between 1 and 100`,
    ),
    check(
      'ai_import_plans_candidate_payload_check',
      sql`jsonb_typeof(${table.candidatePayload}) = 'object'`,
    ),
    check('ai_import_plans_plan_payload_check', sql`jsonb_typeof(${table.planPayload}) = 'object'`),
    check(
      'ai_import_plans_result_payload_check',
      sql`${table.resultPayload} is null or jsonb_typeof(${table.resultPayload}) = 'object'`,
    ),
    check('ai_import_plans_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
