import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { createDataCheckRules } from '../../features/data-checks/dataCheckRules.js';
import { DataCheckService } from '../../features/data-checks/dataCheckService.js';
import type { DataCheckRuleTiming } from '../../features/data-checks/dataCheckTypes.js';
import { runMigrations } from '../migrate.js';
import { runSimulation } from '../test-data/simulate.js';

const eventCount = 100_000;
const relationCount = 500_000;
const caseCount = 100_000;
const thresholdMilliseconds = 30_000;

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface DataCheckBenchmarkSummary {
  rules: DataCheckRuleTiming[];
  totalMilliseconds: number;
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

async function runBenchmark(): Promise<void> {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  try {
    process.stdout.write('Starting disposable PostgreSQL data-check benchmark container...\n');
    container = await new GenericContainer('postgres:18.4-alpine')
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
