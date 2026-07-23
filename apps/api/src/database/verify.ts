import 'dotenv/config';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient } from 'pg';

import { parseEnv } from '../config/env.js';

interface DatabaseCounts {
  abstractEvents: number;
  eventAliases: number;
  causalRelations: number;
  concreteCases: number;
  causalRelationCaseLinks: number;
}

interface IntegrityCounts {
  selfLoops: number;
  invalidConfidence: number;
  duplicateCaseLinks: number;
  invalidForeignKeys: number;
  orphanedKeywords: number;
  duplicateNormalizedKeywords: number;
  invalidKeywordLengths: number;
}

interface SemanticIntegrity {
  extensionInstalled: boolean;
  requiredTablesPresent: boolean;
  invalidModelCodes: number;
  invalidVectorDimensions: number;
  inactiveModelVectors: number;
}

export interface DatabaseVerificationReport {
  migrationApplied: boolean;
  counts: DatabaseCounts;
  integrity: IntegrityCounts;
  semantic: SemanticIntegrity;
  valid: boolean;
}

export async function verifyDatabase(pool: Pool | PoolClient): Promise<DatabaseVerificationReport> {
  const migration = await pool.query<{ applied: boolean }>(
    `select exists (
       select 1
       from drizzle.__drizzle_migrations
     ) as applied`,
  );
  const counts = await pool.query<{
    abstract_events: number;
    causal_relations: number;
    concrete_cases: number;
    causal_relation_case_links: number;
    event_aliases: number;
  }>(
    `select
       (select count(*)::int from abstract_events) as abstract_events,
       (select count(*)::int from event_aliases) as event_aliases,
       (select count(*)::int from causal_relations) as causal_relations,
       (select count(*)::int from concrete_cases) as concrete_cases,
       (select count(*)::int from causal_relation_cases) as causal_relation_case_links`,
  );
  const integrity = await pool.query<{
    duplicate_case_links: number;
    duplicate_normalized_keywords: number;
    invalid_confidence: number;
    invalid_foreign_keys: number;
    invalid_keyword_lengths: number;
    orphaned_keywords: number;
    self_loops: number;
  }>(
    `select
       (select count(*)::int
        from causal_relations
        where cause_event_id = effect_event_id) as self_loops,
       (select count(*)::int
        from causal_relations
        where confidence < 0 or confidence > 100) as invalid_confidence,
       (select count(*)::int
        from (
          select causal_relation_id, concrete_case_id
          from causal_relation_cases
          group by causal_relation_id, concrete_case_id
          having count(*) > 1
        ) duplicates) as duplicate_case_links,
       (select count(*)::int
        from (
          select event_id, normalized_keyword
          from event_keywords
          group by event_id, normalized_keyword
          having count(*) > 1
        ) duplicates) as duplicate_normalized_keywords,
       (select count(*)::int
        from event_keywords
        where char_length(btrim(keyword)) not between 1 and 50) as invalid_keyword_lengths,
       (select count(*)::int
        from event_keywords k
        left join abstract_events e on e.id = k.event_id
        where e.id is null) as orphaned_keywords,
       (
         (select count(*) from event_aliases a
          left join abstract_events e on e.id = a.event_id
          where e.id is null) +
         (select count(*) from causal_relations r
          left join abstract_events c on c.id = r.cause_event_id
          left join abstract_events e on e.id = r.effect_event_id
          where c.id is null or e.id is null) +
         (select count(*) from causal_relation_cases crc
          left join causal_relations r on r.id = crc.causal_relation_id
          left join concrete_cases c on c.id = crc.concrete_case_id
          where r.id is null or c.id is null)
       )::int as invalid_foreign_keys`,
  );
  const semanticFoundation = await pool.query<{
    extension_installed: boolean;
    required_tables_present: boolean;
  }>(
    `select
       exists (
         select 1
         from pg_extension
         where extname = 'vector'
       ) as extension_installed,
       to_regclass('public.semantic_model_settings') is not null
         and to_regclass('public.semantic_index_state') is not null
         and to_regclass('public.semantic_embeddings') is not null
         and to_regclass('public.semantic_jobs') is not null
         as required_tables_present`,
  );
  const foundationRow = semanticFoundation.rows[0]!;
  const semanticCounts =
    foundationRow.extension_installed && foundationRow.required_tables_present
      ? await pool.query<{
          inactive_model_vectors: number;
          invalid_model_codes: number;
          invalid_vector_dimensions: number;
        }>(
          `select
       (select count(*)::int
        from semantic_embeddings
        where model_code not in ('multilingual-e5-small', 'bge-m3')) as invalid_model_codes,
       (select count(*)::int
        from semantic_embeddings
        where (model_code = 'multilingual-e5-small' and vector_dims(embedding) <> 384)
           or (model_code = 'bge-m3' and vector_dims(embedding) <> 1024))
         as invalid_vector_dimensions,
       (select count(*)::int
        from semantic_embeddings embedding
        cross join semantic_index_state state
        where state.singleton_key = true
          and (
            state.active_model_code is null
            or embedding.model_code <> state.active_model_code
          ))
         as inactive_model_vectors`,
        )
      : undefined;

  const countRow = counts.rows[0]!;
  const integrityRow = integrity.rows[0]!;
  const semanticCountRow = semanticCounts?.rows[0];
  const report: DatabaseVerificationReport = {
    migrationApplied: migration.rows[0]?.applied ?? false,
    counts: {
      abstractEvents: countRow.abstract_events,
      eventAliases: countRow.event_aliases,
      causalRelations: countRow.causal_relations,
      concreteCases: countRow.concrete_cases,
      causalRelationCaseLinks: countRow.causal_relation_case_links,
    },
    integrity: {
      selfLoops: integrityRow.self_loops,
      invalidConfidence: integrityRow.invalid_confidence,
      duplicateCaseLinks: integrityRow.duplicate_case_links,
      invalidForeignKeys: integrityRow.invalid_foreign_keys,
      orphanedKeywords: integrityRow.orphaned_keywords,
      duplicateNormalizedKeywords: integrityRow.duplicate_normalized_keywords,
      invalidKeywordLengths: integrityRow.invalid_keyword_lengths,
    },
    semantic: {
      extensionInstalled: foundationRow.extension_installed,
      requiredTablesPresent: foundationRow.required_tables_present,
      invalidModelCodes: semanticCountRow?.invalid_model_codes ?? 0,
      invalidVectorDimensions: semanticCountRow?.invalid_vector_dimensions ?? 0,
      inactiveModelVectors: semanticCountRow?.inactive_model_vectors ?? 0,
    },
    valid: false,
  };

  report.valid =
    report.migrationApplied &&
    Object.values(report.integrity).every((value) => value === 0) &&
    report.semantic.extensionInstalled &&
    report.semantic.requiredTablesPresent &&
    report.semantic.invalidModelCodes === 0 &&
    report.semantic.invalidVectorDimensions === 0 &&
    report.semantic.inactiveModelVectors === 0;

  return report;
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    const report = await verifyDatabase(pool);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.valid) process.exitCode = 1;
  } catch {
    process.stderr.write('Database verification failed. Check connectivity and migrations.\n');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
