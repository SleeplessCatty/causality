import type {
  LegacySemanticTaskStatus,
  LegacySemanticTaskType,
  SemanticDownloadStatus,
  SemanticIndexStatus,
  SemanticModelCode,
  SemanticModelFileStatus,
  SemanticSettingsResponse,
} from '@causality/contracts';
import { MODEL_CATALOG, semanticModelCodes } from '@causality/semantic-core';
import type { Pool } from 'pg';

import type { SemanticRepository } from './semanticTypes.js';

interface ModelRow {
  model_code: SemanticModelCode;
  revision: string;
  threshold: number;
  file_status: SemanticModelFileStatus;
  downloaded_at: Date | null;
  error: string | null;
}

interface IndexRow {
  active_model_code: SemanticModelCode | null;
  status: SemanticIndexStatus;
  state_version: number;
  processed_items: number;
  total_items: number;
  pending_items: number;
  error: string | null;
  updated_at: Date;
}

interface TaskRow {
  id: string;
  job_type: LegacySemanticTaskType;
  model_code: SemanticModelCode;
  status: LegacySemanticTaskStatus;
  processed_items: number;
  total_items: number;
  downloaded_bytes: number;
  total_bytes: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  updated_at: Date;
  completed_at: Date | null;
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toLegacyDownloadStatus(fileStatus: SemanticModelFileStatus): SemanticDownloadStatus {
  if (fileStatus === 'download_queued') return 'not_downloaded';
  if (fileStatus === 'invalid') return 'failed';
  return fileStatus;
}

function mapTask(row: TaskRow | undefined): SemanticSettingsResponse['activeTask'] {
  if (!row) return null;
  return {
    id: row.id,
    type: row.job_type,
    status: row.status,
    modelCode: row.model_code,
    processedItems: row.processed_items,
    totalItems: row.total_items,
    downloadedBytes: row.downloaded_bytes,
    totalBytes: row.total_bytes,
    createdAt: row.created_at.toISOString(),
    startedAt: toIso(row.started_at),
    updatedAt: row.updated_at.toISOString(),
    completedAt: toIso(row.completed_at),
    error: row.error,
  };
}

export class PostgresSemanticRepository implements SemanticRepository {
  public constructor(private readonly pool: Pool) {}

  public async getSettings(): Promise<SemanticSettingsResponse> {
    const [modelsResult, indexResult] = await Promise.all([
      this.pool.query<ModelRow>(
        `select model_code,
                revision,
                threshold,
                file_status,
                downloaded_at,
                error
         from semantic_model_settings`,
      ),
      this.pool.query<IndexRow>(
        `select active_model_code,
                status,
                state_version,
                processed_items,
                total_items,
                pending_items,
                error,
                updated_at
         from semantic_index_state
         where singleton_key = true`,
      ),
    ]);
    const index = indexResult.rows[0];
    if (!index) throw new Error('Missing semantic_index_state singleton');
    const modelRows = new Map(modelsResult.rows.map((row) => [row.model_code, row]));

    const activeTaskResult = index.active_model_code
      ? await this.pool.query<TaskRow>(
          `select id,
                  job_type,
                  model_code,
                  status,
                  processed_items,
                  total_items,
                  downloaded_bytes,
                  total_bytes,
                  error,
                  created_at,
                  started_at,
                  updated_at,
                  completed_at
           from semantic_jobs
           where model_code = $1
             and state_version = $2
             and (
               (job_type in ('download', 'full_index')
                 and status in ('queued', 'running', 'failed'))
               or (job_type = 'incremental' and status = 'failed')
             )
           order by
             case when job_type in ('download', 'full_index') then 0 else 1 end,
             created_at desc,
             id desc
           limit 1`,
          [index.active_model_code, index.state_version],
        )
      : undefined;

    return {
      activeModelCode: index.active_model_code,
      index: {
        status: index.status,
        processedItems: index.processed_items,
        totalItems: index.total_items,
        pendingItems: index.pending_items,
        updatedAt: index.updated_at.toISOString(),
        error: index.error,
      },
      models: semanticModelCodes.map((modelCode) => {
        const row = modelRows.get(modelCode);
        if (!row) throw new Error(`Missing semantic model setting: ${modelCode}`);
        const definition = MODEL_CATALOG[modelCode];
        if (row.revision !== definition.revision) {
          throw new Error(`Unexpected semantic model revision: ${modelCode}`);
        }
        return {
          code: modelCode,
          label: definition.label,
          description: definition.description,
          languageLabel: definition.languageLabel,
          dimensions: definition.dimensions,
          expectedDownloadBytes: definition.expectedDownloadBytes,
          threshold: row.threshold,
          downloadStatus: toLegacyDownloadStatus(row.file_status),
          downloadedAt: toIso(row.downloaded_at),
          isActive: index.active_model_code === modelCode,
          error: row.error,
        };
      }),
      activeTask: mapTask(activeTaskResult?.rows[0]),
    };
  }
}
