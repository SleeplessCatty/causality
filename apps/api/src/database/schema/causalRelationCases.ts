import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { causalRelations } from './causalRelations.js';
import { concreteCases } from './concreteCases.js';

export const causalRelationCases = pgTable(
  'causal_relation_cases',
  {
    causalRelationId: uuid('causal_relation_id')
      .notNull()
      .references(() => causalRelations.id, { onDelete: 'restrict' }),
    concreteCaseId: uuid('concrete_case_id')
      .notNull()
      .references(() => concreteCases.id, { onDelete: 'restrict' }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.causalRelationId, table.concreteCaseId] }),
    index('causal_relation_cases_relation_linked_idx').on(
      table.causalRelationId,
      table.linkedAt.desc(),
      table.concreteCaseId,
    ),
    index('causal_relation_cases_case_linked_idx').on(
      table.concreteCaseId,
      table.linkedAt.desc(),
      table.causalRelationId,
    ),
  ],
);
