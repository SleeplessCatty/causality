import type {
  SemanticAction,
  SemanticActionAccepted,
  SemanticModelCode,
  SemanticModelFileStatus,
  SemanticTaskType,
} from '@causality/contracts';
import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';

import { readSemanticLifecycleFacts } from './semanticLifecycleRepository.js';
import { resolveSemanticAllowedActions } from './semanticLifecycleResolver.js';
import { SemanticRepositoryError, type SemanticCommandRepository } from './semanticTypes.js';

type HighLevelJobType = Extract<SemanticTaskType, 'download' | 'load' | 'full_index'>;

interface IndexRow {
  active_model_code: SemanticModelCode | null;
  state_version: number;
}

interface ModelRow {
  file_status: SemanticModelFileStatus;
}

interface JobRow {
  id: string;
}

const ACTIVE_HIGH_LEVEL_STATUSES = ['queued', 'running', 'retry_wait'] as const;

function actionNotAllowed(action: SemanticAction): SemanticRepositoryError {
  return new SemanticRepositoryError(
    'SEMANTIC_ACTION_NOT_ALLOWED',
    `当前模型状态不允许执行操作：${action}`,
  );
}

async function lockIndexState(client: PoolClient): Promise<IndexRow> {
  const result = await client.query<IndexRow>(
    `select active_model_code, state_version
     from semantic_index_state
     where singleton_key = true
     for update`,
  );
  const state = result.rows[0];
  if (!state) throw new Error('Missing semantic_index_state singleton');
  return state;
}

async function lockModel(client: PoolClient, modelCode: SemanticModelCode): Promise<ModelRow> {
  const result = await client.query<ModelRow>(
    `select file_status
     from semantic_model_settings
     where model_code = $1
     for update`,
    [modelCode],
  );
  const model = result.rows[0];
  if (!model) {
    throw new SemanticRepositoryError('SEMANTIC_MODEL_UNAVAILABLE', '语义模型配置不存在');
  }
  return model;
}

async function findActiveJob(
  client: PoolClient,
  input: {
    jobType: HighLevelJobType;
    modelCode: SemanticModelCode;
    stateVersion: number;
  },
): Promise<string | null> {
  const result = await client.query<JobRow>(
    `select id
     from semantic_jobs
     where job_type = $1
       and model_code = $2
       and state_version = $3
       and status in ('queued', 'running', 'retry_wait')
     order by created_at, id
     limit 1
     for update`,
    [input.jobType, input.modelCode, input.stateVersion],
  );
  return result.rows[0]?.id ?? null;
}

async function assertNoActiveHighLevelJob(client: PoolClient, state: IndexRow): Promise<void> {
  if (!state.active_model_code) return;
  const result = await client.query<JobRow>(
    `select id
     from semantic_jobs
     where job_type in ('download', 'load', 'full_index')
       and model_code = $2
       and state_version = $3
       and status = any($1::varchar[])
     order by created_at, id
     limit 1
     for update`,
    [ACTIVE_HIGH_LEVEL_STATUSES, state.active_model_code, state.state_version],
  );
  if (result.rows.length > 0) {
    throw new SemanticRepositoryError(
      'SEMANTIC_HIGH_LEVEL_TASK_ACTIVE',
      '已有模型下载、加载或全量索引任务正在执行',
    );
  }
}

async function assertAllowed(
  client: PoolClient,
  modelCode: SemanticModelCode,
  expected: readonly SemanticAction[],
): Promise<void> {
  const facts = await readSemanticLifecycleFacts(client);
  const allowed = resolveSemanticAllowedActions(facts, modelCode);
  if (!expected.some((action) => allowed.includes(action))) {
    throw actionNotAllowed(expected[0]!);
  }
}

async function clearIndexAndJobs(client: PoolClient): Promise<void> {
  await client.query(`truncate table semantic_embeddings`);
  await client.query(`delete from semantic_jobs`);
}

async function clearIndex(client: PoolClient): Promise<void> {
  await client.query(`truncate table semantic_embeddings`);
}

