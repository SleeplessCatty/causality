import { writeFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { buildApp } from '../../app.js';
import type { AiCaptureSemanticCandidates } from '../../features/ai-capture/aiCaptureRoutes.js';
import type { SemanticWorkerClient } from '../../features/semantic/semanticWorkerClient.js';
import { runMigrations } from '../migrate.js';
import { runSimulation } from '../test-data/simulate.js';

const FIXED_DATASET = {
  events: 10_000,
  relations: 30_000,
  cases: 100_000,
  seed: 20260731,
} as const;

function numericArgument(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --${name}`);
  return value;
}

const semanticCandidates: AiCaptureSemanticCandidates = {
  compare: async (_entityType, texts) => texts.map(() => []),
  topicRelevance: async (_topic, events) =>
    events.map((event) => ({ ref: event.ref, similarity: 1 })),
};

const unusedWorker: SemanticWorkerClient = {
  health: async () => ({ status: 'ok', modelLoaded: false, activeModelCode: null }),
  embedQuery: async () => {
    throw new Error('MCP benchmark does not use semantic embeddings');
  },
  embedQueries: async () => {
    throw new Error('MCP benchmark does not use semantic embeddings');
  },
};

async function main(): Promise<void> {
  const readyFile = process.env.CAUSALITY_MCP_BENCHMARK_READY_FILE;
  if (!readyFile) throw new Error('CAUSALITY_MCP_BENCHMARK_READY_FILE is required');
  const host = '127.0.0.1';
  const port = numericArgument('port', 19_080);
  const dataset = {
    events: numericArgument('events', FIXED_DATASET.events),
    relations: numericArgument('relations', FIXED_DATASET.relations),
    cases: numericArgument('cases', FIXED_DATASET.cases),
    seed: numericArgument('seed', FIXED_DATASET.seed),
  };
  if (JSON.stringify(dataset) !== JSON.stringify(FIXED_DATASET)) {
    throw new Error('MCP benchmark requires the reviewed fixed dataset');
  }

  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app?.close();
    await pool?.end();
    await container?.stop();
  };
  try {
    container = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
      .withLabels({ 'causality.mcp-benchmark': 'true' })
      .withEnvironment({
        POSTGRES_DB: 'causality_mcp_benchmark',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_mcp_benchmark'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_mcp_benchmark`,
    });
    await runMigrations(pool);
    const simulation = await runSimulation(pool, dataset, 'mcp-capacity-20260731');
    app = buildApp({
      databasePool: pool,
      checkDatabase: async () => true,
      semanticWorkerClient: unusedWorker,
      aiCaptureSemanticCandidates: semanticCandidates,
      mcpEndpoint: `http://127.0.0.1:${process.env.CAUSALITY_MCP_BENCHMARK_PORT ?? '19081'}/mcp`,
      mcpHealthUrl: `http://127.0.0.1:${process.env.CAUSALITY_MCP_BENCHMARK_PORT ?? '19081'}/health`,
      logger: false,
    });
    await app.listen({ host, port });
    await writeFile(
      readyFile,
      JSON.stringify({
        apiUrl: `http://${host}:${port}`,
        batchId: simulation.batchId,
        inserted: simulation.inserted,
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
    await new Promise<void>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, resolve);
    });
  } finally {
    await shutdown();
  }
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'MCP benchmark API failed'}\n`);
  process.exitCode = 1;
});
