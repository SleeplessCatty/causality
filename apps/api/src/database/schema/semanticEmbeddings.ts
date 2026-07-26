import { sql } from 'drizzle-orm';
import { toSql } from 'pgvector';
import {
  check,
  customType,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { semanticModelSettings } from './semanticModelSettings.js';

export const semanticVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector';
  },
  toDriver(value) {
    return toSql(value) ?? '[]';
  },
});

export const semanticEmbeddings = pgTable(
  'semantic_embeddings',
  {
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    modelCode: varchar('model_code', { length: 64 })
      .notNull()
      .references(() => semanticModelSettings.modelCode, { onDelete: 'cascade' }),
    sourceHash: varchar('source_hash', { length: 64 }).notNull(),
    embedding: semanticVector('embedding').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'semantic_embeddings_entity_pk',
      columns: [table.entityType, table.entityId],
    }),
    check(
      'semantic_embeddings_entity_type_check',
      sql`${table.entityType} in ('event', 'relation', 'case')`,
    ),
    check(
      'semantic_embeddings_model_code_check',
      sql`${table.modelCode} in (
        'bge-small-zh-v1.5',
        'multilingual-e5-small',
        'granite-embedding-97m-multilingual-r2',
        'bge-m3'
      )`,
    ),
    check('semantic_embeddings_source_hash_check', sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'semantic_embeddings_dimension_check',
      sql`(${table.modelCode} = 'bge-small-zh-v1.5' and vector_dims(${table.embedding}) = 512)
        or (${table.modelCode} in ('multilingual-e5-small', 'granite-embedding-97m-multilingual-r2')
          and vector_dims(${table.embedding}) = 384)
        or (${table.modelCode} = 'bge-m3' and vector_dims(${table.embedding}) = 1024)`,
    ),
  ],
);
