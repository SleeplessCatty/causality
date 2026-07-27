import type {
  SemanticActionAccepted,
  SemanticLifecycleSnapshot,
  SemanticModelCode,
  SemanticWorkerStatus,
} from '@causality/contracts';

import type { SemanticLifecycleRepository } from './semanticLifecycleRepository.js';
import { resolveSemanticLifecycle } from './semanticLifecycleResolver.js';
import type { SemanticLifecycleFacts } from './semanticLifecycleTypes.js';
import type { SemanticCommandRepository } from './semanticTypes.js';
import type { SemanticWorkerClient, SemanticWorkerHealth } from './semanticWorkerClient.js';

export class SemanticService {
  public constructor(private readonly commandRepository: SemanticCommandRepository) {}

  public useModel(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.commandRepository.useModel(modelCode);
  }

  public retryDownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.commandRepository.retryDownload(modelCode);
  }

  public redownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.commandRepository.redownload(modelCode);
  }

  public retryLoad(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.commandRepository.retryLoad(modelCode);
  }

  public retryFullIndex(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.commandRepository.retryFullIndex(modelCode);
  }

  public reindex(): Promise<SemanticActionAccepted> {
    return this.commandRepository.reindex();
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

  private async resolveWorkerStatus(facts: SemanticLifecycleFacts): Promise<SemanticWorkerStatus> {
    const health: SemanticWorkerHealth | null = await this.workerClient.health().catch(() => null);
    const checkedAt = this.clock().toISOString();
    return health
      ? onlineWorkerStatus(facts, health, checkedAt)
      : {
          status: 'unreachable',
          modelState: 'missing',
          loadedModelCode: null,
          checkedAt,
        };
  }

  public async workerStatus(): Promise<SemanticWorkerStatus> {
    const facts = await this.repository.readFacts();
    return this.resolveWorkerStatus(facts);
  }

  public async lifecycle(): Promise<SemanticLifecycleSnapshot> {
    const facts = await this.repository.readFacts();
    const worker = await this.resolveWorkerStatus(facts);
    return resolveSemanticLifecycle({
      ...facts,
      worker,
      now: worker.checkedAt,
    });
  }

  public async updateThreshold(
    modelCode: SemanticModelCode,
    threshold: number,
  ): Promise<SemanticLifecycleSnapshot> {
    await this.repository.setThreshold(modelCode, threshold);
    return this.lifecycle();
  }

  public async updateDedupeThreshold(
    modelCode: SemanticModelCode,
    threshold: number,
  ): Promise<SemanticLifecycleSnapshot> {
    await this.repository.setDedupeThreshold(modelCode, threshold);
    return this.lifecycle();
  }
}
