import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { createDataCheckRules } from '../../features/data-checks/dataCheckRules.js';
import { DataCheckService } from '../../features/data-checks/dataCheckService.js';
import type { DataCheckRuleTiming } from '../../features/data-checks/dataCheckTypes.js';
import {
  SemanticDuplicateRule,
  semanticCandidateSql,
} from '../../features/data-checks/semanticDuplicateRule.js';
import type { SemanticWorkerClient } from '../../features/semantic/semanticWorkerClient.js';
import { runMigrations } from '../migrate.js';
import { runSimulation } from '../test-data/simulate.js';

const eventCount = 100_000;
const relationCount = 500_000;
const caseCount = 100_000;
const thresholdMilliseconds = 30_000;
const semanticEmbeddingCount = 10_004;
const semanticModelCode = 'multilingual-e5-small';
const semanticMemoryLimitBytes = 512 * 1024 ** 2;

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface DataCheckBenchmarkSummary {
  rules: DataCheckRuleTiming[];
  totalMilliseconds: number;
}

export interface SemanticDataCheckBenchmarkMetrics {
  issueCount: number;
  status: 'completed' | 'truncated';
  reason: 'candidate_limit' | null;
  peakRssDeltaBytes: number;
  usedVectorIndex: boolean;
}

export interface SemanticDataCheckBenchmarkLimits {
  expectedIssueCount: number;
  maximumPeakRssDeltaBytes: number;
}

export function summarizeRuleTimings(
  timings: readonly DataCheckRuleTiming[],
  totalMilliseconds: number,
): DataCheckBenchmarkSummary {
  return {
    rules: timings.map((timing) => ({
      rule: timing.rule,
      milliseconds: roundMilliseconds(timing.milliseconds),
    })),
    totalMilliseconds: roundMilliseconds(totalMilliseconds),
  };
}

export function assertDataCheckBenchmarkTarget(totalMilliseconds: number, threshold: number): void {
  if (totalMilliseconds > threshold) {
    throw new Error(`Data-check benchmark total ${totalMilliseconds}ms exceeds ${threshold}ms`);
  }
}

export function assertSemanticDataCheckBenchmarkTarget(
  metrics: SemanticDataCheckBenchmarkMetrics,
  limits: SemanticDataCheckBenchmarkLimits,
): void {
  if (metrics.issueCount !== limits.expectedIssueCount) {
    throw new Error(
      `Semantic benchmark retained ${metrics.issueCount} issues; expected ${limits.expectedIssueCount}`,
    );
  }
  if (metrics.status !== 'truncated' || metrics.reason !== 'candidate_limit') {
    throw new Error('Semantic benchmark did not exercise the global candidate limit');
  }
  if (!metrics.usedVectorIndex) {
    throw new Error('Semantic benchmark did not use the pgvector HNSW index');
  }
  if (metrics.peakRssDeltaBytes > limits.maximumPeakRssDeltaBytes) {
    throw new Error(
      `Semantic benchmark peak RSS delta ${metrics.peakRssDeltaBytes} bytes exceeds ${limits.maximumPeakRssDeltaBytes} bytes`,
    );
  }
}

function unitVector(): string {
  return `[1,${Array.from({ length: 383 }, () => 0).join(',')}]`;
}

async function seedSemanticCandidates(pool: Pool): Promise<void> {
  await pool.query(
    `update semantic_model_settings
     set dedupe_threshold = 100,
         file_status = 'downloaded',
         downloaded_at = now()
     where model_code = $1`,
    [semanticModelCode],
  );
  await pool.query(
    `insert into semantic_embeddings (
       entity_type,
       entity_id,
       model_code,
       source_hash,
       embedding
     )
     select 'event',
            event.id,
            $1,
            repeat('a', 64),
            $2::vector
     from abstract_events event
     order by event.id
     limit $3`,
    [semanticModelCode, unitVector(), semanticEmbeddingCount],
  );
  await pool.query(`delete from semantic_jobs`);
  await pool.query(
    `update semantic_index_state
     set active_model_code = $1,
         status = 'ready',
         state_version = state_version + 1,
         processed_items = $2,
         total_items = $2,
         pending_items = 0,
         failed_items = 0,
         failure_stage = null,
         failure_kind = null,
         failure_code = null,
         error = null
     where singleton_key = true`,
    [semanticModelCode, semanticEmbeddingCount],
  );
  await pool.query('analyze semantic_embeddings');
}

