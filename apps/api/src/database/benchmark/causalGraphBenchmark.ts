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

interface HubDegreeRow {
  degree: number;
  distinct_neighbors: number;
}

interface BenchmarkScenario {
  name: string;
  query: Omit<CausalGraphQuery, 'centerEventId'>;
}

type BenchmarkCenterName = 'low' | 'medium' | 'high' | 'hub';

interface BenchmarkCenter {
  name: BenchmarkCenterName;
  eventId: string;
  degree: number;
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

export function assertInstalledHubDegree(
  requestedDegree: number,
  actualDegree: number,
  distinctNeighbors: number,
): number {
  if (actualDegree !== requestedDegree || distinctNeighbors !== requestedDegree) {
    throw new Error(
      `Benchmark hub expected degree ${requestedDegree} with ${requestedDegree} distinct neighbors, found degree ${actualDegree} with ${distinctNeighbors} distinct neighbors`,
    );
  }
  return actualDegree;
}

export function benchmarkScenariosForCenter(center: BenchmarkCenterName): BenchmarkScenario[] {
  if (center === 'hub') {
    return [
      {
        name: 'both-limit-20',
        query: { direction: 'both', limit: 20, minConfidence: 0, minCaseCount: 0 },
      },
      {
        name: 'both-limit-100',
        query: { direction: 'both', limit: 100, minConfidence: 0, minCaseCount: 0 },
      },
      {
        name: 'combined',
        query: { direction: 'both', limit: 100, minConfidence: 75, minCaseCount: 1 },
      },
    ];
  }
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

async function selectCenters(pool: Pool, hub: BenchmarkCenter): Promise<BenchmarkCenter[]> {
  const result = await pool.query<DegreeRow>(
    `with endpoints as (
       select cause_event_id as event_id from causal_relations
       union all
       select effect_event_id as event_id from causal_relations
     )
     select event_id, count(*)::int as degree
     from endpoints
     where event_id <> $1
     group by event_id
     order by degree asc, event_id asc`,
    [hub.eventId],
  );
  if (result.rows.length === 0) throw new Error('Benchmark simulation created no connected events');
  const selections = [
    { name: 'low' as const, row: result.rows[0]! },
    { name: 'medium' as const, row: result.rows[Math.floor(result.rows.length / 2)]! },
    { name: 'high' as const, row: result.rows.at(-1)! },
  ];
  return [
    ...selections.map(({ name, row }) => ({
      name,
      eventId: row.event_id,
      degree: Number(row.degree),
    })),
    hub,
  ];
}

async function installBenchmarkHub(pool: Pool, degree: number): Promise<BenchmarkCenter> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const hubResult = await client.query<{ id: string }>(
      `select id
       from abstract_events
       order by id asc
       limit 1`,
    );
    const hubId = hubResult.rows[0]?.id;
    if (!hubId) throw new Error('Benchmark simulation created no events for the hub');

    await client.query(
      `create temporary table benchmark_relations_to_replace (
         id uuid primary key
       ) on commit drop`,
    );
    await client.query(
      `insert into benchmark_relations_to_replace (id)
       select r.id
       from causal_relations r
       order by
         case when r.cause_event_id = $1 or r.effect_event_id = $1 then 0 else 1 end,
         r.id asc
       limit $2`,
      [hubId, degree],
    );
    await client.query(
      `delete from causal_relation_cases
       where causal_relation_id in (select id from benchmark_relations_to_replace)`,
    );
    const deleted = await client.query(
      `delete from causal_relations
       where id in (select id from benchmark_relations_to_replace)
       returning id`,
    );
    if (deleted.rowCount !== degree) {
      throw new Error(`Benchmark requires at least ${degree} replaceable relations`);
    }

    const inserted = await client.query(
      `with neighbors as (
         select id,
                row_number() over (order by id asc) as neighbor_number
         from abstract_events
         where id <> $1
         order by id asc
         limit $2
       )
       insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       select gen_random_uuid(),
              $1,
              id,
              (100 - ((neighbor_number - 1) % 101))::smallint
       from neighbors
       returning id`,
      [hubId, degree],
    );
    if (inserted.rowCount !== degree) {
      throw new Error(`Benchmark requires at least ${degree} distinct hub neighbors`);
    }

    const installedResult = await client.query<HubDegreeRow>(
      `select count(*)::int as degree,
              count(distinct case
                when cause_event_id = $1 then effect_event_id
                else cause_event_id
              end)::int as distinct_neighbors
       from causal_relations
       where cause_event_id = $1 or effect_event_id = $1`,
      [hubId],
    );
    const installed = installedResult.rows[0]!;
    const installedDegree = assertInstalledHubDegree(
      degree,
      Number(installed.degree),
      Number(installed.distinct_neighbors),
    );

    await client.query('analyze causal_relations');
    await client.query('analyze causal_relation_cases');
    await client.query('commit');
    return { name: 'hub', eventId: hubId, degree: installedDegree };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function runBenchmark(): Promise<void> {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  try {
    process.stdout.write('Starting disposable PostgreSQL benchmark container...\n');
    container = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
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

    const hub = await installBenchmarkHub(pool, 10_000);
    const centers = await selectCenters(pool, hub);
    const service = new CausalGraphService(new PostgresCausalGraphRepository(pool));
    const durations: number[] = [];
    const samples: Array<{
      center: string;
      degree: number;
      scenario: string;
      milliseconds: number;
    }> = [];

    for (const center of centers) {
      for (const scenario of benchmarkScenariosForCenter(center.name)) {
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
