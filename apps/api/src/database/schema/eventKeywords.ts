import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { abstractEvents } from './abstractEvents.js';

export const eventKeywords = pgTable(
  'event_keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => abstractEvents.id, { onDelete: 'cascade' }),
    keyword: varchar('keyword', { length: 50 }).notNull(),
    normalizedKeyword: varchar('normalized_keyword', { length: 50 })
      .generatedAlwaysAs(sql`lower(btrim(keyword))`)
      .notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('event_keywords_event_normalized_uidx').on(table.eventId, table.normalizedKeyword),
    uniqueIndex('event_keywords_event_position_uidx').on(table.eventId, table.position),
    index('event_keywords_normalized_trgm_idx').using(
      'gin',
      table.normalizedKeyword.op('gin_trgm_ops'),
    ),
    index('event_keywords_event_id_idx').on(table.eventId),
    check(
      'event_keywords_length_check',
      sql`char_length(btrim(${table.keyword})) between 1 and 50`,
    ),
    check('event_keywords_position_check', sql`${table.position} between 1 and 20`),
  ],
);