async function resetIndexState(
  client: PoolClient,
  input: {
    modelCode: SemanticModelCode;
    stateVersion: number;
    status: 'waiting_model' | 'loading' | 'index_queued';
  },
): Promise<void> {
  await client.query(
    `update semantic_index_state
     set active_model_code = $1,
         status = $2,
         state_version = $3,
         processed_items = 0,
         total_items = 0,
         pending_items = 0,
         failed_items = 0,
         failure_stage = null,
         failure_kind = null,
         failure_code = null,
         error = null,
         last_ready_at = null,
         updated_at = clock_timestamp()
     where singleton_key = true`,
    [input.modelCode, input.status, input.stateVersion],
  );
}

async function queueJob(
  client: PoolClient,
  input: {
    jobType: HighLevelJobType;
    modelCode: SemanticModelCode;
    stateVersion: number;
  },
): Promise<string> {
  const result = await client.query<JobRow>(
    `insert into semantic_jobs (
       job_type,
       model_code,
       status,
       phase,
       state_version,
       total_bytes
     )
     values ($1, $2, 'queued', 'waiting', $3, $4)
     returning id`,
    [
      input.jobType,
      input.modelCode,
      input.stateVersion,
      input.jobType === 'download' ? MODEL_CATALOG[input.modelCode].expectedDownloadBytes : 0,
    ],
  );
  return result.rows[0]!.id;
}

async function requeueFailedJob(
  client: PoolClient,
  input: {
    jobType: HighLevelJobType;
    modelCode: SemanticModelCode;
    stateVersion: number;
  },
): Promise<string> {
  const failed = await client.query<JobRow>(
    `select id
     from semantic_jobs
     where job_type = $1
       and model_code = $2
       and state_version = $3
       and status = 'failed'
     order by completed_at desc, id desc
     limit 1
     for update`,
    [input.jobType, input.modelCode, input.stateVersion],
  );
  const job = failed.rows[0];
  if (!job) throw actionNotAllowed(retryAction(input.jobType));

  await client.query(
    `update semantic_jobs
     set status = 'queued',
         phase = 'waiting',
         processed_items = 0,
         total_items = 0,
         downloaded_bytes = 0,
         total_bytes = $2,
         attempts = 0,
         lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = null,
         failure_kind = null,
         failure_code = null,
         error = null,
         started_at = null,
         completed_at = null,
         updated_at = clock_timestamp()
     where id = $1`,
    [
      job.id,
      input.jobType === 'download' ? MODEL_CATALOG[input.modelCode].expectedDownloadBytes : 0,
    ],
  );
  return job.id;
}

function retryAction(jobType: HighLevelJobType): SemanticAction {
  if (jobType === 'download') return 'retry_download';
  if (jobType === 'load') return 'retry_load';
  return 'retry_full_index';
}

function accepted(taskId: string, activeModelCode: SemanticModelCode): SemanticActionAccepted {
  return { accepted: true, taskId, activeModelCode };
}

export class PostgresSemanticCommandRepository implements SemanticCommandRepository {
  public constructor(private readonly pool: Pool) {}

  public useModel(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.withTransaction(async (client) => {
      const state = await lockIndexState(client);
      const model = await lockModel(client, modelCode);
      const jobType: HighLevelJobType = model.file_status === 'downloaded' ? 'load' : 'download';
      const duplicate =
        state.active_model_code === modelCode
          ? await findActiveJob(client, {
              jobType,
              modelCode,
              stateVersion: state.state_version,
            })
          : null;
      if (duplicate) return accepted(duplicate, modelCode);

      await assertNoActiveHighLevelJob(client, state);
      await assertAllowed(client, modelCode, ['download_and_use', 'use']);

      const stateVersion = state.state_version + 1;
      await clearIndexAndJobs(client);
      if (jobType === 'download') {
        await client.query(
          `update semantic_model_settings
           set file_status = 'download_queued',
               downloaded_at = null,
               failure_kind = null,
               failure_code = null,
               error = null,
               updated_at = clock_timestamp()
           where model_code = $1`,
          [modelCode],
        );
      } else {
        await client.query(
          `update semantic_model_settings
           set failure_kind = null,
               failure_code = null,
               error = null,
               updated_at = clock_timestamp()
           where model_code = $1`,
          [modelCode],
        );
      }
      await resetIndexState(client, {
        modelCode,
        stateVersion,
        status: jobType === 'download' ? 'waiting_model' : 'loading',
      });
      const taskId = await queueJob(client, { jobType, modelCode, stateVersion });
      return accepted(taskId, modelCode);
    });
  }

