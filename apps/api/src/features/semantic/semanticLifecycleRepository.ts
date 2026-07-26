import type {
  SemanticFailure,
  SemanticFailureKind,
  SemanticFailureStage,
  SemanticIndexStatus,
  SemanticModelCode,
  SemanticModelFileStatus,
  SemanticTaskPhase,
  SemanticTaskStatus,
  SemanticTaskType,
} from '@causality/contracts';
import { MODEL_CATALOG, semanticModelCodes } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';

import type {
  SemanticIndexState,
  SemanticJobState,
  SemanticLifecycleFacts,
  SemanticModelState,
} from './semanticLifecycleTypes.js';
import { SemanticRepositoryError } from './semanticTypes.js';

interface ModelRow {
  model_code: SemanticModelCode;
  revision: string;
  threshold: number;
  file_status: SemanticModelFileStatus;
  downloaded_at: Date | null;
  failure_kind: SemanticFailureKind | null;
  failure_code: string | null;
  error: string | null;
  updated_at: Date;
}

interface IndexRow {
  active_model_code: SemanticModelCode | null;
  status: SemanticIndexStatus;
  state_version: number;
  processed_items: number;
  total_items: number;
  pending_items: number;
  failed_items: number;
  failure_stage: SemanticFailureStage | null;
  failure_kind: SemanticFailureKind | null;
  failure_code: string | null;
  error: string | null;
  updated_at: Date;
}

interface JobRow {
  id: string;
  job_type: SemanticTaskType;
  model_code: SemanticModelCode;
  status: SemanticTaskStatus;
  phase: SemanticTaskPhase;
  state_version: number;
  attempts: number;
  processed_items: number;
  total_items: number;
  downloaded_bytes: number;
  total_bytes: number;
  next_attempt_at: Date | null;
  failure_kind: SemanticFailureKind | null;
  failure_code: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface SemanticLifecycleRepository {
  readFacts(): Promise<SemanticLifecycleFacts>;
  setThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void>;
}

function failure(options: {
  stage: SemanticFailureStage | null;
  kind: SemanticFailureKind | null;
  code: string | null;
  message: string | null;
  attempts: number;
  occurredAt: Date;
}): SemanticFailure | null {
  if (!options.stage || !options.kind || !options.code || !options.message) return null;
  return {
    stage: options.stage,
    kind: options.kind,
    code: options.code,
    message: options.message,
    attempts: options.attempts,
    occurredAt: options.occurredAt.toISOString(),
  };
}

function modelFailureStage(fileStatus: SemanticModelFileStatus): SemanticFailureStage | null {
  if (fileStatus === 'invalid') return 'verify';
  if (fileStatus === 'failed') return 'download';
  return null;
}

function jobFailureStage(row: JobRow): SemanticFailureStage {
  if (row.job_type === 'download') return row.phase === 'verifying' ? 'verify' : 'download';
  return row.job_type;
}

function mapModel(row: ModelRow): SemanticModelState {
  const definition = MODEL_CATALOG[row.model_code];
  if (row.revision !== definition.revision) {
    throw new Error(`Unexpected semantic model revision: ${row.model_code}`);
  }
  return {
    modelCode: row.model_code,
    label: definition.label,
    description: definition.description,
    languageLabel: definition.languageLabel,
    dimensions: definition.dimensions,
    expectedDownloadBytes: definition.expectedDownloadBytes,
    threshold: row.threshold,
    downloadedAt: row.downloaded_at?.toISOString() ?? null,
    fileState: row.file_status,
    failure: failure({
      stage: modelFailureStage(row.file_status),
      kind: row.failure_kind,
      code: row.failure_code,
      message: row.error,
      attempts: 0,
      occurredAt: row.updated_at,
    }),
  };
}

function mapIndex(row: IndexRow): SemanticIndexState {
  return {
    currentModelCode: row.active_model_code,
    status: row.status,
    stateVersion: row.state_version,
    processedItems: row.processed_items,
    totalItems: row.total_items,
    pendingItems: row.pending_items,
    failedItems: row.failed_items,
    failure: failure({
      stage: row.failure_stage,
      kind: row.failure_kind,
      code: row.failure_code,
      message: row.error,
      attempts: 0,
      occurredAt: row.updated_at,
    }),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapJob(row: JobRow): SemanticJobState {
  return {
    id: row.id,
    type: row.job_type,
    status: row.status,
    phase: row.phase,
    modelCode: row.model_code,
    stateVersion: row.state_version,
    attempt: row.attempts,
    processedItems: row.processed_items,
    totalItems: row.total_items,
    downloadedBytes: row.downloaded_bytes,
    totalBytes: row.total_bytes,
    nextRetryAt: row.next_attempt_at?.toISOString() ?? null,
    failure: failure({
      stage: jobFailureStage(row),
      kind: row.failure_kind,
      code: row.failure_code,
      message: row.error,
      attempts: row.attempts,
      occurredAt: row.completed_at ?? row.updated_at,
    }),
    createdAt: row.created_at.toISOString(),
  };
}

export async function readSemanticLifecycleFacts(
  client: PoolClient,
): Promise<SemanticLifecycleFacts> {
  const modelsResult = await client.query<ModelRow>(
    `select model_code,
            revision,
            threshold,
            file_status,
            downloaded_at,
            failure_kind,
            failure_code,
            error,
            updated_at
     from semantic_model_settings`,
  );
  const indexResult = await client.query<IndexRow>(
    `select active_model_code,
            status,
            state_version,
            processed_items,
            total_items,
            pending_items,
            failed_items,
            failure_stage,
            failure_kind,
            failure_code,
            error,
            updated_at
     from semantic_index_state
     where singleton_key = true`,
  );
  const indexRow = indexResult.rows[0];
  if (!indexRow) throw new Error('Missing semantic_index_state singleton');

  const jobsResult = indexRow.active_model_code
    ? await client.query<JobRow>(
        `select id,
                job_type,
                model_code,
                status,
                phase,
                state_version,
                attempts,
                processed_items,
                total_items,
                downloaded_bytes,
                total_bytes,
                next_attempt_at,
                failure_kind,
                failure_code,
                error,
                created_at,
                updated_at,
                completed_at
         from semantic_jobs
         where model_code = $1
           and state_version = $2
         order by created_at, id`,
        [indexRow.active_model_code, indexRow.state_version],
      )
    : { rows: [] };
  const modelRows = new Map(modelsResult.rows.map((row) => [row.model_code, row]));

  return {
    models: semanticModelCodes.map((modelCode) => {
      const row = modelRows.get(modelCode);
      if (!row) throw new Error(`Missing semantic model setting: ${modelCode}`);
      return mapModel(row);
    }),
    index: mapIndex(indexRow),
    jobs: jobsResult.rows.map(mapJob),
  };
}

export class PostgresSemanticLifecycleRepository implements SemanticLifecycleRepository {
  public constructor(private readonly pool: Pool) {}

  public async readFacts(): Promise<SemanticLifecycleFacts> {
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const facts = await readSemanticLifecycleFacts(client);
      await client.query('commit');
      return facts;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async setThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void> {
    const result = await this.pool.query(
      `update semantic_model_settings
       set threshold = $2,
           updated_at = clock_timestamp()
       where model_code = $1`,
      [modelCode, threshold],
    );
    if (result.rowCount !== 1) {
      throw new SemanticRepositoryError('SEMANTIC_MODEL_UNAVAILABLE', '语义模型配置不存在');
    }
  }
}
