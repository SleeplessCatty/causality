import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { abstractEvents } from './abstractEvents.js';

export const causalRelations = pgTable(
  'causal_relations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    causeEventId: uuid('cause_event_id')
      .notNull()
      .references(() => abstractEvents.id, { onDelete: 'restrict' }),
    effectEventId: uuid('effect_event_id')
      .notNull()
      .references(() => abstractEvents.id, { onDelete: 'restrict' }),
    confidence: smallint('confidence').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('causal_relations_direction_uidx').on(table.causeEventId, table.effectEventId),
    index('causal_relations_cause_event_id_idx').on(table.causeEventId),
    index('causal_relations_effect_event_id_idx').on(table.effectEventId),
    check(
      'causal_relations_no_self_loop_check',
      sql`${table.causeEventId} <> ${table.effectEventId}`,
    ),
    check('causal_relations_confidence_check', sql`${table.confidence} between 0 and 100`),
    check(
      'causal_relations_description_check',
      sql`${table.description} is null or char_length(btrim(${table.description})) > 0`,
    ),
  ],
);
