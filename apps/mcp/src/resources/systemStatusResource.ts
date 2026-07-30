import type {
  HealthResponse,
  ReadinessResponse,
  SemanticLifecycleSnapshot,
} from '@causality/contracts';

import { CAUSALITY_MCP_NAME } from '../capabilities/capabilityManifest.js';
import { systemStatusResourceSchema, type SystemStatusResource } from './resourceSchemas.js';

export interface CausalityStatusApi {
  getHealth(timeoutMs: number): Promise<HealthResponse>;
  getReadiness(timeoutMs: number): Promise<ReadinessResponse>;
  getSemanticLifecycle(timeoutMs: number): Promise<SemanticLifecycleSnapshot>;
}

interface BuildSystemStatusOptions {
  now: () => Date;
  serverVersion: string;
}

type EnhancedReason = SystemStatusResource['enhancedQuery']['reason'];

function enhancedReason(lifecycle: SemanticLifecycleSnapshot): EnhancedReason {
  if (lifecycle.worker.status === 'unreachable') return 'worker_unreachable';
  if (!lifecycle.currentModelCode) return 'model_not_selected';
  const current = lifecycle.models.find((model) => model.modelCode === lifecycle.currentModelCode);
  if (!current || current.fileState !== 'downloaded') return 'model_not_downloaded';
  if (
    lifecycle.worker.modelState !== 'loaded' ||
    lifecycle.worker.loadedModelCode !== lifecycle.currentModelCode
  ) {
    return 'model_not_loaded';
  }
  if (lifecycle.index.status !== 'ready' || !lifecycle.index.availableForEnhancedSearch) {
    return 'index_not_ready';
  }
  return null;
}

export async function buildSystemStatusResource(
  api: CausalityStatusApi,
  options: BuildSystemStatusOptions,
): Promise<SystemStatusResource> {
  const [health, readiness, lifecycle] = await Promise.allSettled([
    api.getHealth(5_000),
    api.getReadiness(5_000),
    api.getSemanticLifecycle(5_000),
  ]);
  const apiOnline = health.status === 'fulfilled';
  const database =
    readiness.status === 'rejected'
      ? ({ status: 'unknown', reason: 'status_unavailable' } as const)
      : readiness.value.status === 'ready'
        ? ({ status: 'ready', reason: null } as const)
        : ({ status: 'unavailable', reason: 'database_unavailable' } as const);
  const semanticValue = lifecycle.status === 'fulfilled' ? lifecycle.value : null;
  const reason = semanticValue ? enhancedReason(semanticValue) : 'semantic_status_unavailable';
  const currentModel = semanticValue?.models.find(
    (model) => model.modelCode === semanticValue.currentModelCode,
  );
  const unavailable = !apiOnline || database.status !== 'ready';

  return systemStatusResourceSchema.parse({
    schemaVersion: 1,
    generatedAt: options.now().toISOString(),
    overallStatus: unavailable ? 'unavailable' : reason ? 'degraded' : 'ready',
    mcp: {
      status: 'online',
      name: CAUSALITY_MCP_NAME,
      version: options.serverVersion,
    },
    api: {
      status: apiOnline ? 'online' : 'unreachable',
      reason: apiOnline ? null : 'api_unreachable',
    },
    database,
    semantic: semanticValue
      ? {
          status: reason ? 'degraded' : 'ready',
          workerStatus: semanticValue.worker.status,
          modelState: semanticValue.worker.modelState,
          currentModelCode: semanticValue.currentModelCode,
          currentModelFileState: currentModel?.fileState ?? null,
          indexStatus: semanticValue.index.status,
        }
      : {
          status: 'unavailable',
          workerStatus: null,
          modelState: null,
          currentModelCode: null,
          currentModelFileState: null,
          indexStatus: null,
        },
    enhancedQuery: {
      available: reason === null,
      reason,
    },
  });
}
