import {
  aiImportCommitResultSchema,
  type AiImportChangeCounts,
  type AiImportCommitResult,
  type AiWorkflowError,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import { AiCaptureDataError } from './aiCaptureErrors.js';
import type { AiImportCommitRepository } from './aiImportCommitService.js';
import type { StoredAiImportPlanPayload } from './aiImportPlanRepository.js';
import {
  fingerprintDependency,
  type PreparedDependencyVersion,
  type PreparedMutationSet,
} from './aiImportPlanValidator.js';
import { relationCaseKey } from './relationCaseKey.js';

interface PlanRow {
  id: string;
  version: number;
  status: string;
  topic: string;
  client_name: string;
  plan_payload: StoredAiImportPlanPayload;
  result_payload: unknown;
  expires_at: Date;
  committed_at: Date | null;
  has_replacement: boolean;
  is_expired: boolean;
}

interface IdRow {
  id: string;
}

interface EventSnapshotRow {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
  updated_at: Date;
}

interface CaseSnapshotRow {
  id: string;
  content: string;
  updated_at: Date;
}

interface RelationSnapshotRow {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  description: string | null;
  confidence: number | string;
  baseline_confidence: number | string;
  baseline_case_count: number;
  case_ids: string[];
  updated_at: Date;
}

interface LinkSnapshotRow {
  exists: boolean;
  linked_at: Date | null;
}

interface ConfidenceRow {
  id: string;
  confidence: number | string;
}

interface HistoryRecord {
  recordType: 'event' | 'case' | 'relation' | 'relation_case' | 'confidence';
  action: 'created' | 'reused' | 'updated' | 'changed';
  primaryRecordId: string;
  relatedRecordId: string | null;
  detail: Record<string, unknown>;
}

interface AppliedMutationResult {
  counts: AiImportChangeCounts;
  records: HistoryRecord[];
  noChanges: boolean;
}

interface RelationDisplay {
  causeEventName: string;
  effectEventName: string;
  relationDescription: string | null;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return code === '40001' || code === '40P01';
}

function isBusinessChange(counts: AiImportChangeCounts): boolean {
  return (
    counts.eventCreated > 0 ||
    counts.eventUpdated > 0 ||
    counts.caseCreated > 0 ||
    counts.relationCreated > 0 ||
    counts.relationCaseCreated > 0 ||
    counts.confidenceChanged > 0
  );
}

export class PostgresAiImportCommitRepository implements AiImportCommitRepository {
  public constructor(private readonly pool: Pool) {}

  public async commit(planId: string): Promise<AiImportCommitResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.commitOnce(planId);
      } catch (error) {
        if (attempt < 3 && isRetryableTransactionError(error)) continue;
        throw error;
      }
    }
    throw new Error('Unreachable AI import transaction retry state');
  }

  public async recordFailure(planId: string, error: AiWorkflowError): Promise<void> {
    const status = error.category === 'data' ? 'data_failed' : 'system_failed';
    await this.pool.query(
      `update ai_import_plans
       set status = $2,
           result_payload = $3::jsonb,
           updated_at = clock_timestamp()
       where id = $1
         and status in ('pending', 'system_failed')
         and not exists (
           select 1 from ai_import_batches batch where batch.plan_id = ai_import_plans.id
         )`,
      [planId, status, JSON.stringify(error)],
    );
  }

  private async commitOnce(planId: string): Promise<AiImportCommitResult> {
    const client = await this.pool.connect();
    let open = false;
    try {
      await client.query('begin isolation level serializable');
      open = true;
      const plan = await this.lockPlan(client, planId);
      if (plan.status === 'committed') {
        const stored = aiImportCommitResultSchema.safeParse(plan.result_payload);
        if (!stored.success) {
          throw new Error('Committed AI import plan has no valid stored result');
        }
        await client.query('commit');
        open = false;
        return stored.data;
      }
      this.assertCommittable(plan);
      await client.query(
        `update ai_import_plans
         set status = 'submitting', result_payload = null, updated_at = clock_timestamp()
         where id = $1`,
        [plan.id],
      );
      await client.query(`set constraints ai_import_plans_history_status_check immediate`);
      await this.lockAndRevalidateDependencies(client, plan.plan_payload.mutations.dependencies);
      const applied = await this.applyMutations(client, plan.plan_payload.mutations);
      const history = await this.writeSuccessfulHistory(client, plan, applied);
      const completedAt = history.completedAt.toISOString();
      const result: AiImportCommitResult = {
        planId: plan.id,
        historyId: history.id,
        marker: `[Causality-Capture: ${history.id}]`,
        noChanges: applied.noChanges,
        counts: applied.counts,
        completedAt,
      };
      await client.query(
        `update ai_import_plans
         set status = 'committed',
             result_payload = $2::jsonb,
             committed_at = $3,
             updated_at = $3
         where id = $1`,
        [plan.id, JSON.stringify(result), completedAt],
      );
      await client.query('commit');
      open = false;
      return result;
    } catch (error) {
      if (open) {
        try {
          await client.query('rollback');
        } catch {
          // Preserve the original transaction error.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockPlan(client: PoolClient, planId: string): Promise<PlanRow> {
    const result = await client.query<PlanRow>(
      `select plan.*,
              plan.expires_at <= clock_timestamp() as is_expired,
              exists (
                select 1 from ai_import_plans replacement
                where replacement.replaces_plan_id = plan.id
              ) as has_replacement
       from ai_import_plans plan
       where plan.id = $1
       for update`,
      [planId],
    );
    const plan = result.rows[0];
    if (!plan) throw new AiCaptureDataError('AI_PLAN_NOT_FOUND', [planId]);
    return plan;
  }

  private assertCommittable(plan: PlanRow): void {
    if (plan.has_replacement) {
      throw new AiCaptureDataError('AI_PLAN_NOT_LATEST', [plan.id]);
    }
    if (plan.is_expired) {
      throw new AiCaptureDataError('AI_PLAN_EXPIRED', [plan.id]);
    }
    if (plan.status !== 'pending' && plan.status !== 'system_failed') {
      throw new AiCaptureDataError('AI_PLAN_NOT_COMMITTABLE', [plan.id]);
    }
  }

  private async lockAndRevalidateDependencies(
    client: PoolClient,
    dependencies: readonly PreparedDependencyVersion[],
  ): Promise<void> {
    for (const dependency of dependencies) {
      const fingerprint = await this.currentDependencyFingerprint(client, dependency);
      if (fingerprint !== dependency.fingerprint) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [
          dependency.id,
          ...(dependency.relatedId ? [dependency.relatedId] : []),
        ]);
      }
    }
  }

  private async currentDependencyFingerprint(
    client: PoolClient,
    dependency: PreparedDependencyVersion,
  ): Promise<string | null> {
    if (dependency.type === 'event') {
      const result = await client.query<EventSnapshotRow>(
        `select event.id, event.name, event.description,
                coalesce((
                  select array_agg(alias.alias order by alias.normalized_alias, alias.id)
                  from event_aliases alias where alias.event_id = event.id
                ), array[]::varchar[]) as aliases,
                coalesce((
                  select array_agg(keyword.keyword order by keyword.position, keyword.id)
                  from event_keywords keyword where keyword.event_id = event.id
                ), array[]::varchar[]) as keywords,
                event.updated_at
         from abstract_events event
         where event.id = $1
         for update`,
        [dependency.id],
      );
      const row = result.rows[0];
      return row
        ? fingerprintDependency({
            id: row.id,
            name: row.name,
            description: row.description,
            aliases: row.aliases.toSorted(),
            keywords: row.keywords.toSorted(),
            updatedAt: row.updated_at.toISOString(),
          })
        : null;
    }
    if (dependency.type === 'case') {
      const result = await client.query<CaseSnapshotRow>(
        `select id, content, updated_at
         from concrete_cases where id = $1 for update`,
        [dependency.id],
      );
      const row = result.rows[0];
      return row
        ? fingerprintDependency({
            id: row.id,
            content: row.content,
            updatedAt: row.updated_at.toISOString(),
          })
        : null;
    }
    if (dependency.type === 'relation') {
      const result = await client.query<RelationSnapshotRow>(
        `select relation.id, relation.cause_event_id, relation.effect_event_id,
                relation.description, relation.confidence,
                relation.baseline_confidence, relation.baseline_case_count,
                coalesce((
                  select array_agg(link.concrete_case_id order by link.concrete_case_id)
                  from causal_relation_cases link
                  where link.causal_relation_id = relation.id
                ), array[]::uuid[]) as case_ids,
                relation.updated_at
         from causal_relations relation
         where relation.id = $1
         for update`,
        [dependency.id],
      );
      const row = result.rows[0];
      return row
        ? fingerprintDependency({
            id: row.id,
            causeEventId: row.cause_event_id,
            effectEventId: row.effect_event_id,
            description: row.description,
            confidence: Number(row.confidence),
            baselineConfidence: Number(row.baseline_confidence),
            baselineCaseCount: row.baseline_case_count,
            caseIds: row.case_ids.toSorted(),
            updatedAt: row.updated_at.toISOString(),
          })
        : null;
    }
    const relationId = dependency.id;
    const caseId = dependency.relatedId;
    if (!caseId) return null;
    await client.query(`select id from causal_relations where id = $1 for update`, [relationId]);
    await client.query(`select id from concrete_cases where id = $1 for update`, [caseId]);
    const result = await client.query<LinkSnapshotRow>(
      `select stored.causal_relation_id is not null as exists, stored.linked_at
       from (values (true)) source(value)
       left join causal_relation_cases stored
         on stored.causal_relation_id = $1 and stored.concrete_case_id = $2`,
      [relationId, caseId],
    );
    const row = result.rows[0]!;
    return fingerprintDependency({
      relationId,
      caseId,
      exists: row.exists,
      linkedAt: row.linked_at?.toISOString() ?? null,
    });
  }

  private async applyMutations(
    client: PoolClient,
    mutations: PreparedMutationSet,
  ): Promise<AppliedMutationResult> {
    const eventIds = new Map(mutations.reuseEvents.map((item) => [item.ref, item.id]));
    const caseIds = new Map(mutations.reuseCases.map((item) => [item.ref, item.id]));
    const relationIds = new Map(mutations.reuseRelations.map((item) => [item.ref, item.id]));
    const eventNames = new Map<string, string>();
    const caseContents = new Map<string, string>();
    const relationDisplays = new Map<string, RelationDisplay>();
    const records: HistoryRecord[] = [];

    for (const item of mutations.createEvents) {
      const result = await client.query<IdRow>(
        `insert into abstract_events (name, description)
         values ($1, $2) returning id`,
        [item.name, item.description],
      );
      const id = result.rows[0]!.id;
      eventIds.set(item.ref, id);
      eventNames.set(item.ref, item.name);
      await this.insertAliases(client, id, item.aliases);
      await this.insertKeywords(client, id, item.keywords);
      records.push({
        recordType: 'event',
        action: 'created',
        primaryRecordId: id,
        relatedRecordId: null,
        detail: {
          ref: item.ref,
          name: item.name,
          description: item.description,
          aliases: item.aliases,
          keywords: item.keywords,
        },
      });
    }
    for (const item of mutations.reuseEvents) {
      const event = await client.query<{ name: string }>(
        `select name from abstract_events where id = $1`,
        [item.id],
      );
      if (!event.rows[0]) throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [item.ref]);
      eventNames.set(item.ref, event.rows[0].name);
      records.push({
        recordType: 'event',
        action: 'reused',
        primaryRecordId: item.id,
        relatedRecordId: null,
        detail: { ref: item.ref, name: event.rows[0].name },
      });
    }
    for (const item of mutations.updateEvents) {
      await client.query(
        `update abstract_events
         set description = $2, updated_at = clock_timestamp()
         where id = $1`,
        [item.id, item.newDescription],
      );
      await this.insertAliases(client, item.id, item.appendAliases);
      await this.appendKeywords(client, item.id, item.appendKeywords);
      records.push({
        recordType: 'event',
        action: 'updated',
        primaryRecordId: item.id,
        relatedRecordId: null,
        detail: {
          ref: item.ref,
          name: eventNames.get(item.ref) ?? '未知原子事件',
          appendAliases: item.appendAliases,
          appendKeywords: item.appendKeywords,
          oldDescription: item.oldDescription,
          newDescription: item.newDescription,
        },
      });
    }

    for (const item of mutations.createCases) {
      const result = await client.query<IdRow>(
        `insert into concrete_cases (content) values ($1) returning id`,
        [item.content],
      );
      const id = result.rows[0]!.id;
      caseIds.set(item.ref, id);
      caseContents.set(item.ref, item.content);
      records.push({
        recordType: 'case',
        action: 'created',
        primaryRecordId: id,
        relatedRecordId: null,
        detail: { ref: item.ref, content: item.content },
      });
    }
    for (const item of mutations.reuseCases) {
      const concreteCase = await client.query<{ content: string }>(
        `select content from concrete_cases where id = $1`,
        [item.id],
      );
      if (!concreteCase.rows[0]) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [item.ref]);
      }
      caseContents.set(item.ref, concreteCase.rows[0].content);
      records.push({
        recordType: 'case',
        action: 'reused',
        primaryRecordId: item.id,
        relatedRecordId: null,
        detail: { ref: item.ref, content: concreteCase.rows[0].content },
      });
    }

    const confidenceBefore = new Map<string, number>();
    for (const item of mutations.confidenceChanges) {
      if (!item.relationId) continue;
      const current = await client.query<ConfidenceRow>(
        `select id, confidence from causal_relations where id = $1`,
        [item.relationId],
      );
      if (current.rows[0])
        confidenceBefore.set(item.relationRef, Number(current.rows[0].confidence));
    }

    const eventNamesById = new Map(
      [...eventIds].flatMap(([ref, id]) => {
        const name = eventNames.get(ref);
        return name ? [[id, name] as const] : [];
      }),
    );
    for (const item of mutations.createRelations) {
      const causeId =
        item.causeEvent.kind === 'existing'
          ? item.causeEvent.id
          : eventIds.get(item.causeEvent.ref);
      const effectId =
        item.effectEvent.kind === 'existing'
          ? item.effectEvent.id
          : eventIds.get(item.effectEvent.ref);
      if (!causeId || !effectId) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [item.ref]);
      }
      const result = await client.query<IdRow>(
        `insert into causal_relations (
           cause_event_id, effect_event_id, confidence,
           baseline_confidence, baseline_case_count, description
         )
         values ($1, $2, 10, 10, 0, $3)
         returning id`,
        [causeId, effectId, item.description],
      );
      const id = result.rows[0]!.id;
      relationIds.set(item.ref, id);
      confidenceBefore.set(item.ref, 10);
      const causeEventName =
        item.causeEvent.kind === 'create'
          ? eventNames.get(item.causeEvent.ref)
          : eventNamesById.get(item.causeEvent.id);
      const effectEventName =
        item.effectEvent.kind === 'create'
          ? eventNames.get(item.effectEvent.ref)
          : eventNamesById.get(item.effectEvent.id);
      if (!causeEventName || !effectEventName) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [item.ref]);
      }
      const relationDisplay: RelationDisplay = {
        causeEventName,
        effectEventName,
        relationDescription: item.description,
      };
      relationDisplays.set(item.ref, relationDisplay);
      records.push({
        recordType: 'relation',
        action: 'created',
        primaryRecordId: id,
        relatedRecordId: null,
        detail: {
          ref: item.ref,
          causeEventId: causeId,
          effectEventId: effectId,
          description: item.description,
          ...relationDisplay,
        },
      });
    }
    for (const item of mutations.reuseRelations) {
      const relation = await client.query<{
        cause_event_id: string;
        effect_event_id: string;
        description: string | null;
        cause_event_name: string;
        effect_event_name: string;
      }>(
        `select relation.cause_event_id, relation.effect_event_id, relation.description,
                cause_event.name as cause_event_name,
                effect_event.name as effect_event_name
         from causal_relations relation
         join abstract_events cause_event on cause_event.id = relation.cause_event_id
         join abstract_events effect_event on effect_event.id = relation.effect_event_id
         where relation.id = $1`,
        [item.id],
      );
      if (!relation.rows[0]) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [item.ref]);
      }
      const relationDisplay: RelationDisplay = {
        causeEventName: relation.rows[0].cause_event_name,
        effectEventName: relation.rows[0].effect_event_name,
        relationDescription: relation.rows[0].description,
      };
      relationDisplays.set(item.ref, relationDisplay);
      records.push({
        recordType: 'relation',
        action: 'reused',
        primaryRecordId: item.id,
        relatedRecordId: null,
        detail: { ref: item.ref, ...relation.rows[0], ...relationDisplay },
      });
    }

    for (const item of mutations.createLinks) {
      const relationId = relationIds.get(item.relationRef);
      const caseId = caseIds.get(item.caseRef);
      if (!relationId || !caseId) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [
          item.relationRef,
          item.caseRef,
        ]);
      }
      await client.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values ($1, $2)`,
        [relationId, caseId],
      );
      const relationDisplay = relationDisplays.get(item.relationRef);
      const caseContent = caseContents.get(item.caseRef);
      if (!relationDisplay || !caseContent) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [
          item.relationRef,
          item.caseRef,
        ]);
      }
      records.push({
        recordType: 'relation_case',
        action: 'created',
        primaryRecordId: relationId,
        relatedRecordId: caseId,
        detail: {
          relationRef: item.relationRef,
          caseRef: item.caseRef,
          ...relationDisplay,
          caseContent,
        },
      });
    }

    const reuseLinks = planReuseLinks(mutations, relationIds, caseIds);
    for (const link of reuseLinks) {
      const exists = await client.query(
        `select 1 from causal_relation_cases
         where causal_relation_id = $1 and concrete_case_id = $2`,
        [link.relationId, link.caseId],
      );
      if (exists.rowCount !== 1) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [
          link.relationRef,
          link.caseRef,
        ]);
      }
      const relationDisplay = relationDisplays.get(link.relationRef);
      const caseContent = caseContents.get(link.caseRef);
      if (!relationDisplay || !caseContent) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [
          link.relationRef,
          link.caseRef,
        ]);
      }
      records.push({
        recordType: 'relation_case',
        action: 'reused',
        primaryRecordId: link.relationId,
        relatedRecordId: link.caseId,
        detail: {
          relationRef: link.relationRef,
          caseRef: link.caseRef,
          ...relationDisplay,
          caseContent,
        },
      });
    }

    let confidenceChanged = 0;
    for (const item of mutations.confidenceChanges) {
      const relationId = relationIds.get(item.relationRef) ?? item.relationId;
      if (!relationId) {
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [item.relationRef]);
      }
      const current = await client.query<ConfidenceRow>(
        `select id, confidence from causal_relations where id = $1`,
        [relationId],
      );
      const newConfidence = Number(current.rows[0]?.confidence);
      const oldConfidence = confidenceBefore.get(item.relationRef) ?? item.oldConfidence;
      if (Number.isFinite(newConfidence) && newConfidence !== oldConfidence) {
        const relationDisplay = relationDisplays.get(item.relationRef);
        if (!relationDisplay) {
          throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_CHANGED', [item.relationRef]);
        }
        confidenceChanged += 1;
        records.push({
          recordType: 'confidence',
          action: 'changed',
          primaryRecordId: relationId,
          relatedRecordId: null,
          detail: {
            relationRef: item.relationRef,
            ...relationDisplay,
            oldConfidence,
            newConfidence,
            oldCaseCount: item.oldCaseCount,
            newCaseCount: item.newCaseCount,
          },
        });
      }
    }

    const counts: AiImportChangeCounts = {
      eventCreated: mutations.createEvents.length,
      eventReused: mutations.reuseEvents.length,
      eventUpdated: mutations.updateEvents.length,
      caseCreated: mutations.createCases.length,
      caseReused: mutations.reuseCases.length,
      relationCreated: mutations.createRelations.length,
      relationReused: mutations.reuseRelations.length,
      relationCaseCreated: mutations.createLinks.length,
      relationCaseReused: reuseLinks.length,
      confidenceChanged,
    };
    return { counts, records, noChanges: !isBusinessChange(counts) };
  }

  private async insertAliases(
    client: PoolClient,
    eventId: string,
    aliases: readonly string[],
  ): Promise<void> {
    for (const alias of aliases) {
      await client.query(
        `insert into event_aliases (event_id, alias)
         values ($1, $2)
         on conflict (event_id, normalized_alias) do nothing`,
        [eventId, alias],
      );
    }
  }

  private async insertKeywords(
    client: PoolClient,
    eventId: string,
    keywords: readonly string[],
  ): Promise<void> {
    for (const [index, keyword] of keywords.entries()) {
      await client.query(
        `insert into event_keywords (event_id, keyword, position)
         values ($1, $2, $3)`,
        [eventId, keyword, index + 1],
      );
    }
  }

  private async appendKeywords(
    client: PoolClient,
    eventId: string,
    keywords: readonly string[],
  ): Promise<void> {
    if (keywords.length === 0) return;
    const result = await client.query<{ max_position: number }>(
      `select coalesce(max(position), 0)::int as max_position
       from event_keywords where event_id = $1`,
      [eventId],
    );
    const start = result.rows[0]!.max_position;
    for (const [index, keyword] of keywords.entries()) {
      await client.query(
        `insert into event_keywords (event_id, keyword, position)
         values ($1, $2, $3)
         on conflict (event_id, normalized_keyword) do nothing`,
        [eventId, keyword, start + index + 1],
      );
    }
  }

  private async writeSuccessfulHistory(
    client: PoolClient,
    plan: PlanRow,
    applied: AppliedMutationResult,
  ): Promise<{ id: string; completedAt: Date }> {
    const batch = await client.query<{ id: string; completed_at: Date }>(
      `insert into ai_import_batches (
         plan_id, topic, plan_version, client_name,
         event_created, event_reused, event_updated,
         case_created, case_reused,
         relation_created, relation_reused,
         relation_case_created, relation_case_reused, confidence_changed
       )
       values (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )
       returning id, completed_at`,
      [
        plan.id,
        plan.topic,
        plan.version,
        plan.client_name,
        applied.counts.eventCreated,
        applied.counts.eventReused,
        applied.counts.eventUpdated,
        applied.counts.caseCreated,
        applied.counts.caseReused,
        applied.counts.relationCreated,
        applied.counts.relationReused,
        applied.counts.relationCaseCreated,
        applied.counts.relationCaseReused,
        applied.counts.confidenceChanged,
      ],
    );
    const row = batch.rows[0]!;
    for (const [index, record] of applied.records.entries()) {
      await client.query(
        `insert into ai_import_records (
           batch_id, sequence, record_type, action,
           primary_record_id, related_record_id, detail
         )
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          row.id,
          index + 1,
          record.recordType,
          record.action,
          record.primaryRecordId,
          record.relatedRecordId,
          JSON.stringify(record.detail),
        ],
      );
    }
    return { id: row.id, completedAt: row.completed_at };
  }
}

