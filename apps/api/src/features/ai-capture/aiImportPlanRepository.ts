import type {
  AiCaptureCandidateSet,
  AiCaptureComparison,
  AiCaptureDecisionSet,
  AiImportCommitResult,
  AiImportPlan,
  AiImportPlanStatus,
  AiWorkflowError,
  PrepareAiImportPlanInput,
} from '@causality/contracts';
import {
  aiCaptureComparisonSchema,
  aiImportCommitResultSchema,
  aiWorkflowErrorSchema,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import { AiCaptureDataError } from './aiCaptureErrors.js';
import { canonicalizeAiImportPlanInput } from './aiImportPlanCanonicalizer.js';
import { relationCaseKey } from './relationCaseKey.js';
import {
  fingerprintDependency,
  type AiImportPlanPreparationState,
  type ExistingCaseState,
  type ExistingEventState,
  type ExistingLinkState,
  type ExistingRelationState,
  type PreparedDependencyVersion,
  type PreparedMutationSet,
} from './aiImportPlanValidator.js';

interface PlanRow {
  id: string;
  version: number;
  replaces_plan_id: string | null;
  status: AiImportPlanStatus;
  topic: string;
  client_name: string;
  candidate_payload: AiCaptureCandidateSet;
  plan_payload: StoredAiImportPlanPayload;
  result_payload: unknown;
  created_at: Date;
  expires_at: Date;
  committed_at: Date | null;
  is_expired?: boolean;
}

interface ReplacementRow {
  id: string;
  version: number;
  status: AiImportPlanStatus;
  expires_at: Date;
  is_expired: boolean;
}

interface EventStateRow {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
  updated_at: Date;
}

interface CaseStateRow {
  id: string;
  content: string;
  updated_at: Date;
}

interface RelationStateRow {
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

interface LinkStateRow {
  relation_id: string;
  case_id: string;
  exists: boolean;
  linked_at: Date | null;
}

interface LinkIdentity {
  relationId: string;
  caseId: string;
}

interface IdRow {
  id: string;
}

type Database = Pool | PoolClient;

export interface StoredAiImportPlanPayload {
  comparison: AiCaptureComparison;
  decisions: AiCaptureDecisionSet;
  mutations: PreparedMutationSet;
  payloadHash: string;
}

export interface AiImportPlanRepository {
  loadPreparationState(input: PrepareAiImportPlanInput): Promise<AiImportPlanPreparationState>;
  createPlan(
    input: PrepareAiImportPlanInput,
    mutations: PreparedMutationSet,
  ): Promise<AiImportPlan>;
  status(planId: string): Promise<AiImportPlanStatus>;
  get(planId: string): Promise<AiImportPlan>;
}

function publicPlan(row: PlanRow): AiImportPlan {
  const parsedResult = aiImportCommitResultSchema.safeParse(row.result_payload);
  const parsedError = aiWorkflowErrorSchema.safeParse(row.result_payload);
  const result: AiImportCommitResult | null =
    row.status === 'committed' && parsedResult.success ? parsedResult.data : null;
  const error: AiWorkflowError | null =
    (row.status === 'data_failed' || row.status === 'system_failed') && parsedError.success
      ? parsedError.data
      : null;
  return {
    id: row.id,
    version: row.version,
    replacesPlanId: row.replaces_plan_id,
    status: row.status,
    topic: row.topic,
    clientName: row.client_name,
    candidates: row.candidate_payload,
    comparison: aiCaptureComparisonSchema.parse(row.plan_payload.comparison),
    decisions: row.plan_payload.decisions,
    summary: row.plan_payload.mutations.summary,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    committedAt: row.committed_at?.toISOString() ?? null,
    error,
    result,
  };
}

function eventState(row: EventStateRow): ExistingEventState {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    aliases: row.aliases,
    keywords: row.keywords,
    updatedAt: row.updated_at.toISOString(),
  };
}

function caseState(row: CaseStateRow): ExistingCaseState {
  return {
    id: row.id,
    content: row.content,
    updatedAt: row.updated_at.toISOString(),
  };
}

function relationState(row: RelationStateRow): ExistingRelationState {
  return {
    id: row.id,
    causeEventId: row.cause_event_id,
    effectEventId: row.effect_event_id,
    description: row.description,
    confidence: Number(row.confidence),
    baselineConfidence: Number(row.baseline_confidence),
    baselineCaseCount: Number(row.baseline_case_count),
    caseIds: row.case_ids,
    updatedAt: row.updated_at.toISOString(),
  };
}

function linkState(row: LinkStateRow): ExistingLinkState {
  return {
    relationId: row.relation_id,
    caseId: row.case_id,
    exists: row.exists,
    linkedAt: row.linked_at?.toISOString() ?? null,
  };
}

function dependencyKey(dependency: { type: string; id: string; relatedId: string | null }): string {
  return `${dependency.type}\u0000${dependency.id}\u0000${dependency.relatedId ?? ''}`;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

export class PostgresAiImportPlanRepository implements AiImportPlanRepository {
  public constructor(private readonly pool: Pool) {}

  public async loadPreparationState(
    input: PrepareAiImportPlanInput,
  ): Promise<AiImportPlanPreparationState> {
    const eventDecisionMap = new Map(
      input.decisions.atomicEvents.map((decision) => [decision.ref, decision]),
    );
    const caseDecisionMap = new Map(
      input.decisions.concreteCases.map((decision) => [decision.ref, decision]),
    );
    const relationDecisionMap = new Map(
      input.decisions.causalRelations.map((decision) => [decision.ref, decision]),
    );
    const createdEvents = input.candidates.atomicEvents.filter(
      (candidate) => eventDecisionMap.get(candidate.ref)?.action === 'create',
    );
    const createdCases = input.candidates.concreteCases.filter(
      (candidate) => caseDecisionMap.get(candidate.ref)?.action === 'create',
    );
    const [currentEventIds, currentCaseIds] = await Promise.all([
      this.findExactEventConflictIds(createdEvents),
      this.findExactCaseConflictIds(createdCases),
    ]);
    const eventIds = input.decisions.atomicEvents.flatMap((decision) =>
      decision.action === 'reuse' ? [decision.existingId] : [],
    );
    eventIds.push(...currentEventIds);
    const caseIds = input.decisions.concreteCases.flatMap((decision) =>
      decision.action === 'reuse' ? [decision.existingId] : [],
    );
    caseIds.push(...currentCaseIds);
    const relationIds = input.decisions.causalRelations.flatMap((decision) =>
      decision.action === 'reuse' ? [decision.existingId] : [],
    );
    const relationProbes = input.candidates.causalRelations.flatMap((candidate) => {
      if (relationDecisionMap.get(candidate.ref)?.action !== 'create') return [];
      const causeDecision = eventDecisionMap.get(candidate.causeEventRef);
      const effectDecision = eventDecisionMap.get(candidate.effectEventRef);
      return causeDecision?.action === 'reuse' && effectDecision?.action === 'reuse'
        ? [
            {
              ref: candidate.ref,
              causeEventId: causeDecision.existingId,
              effectEventId: effectDecision.existingId,
            },
          ]
        : [];
    });
    relationIds.push(...(await this.findExactRelationConflictIds(relationProbes)));
    const linkDecisionMap = new Map(
      input.decisions.relationCaseLinks.map((decision) => [
        relationCaseKey(decision.relationRef, decision.caseRef),
        decision,
      ]),
    );
    const links: LinkIdentity[] = [];
    for (const candidate of input.candidates.relationCaseLinks) {
      const linkDecision = linkDecisionMap.get(
        relationCaseKey(candidate.relationRef, candidate.caseRef),
      );
      const relationDecision = relationDecisionMap.get(candidate.relationRef);
      const concreteCaseDecision = caseDecisionMap.get(candidate.caseRef);
      if (
        linkDecision?.action !== 'skip' &&
        relationDecision?.action === 'reuse' &&
        concreteCaseDecision?.action === 'reuse'
      ) {
        links.push({
          relationId: relationDecision.existingId,
          caseId: concreteCaseDecision.existingId,
        });
      }
    }

    const [events, cases, relations, linkStates] = await Promise.all([
      this.loadEvents(this.pool, eventIds),
      this.loadCases(this.pool, caseIds),
      this.loadRelations(this.pool, relationIds),
      this.loadLinks(this.pool, links),
    ]);
    return { events, cases, relations, links: linkStates };
  }

  private async findExactEventConflictIds(
    events: readonly PrepareAiImportPlanInput['candidates']['atomicEvents'][number][],
  ): Promise<string[]> {
    const terms = [
      ...new Set(events.flatMap((event) => [event.name, ...event.aliases].map(normalize))),
    ];
    if (terms.length === 0) return [];
    const result = await this.pool.query<IdRow>(
      `with terms as (
         select value from jsonb_array_elements_text($1::jsonb) source(value)
       )
       select event.id
       from abstract_events event
       where event.normalized_name in (select value from terms)
          or exists (
               select 1 from event_aliases alias
               where alias.event_id = event.id
                 and alias.normalized_alias in (select value from terms)
             )
       order by event.id`,
      [JSON.stringify(terms)],
    );
    return result.rows.map((row) => row.id);
  }

  private async findExactCaseConflictIds(
    cases: readonly PrepareAiImportPlanInput['candidates']['concreteCases'][number][],
  ): Promise<string[]> {
    const contents = [...new Set(cases.map((concreteCase) => concreteCase.content))];
    if (contents.length === 0) return [];
    const result = await this.pool.query<IdRow>(
      `select id from concrete_cases where content = any($1::varchar[]) order by id`,
      [contents],
    );
    return result.rows.map((row) => row.id);
  }

  private async findExactRelationConflictIds(
    relations: readonly { causeEventId: string; effectEventId: string }[],
  ): Promise<string[]> {
    if (relations.length === 0) return [];
    const result = await this.pool.query<IdRow>(
      `with input as (
         select "causeEventId"::uuid as cause_event_id,
                "effectEventId"::uuid as effect_event_id
         from jsonb_to_recordset($1::jsonb)
           as source("causeEventId" text, "effectEventId" text)
       )
       select distinct relation.id
       from input
       join causal_relations relation
         on relation.cause_event_id = input.cause_event_id
        and relation.effect_event_id = input.effect_event_id
       order by relation.id`,
      [JSON.stringify(relations)],
    );
    return result.rows.map((row) => row.id);
  }

  public async createPlan(
    rawInput: PrepareAiImportPlanInput,
    mutations: PreparedMutationSet,
  ): Promise<AiImportPlan> {
    const input = canonicalizeAiImportPlanInput(rawInput);
    const planPayloadWithoutHash = {
      comparison: input.comparison,
      decisions: input.decisions,
      mutations,
    };
    const payload: StoredAiImportPlanPayload = {
      ...planPayloadWithoutHash,
      payloadHash: fingerprintDependency({
        candidates: input.candidates,
        ...planPayloadWithoutHash,
      }),
    };
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query('begin');
      transactionOpen = true;
      let version = 1;
      if (input.replacesPlanId) {
        const previous = await client.query<ReplacementRow>(
          `select id, version, status, expires_at,
                  expires_at <= clock_timestamp() as is_expired
           from ai_import_plans
           where id = $1
           for update`,
          [input.replacesPlanId],
        );
        const row = previous.rows[0];
        if (!row) throw new AiCaptureDataError('AI_PLAN_NOT_FOUND', [input.replacesPlanId]);
        if (row.status !== 'pending' || row.is_expired) {
          throw new AiCaptureDataError('AI_PLAN_NOT_REPLACEABLE', [input.replacesPlanId]);
        }
        const replaced = await client.query(
          `update ai_import_plans
           set status = 'replaced',
               updated_at = clock_timestamp()
           where id = $1 and status = 'pending'
           returning id`,
          [input.replacesPlanId],
        );
        if (replaced.rowCount !== 1) {
          throw new AiCaptureDataError('AI_PLAN_NOT_REPLACEABLE', [input.replacesPlanId]);
        }
        version = row.version + 1;
      }

      const result = await client.query<PlanRow>(
        `with instant as (select clock_timestamp() as value)
         insert into ai_import_plans (
           version, replaces_plan_id, status, topic, client_name,
           candidate_payload, plan_payload, result_payload,
           created_at, expires_at, committed_at, updated_at
         )
         select $1, $2, 'pending', $3, $4,
                $5::jsonb, $6::jsonb, null,
                instant.value, instant.value + interval '30 minutes', null, instant.value
         from instant
         returning *`,
        [
          version,
          input.replacesPlanId ?? null,
          input.candidates.topic,
          input.candidates.clientName,
          JSON.stringify(input.candidates),
          JSON.stringify(payload),
        ],
      );
      await client.query('commit');
      transactionOpen = false;
      return publicPlan(result.rows[0]!);
    } catch (error) {
      if (transactionOpen) await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async status(planId: string): Promise<AiImportPlanStatus> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<PlanRow>(
        `select plan.*,
                plan.expires_at <= clock_timestamp() as is_expired
         from ai_import_plans plan
         where plan.id = $1
         for update`,
        [planId],
      );
      const plan = result.rows[0];
      if (!plan) {
        await client.query('rollback');
        throw new AiCaptureDataError('AI_PLAN_NOT_FOUND', [planId]);
      }
      if (plan.status !== 'pending') {
        await client.query('commit');
        return plan.status;
      }
      if (plan.is_expired) {
        await client.query(
          `update ai_import_plans
           set status = 'expired', updated_at = clock_timestamp()
           where id = $1`,
          [planId],
        );
        await client.query('commit');
        return 'expired';
      }
      const dependenciesValid = await this.dependenciesValid(
        client,
        plan.plan_payload.mutations.dependencies,
      );
      if (!dependenciesValid) {
        await client.query(
          `update ai_import_plans
           set status = 'invalidated', updated_at = clock_timestamp()
           where id = $1`,
          [planId],
        );
        await client.query('commit');
        return 'invalidated';
      }
      await client.query('commit');
      return 'pending';
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // The transaction may already be closed by a successful terminal-state read.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async get(planId: string): Promise<AiImportPlan> {
    await this.status(planId);
    const result = await this.pool.query<PlanRow>(`select * from ai_import_plans where id = $1`, [
      planId,
    ]);
    const plan = result.rows[0];
    if (!plan) throw new AiCaptureDataError('AI_PLAN_NOT_FOUND', [planId]);
    return publicPlan(plan);
  }

  private async dependenciesValid(
    database: Database,
    dependencies: readonly PreparedDependencyVersion[],
  ): Promise<boolean> {
    const eventIds = dependencies
      .filter((dependency) => dependency.type === 'event')
      .map((dependency) => dependency.id);
    const caseIds = dependencies
      .filter((dependency) => dependency.type === 'case')
      .map((dependency) => dependency.id);
    const relationIds = dependencies
      .filter((dependency) => dependency.type === 'relation')
      .map((dependency) => dependency.id);
    const links = dependencies
      .filter(
        (dependency): dependency is PreparedDependencyVersion & { relatedId: string } =>
          dependency.type === 'link' && dependency.relatedId !== null,
      )
      .map((dependency) => ({
        relationId: dependency.id,
        caseId: dependency.relatedId,
      }));
    const events = await this.loadEvents(database, eventIds);
    const cases = await this.loadCases(database, caseIds);
    const relations = await this.loadRelations(database, relationIds);
    const linkStates = await this.loadLinks(database, links);
    const current = new Map<string, string>();
    for (const event of events) {
      current.set(
        dependencyKey({ type: 'event', id: event.id, relatedId: null }),
        fingerprintDependency({
          ...event,
          aliases: event.aliases.toSorted(),
          keywords: event.keywords.toSorted(),
        }),
      );
    }
    for (const concreteCase of cases) {
      current.set(
        dependencyKey({ type: 'case', id: concreteCase.id, relatedId: null }),
        fingerprintDependency(concreteCase),
      );
    }
    for (const relation of relations) {
      current.set(
        dependencyKey({ type: 'relation', id: relation.id, relatedId: null }),
        fingerprintDependency({ ...relation, caseIds: relation.caseIds.toSorted() }),
      );
    }
    for (const link of linkStates) {
      current.set(
        dependencyKey({
          type: 'link',
          id: link.relationId,
          relatedId: link.caseId,
        }),
        fingerprintDependency(link),
      );
    }
    return dependencies.every(
      (dependency) => current.get(dependencyKey(dependency)) === dependency.fingerprint,
    );
  }

  private async loadEvents(
    database: Database,
    ids: readonly string[],
  ): Promise<ExistingEventState[]> {
    if (ids.length === 0) return [];
    const result = await database.query<EventStateRow>(
      `select event.id,
              event.name,
              event.description,
              coalesce((
                select array_agg(alias.alias order by alias.normalized_alias, alias.id)
                from event_aliases alias
                where alias.event_id = event.id
              ), array[]::varchar[]) as aliases,
              coalesce((
                select array_agg(keyword.keyword order by keyword.position, keyword.id)
                from event_keywords keyword
                where keyword.event_id = event.id
              ), array[]::varchar[]) as keywords,
              event.updated_at
       from abstract_events event
       where event.id = any($1::uuid[])
       order by event.id`,
      [[...new Set(ids)]],
    );
    return result.rows.map(eventState);
  }

  private async loadCases(
    database: Database,
    ids: readonly string[],
  ): Promise<ExistingCaseState[]> {
    if (ids.length === 0) return [];
    const result = await database.query<CaseStateRow>(
      `select id, content, updated_at
       from concrete_cases
       where id = any($1::uuid[])
       order by id`,
      [[...new Set(ids)]],
    );
    return result.rows.map(caseState);
  }

  private async loadRelations(
    database: Database,
    ids: readonly string[],
  ): Promise<ExistingRelationState[]> {
    if (ids.length === 0) return [];
    const result = await database.query<RelationStateRow>(
      `select relation.id,
              relation.cause_event_id,
              relation.effect_event_id,
              relation.description,
              relation.confidence,
              relation.baseline_confidence,
              relation.baseline_case_count,
              coalesce((
                select array_agg(link.concrete_case_id order by link.concrete_case_id)
                from causal_relation_cases link
                where link.causal_relation_id = relation.id
              ), array[]::uuid[]) as case_ids,
              relation.updated_at
       from causal_relations relation
       where relation.id = any($1::uuid[])
       order by relation.id`,
      [[...new Set(ids)]],
    );
    return result.rows.map(relationState);
  }

  private async loadLinks(
    database: Database,
    links: readonly LinkIdentity[],
  ): Promise<ExistingLinkState[]> {
    if (links.length === 0) return [];
    const result = await database.query<LinkStateRow>(
      `with input as (
         select "relationId"::uuid as relation_id, "caseId"::uuid as case_id
         from jsonb_to_recordset($1::jsonb)
           as source("relationId" text, "caseId" text)
       )
       select input.relation_id,
              input.case_id,
              stored.causal_relation_id is not null as exists,
              stored.linked_at
       from input
       left join causal_relation_cases stored
         on stored.causal_relation_id = input.relation_id
        and stored.concrete_case_id = input.case_id
       order by input.relation_id, input.case_id`,
      [JSON.stringify(links)],
    );
    return result.rows.map(linkState);
  }
}