  public retryDownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.retryStage(modelCode, 'download');
  }

  public redownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.withTransaction(async (client) => {
      const state = await lockIndexState(client);
      await lockModel(client, modelCode);
      const duplicate =
        state.active_model_code === modelCode
          ? await findActiveJob(client, {
              jobType: 'download',
              modelCode,
              stateVersion: state.state_version,
            })
          : null;
      if (duplicate) return accepted(duplicate, modelCode);

      await assertNoActiveHighLevelJob(client, state);
      await assertAllowed(client, modelCode, ['redownload_and_use']);
      const stateVersion = state.state_version + 1;
      await clearIndexAndJobs(client);
      await client.query(
        `update semantic_model_settings
         set file_status = 'download_queued',
             downloaded_at = null,
             failure_kind = null,
             failure_code = null,
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [modelCode],
      );
      await resetIndexState(client, {
        modelCode,
        stateVersion,
        status: 'waiting_model',
      });
      const taskId = await queueJob(client, {
        jobType: 'download',
        modelCode,
        stateVersion,
      });
      return accepted(taskId, modelCode);
    });
  }

  public retryLoad(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.retryStage(modelCode, 'load');
  }

  public retryFullIndex(modelCode: SemanticModelCode): Promise<SemanticActionAccepted> {
    return this.retryStage(modelCode, 'full_index');
  }

  public reindex(): Promise<SemanticActionAccepted> {
    return this.withTransaction(async (client) => {
      const state = await lockIndexState(client);
      if (!state.active_model_code) {
        throw new SemanticRepositoryError(
          'SEMANTIC_MODEL_NOT_CURRENT',
          '当前没有正在使用的语义模型',
        );
      }
      const modelCode = state.active_model_code;
      await lockModel(client, modelCode);
      const duplicate = await findActiveJob(client, {
        jobType: 'load',
        modelCode,
        stateVersion: state.state_version,
      });
      if (duplicate) return accepted(duplicate, modelCode);

      await assertNoActiveHighLevelJob(client, state);
      await assertAllowed(client, modelCode, ['reindex']);
      const stateVersion = state.state_version + 1;
      await clearIndexAndJobs(client);
      await client.query(
        `update semantic_model_settings
         set failure_kind = null,
             failure_code = null,
             error = null,
             updated_at = clock_timestamp()
         where model_code = $1`,
        [modelCode],
      );
      await resetIndexState(client, { modelCode, stateVersion, status: 'loading' });
      const taskId = await queueJob(client, {
        jobType: 'load',
        modelCode,
        stateVersion,
      });
      return accepted(taskId, modelCode);
    });
  }

  private retryStage(
    modelCode: SemanticModelCode,
    jobType: HighLevelJobType,
  ): Promise<SemanticActionAccepted> {
    return this.withTransaction(async (client) => {
      const state = await lockIndexState(client);
      await lockModel(client, modelCode);
      if (state.active_model_code !== modelCode) {
        throw new SemanticRepositoryError(
          'SEMANTIC_MODEL_NOT_CURRENT',
          '只能重试当前模型的失败阶段',
        );
      }
      const duplicate = await findActiveJob(client, {
        jobType,
        modelCode,
        stateVersion: state.state_version,
      });
      if (duplicate) return accepted(duplicate, modelCode);

      await assertNoActiveHighLevelJob(client, state);
      const action = retryAction(jobType);
      await assertAllowed(client, modelCode, [action]);
      if (jobType === 'full_index') await clearIndex(client);
      const taskId = await requeueFailedJob(client, {
        jobType,
        modelCode,
        stateVersion: state.state_version,
      });

      if (jobType === 'download') {
        await client.query(
          `update semantic_model_settings
           set file_status = 'download_queued',
               downloaded_at = null,
               failure_kind = null,
               failure_code = null,
               error = null,
               updated_at = clock_timestamp()
           where model_code = $1`,
          [modelCode],
        );
      }
      await resetIndexState(client, {
        modelCode,
        stateVersion: state.state_version,
        status:
          jobType === 'download'
            ? 'waiting_model'
            : jobType === 'load'
              ? 'loading'
              : 'index_queued',
      });
      return accepted(taskId, modelCode);
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