function planReuseLinks(
  mutations: PreparedMutationSet,
  relationIds: ReadonlyMap<string, string>,
  caseIds: ReadonlyMap<string, string>,
): Array<{
  relationRef: string;
  caseRef: string;
  relationId: string;
  caseId: string;
}> {
  const relationRefs = new Map([...relationIds].map(([ref, id]) => [id, ref]));
  const caseRefs = new Map([...caseIds].map(([ref, id]) => [id, ref]));
  const createdTargets = new Set(
    mutations.createLinks.flatMap((link) => {
      const relationId = relationIds.get(link.relationRef);
      const caseId = caseIds.get(link.caseRef);
      return relationId && caseId ? [relationCaseKey(relationId, caseId)] : [];
    }),
  );
  return mutations.dependencies.flatMap((dependency) => {
    if (dependency.type !== 'link' || !dependency.relatedId) return [];
    if (createdTargets.has(relationCaseKey(dependency.id, dependency.relatedId))) return [];
    const relationRef = relationRefs.get(dependency.id);
    const caseRef = caseRefs.get(dependency.relatedId);
    if (!relationRef || !caseRef) return [];
    return [
      {
        relationRef,
        caseRef,
        relationId: dependency.id,
        caseId: dependency.relatedId,
      },
    ];
  });
}
