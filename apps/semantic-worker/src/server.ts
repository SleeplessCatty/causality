import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import { parseWorkerEnv } from './config/env.js';
import { createWorkerDatabasePool } from './database.js';
import { PostgresIndexBuilder } from './jobs/indexBuilder.js';
import { PostgresDownloadJobRepository } from './jobs/jobRepository.js';
import { DownloadJobRunner, IndexJobRunner } from './jobs/jobRunner.js';
import { PostgresSemanticSourceRepository } from './jobs/semanticSourceRepository.js';
import { buildInternalServer, SemanticWorkerService } from './internalServer.js';
import { PinnedModelDownloader } from './model/modelDownloader.js';
import { TransformersEmbeddingRuntime } from './model/transformersRuntime.js';

const env = parseWorkerEnv(process.env);
const pool = createWorkerDatabasePool(env.DATABASE_URL);
const repository = new PostgresDownloadJobRepository(pool);
const runtime = new TransformersEmbeddingRuntime({
  modelsDirectory: env.MODEL_DIRECTORY,
});
const service = new SemanticWorkerService({
  repository,
  runtime,
  modelsDirectory: env.MODEL_DIRECTORY,
});
const workerId = `${hostname()}-${process.pid}-${randomUUID()}`;
const runner = new DownloadJobRunner({
  repository,
  downloader: new PinnedModelDownloader(),
  modelsDirectory: env.MODEL_DIRECTORY,
  workerId,
});
const indexBuilder = new PostgresIndexBuilder({
  pool,
  sourceRepository: new PostgresSemanticSourceRepository(pool),
  runtime,
  modelsDirectory: env.MODEL_DIRECTORY,
  onModelLoading: () => service.markModelLoading(),
  onModelReady: (modelCode) => service.markLoadedModel(modelCode),
});
const indexRunner = new IndexJobRunner({
  repository,
  builder: indexBuilder,
  workerId,
});
const app = buildInternalServer({
  service,
  logger:
    env.NODE_ENV === 'development'
      ? {
          level: env.LOG_LEVEL,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        }
      : { level: env.LOG_LEVEL },
});
const pollingController = new AbortController();

async function pollJobs(): Promise<void> {
  while (!pollingController.signal.aborted) {
    try {
      const processed = await runner.runOnce();
      if (processed) continue;
      const indexed = await indexRunner.runOnce();
      if (indexed) continue;
    } catch (error) {
      app.log.error(error, 'Semantic job failed outside retry handling');
    }

    try {
      await delay(env.JOB_POLL_INTERVAL_MS, undefined, {
        signal: pollingController.signal,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).name !== 'AbortError') throw error;
    }
  }
}

let polling: Promise<void> | undefined;
let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info({ signal }, 'Shutting down semantic worker');
  pollingController.abort();
  await polling;
  await app.close();
  await service.dispose();
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      app.log.error(error, 'Semantic worker graceful shutdown failed');
      process.exitCode = 1;
    });
  });
}

try {
  await service.initialize();
  await app.listen({ host: env.HOST, port: env.PORT });
  polling = pollJobs();
} catch (error) {
  app.log.error(error, 'Semantic worker failed to start');
  pollingController.abort();
  await service.dispose();
  await pool.end();
  process.exitCode = 1;
}
