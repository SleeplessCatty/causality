import type { SemanticEntityType } from '@causality/contracts';
import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool, PoolClient } from 'pg';
import { toSql } from 'pgvector';

import { PostgresIncrementalIndexDrain } from './incrementalIndexDrain.js';
import {
  classifySemanticFailure,
  IndexValidationFailedError,
  SourceEmbeddingFailedError,
  VectorDimensionInvalidError,
  VectorValueInvalidError,
} from './failureClassifier.js';
import type { IndexStateRepository, SemanticIndexJob } from './jobTypes.js';
import { boundedJobError, WorkerLeaseLostError } from './postgresJobSupport.js';
import type { SemanticSourceRecord, SemanticSourceRepository } from './semanticSourceRepository.js';
import type { EmbeddingRuntime } from '../model/modelRuntime.js';

export interface IndexBuilder {
  buildFull(job: SemanticIndexJob, assertLeaseValid: () => void): Promise<void>;
  buildIncremental(job: SemanticIndexJob, assertLeaseValid: () => void): Promise<void>;
}

export interface PostgresIndexBuilderOptions {
  pool: Pool;
  stateRepository: IndexStateRepository;
  sourceRepository: SemanticSourceRepository;
  runtime: EmbeddingRuntime;
  drainedIncrementalLeaseMilliseconds?: number;
}

interface IndexStateRow {
  active_model_code: SemanticIndexJob['modelCode'] | null;
  state_version: number;
  status: string;
}

interface CompleteIndexValidation {
  indexedItems: number;
  failedItems: number;
}

type StableWriteResult = 'written' | 'deleted' | 'changed' | 'stale';

const entityTypes = ['event', 'relation', 'case'] as const satisfies readonly SemanticEntityType[];

export function semanticIndexBatchSize(modelCode: SemanticIndexJob['modelCode']): number {
  if (modelCode === 'bge-m3') return 1;
  if (modelCode === 'bge-small-zh-v1.5') return 8;
  return 4;
}

