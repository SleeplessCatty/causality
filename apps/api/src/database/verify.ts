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
  invalidThresholds: number;
  invalidLifecycleStates: number;
  invalidDataCheckSemanticStates: number;
}

interface DataTransferIntegrity {
  requiredTablesPresent: boolean;
  requiredIndexesPresent: boolean;
  invalidImportCounts: number;
  invalidImportRecordSnapshots: number;
  expiredExportRequests: number;
}

interface McpAccessIntegrity {
  requiredColumnsPresent: boolean;
  requiredIndexesPresent: boolean;
  invalidEncryptedFields: number;
}

export interface DatabaseVerificationReport {
  migrationApplied: boolean;
  counts: DatabaseCounts;
  integrity: IntegrityCounts;
  semantic: SemanticIntegrity;
  dataTransfer: DataTransferIntegrity;
  mcpAccess: McpAccessIntegrity;
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
  const dataTransferFoundation = await pool.query<{
    required_indexes_present: boolean;
    required_tables_present: boolean;
  }>(
    `select
       to_regclass('public.import_batches') is not null
         and to_regclass('public.import_records') is not null
         and to_regclass('public.export_requests') is not null
         as required_tables_present,
       (
         select count(*) = 5
         from pg_indexes
         where schemaname = 'public'
           and indexname = any(array[
             'import_batches_completed_id_idx',
             'import_records_batch_source_item_sequence_uidx',
             'import_records_batch_type_sequence_idx',
             'export_requests_token_hash_uidx',
             'export_requests_expires_at_idx'
           ])
       ) as required_indexes_present`,
  );
  const mcpAccessFoundation = await pool.query<{
    required_columns_present: boolean;
    required_indexes_present: boolean;
  }>(
    `select
       (
         select count(*) = 11
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'mcp_access_tokens'
           and column_name = any(array[
             'id', 'user_id', 'token_digest', 'name', 'created_at', 'last_used_at',
             'last_client_name', 'masked_token', 'token_ciphertext', 'token_iv',
             'token_auth_tag'
           ])
       ) as required_columns_present,
       (
         select count(*) = 2
         from pg_indexes
         where schemaname = 'public'
           and indexname = any(array[
             'mcp_access_tokens_digest_uidx',
             'mcp_access_tokens_user_name_uidx'
           ])
       ) as required_indexes_present`,
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
        where model_code not in (
          'bge-small-zh-v1.5',
          'multilingual-e5-small',
          'granite-embedding-97m-multilingual-r2',
          'bge-m3'
        )) as invalid_model_codes,
       (select count(*)::int
        from semantic_embeddings
        where (model_code = 'bge-small-zh-v1.5' and vector_dims(embedding) <> 512)
           or (model_code in ('multilingual-e5-small', 'granite-embedding-97m-multilingual-r2')
             and vector_dims(embedding) <> 384)
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
  const semanticLifecycleCounts = foundationRow.required_tables_present
    ? await pool.query<{
        invalid_data_check_semantic_states: number;
        invalid_lifecycle_states: number;
        invalid_thresholds: number;
      }>(
        `select
           (select count(*)::int
            from semantic_model_settings
            where threshold not between 0 and 100
               or dedupe_threshold not between 0 and 100) as invalid_thresholds,
           (select count(*)::int
            from semantic_index_state
            where processed_items < 0
               or total_items < 0
               or pending_items < 0
               or failed_items < 0
               or processed_items > total_items
               or (active_model_code is null and status <> 'empty')
               or (
                 (failure_stage is null or failure_kind is null or failure_code is null)
                 and not (
                   failure_stage is null
                   and failure_kind is null
                   and failure_code is null
                 )
               )) as invalid_lifecycle_states,
           (select count(*)::int
            from data_check_state
            where (
                last_snapshot_id is null
                and (semantic_status is not null or semantic_reason is not null)
              )
              or (
                last_snapshot_id is not null
                and (
                  semantic_status is null
                  or not (
                    (semantic_status = 'completed' and semantic_reason is null)
                    or (semantic_status = 'truncated' and semantic_reason = 'candidate_limit')
                    or (semantic_status = 'failed' and semantic_reason = 'internal_failure')
                    or (
                      semantic_status = 'skipped'
                      and semantic_reason in (
                        'not_recorded',
                        'no_active_model',
                        'worker_unreachable',
                        'index_not_ready',
                        'no_embeddings'
                      )
                    )
                  )
                )
              )) as invalid_data_check_semantic_states`,
      )
    : undefined;
  const dataTransferFoundationRow = dataTransferFoundation.rows[0]!;
  const dataTransferCounts = dataTransferFoundationRow.required_tables_present
    ? await pool.query<{
        expired_export_requests: number;
        invalid_import_counts: number;
        invalid_import_record_snapshots: number;
      }>(
        `select
           (select count(*)::int
            from import_batches
            where event_created < 0
               or event_reused < 0
               or case_created < 0
               or case_reused < 0
               or relation_created < 0
               or relation_reused < 0
               or relation_case_created < 0
               or relation_case_reused < 0) as invalid_import_counts,
           (select count(*)::int
            from import_records
            where jsonb_typeof(text_snapshot) <> 'object'
               or text_snapshot ->> 'type' is distinct from record_type
               or (
                 record_type = 'event'
                 and nullif(btrim(text_snapshot ->> 'eventName'), '') is null
               )
               or (
                 record_type = 'case'
                 and nullif(btrim(text_snapshot ->> 'caseContent'), '') is null
               )
               or (
                 record_type in ('relation', 'relation_case')
                 and (
                   nullif(btrim(text_snapshot ->> 'causeEventName'), '') is null
                   or nullif(btrim(text_snapshot ->> 'effectEventName'), '') is null
                 )
               )
               or (
                 record_type = 'relation_case'
                 and nullif(btrim(text_snapshot ->> 'caseContent'), '') is null
               )) as invalid_import_record_snapshots,
           (select count(*)::int
            from export_requests
            where expires_at <= clock_timestamp()) as expired_export_requests`,
      )
    : undefined;

  const countRow = counts.rows[0]!;
  const integrityRow = integrity.rows[0]!;
  const semanticCountRow = semanticCounts?.rows[0];
  const semanticLifecycleRow = semanticLifecycleCounts?.rows[0];
  const dataTransferCountRow = dataTransferCounts?.rows[0];
  const mcpAccessFoundationRow = mcpAccessFoundation.rows[0]!;
  const mcpAccessCounts = mcpAccessFoundationRow.required_columns_present
    ? await pool.query<{ invalid_encrypted_fields: number }>(
        `select count(*)::int as invalid_encrypted_fields
         from mcp_access_tokens
         where octet_length(token_digest) <> 32
            or name <> btrim(name)
            or char_length(name) not between 1 and 80
            or masked_token !~ '^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$'
            or octet_length(token_ciphertext) = 0
            or octet_length(token_iv) <> 12
            or octet_length(token_auth_tag) <> 16`,
      )
    : undefined;
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
      invalidThresholds: semanticLifecycleRow?.invalid_thresholds ?? 0,
      invalidLifecycleStates: semanticLifecycleRow?.invalid_lifecycle_states ?? 0,
      invalidDataCheckSemanticStates: semanticLifecycleRow?.invalid_data_check_semantic_states ?? 0,
    },
    dataTransfer: {
      requiredTablesPresent: dataTransferFoundationRow.required_tables_present,
      requiredIndexesPresent: dataTransferFoundationRow.required_indexes_present,
      invalidImportCounts: dataTransferCountRow?.invalid_import_counts ?? 0,
      invalidImportRecordSnapshots: dataTransferCountRow?.invalid_import_record_snapshots ?? 0,
      expiredExportRequests: dataTransferCountRow?.expired_export_requests ?? 0,
    },
    mcpAccess: {
      requiredColumnsPresent: mcpAccessFoundationRow.required_columns_present,
      requiredIndexesPresent: mcpAccessFoundationRow.required_indexes_present,
      invalidEncryptedFields: mcpAccessCounts?.rows[0]?.invalid_encrypted_fields ?? 0,
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
    report.semantic.inactiveModelVectors === 0 &&
    report.semantic.invalidThresholds === 0 &&
    report.semantic.invalidLifecycleStates === 0 &&
    report.semantic.invalidDataCheckSemanticStates === 0 &&
    report.dataTransfer.requiredTablesPresent &&
    report.dataTransfer.requiredIndexesPresent &&
    report.dataTransfer.invalidImportCounts === 0 &&
    report.dataTransfer.invalidImportRecordSnapshots === 0 &&
    report.mcpAccess.requiredColumnsPresent &&
    report.mcpAccess.requiredIndexesPresent &&
    report.mcpAccess.invalidEncryptedFields === 0;

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
