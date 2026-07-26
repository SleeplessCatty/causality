import type {
  SemanticLifecycleSnapshot,
  SemanticModelCode,
  SemanticSettingsResponse,
  SemanticUseModelResponse,
  SemanticWorkerStatus,
} from '@causality/contracts';

import type { SemanticLifecycleRepository } from './semanticLifecycleRepository.js';
import { resolveSemanticLifecycle } from './semanticLifecycleResolver.js';
import type { SemanticLifecycleFacts } from './semanticLifecycleTypes.js';
import type { SemanticRepository } from './semanticTypes.js';
import type { SemanticWorkerClient, SemanticWorkerHealth } from './semanticWorkerClient.js';

export class SemanticService {
  public constructor(private readonly repository: SemanticRepository) {}

  public settings(): Promise<SemanticSettingsResponse> {
    return this.repository.getSettings();
  }

  public useModel(modelCode: SemanticModelCode): Promise<SemanticUseModelResponse> {
    return this.repository.requestUseModel(modelCode);
  }

  public reindex(): Promise<SemanticUseModelResponse> {
    return this.repository.requestReindex();
  }

  public retry(): Promise<SemanticUseModelResponse> {
    return this.repository.retryLatestFailure();
  }
}

const PREPARING_INDEX_STATUSES = new Set(['waiting_model', 'loading', 'index_queued', 'building']);
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'retry_wait']);

function onlineWorkerStatus(
  facts: SemanticLifecycleFacts,
  health: SemanticWorkerHealth,
  checkedAt: string,
): SemanticWorkerStatus {
  const currentModelCode = facts.index.currentModelCode;
  const loadedModelCode = health.activeModelCode;

  if (loadedModelCode !== null) {
    return {
      status: 'online',
      modelState: loadedModelCode === currentModelCode ? 'loaded' : 'mismatch',
      loadedModelCode,
      checkedAt,
    };
  }
  if (currentModelCode === null) {
    return {
      status: 'online',
      modelState: 'idle',
      loadedModelCode: null,
      checkedAt,
    };
  }

  const hasActivePreparation =
    PREPARING_INDEX_STATUSES.has(facts.index.status) ||
    facts.jobs.some(
      (job) =>
        ACTIVE_JOB_STATUSES.has(job.status) &&
        (job.type === 'download' || job.type === 'load' || job.type === 'full_index'),
    );
  return {
    status: 'online',
    modelState: hasActivePreparation ? 'preparing' : 'missing',
    loadedModelCode: null,
    checkedAt,
  };
}

export class SemanticLifecycleService {
  public constructor(
    private readonly repository: SemanticLifecycleRepository,
    private readonly workerClient: SemanticWorkerClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async lifecycle(): Promise<SemanticLifecycleSnapshot> {
    const facts = await this.repository.readFacts();
    const health: SemanticWorkerHealth | null = await this.workerClient.health().catch(() => null);
    const checkedAt = this.clock().toISOString();
    const worker: SemanticWorkerStatus = health
      ? onlineWorkerStatus(facts, health, checkedAt)
      : {
          status: 'unreachable',
          modelState: 'missing',
          loadedModelCode: null,
          checkedAt,
        };
    return resolveSemanticLifecycle({
      ...facts,
      worker,
      now: checkedAt,
    });
  }

  public async updateThreshold(
    modelCode: SemanticModelCode,
    threshold: number,
  ): Promise<SemanticLifecycleSnapshot> {
    await this.repository.setThreshold(modelCode, threshold);
    return this.lifecycle();
  }
}
