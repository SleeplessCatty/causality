import type {
  SemanticDownloadStatus,
  SemanticIndexStatus,
  SemanticModelCode,
  SemanticSettingsResponse,
  SemanticTaskStatus,
  SemanticTaskType,
  SemanticUseModelResponse,
} from '@causality/contracts';
import { MODEL_CATALOG, semanticModelCodes } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';

import { SemanticRepositoryError, type SemanticRepository } from './semanticTypes.js';

interface ModelRow {
  model_code: SemanticModelCode;
  revision: string;
  threshold: number;
  download_status: SemanticDownloadStatus;
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
  job_type: SemanticTaskType;
  model_code: SemanticModelCode;
  status: SemanticTaskStatus;
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

interface TargetModelRow {
  download_status: SemanticDownloadStatus;
}

interface FailedTaskRow {
  job_type: Extract<SemanticTaskType, 'download' | 'full_index'>;
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
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

async function lockIndexState(client: PoolClient): Promise<IndexRow> {
  const result = await client.query<IndexRow>(
    `select active_model_code,
            status,
            state_version,
            processed_items,
            total_items,
            pending_items,
            error,
            updated_at
     from semantic_index_state
     where singleton_key = true
     for update`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('Missing semantic_index_state singleton');
  return row;
}

async function assertNoActiveHighLevelTask(client: PoolClient): Promise<void> {
  const result = await client.query<{ id: string }>(
    `select id
     from semantic_jobs
     where job_type in ('download', 'full_index')
       and status in ('queued', 'running')
     order by created_at, id
     limit 1
     for update`,
  );
  if (result.rows.length > 0) {
    throw new SemanticRepositoryError('SEMANTIC_SWITCH_CONFLICT', '已有模型下载或索引任务正在执行');
  }
}

async function clearCurrentIndex(client: PoolClient): Promise<void> {
  await client.query(`truncate table semantic_embeddings`);
  await client.query(
    `delete from semantic_jobs
     where job_type = 'incremental'
       and status = 'queued'`,
  );
}

async function enqueueHighLevelTask(
  client: PoolClient,
  input: {
    jobType: Extract<SemanticTaskType, 'download' | 'full_index'>;
    modelCode: SemanticModelCode;
    stateVersion: number;
  },
): Promise<string> {
  const definition = MODEL_CATALOG[input.modelCode];
  const result = await client.query<{ id: string }>(
    `insert into semantic_jobs (
       job_type,
       model_code,
       status,
       state_version,
       total_bytes
     )
     values (
       $1::varchar(20),
       $2::varchar(64),
       'queued',
       $3::integer,
       $4::integer
     )
     returning id`,
    [
      input.jobType,
      input.modelCode,
      input.stateVersion,
      input.jobType === 'download' ? definition.expectedDownloadBytes : 0,
    ],
  );
  return result.rows[0]!.id;
}

async function updateRequestedState(
  client: PoolClient,
  input: {
    jobType: Extract<SemanticTaskType, 'download' | 'full_index'>;
    modelCode: SemanticModelCode;
    stateVersion: number;
  },
): Promise<void> {
  await client.query(
    `update semantic_index_state
     set active_model_code = $1::varchar(64),
         status = $2::varchar(20),
         state_version = $3::integer,
         processed_items = 0,
         total_items = 0,
         pending_items = (
           select count(*)::int
           from semantic_jobs
           where job_type = 'incremental'
             and status = 'queued'
             and model_code = $1::varchar(64)
             and state_version = $3::integer
         ),
         error = null,
         last_ready_at = null,
         updated_at = clock_timestamp()
     where singleton_key = true`,
    [
      input.modelCode,
      input.jobType === 'download' ? 'waiting_model' : 'loading',
      input.stateVersion,
    ],
  );
}

export class PostgresSemanticRepository implements SemanticRepository {
  public constructor(private readonly pool: Pool) {}

  public async getSettings(): Promise<SemanticSettingsResponse> {
    const [modelsResult, indexResult] = await Promise.all([
      this.pool.query<ModelRow>(
        `select model_code,
                revision,
                threshold,
                download_status,
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

    const activeTaskResult =
      index.active_model_code && index.status !== 'ready'
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
             and job_type in ('download', 'full_index')
             and status in ('queued', 'running', 'failed')
           order by created_at desc, id desc
           limit 1`,
            [index.active_model_code],
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
          downloadStatus: row.download_status,
          downloadedAt: toIso(row.downloaded_at),
          isActive: index.active_model_code === modelCode,
          error: row.error,
        };
      }),
      activeTask: mapTask(activeTaskResult?.rows[0]),
    };
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

  public requestUseModel(modelCode: SemanticModelCode): Promise<SemanticUseModelResponse> {
    return this.withTransaction(async (client) => {
      const state = await lockIndexState(client);
      await assertNoActiveHighLevelTask(client);
      const targetResult = await client.query<TargetModelRow>(
        `select download_status
         from semantic_model_settings
         where model_code = $1
         for update`,
        [modelCode],
      );
      const target = targetResult.rows[0];
      if (!target) {
        throw new SemanticRepositoryError('SEMANTIC_MODEL_UNAVAILABLE', '语义模型配置不存在');
      }

      const jobType = target.download_status === 'downloaded' ? 'full_index' : 'download';
      const stateVersion = state.state_version + 1;
      await clearCurrentIndex(client);
      await client.query(
        `update semantic_model_settings
         set download_status = case
               when download_status = 'failed' then 'not_downloaded'
               else download_status
             end,
             downloaded_at = case
               when download_status = 'failed' then null
               else downloaded_at
             end,
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [modelCode],
      );
      await updateRequestedState(client, { jobType, modelCode, stateVersion });
      const taskId = await enqueueHighLevelTask(client, { jobType, modelCode, stateVersion });
      return { accepted: true, taskId, activeModelCode: modelCode };
    });
  }

  public requestReindex(): Promise<SemanticUseModelResponse> {
    return this.withTransaction(async (client) => {
      const state = await lockIndexState(client);
      await assertNoActiveHighLevelTask(client);
      if (!state.active_model_code) {
        throw new SemanticRepositoryError(
          'SEMANTIC_MODEL_UNAVAILABLE',
          '当前没有正在使用的语义模型',
        );
      }

      const targetResult = await client.query<TargetModelRow>(
        `select download_status
         from semantic_model_settings
         where model_code = $1
         for update`,
        [state.active_model_code],
      );
      if (targetResult.rows[0]?.download_status !== 'downloaded') {
        throw new SemanticRepositoryError('SEMANTIC_MODEL_UNAVAILABLE', '当前语义模型尚未下载完成');
      }

      const stateVersion = state.state_version + 1;
      await clearCurrentIndex(client);
      await client.query(
        `update semantic_model_settings
         set error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [state.active_model_code],
      );
      await updateRequestedState(client, {
        jobType: 'full_index',
        modelCode: state.active_model_code,
        stateVersion,
      });
      const taskId = await enqueueHighLevelTask(client, {
        jobType: 'full_index',
        modelCode: state.active_model_code,
        stateVersion,
      });
      return { accepted: true, taskId, activeModelCode: state.active_model_code };
    });
  }

  public retryLatestFailure(): Promise<SemanticUseModelResponse> {
    return this.withTransaction(async (client) => {
      const state = await lockIndexState(client);
      await assertNoActiveHighLevelTask(client);
      if (!state.active_model_code) {
        throw new SemanticRepositoryError('SEMANTIC_MODEL_UNAVAILABLE', '当前没有可重试的语义模型');
      }

      const failedResult = await client.query<FailedTaskRow>(
        `select job_type
         from semantic_jobs
         where model_code = $1
           and job_type in ('download', 'full_index')
           and status = 'failed'
         order by completed_at desc, id desc
         limit 1
         for update`,
        [state.active_model_code],
      );
      const failed = failedResult.rows[0];
      if (!failed) {
        throw new SemanticRepositoryError('SEMANTIC_INDEX_FAILED', '没有可重试的失败任务');
      }

      await clearCurrentIndex(client);
      await client.query(
        `update semantic_model_settings
         set download_status = case
               when $2::varchar(20) = 'download' then 'not_downloaded'
               else download_status
             end,
             downloaded_at = case
               when $2::varchar(20) = 'download' then null
               else downloaded_at
             end,
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [state.active_model_code, failed.job_type],
      );
      await updateRequestedState(client, {
        jobType: failed.job_type,
        modelCode: state.active_model_code,
        stateVersion: state.state_version,
      });
      const taskId = await enqueueHighLevelTask(client, {
        jobType: failed.job_type,
        modelCode: state.active_model_code,
        stateVersion: state.state_version,
      });
      return { accepted: true, taskId, activeModelCode: state.active_model_code };
    });
  }

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
