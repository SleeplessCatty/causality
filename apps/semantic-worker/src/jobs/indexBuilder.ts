import { join } from 'node:path';

import type { SemanticEntityType } from '@causality/contracts';
import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';
import { toSql } from 'pgvector';

import { PostgresIncrementalIndexDrain } from './incrementalIndexDrain.js';
import type { SemanticIndexJob } from './jobRepository.js';
import type { SemanticSourceRecord, SemanticSourceRepository } from './semanticSourceRepository.js';
import type { EmbeddingRuntime } from '../model/modelRuntime.js';

export interface IndexBuilder {
  buildFull(job: SemanticIndexJob): Promise<void>;
  buildIncremental(job: SemanticIndexJob): Promise<void>;
}

export interface PostgresIndexBuilderOptions {
  pool: Pool;
  sourceRepository: SemanticSourceRepository;
  runtime: EmbeddingRuntime;
  modelsDirectory: string;
  drainedIncrementalLeaseMilliseconds?: number;
  onModelLoading?: () => void | Promise<void>;
  onModelReady?: (modelCode: SemanticIndexJob['modelCode']) => void | Promise<void>;
}

interface IndexStateRow {
  active_model_code: SemanticIndexJob['modelCode'] | null;
  state_version: number;
  status: string;
}

type StableWriteResult = 'written' | 'deleted' | 'changed' | 'stale';

const entityTypes = ['event', 'relation', 'case'] as const satisfies readonly SemanticEntityType[];

export function semanticIndexBatchSize(modelCode: SemanticIndexJob['modelCode']): number {
  if (modelCode === 'bge-m3') return 1;
  if (modelCode === 'bge-small-zh-v1.5') return 8;
  return 4;
}

