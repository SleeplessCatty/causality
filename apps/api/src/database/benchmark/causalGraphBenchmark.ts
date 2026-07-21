import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CausalGraphQuery } from '@causality/contracts';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { PostgresCausalGraphRepository } from '../../features/causal-graph/causalGraphRepository.js';
import { CausalGraphService } from '../../features/causal-graph/causalGraphService.js';
import { runMigrations } from '../migrate.js';
import { runSimulation } from '../test-data/simulate.js';

const eventCount = 100_000;
const relationCount = 500_000;
const caseCount = 100_000;
const thresholdMilliseconds = 2_000;
const repetitionsPerScenario = 3;

export interface BenchmarkSummary {
  samples: number;
  averageMilliseconds: number;
  p95Milliseconds: number;
  maximumMilliseconds: number;
}

interface DegreeRow {
  event_id: string;
  degree: number;
}

interface BenchmarkScenario {
  name: string;
  query: Omit<CausalGraphQuery, 'centerEventId'>;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

export function percentile95(durations: number[]): number {
  if (durations.length === 0) throw new Error('Benchmark requires at least one duration');
  const sorted = [...durations].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

export function summarizeDurations(durations: number[]): BenchmarkSummary {
  if (durations.length === 0) throw new Error('Benchmark requires at least one duration');
  return {
    samples: durations.length,
    averageMilliseconds: roundMilliseconds(
      durations.reduce((total, duration) => total + duration, 0) / durations.length,
    ),
    p95Milliseconds: roundMilliseconds(percentile95(durations)),
    maximumMilliseconds: roundMilliseconds(Math.max(...durations)),
  };
}

export function assertBenchmarkTarget(
  summary: Pick<BenchmarkSummary, 'p95Milliseconds'>,
  threshold: number,
): void {
  if (summary.p95Milliseconds > threshold) {
    throw new Error(
      `Causal graph benchmark P95 ${summary.p95Milliseconds}ms exceeds ${threshold}ms`,
    );
  }
}

function scenarios(): BenchmarkScenario[] {
  const base = { limit: 100 as const, minConfidence: 0, minCaseCount: 0 };
  return [
    { name: 'upstream', query: { ...base, direction: 'upstream' } },
    { name: 'downstream', query: { ...base, direction: 'downstream' } },
    { name: 'both', query: { ...base, direction: 'both' } },
    {
      name: 'confidence',
      query: { ...base, direction: 'both', minConfidence: 75 },
    },
    {
      name: 'case-count',
      query: { ...base, direction: 'both', minCaseCount: 1 },
    },
    {
      name: 'combined',
      query: { ...base, direction: 'both', minConfidence: 75, minCaseCount: 1 },
    },
  ];
}

async function selectCenters(
  pool: Pool,
): Promise<Array<{ name: 'low' | 'medium' | 'high'; eventId: string; degree: number }>> {
  const result = await pool.query<DegreeRow>(
    `with endpoints as (
       select cause_event_id as event_id from causal_relations
       union all
       select effect_event_id as event_id from causal_relations
     )
     select event_id, count(*)::int as degree
     from endpoints
     group by event_id
     order by degree asc, event_id asc`,
  );
  if (result.rows.length === 0) throw new Error('Benchmark simulation created no connected events');
  const selections = [
    { name: 'low' as const, row: result.rows[0]! },
    { name: 'medium' as const, row: result.rows[Math.floor(result.rows.length / 2)]! },
    { name: 'high' as const, row: result.rows.at(-1)! },
  ];
  return selections.map(({ name, row }) => ({
    name,
    eventId: row.event_id,
    degree: Number(row.degree),
  }));
}

async function runBenchmark(): Promise<void> {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  try {
    process.stdout.write('Starting disposable PostgreSQL benchmark container...\n');
    container = await new GenericContainer('postgres:18.4-alpine')
      .withEnvironment({
        POSTGRES_DB: 'causality_graph_benchmark',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_graph_benchmark'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_graph_benchmark`,
    });
    await runMigrations(pool);
    process.stdout.write(
      `Generating ${eventCount} events, ${relationCount} relations, and ${caseCount} cases...\n`,
    );
    const simulation = await runSimulation(
      pool,
      { events: eventCount, relations: relationCount, cases: caseCount, seed: 20_260_724 },
      'causal-graph-benchmark',
    );
    process.stdout.write(`Simulation completed in ${simulation.elapsedMilliseconds}ms.\n`);

    const centers = await selectCenters(pool);
    const service = new CausalGraphService(new PostgresCausalGraphRepository(pool));
    const durations: number[] = [];
    const samples: Array<{
      center: string;
      degree: number;
      scenario: string;
      milliseconds: number;
    }> = [];

    for (const center of centers) {
      for (const scenario of scenarios()) {
        const query: CausalGraphQuery = {
          centerEventId: center.eventId,
          ...scenario.query,
        };
        await service.query(query);
        for (let repetition = 0; repetition < repetitionsPerScenario; repetition += 1) {
          const startedAt = performance.now();
          await service.query(query);
          const milliseconds = roundMilliseconds(performance.now() - startedAt);
          durations.push(milliseconds);
          samples.push({
            center: center.name,
            degree: center.degree,
            scenario: scenario.name,
            milliseconds,
          });
        }
      }
      process.stdout.write(`Measured ${center.name}-degree center (${center.degree}).\n`);
    }

    const summary = summarizeDurations(durations);
    const report = {
      data: { events: eventCount, relations: relationCount, cases: caseCount },
      centers,
      repetitionsPerScenario,
      thresholdMilliseconds,
      summary,
      passed: summary.p95Milliseconds <= thresholdMilliseconds,
      samples,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    assertBenchmarkTarget(summary, thresholdMilliseconds);
  } finally {
    await pool?.end();
    await container?.stop();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runBenchmark();
}
