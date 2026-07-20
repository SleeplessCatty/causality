import 'dotenv/config';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import { parseEnv } from '../config/env.js';

interface DatabaseCounts {
  abstractEvents: number;
  eventAliases: number;
  causalRelations: number;
  concreteCausalCases: number;
}

interface IntegrityCounts {
  selfLoops: number;
  invalidConfidence: number;
  invalidCaseTimeOrder: number;
  invalidForeignKeys: number;
}

export interface DatabaseVerificationReport {
  migrationApplied: boolean;
  counts: DatabaseCounts;
  integrity: IntegrityCounts;
  valid: boolean;
}

export async function verifyDatabase(pool: Pool): Promise<DatabaseVerificationReport> {
  const migration = await pool.query<{ applied: boolean }>(
    `select exists (
       select 1
       from drizzle.__drizzle_migrations
     ) as applied`,
  );
  const counts = await pool.query<{
    abstract_events: number;
    causal_relations: number;
    concrete_causal_cases: number;
    event_aliases: number;
  }>(
    `select
       (select count(*)::int from abstract_events) as abstract_events,
       (select count(*)::int from event_aliases) as event_aliases,
       (select count(*)::int from causal_relations) as causal_relations,
       (select count(*)::int from concrete_causal_cases) as concrete_causal_cases`,
  );
  const integrity = await pool.query<{
    invalid_case_time_order: number;
    invalid_confidence: number;
    invalid_foreign_keys: number;
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
        from concrete_causal_cases
        where effect_occurred_at < cause_occurred_at) as invalid_case_time_order,
       (
         (select count(*) from event_aliases a
          left join abstract_events e on e.id = a.event_id
          where e.id is null) +
         (select count(*) from causal_relations r
          left join abstract_events c on c.id = r.cause_event_id
          left join abstract_events e on e.id = r.effect_event_id
          where c.id is null or e.id is null) +
         (select count(*) from concrete_causal_cases c
          left join causal_relations r on r.id = c.causal_relation_id
          where r.id is null)
       )::int as invalid_foreign_keys`,
  );

  const countRow = counts.rows[0]!;
  const integrityRow = integrity.rows[0]!;
  const report: DatabaseVerificationReport = {
    migrationApplied: migration.rows[0]?.applied ?? false,
    counts: {
      abstractEvents: countRow.abstract_events,
      eventAliases: countRow.event_aliases,
      causalRelations: countRow.causal_relations,
      concreteCausalCases: countRow.concrete_causal_cases,
    },
    integrity: {
      selfLoops: integrityRow.self_loops,
      invalidConfidence: integrityRow.invalid_confidence,
      invalidCaseTimeOrder: integrityRow.invalid_case_time_order,
      invalidForeignKeys: integrityRow.invalid_foreign_keys,
    },
    valid: false,
  };

  report.valid =
    report.migrationApplied && Object.values(report.integrity).every((value) => value === 0);

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
