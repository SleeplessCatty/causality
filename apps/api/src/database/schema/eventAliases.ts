import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { abstractEvents } from './abstractEvents.js';

export const eventAliases = pgTable(
  'event_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => abstractEvents.id, { onDelete: 'cascade' }),
    alias: varchar('alias', { length: 80 }).notNull(),
    normalizedAlias: varchar('normalized_alias', { length: 80 })
      .generatedAlwaysAs(sql`lower(btrim(alias))`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('event_aliases_event_normalized_uidx').on(table.eventId, table.normalizedAlias),
    index('event_aliases_event_id_idx').on(table.eventId),
    index('event_aliases_normalized_alias_idx').on(table.normalizedAlias),
    index('event_aliases_normalized_alias_trgm_idx').using(
      'gin',
      table.normalizedAlias.op('gin_trgm_ops'),
    ),
    check(
      'event_aliases_alias_length_check',
      sql`char_length(btrim(${table.alias})) between 1 and 80`,
    ),
  ],
);