function vectorDimensions(vector: readonly number[], expected: number): void {
  if (vector.length !== expected) throw new VectorDimensionInvalidError(expected, vector.length);
  if (vector.some((value) => !Number.isFinite(value))) throw new VectorValueInvalidError();
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

  public async buildFull(
    job: SemanticIndexJob,
    assertLeaseValid: () => void = () => undefined,
  ): Promise<void> {
    if (job.jobType !== 'full_index') throw new Error('Expected a full-index job');
    assertLeaseValid();
    if (!(await this.options.stateRepository.isCurrent(job))) return;

    const model = MODEL_CATALOG[job.modelCode];
    let totalItems = await this.countSources();
    assertLeaseValid();
    await this.options.stateRepository.beginFullBuild(job, totalItems);
    if (!(await this.options.stateRepository.isCurrent(job))) return;

    let processedItems = 0;
    let lastReportedItems = 0;
    let lastProgressUpdateAt = Number.NEGATIVE_INFINITY;
    for (const entityType of entityTypes) {
      let afterId: string | null = null;
      while (true) {
        if (!(await this.options.stateRepository.isCurrent(job))) return;
        const batch = await this.options.sourceRepository.loadBatch(
          entityType,
          afterId,
          semanticIndexBatchSize(job.modelCode),
        );
        if (batch.length === 0) {
          if (processedItems !== lastReportedItems) {
            await this.updateFullProgress(job, processedItems, totalItems, assertLeaseValid);
            lastReportedItems = processedItems;
            lastProgressUpdateAt = Date.now();
          }
          break;
        }
        processedItems += await this.indexFullBatch(job, batch, model.dimensions, assertLeaseValid);
        totalItems = Math.max(totalItems, processedItems);
        afterId = batch.at(-1)!.entityId;
        const now = Date.now();
        if (now - lastProgressUpdateAt >= 500) {
          await this.updateFullProgress(job, processedItems, totalItems, assertLeaseValid);
          lastReportedItems = processedItems;
          lastProgressUpdateAt = now;
        }
      }
    }

    for (let publishAttempt = 0; publishAttempt < 10; publishAttempt += 1) {
      await this.incrementalDrain.drain(job, (incremental, assertIncrementalLeaseValid) =>
        this.buildIncremental(incremental, () => {
          assertLeaseValid();
          assertIncrementalLeaseValid();
        }),
      );
      const validation = await this.validateCompleteIndex(job);
      await this.updateFullProgress(
        job,
        validation.indexedItems,
        validation.indexedItems + validation.failedItems,
        assertLeaseValid,
      );
      assertLeaseValid();
      const published = await this.options.stateRepository.publishIndex(
        job,
        validation.indexedItems,
        validation.failedItems,
      );
      if (published) return;
    }
    throw new IndexValidationFailedError('Semantic index kept changing during final publication');
  }

  public async buildIncremental(
    job: SemanticIndexJob,
    assertLeaseValid: () => void = () => undefined,
  ): Promise<void> {
    if (job.jobType !== 'incremental' || !job.entityType || !job.entityId) {
      throw new Error('Expected a targeted incremental-index job');
    }
    assertLeaseValid();
    if (!(await this.options.stateRepository.isCurrent(job))) return;

    const model = MODEL_CATALOG[job.modelCode];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const source = await this.options.sourceRepository.load(job.entityType, job.entityId);
      if (!source) {
        const result = await this.deleteMissingRecord(job);
        if (result === 'changed') continue;
        return;
      }
      let vector: readonly number[] | undefined;
      try {
        [vector] = await this.options.runtime.embedDocuments([source.document]);
      } catch (error) {
        throw new SourceEmbeddingFailedError(
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
      if (!vector) {
        throw new IndexValidationFailedError(
          'Semantic runtime did not return an incremental vector',
        );
      }
      vectorDimensions(vector, model.dimensions);
      assertLeaseValid();
      const result = await this.writeStableRecord(job, source, vector);
      if (result === 'written' || result === 'deleted' || result === 'stale') {
        assertLeaseValid();
        await this.options.stateRepository.refreshIncrementalState(job);
        return;
      }
    }
    throw new IndexValidationFailedError(
      'Semantic source changed repeatedly during incremental indexing',
    );
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

  private async updateFullProgress(
    job: SemanticIndexJob,
    processedItems: number,
    totalItems: number,
    assertLeaseValid: () => void,
  ): Promise<void> {
    assertLeaseValid();
    await this.options.stateRepository.updateFullProgress(job, processedItems, totalItems);
  }

  private async indexFullBatch(
    job: SemanticIndexJob,
    sources: readonly SemanticSourceRecord[],
    expectedDimensions: number,
    assertLeaseValid: () => void,
  ): Promise<number> {
    let vectors: number[][];
    try {
      vectors = await this.options.runtime.embedDocuments(sources.map((record) => record.document));
    } catch {
      assertLeaseValid();
      return this.indexFullSourcesIndividually(job, sources, expectedDimensions, assertLeaseValid);
    }
    assertLeaseValid();
    if (vectors.length !== sources.length) {
      throw new IndexValidationFailedError('Semantic runtime returned an unexpected batch size');
    }
    for (const vector of vectors) vectorDimensions(vector, expectedDimensions);
    assertLeaseValid();
    const results = await this.writeStableRecords(job, sources, vectors);
    return results.filter((result) => result === 'written').length;
  }

  private async indexFullSourcesIndividually(
    job: SemanticIndexJob,
    sources: readonly SemanticSourceRecord[],
    expectedDimensions: number,
    assertLeaseValid: () => void,
  ): Promise<number> {
    let indexedItems = 0;
    for (const source of sources) {
      let vectors: number[][];
      try {
        vectors = await this.options.runtime.embedDocuments([source.document]);
      } catch (error) {
        assertLeaseValid();
        const message = error instanceof Error ? error.message : String(error);
        const sourceFailure = new SourceEmbeddingFailedError(message, error);
        if (classifySemanticFailure('full_index', sourceFailure).kind === 'retryable') {
          throw sourceFailure;
        }
        await this.options.stateRepository.recordSourceFailure(job, {
          entityType: source.entityType,
          entityId: source.entityId,
          code: 'SOURCE_EMBEDDING_FAILED',
          message: boundedJobError(message),
        });
        continue;
      }
      assertLeaseValid();
      const vector = vectors[0];
      if (vectors.length !== 1 || !vector) {
        throw new IndexValidationFailedError(
          'Semantic runtime returned an unexpected single-record batch size',
        );
      }
      vectorDimensions(vector, expectedDimensions);
      assertLeaseValid();
      const result = await this.writeStableRecord(job, source, vector);
      if (result === 'written') indexedItems += 1;
    }
    return indexedItems;
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
      throw new IndexValidationFailedError(
        'Semantic stable-write batch size does not match its vectors',
      );
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
      await this.lockCurrentJobLease(client, job);

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
        await this.deleteCoveredIncrementalJobs(client, job, source.entityType, source.entityId);
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

  private async deleteCoveredIncrementalJobs(
    client: PoolClient,
    job: SemanticIndexJob,
    entityType: SemanticEntityType,
    entityId: string,
  ): Promise<void> {
    await client.query(
      `delete from semantic_jobs
       where job_type = 'incremental'
         and status in ('queued', 'failed')
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
      await this.lockCurrentJobLease(client, job);
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
      await client.query(
        `delete from semantic_jobs
         where job_type = 'incremental'
           and status = 'failed'
           and model_code = $1
           and state_version = $2
           and entity_type = $3
           and entity_id = $4`,
        [job.modelCode, job.stateVersion, job.entityType, job.entityId],
      );
      await client.query('commit');
      return 'deleted';
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async validateCompleteIndex(job: SemanticIndexJob): Promise<CompleteIndexValidation> {
    const expectedDimensions = MODEL_CATALOG[job.modelCode].dimensions;
    let indexedItems = 0;
    let failedItems = 0;
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
        const failures = await this.options.pool.query<{
          entity_id: string;
          failures: number;
        }>(
          `select entity_id,
                  count(*)::int as failures
           from semantic_jobs
           where job_type = 'incremental'
             and status = 'failed'
             and model_code = $1
             and state_version = $2
             and entity_type = $3
             and entity_id = any($4::uuid[])
             and failure_code = 'SOURCE_EMBEDDING_FAILED'
           group by entity_id`,
          [job.modelCode, job.stateVersion, entityType, sources.map((source) => source.entityId)],
        );
        const embeddingById = new Map(
          embeddings.rows.map((embedding) => [embedding.entity_id, embedding]),
        );
        const failuresById = new Map(
          failures.rows.map((failure) => [failure.entity_id, failure.failures]),
        );
        for (const source of sources) {
          const embedding = embeddingById.get(source.entityId);
          if (embedding) {
            if (
              embedding.model_code !== job.modelCode ||
              embedding.dimensions !== expectedDimensions ||
              embedding.source_hash !== source.sourceHash ||
              failuresById.has(source.entityId)
            ) {
              throw new IndexValidationFailedError(
                `Semantic index validation failed for ${entityType}:${source.entityId}`,
              );
            }
            indexedItems += 1;
            continue;
          }
          if (failuresById.get(source.entityId) === 1) {
            failedItems += 1;
          } else {
            throw new IndexValidationFailedError(
              `Semantic index validation failed for ${entityType}:${source.entityId}`,
            );
          }
        }
        afterId = sources.at(-1)!.entityId;
      }
    }
    const embeddingCount = await this.options.pool.query<{ count: number }>(
      `select count(*)::int as count
       from semantic_embeddings`,
    );
    if (embeddingCount.rows[0]?.count !== indexedItems) {
      throw new IndexValidationFailedError(
        'Semantic index record count does not match business records',
      );
    }
    const failedCount = await this.options.pool.query<{
      source_failures: number;
      total_failures: number;
    }>(
      `select count(*)::int as total_failures,
              count(*) filter (
                where failure_code = 'SOURCE_EMBEDDING_FAILED'
              )::int as source_failures
       from semantic_jobs
       where job_type = 'incremental'
         and status = 'failed'
         and model_code = $1
         and state_version = $2`,
      [job.modelCode, job.stateVersion],
    );
    if (
      failedCount.rows[0]?.source_failures !== failedItems ||
      failedCount.rows[0]?.total_failures !== failedItems
    ) {
      throw new IndexValidationFailedError(
        'Semantic failed-source count does not match business records',
      );
    }
    return { indexedItems, failedItems };
  }

  private async lockCurrentJobLease(client: PoolClient, job: SemanticIndexJob): Promise<void> {
    const result = await client.query(
      `select id
       from semantic_jobs
       where id = $1
         and status = 'running'
         and lease_owner = $2
         and attempts = $3
         and lease_expires_at > clock_timestamp()
       for update`,
      [job.id, job.leaseOwner, job.attempts],
    );
    if (result.rowCount !== 1) throw new WorkerLeaseLostError();
  }
}
