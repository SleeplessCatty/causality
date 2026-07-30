import type {
  HealthResponse,
  ReadinessResponse,
  SemanticLifecycleSnapshot,
} from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import { systemStatusResourceSchema } from '../src/resources/resourceSchemas.js';
import {
  buildSystemStatusResource,
  type CausalityStatusApi,
} from '../src/resources/systemStatusResource.js';

const timestamp = '2026-07-30T12:00:00.000Z';
const health: HealthResponse = { status: 'ok', service: 'causality-api' };
const ready: ReadinessResponse = { status: 'ready', database: 'available' };

function lifecycle(): SemanticLifecycleSnapshot {
  return {
    currentModelCode: 'bge-small-zh-v1.5',
    models: [
      {
        modelCode: 'bge-small-zh-v1.5',
        label: '中文轻量',
        description: '测试模型',
        languageLabel: '中文',
        dimensions: 512,
        expectedDownloadBytes: 25_000_000,
        threshold: 74,
        dedupeThreshold: 100,
        downloadedAt: timestamp,
        fileState: 'downloaded',
        role: 'current',
        stage: 'ready',
        availableForEnhancedSearch: true,
        allowedActions: ['reindex'],
        failure: null,
      },
    ],
    index: {
      status: 'ready',
      processedItems: 100,
      totalItems: 100,
      pendingItems: 0,
      failedItems: 0,
      availableForEnhancedSearch: true,
      failure: null,
      updatedAt: timestamp,
    },
    operation: null,
    worker: {
      status: 'online',
      modelState: 'loaded',
      loadedModelCode: 'bge-small-zh-v1.5',
      checkedAt: timestamp,
    },
    pollAfterMs: null,
    updatedAt: timestamp,
  };
}

class FakeStatusApi implements CausalityStatusApi {
  readonly timeouts: number[] = [];
  healthResult: HealthResponse | Error = health;
  readinessResult: ReadinessResponse | Error = ready;
  lifecycleResult: SemanticLifecycleSnapshot | Error = lifecycle();

  private result<T>(value: T | Error, timeoutMs: number): Promise<T> {
    this.timeouts.push(timeoutMs);
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  }

  getHealth(timeoutMs: number): Promise<HealthResponse> {
    return this.result(this.healthResult, timeoutMs);
  }

  getReadiness(timeoutMs: number): Promise<ReadinessResponse> {
    return this.result(this.readinessResult, timeoutMs);
  }

  getSemanticLifecycle(timeoutMs: number): Promise<SemanticLifecycleSnapshot> {
    return this.result(this.lifecycleResult, timeoutMs);
  }
}

async function build(api: FakeStatusApi) {
  return buildSystemStatusResource(api, {
    now: () => new Date(timestamp),
    serverVersion: '0.1.0',
  });
}

describe('system status resource', () => {
  it('returns strict ready state and performs fresh five-second checks', async () => {
    const api = new FakeStatusApi();
    const first = await build(api);
    await build(api);

    expect(systemStatusResourceSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      overallStatus: 'ready',
      api: { status: 'online', reason: null },
      database: { status: 'ready', reason: null },
      semantic: {
        status: 'ready',
        workerStatus: 'online',
        modelState: 'loaded',
        currentModelCode: 'bge-small-zh-v1.5',
        currentModelFileState: 'downloaded',
        indexStatus: 'ready',
      },
      enhancedQuery: { available: true, reason: null },
    });
    expect(api.timeouts).toEqual([5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);
  });

  it.each([
    [
      'worker_unreachable',
      (value: SemanticLifecycleSnapshot): void => {
        value.worker.status = 'unreachable';
      },
    ],
    [
      'model_not_selected',
      (value: SemanticLifecycleSnapshot): void => {
        value.currentModelCode = null;
      },
    ],
    [
      'model_not_downloaded',
      (value: SemanticLifecycleSnapshot): void => {
        value.models[0]!.fileState = 'not_downloaded';
      },
    ],
    [
      'model_not_loaded',
      (value: SemanticLifecycleSnapshot): void => {
        value.worker.modelState = 'missing';
      },
    ],
    [
      'index_not_ready',
      (value: SemanticLifecycleSnapshot): void => {
        value.index.status = 'building';
      },
    ],
  ] as const)('reports degraded semantic reason %s', async (reason, mutate) => {
    const api = new FakeStatusApi();
    const value = lifecycle();
    mutate(value);
    api.lifecycleResult = value;

    expect(await build(api)).toMatchObject({
      overallStatus: 'degraded',
      enhancedQuery: { available: false, reason },
    });
  });

  it('returns unavailable database state and never serializes rejected errors', async () => {
    const api = new FakeStatusApi();
    api.healthResult = new Error('token-secret http://internal.local stack');
    api.readinessResult = new Error('database-secret');
    api.lifecycleResult = new Error('semantic-secret');

    const result = await build(api);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      overallStatus: 'unavailable',
      api: { status: 'unreachable', reason: 'api_unreachable' },
      database: { status: 'unknown', reason: 'status_unavailable' },
      semantic: { status: 'unavailable' },
      enhancedQuery: { available: false, reason: 'semantic_status_unavailable' },
    });
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('internal.local');
    expect(serialized).not.toContain('stack');
  });

  it('marks an explicit not-ready database unavailable', async () => {
    const api = new FakeStatusApi();
    api.readinessResult = { status: 'not_ready', database: 'unavailable' };

    expect(await build(api)).toMatchObject({
      overallStatus: 'unavailable',
      database: { status: 'unavailable', reason: 'database_unavailable' },
    });
  });
});
