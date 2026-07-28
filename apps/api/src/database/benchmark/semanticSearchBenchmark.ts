import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MODEL_CATALOG,
  type SemanticModelCode,
  type SemanticVectorDimensions,
} from '@causality/semantic-core';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import {
  PostgresSemanticQueryContextRepository,
  SemanticQueryService,
} from '../../features/semantic/semanticQueryService.js';
import { PostgresSemanticSearchRepository } from '../../features/semantic/semanticSearchRepository.js';
import { runMigrations } from '../migrate.js';

const semanticRecordTarget = 100_000;

interface SemanticBenchmarkTimings {
  ordinarySearchDuringIndexing: number;
  candidateRetrieval: number;
  e5WarmServiceQuery: number;
  bgeWarmServiceQuery: number;
  restartRecovery: number;
}

interface SemanticBenchmarkInput {
  semanticRecordCount: number;
  candidateCount: number;
  expectedFirstId: string;
  actualFirstId: string | undefined;
  retrievedSimilarity: number;
  timings: SemanticBenchmarkTimings;
}

export interface SemanticBenchmarkSummary extends SemanticBenchmarkInput {
  timings: SemanticBenchmarkTimings;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeSemanticBenchmark(
  input: SemanticBenchmarkInput,
): SemanticBenchmarkSummary {
  return {
    ...input,
    timings: Object.fromEntries(
      Object.entries(input.timings).map(([key, value]) => [key, rounded(value)]),
    ) as unknown as SemanticBenchmarkTimings,
  };
}

export function assertSemanticBenchmarkCorrectness(summary: SemanticBenchmarkSummary): void {
  if (summary.semanticRecordCount !== semanticRecordTarget) {
    throw new Error(`Semantic benchmark must contain exactly 100,000 records`);
  }
  if (summary.candidateCount > 100) {
    throw new Error('Semantic benchmark returned more than 100 candidates');
  }
  if (summary.retrievedSimilarity < 0.99) {
    throw new Error('Semantic benchmark failed the reviewed relevance floor');
  }
  if (summary.candidateCount === 0 || summary.actualFirstId !== summary.expectedFirstId) {
    throw new Error('Semantic benchmark result correctness changed');
  }
}

function queryVector(dimensions: SemanticVectorDimensions): number[] {
  return [1, ...Array.from({ length: dimensions - 1 }, () => 0)];
}

function vectorSql(dimensions: SemanticVectorDimensions): string {
  return `case
    when item = 100 then
      array_prepend(1::real, array_fill(0::real, array[${dimensions - 1}]))::vector
    else
      array_prepend(
        1::real,
        array_prepend(
          (((item % 100) + 1)::real / 1000),
          array_fill(0::real, array[${dimensions - 2}])
        )
      )::vector
  end`;
}

async function activateModel(
  pool: Pool,
  modelCode: SemanticModelCode,
  status: 'building' | 'ready',
) {
  const model = MODEL_CATALOG[modelCode];
  await pool.query(
    `update semantic_model_settings
     set file_status = 'downloaded',
         downloaded_at = coalesce(downloaded_at, clock_timestamp()),
         error = null
     where model_code = $1`,
    [modelCode],
  );
  await pool.query(
    `update semantic_index_state
     set active_model_code = $1,
         status = $2::varchar(20),
         state_version = state_version + 1,
         processed_items = $3,
         total_items = $3,
         pending_items = 0,
         error = null,
         last_ready_at = case
           when $2::varchar(20) = 'ready' then clock_timestamp()
           else last_ready_at
         end,
         updated_at = clock_timestamp()
     where singleton_key = true`,
    [modelCode, status, status === 'ready' ? semanticRecordTarget : 0],
  );
  return model;
}

async function installSyntheticIndex(pool: Pool, modelCode: SemanticModelCode): Promise<void> {
  const model = MODEL_CATALOG[modelCode];
  await pool.query(`truncate semantic_embeddings`);
  await pool.query(
    `insert into semantic_embeddings
       (entity_type, entity_id, model_code, source_hash, embedding)
     select
       'event',
       ('10000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
       $1,
       md5(item::text) || md5(item::text),
       ${vectorSql(model.dimensions)}
     from generate_series(1, $2) as generated(item)`,
    [modelCode, semanticRecordTarget],
  );
  await pool.query(`analyze semantic_embeddings`);
}

async function measureServiceQuery(
  pool: Pool,
  modelCode: SemanticModelCode,
): Promise<{ milliseconds: number; firstId: string | undefined; candidateCount: number }> {
  const model = MODEL_CATALOG[modelCode];
  const service = new SemanticQueryService({
    contextRepository: new PostgresSemanticQueryContextRepository(pool),
    workerClient: {
      health: async () => ({
        status: 'ok',
        modelLoaded: true,
        activeModelCode: model.code,
      }),
      embedQuery: async () => queryVector(model.dimensions),
      embedQueries: async (_modelCode, texts) => texts.map(() => queryVector(model.dimensions)),
    },
    searchRepository: new PostgresSemanticSearchRepository(pool),
  });
  const startedAt = performance.now();
  const result = await service.candidateIds('event', 'benchmark target');
  return {
    milliseconds: performance.now() - startedAt,
    firstId: result.ids[0],
    candidateCount: result.ids.length,
  };
}

async function runBenchmark(): Promise<void> {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  try {
    process.stdout.write('Starting disposable pgvector semantic benchmark container...\n');
    container = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
      .withEnvironment({
        POSTGRES_DB: 'causality_semantic_benchmark',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_semantic_benchmark'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    const connectionString = `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_semantic_benchmark`;
    pool = new Pool({ connectionString, max: 4, options: '-c hnsw.ef_search=200' });
    await runMigrations(pool);
    await pool.query(
      `insert into abstract_events (name, description)
       values ('语义索引期间普通搜索目标', '普通查询必须保持可用')`,
    );

    await activateModel(pool, 'multilingual-e5-small', 'building');
    const indexing = installSyntheticIndex(pool, 'multilingual-e5-small');
    const ordinaryStartedAt = performance.now();
    const ordinary = await pool.query(
      `select id from abstract_events where name ilike '%普通搜索目标%' limit 1`,
    );
    const ordinarySearchDuringIndexing = performance.now() - ordinaryStartedAt;
    if (ordinary.rowCount !== 1) throw new Error('Ordinary search failed while indexing');
    await indexing;
    await activateModel(pool, 'multilingual-e5-small', 'ready');

    const repository = new PostgresSemanticSearchRepository(pool);
    const candidateStartedAt = performance.now();
    const candidates = await repository.candidates({
      entityType: 'event',
      modelCode: 'multilingual-e5-small',
      dimensions: 384,
      threshold: 0,
      vector: queryVector(384),
      limit: 100,
    });
    const candidateRetrieval = performance.now() - candidateStartedAt;
    const e5 = await measureServiceQuery(pool, 'multilingual-e5-small');

    await activateModel(pool, 'bge-m3', 'building');
    await installSyntheticIndex(pool, 'bge-m3');
    await activateModel(pool, 'bge-m3', 'ready');
    const bge = await measureServiceQuery(pool, 'bge-m3');

    const restartStartedAt = performance.now();
    await pool.end();
    pool = new Pool({ connectionString, max: 4, options: '-c hnsw.ef_search=200' });
    const recovered = await measureServiceQuery(pool, 'bge-m3');
    const restartRecovery = performance.now() - restartStartedAt;
    const count = await pool.query<{ count: number }>(
      `select count(*)::int as count from semantic_embeddings`,
    );

    const summary = summarizeSemanticBenchmark({
      semanticRecordCount: count.rows[0]?.count ?? 0,
      candidateCount: Math.max(candidates.length, e5.candidateCount, bge.candidateCount),
      expectedFirstId: `${candidates[0]?.id ?? ''}|${bge.firstId ?? ''}`,
      actualFirstId: `${e5.firstId ?? ''}|${recovered.firstId ?? ''}`,
      retrievedSimilarity: candidates[0]?.similarity ?? 0,
      timings: {
        ordinarySearchDuringIndexing,
        candidateRetrieval,
        e5WarmServiceQuery: e5.milliseconds,
        bgeWarmServiceQuery: bge.milliseconds,
        restartRecovery,
      },
    });
    process.stdout.write(
      `${JSON.stringify({
        firstIds: {
          candidateRetrieval: candidates[0]?.id,
          e5WarmServiceQuery: e5.firstId,
          bgeWarmServiceQuery: bge.firstId,
          restartRecovery: recovered.firstId,
        },
      })}\n`,
    );
    assertSemanticBenchmarkCorrectness(summary);
    process.stdout.write(
      `${JSON.stringify(
        {
          ...summary,
          note: 'Timings report database/API query path with deterministic vectors; real inference is measured by semantic:model-smoke and semantic:quality.',
          manualTargetsMilliseconds: { e5Warm: 2_000, bgeWarm: 5_000 },
          passed: true,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await pool?.end();
    await container?.stop();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runBenchmark();
}
