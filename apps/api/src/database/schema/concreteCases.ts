import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const concreteCases = pgTable(
  'concrete_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    content: varchar('content', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('concrete_cases_content_uidx').on(table.content),
    index('concrete_cases_content_trgm_idx').using(
      'gin',
      sql`lower(${table.content}) gin_trgm_ops`,
    ),
    index('concrete_cases_updated_at_id_idx').on(table.updatedAt.desc(), table.id.desc()),
    check(
      'concrete_cases_content_check',
      sql`${table.content} = btrim(${table.content}) and char_length(${table.content}) between 1 and 50`,
    ),
  ],
);
