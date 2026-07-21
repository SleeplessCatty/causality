import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const abstractEvents = pgTable(
  'abstract_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 120 })
      .generatedAlwaysAs(sql`lower(btrim(name))`)
      .notNull(),
    description: text('description'),
    keywords: text('keywords')
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('abstract_events_normalized_name_uidx').on(table.normalizedName),
    index('abstract_events_normalized_name_trgm_idx').using(
      'gin',
      table.normalizedName.op('gin_trgm_ops'),
    ),
    index('abstract_events_updated_at_id_idx').on(table.updatedAt.desc(), table.id.desc()),
    check(
      'abstract_events_name_length_check',
      sql`char_length(btrim(${table.name})) between 1 and 120`,
    ),
    check(
      'abstract_events_description_check',
      sql`${table.description} is null or char_length(btrim(${table.description})) > 0`,
    ),
  ],
);