function vectorDimensions(vector: readonly number[], expected: number): void {
  if (vector.length !== expected || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Semantic index vector must contain ${expected} finite dimensions`);
  }
}

async function lockBusinessSource(
  client: PoolClient,
  entityType: SemanticEntityType,
  entityId: string,
): Promise<boolean> {
  if (entityType === 'event') {
    const event = await client.query(
      `select id
       from abstract_events
       where id = $1
       for update`,
      [entityId],
    );
    if (event.rowCount !== 1) return false;
    await client.query(
      `select id
       from event_aliases
       where event_id = $1
       order by id
       for share`,
      [entityId],
    );
    await client.query(
      `select id
       from event_keywords
       where event_id = $1
       order by id
       for share`,
      [entityId],
    );
    return true;
  }

  if (entityType === 'relation') {
    const relation = await client.query(
      `select relation.id
       from causal_relations as relation
       join abstract_events as cause
         on cause.id = relation.cause_event_id
       join abstract_events as effect
         on effect.id = relation.effect_event_id
       where relation.id = $1
       for share of relation, cause, effect`,
      [entityId],
    );
    return relation.rowCount === 1;
  }

  const concreteCase = await client.query(
    `select id
     from concrete_cases
     where id = $1
     for share`,
    [entityId],
  );
  return concreteCase.rowCount === 1;
}

export class PostgresIndexBuilder implements IndexBuilder {
  private readonly incrementalDrain: PostgresIncrementalIndexDrain;

  public constructor(private readonly options: PostgresIndexBuilderOptions) {
    this.incrementalDrain = new PostgresIncrementalIndexDrain(
      options.pool,
      options.drainedIncrementalLeaseMilliseconds,
    );
  }

  public async buildFull(job: SemanticIndexJob): Promise<void> {
    if (job.jobType !== 'full_index') throw new Error('Expected a full-index job');
    if (!(await this.isCurrent(job))) return;

    const model = MODEL_CATALOG[job.modelCode];
    const target = join(this.options.modelsDirectory, model.code, model.revision);
    await this.options.pool.query(
      `update semantic_index_state
       set status = 'loading',
           processed_items = 0,
           total_items = 0,
           pending_items = 0,
           error = null,
           updated_at = clock_timestamp()
       where singleton_key = true
         and active_model_code = $1
         and state_version = $2`,
      [job.modelCode, job.stateVersion],
    );
    await this.options.onModelLoading?.();
    await this.options.runtime.load(model, target);
    if (!(await this.isCurrent(job))) return;

    if (!(await this.resetCurrentIndex(job))) return;
    let totalItems = await this.countSources();
    await this.options.pool.query(
      `update semantic_index_state
       set status = 'building',
           processed_items = 0,
           total_items = $3,
           pending_items = (
             select count(*)::int
             from semantic_jobs
             where job_type = 'incremental'
               and status in ('queued', 'running')
               and model_code = $1
               and state_version = $2
           ),
           error = null,
           updated_at = clock_timestamp()
       where singleton_key = true
         and active_model_code = $1
         and state_version = $2`,
      [job.modelCode, job.stateVersion, totalItems],
    );
    await this.options.pool.query(
      `update semantic_jobs
       set processed_items = 0,
           total_items = $2,
           updated_at = clock_timestamp()
       where id = $1
         and job_type = 'full_index'
         and status = 'running'`,
      [job.id, totalItems],
    );

    let processedItems = 0;
    let lastReportedItems = 0;
    let lastProgressUpdateAt = Number.NEGATIVE_INFINITY;
    for (const entityType of entityTypes) {
      let afterId: string | null = null;
      while (true) {
        if (!(await this.isCurrent(job))) return;
        const batch = await this.options.sourceRepository.loadBatch(
          entityType,
          afterId,
          semanticIndexBatchSize(job.modelCode),
        );
        if (batch.length === 0) {
          if (processedItems !== lastReportedItems) {
            await this.updateFullProgress(job, processedItems, totalItems);
            lastReportedItems = processedItems;
            lastProgressUpdateAt = Date.now();
          }
          break;
        }
        const vectors = await this.options.runtime.embedDocuments(
          batch.map((record) => record.document),
        );
        if (vectors.length !== batch.length) {
          throw new Error('Semantic runtime returned an unexpected batch size');
        }
        for (let index = 0; index < batch.length; index += 1) {
          const vector = vectors[index]!;
          vectorDimensions(vector, model.dimensions);
        }
        await this.writeStableRecords(job, batch, vectors);
        processedItems += batch.length;
        totalItems = Math.max(totalItems, processedItems);
        afterId = batch.at(-1)!.entityId;
        const now = Date.now();
        if (now - lastProgressUpdateAt >= 500) {
          await this.updateFullProgress(job, processedItems, totalItems);
          lastReportedItems = processedItems;
          lastProgressUpdateAt = now;
        }
      }
    }

    for (let publishAttempt = 0; publishAttempt < 10; publishAttempt += 1) {
      await this.incrementalDrain.drain(job, (incremental) => this.buildIncremental(incremental));
      const validatedItems = await this.validateCompleteIndex(job);
      await this.updateFullProgress(job, validatedItems, validatedItems);
      const published = await this.options.pool.query(
        `update semantic_index_state
         set status = 'ready',
             processed_items = $3,
             total_items = $3,
             pending_items = 0,
             error = null,
             last_ready_at = clock_timestamp(),
             updated_at = clock_timestamp()
         where singleton_key = true
           and active_model_code = $1
           and state_version = $2
           and not exists (
             select 1
             from semantic_jobs
             where job_type = 'incremental'
               and status in ('queued', 'running')
               and model_code = $1
               and state_version = $2
           )`,
        [job.modelCode, job.stateVersion, validatedItems],
      );
      if (published.rowCount === 1) {
        await this.options.onModelReady?.(job.modelCode);
        return;
      }
    }
    throw new Error('Semantic index kept changing during final publication');
  }

  public async buildIncremental(job: SemanticIndexJob): Promise<void> {
    if (job.jobType !== 'incremental' || !job.entityType || !job.entityId) {
      throw new Error('Expected a targeted incremental-index job');
    }
    if (!(await this.isCurrent(job))) return;

    const model = MODEL_CATALOG[job.modelCode];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const source = await this.options.sourceRepository.load(job.entityType, job.entityId);
      if (!source) {
        const result = await this.deleteMissingRecord(job);
        if (result === 'changed') continue;
        return;
      }
      const [vector] = await this.options.runtime.embedDocuments([source.document]);
      if (!vector) throw new Error('Semantic runtime did not return an incremental vector');
      vectorDimensions(vector, model.dimensions);
      const result = await this.writeStableRecord(job, source, vector);
      if (result === 'written' || result === 'deleted' || result === 'stale') {
        await this.refreshIncrementalState(job);
        return;
      }
    }
    throw new Error('Semantic source changed repeatedly during incremental indexing');
  }

  private async isCurrent(job: SemanticIndexJob): Promise<boolean> {
    const result = await this.options.pool.query<IndexStateRow>(
      `select active_model_code,
              state_version,
              status
       from semantic_index_state
       where singleton_key = true`,
    );
    const state = result.rows[0];
    return state?.active_model_code === job.modelCode && state.state_version === job.stateVersion;
  }

  private async countSources(): Promise<number> {
    const result = await this.options.pool.query<{ count: number }>(
      `select (
         (select count(*) from abstract_events)
         + (select count(*) from causal_relations)
         + (select count(*) from concrete_cases)
       )::int as count`,
    );
    return result.rows[0]?.count ?? 0;
  }

  private async resetCurrentIndex(job: SemanticIndexJob): Promise<boolean> {
    const client = await this.options.pool.connect();
    try {
      await client.query('begin');
      const state = await client.query<IndexStateRow>(
        `select active_model_code,
                state_version,
                status
         from semantic_index_state
         where singleton_key = true
         for update`,
      );
      if (
        state.rows[0]?.active_model_code !== job.modelCode ||
        state.rows[0]?.state_version !== job.stateVersion
      ) {
        await client.query('rollback');
        return false;
      }
      await client.query(`delete from semantic_embeddings`);
      await client.query(
        `delete from semantic_jobs
         where job_type = 'incremental'
           and status = 'queued'
           and (
             model_code <> $1
             or state_version <> $2
           )`,
        [job.modelCode, job.stateVersion],
      );
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateFullProgress(
    job: SemanticIndexJob,
    processedItems: number,
    totalItems: number,
  ): Promise<void> {
    await this.options.pool.query(
      `update semantic_index_state
       set processed_items = $3,
           total_items = $4,
           updated_at = clock_timestamp()
       where singleton_key = true
         and active_model_code = $1
         and state_version = $2`,
      [job.modelCode, job.stateVersion, processedItems, totalItems],
    );
    await this.options.pool.query(
      `update semantic_jobs
       set processed_items = $2,
           total_items = $3,
           updated_at = clock_timestamp()
       where id = $1
         and job_type = 'full_index'
         and status = 'running'`,
      [job.id, processedItems, totalItems],
    );
  }

  private async writeStableRecord(
    job: SemanticIndexJob,
    source: SemanticSourceRecord,
    vector: readonly number[],
  ): Promise<StableWriteResult> {
    return (await this.writeStableRecords(job, [source], [vector]))[0]!;
  }

  private async writeStableRecords(
    job: SemanticIndexJob,
    sources: readonly SemanticSourceRecord[],
    vectors: readonly (readonly number[])[],
  ): Promise<StableWriteResult[]> {
    if (sources.length !== vectors.length) {
      throw new Error('Semantic stable-write batch size does not match its vectors');
    }
    if (sources.length === 0) return [];

    const client = await this.options.pool.connect();
    try {
      await client.query('begin');
      const existence: boolean[] = [];
      for (const source of sources) {
        existence.push(await lockBusinessSource(client, source.entityType, source.entityId));
      }
      const state = await client.query<IndexStateRow>(
        `select active_model_code,
                state_version,
                status
         from semantic_index_state
         where singleton_key = true
         for update`,
      );
      if (
        state.rows[0]?.active_model_code !== job.modelCode ||
        state.rows[0]?.state_version !== job.stateVersion
      ) {
        await client.query('rollback');
        return sources.map(() => 'stale');
      }

      const results: StableWriteResult[] = [];
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index]!;
        if (!existence[index]) {
          await client.query(
            `delete from semantic_embeddings
             where entity_type = $1
               and entity_id = $2`,
            [source.entityType, source.entityId],
          );
          results.push('deleted');
          continue;
        }

        const current = await this.options.sourceRepository.load(
          source.entityType,
          source.entityId,
        );
        if (!current || current.sourceHash !== source.sourceHash) {
          results.push('changed');
          continue;
        }
        await client.query(
          `insert into semantic_embeddings (
             entity_type,
             entity_id,
             model_code,
             source_hash,
             embedding,
             generated_at
           )
           values ($1, $2, $3, $4, $5::vector, clock_timestamp())
           on conflict (entity_type, entity_id)
           do update set
             model_code = excluded.model_code,
             source_hash = excluded.source_hash,
             embedding = excluded.embedding,
             generated_at = excluded.generated_at`,
          [
            source.entityType,
            source.entityId,
            job.modelCode,
            source.sourceHash,
            toSql([...vectors[index]!]),
          ],
        );
        await this.deleteCoveredQueuedJob(client, job, source.entityType, source.entityId);
        results.push('written');
      }
      await client.query('commit');
      return results;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteCoveredQueuedJob(
    client: PoolClient,
    job: SemanticIndexJob,
    entityType: SemanticEntityType,
    entityId: string,
  ): Promise<void> {
    await client.query(
      `delete from semantic_jobs
       where job_type = 'incremental'
         and status = 'queued'
         and model_code = $1
         and state_version = $2
         and entity_type = $3
         and entity_id = $4
         and id <> $5`,
      [job.modelCode, job.stateVersion, entityType, entityId, job.id],
    );
  }

  private async deleteMissingRecord(
    job: SemanticIndexJob,
  ): Promise<Extract<StableWriteResult, 'deleted' | 'changed' | 'stale'>> {
    if (!job.entityType || !job.entityId) return 'stale';
    const client = await this.options.pool.connect();
    try {
      await client.query('begin');
      const state = await client.query<IndexStateRow>(
        `select active_model_code,
                state_version,
                status
         from semantic_index_state
         where singleton_key = true
         for update`,
      );
      if (
        state.rows[0]?.active_model_code !== job.modelCode ||
        state.rows[0]?.state_version !== job.stateVersion
      ) {
        await client.query('rollback');
        return 'stale';
      }
      const current = await this.options.sourceRepository.load(job.entityType, job.entityId);
      if (current) {
        await client.query('rollback');
        return 'changed';
      }
      await client.query(
        `delete from semantic_embeddings
         where entity_type = $1
           and entity_id = $2`,
        [job.entityType, job.entityId],
      );
      await client.query('commit');
      await this.refreshIncrementalState(job);
      return 'deleted';
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async refreshIncrementalState(job: SemanticIndexJob): Promise<void> {
    await this.options.pool.query(
      `update semantic_index_state
       set pending_items = (
             select count(*)::int
             from semantic_jobs
             where job_type = 'incremental'
               and status in ('queued', 'running')
               and model_code = $1
               and state_version = $2
           ),
           status = case
             when status in ('ready', 'updating') then 'updating'
             else status
           end,
           updated_at = clock_timestamp()
       where singleton_key = true
         and active_model_code = $1
         and state_version = $2`,
      [job.modelCode, job.stateVersion],
    );
  }

  private async validateCompleteIndex(job: SemanticIndexJob): Promise<number> {
    const expectedDimensions = MODEL_CATALOG[job.modelCode].dimensions;
    let sourceCount = 0;
    for (const entityType of entityTypes) {
      let afterId: string | null = null;
      while (true) {
        const sources = await this.options.sourceRepository.loadBatch(entityType, afterId, 1_000);
        if (sources.length === 0) break;
        const embeddings = await this.options.pool.query<{
          entity_id: string;
          model_code: SemanticIndexJob['modelCode'];
          source_hash: string;
          dimensions: number;
        }>(
          `select entity_id,
                  model_code,
                  source_hash,
                  vector_dims(embedding)::int as dimensions
           from semantic_embeddings
           where entity_type = $1
             and entity_id = any($2::uuid[])`,
          [entityType, sources.map((source) => source.entityId)],
        );
        if (sources.length !== embeddings.rows.length) {
          throw new Error('Semantic index record count does not match business records');
        }
        const embeddingById = new Map(
          embeddings.rows.map((embedding) => [embedding.entity_id, embedding]),
        );
        for (const source of sources) {
          const embedding = embeddingById.get(source.entityId);
          if (
            !embedding ||
            embedding.model_code !== job.modelCode ||
            embedding.dimensions !== expectedDimensions ||
            embedding.source_hash !== source.sourceHash
          ) {
            throw new Error(
              `Semantic index validation failed for ${entityType}:${source.entityId}`,
            );
          }
        }
        sourceCount += sources.length;
        afterId = sources.at(-1)!.entityId;
      }
    }
    const embeddingCount = await this.options.pool.query<{ count: number }>(
      `select count(*)::int as count
       from semantic_embeddings`,
    );
    if (embeddingCount.rows[0]?.count !== sourceCount) {
      throw new Error('Semantic index record count does not match business records');
    }
    return sourceCount;
  }
}