async function measureSemanticRule(
  pool: Pool,
): Promise<SemanticDataCheckBenchmarkMetrics & { milliseconds: number }> {
  const workerClient: SemanticWorkerClient = {
    health: async () => ({
      status: 'ok',
      modelLoaded: true,
      activeModelCode: semanticModelCode,
    }),
    embedQuery: async () => [],
  };
  const plan = await pool.query<{ 'QUERY PLAN': unknown }>(
    `explain (format json) ${semanticCandidateSql(384)}`,
    [semanticModelCode, 'event', 1, 'case'],
  );
  const planText = JSON.stringify(plan.rows);
  const usedVectorIndex = planText.includes('semantic_embeddings_event_e5_hnsw_idx');
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sample = () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };
  const interval = setInterval(sample, 10);
  const startedAt = performance.now();
  try {
    const result = await new SemanticDuplicateRule(pool, workerClient).scan();
    sample();
    return {
      issueCount: result.issues.length,
      status: result.semantic.status === 'truncated' ? 'truncated' : 'completed',
      reason: result.semantic.reason === 'candidate_limit' ? 'candidate_limit' : null,
      peakRssDeltaBytes: Math.max(0, peakRss - baselineRss),
      usedVectorIndex,
      milliseconds: roundMilliseconds(performance.now() - startedAt),
    };
  } finally {
    clearInterval(interval);
  }
}

async function runBenchmark(): Promise<void> {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  try {
    process.stdout.write('Starting disposable PostgreSQL data-check benchmark container...\n');
    container = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
      .withEnvironment({
        POSTGRES_DB: 'causality_data_check_benchmark',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_data_check_benchmark'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_data_check_benchmark`,
    });
    await runMigrations(pool);
    process.stdout.write(
      `Generating ${eventCount} events, ${relationCount} relations, and ${caseCount} cases...\n`,
    );
    const simulation = await runSimulation(
      pool,
      { events: eventCount, relations: relationCount, cases: caseCount, seed: 20_260_723 },
      'data-check-benchmark',
    );
    process.stdout.write(`Simulation completed in ${simulation.elapsedMilliseconds}ms.\n`);
    await pool.query('analyze');
    process.stdout.write(`Seeding ${semanticEmbeddingCount} active event embeddings...\n`);
    await seedSemanticCandidates(pool);
    const semanticSummary = await measureSemanticRule(pool);
    assertSemanticDataCheckBenchmarkTarget(semanticSummary, {
      expectedIssueCount: 50_000,
      maximumPeakRssDeltaBytes: semanticMemoryLimitBytes,
    });

    const service = new DataCheckService(pool, createDataCheckRules());
    const startedAt = performance.now();
    const result = await service.run();
    const totalMilliseconds = performance.now() - startedAt;
    const summary = summarizeRuleTimings(result.timings, totalMilliseconds);
    const report = {
      data: { events: eventCount, relations: relationCount, cases: caseCount },
      thresholdMilliseconds,
      summary,
      orphanCounts: result.orphanCounts,
      issueCount: result.issues.length,
      semantic: {
        ...semanticSummary,
        peakRssDeltaMiB: roundMilliseconds(semanticSummary.peakRssDeltaBytes / 1024 ** 2),
      },
      passed: summary.totalMilliseconds <= thresholdMilliseconds,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    assertDataCheckBenchmarkTarget(summary.totalMilliseconds, thresholdMilliseconds);
  } finally {
    await pool?.end();
    await container?.stop();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runBenchmark();
}
