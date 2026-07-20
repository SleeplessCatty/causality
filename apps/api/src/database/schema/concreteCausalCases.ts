import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { causalRelations } from './causalRelations.js';

export const concreteCausalCases = pgTable(
  'concrete_causal_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    causalRelationId: uuid('causal_relation_id')
      .notNull()
      .references(() => causalRelations.id, { onDelete: 'restrict' }),
    causeEvent: text('cause_event').notNull(),
    effectEvent: text('effect_event').notNull(),
    causeOccurredAt: timestamp('cause_occurred_at', {
      withTimezone: true,
    }).notNull(),
    effectOccurredAt: timestamp('effect_occurred_at', {
      withTimezone: true,
    }).notNull(),
    description: text('description').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('concrete_cases_relation_effect_time_idx').on(
      table.causalRelationId,
      table.effectOccurredAt.desc(),
    ),
    check(
      'concrete_cases_time_order_check',
      sql`${table.effectOccurredAt} >= ${table.causeOccurredAt}`,
    ),
    check('concrete_cases_cause_event_check', sql`char_length(btrim(${table.causeEvent})) > 0`),
    check('concrete_cases_effect_event_check', sql`char_length(btrim(${table.effectEvent})) > 0`),
    check('concrete_cases_description_check', sql`char_length(btrim(${table.description})) > 0`),
    check('concrete_cases_source_check', sql`char_length(btrim(${table.source})) > 0`),
  ],
);
