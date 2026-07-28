import type { AtomicEventCandidate, ConcreteCaseCandidate } from '@causality/contracts';
import type { Pool } from 'pg';

export type EventMatchKind = 'exact_name' | 'exact_alias' | 'fuzzy' | 'semantic';
export type CaseMatchKind = 'exact_content' | 'fuzzy' | 'semantic';

export interface EventRecord {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
  updatedAt: string;
}

export interface EventMatchRow extends EventRecord {
  matchKind: EventMatchKind;
  similarity: number | null;
}

export interface CaseRecord {
  id: string;
  content: string;
  updatedAt: string;
}

export interface CaseMatchRow extends CaseRecord {
  matchKind: CaseMatchKind;
  similarity: number | null;
}

export interface ResolvedRelationProbe {
  ref: string;
  causeEventId: string;
  effectEventId: string;
}

export interface RelationRecord {
  id: string;
  causeEventId: string;
  effectEventId: string;
  description: string | null;
  confidence: number;
  caseCount: number;
  updatedAt: string;
}

export interface RelationMatch {
  ref: string;
  direction: 'existing' | 'reverse';
  relation: RelationRecord;
}

export interface ResolvedLinkProbe {
  relationRef: string;
  relationId: string;
  caseRef: string;
  caseId: string;
}

export interface LinkMatch {
  relationRef: string;
  caseRef: string;
}

export interface AiCandidateComparisonRepository {
  findEventMatches(events: readonly AtomicEventCandidate[]): Promise<EventMatchRow[][]>;
  findCaseMatches(cases: readonly ConcreteCaseCandidate[]): Promise<CaseMatchRow[][]>;
  findEventsByIds(ids: readonly string[]): Promise<EventRecord[]>;
  findCasesByIds(ids: readonly string[]): Promise<CaseRecord[]>;
  findRelationMatches(relations: readonly ResolvedRelationProbe[]): Promise<RelationMatch[]>;
  findLinkMatches(links: readonly ResolvedLinkProbe[]): Promise<LinkMatch[]>;
}

interface EventRow {
  input_index: number;
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
  match_kind: Exclude<EventMatchKind, 'semantic'>;
  similarity: number | string | null;
  updated_at: Date;
}

interface EventRecordRow {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
  updated_at: Date;
}

interface CaseRow {
  input_index: number;
  id: string;
  content: string;
  match_kind: Exclude<CaseMatchKind, 'semantic'>;
  similarity: number | string | null;
  updated_at: Date;
}

interface CaseRecordRow {
  id: string;
  content: string;
  updated_at: Date;
}

interface RelationRow {
  ref: string;
  direction: 'existing' | 'reverse';
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  description: string | null;
  confidence: number | string;
  case_count: number;
  updated_at: Date;
}

interface LinkRow {
  relation_ref: string;
  case_ref: string;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function eventRecord(row: EventRecordRow): EventRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    aliases: row.aliases,
    keywords: row.keywords,
    updatedAt: row.updated_at.toISOString(),
  };
}

function caseRecord(row: CaseRecordRow): CaseRecord {
  return {
    id: row.id,
    content: row.content,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresAiCandidateComparisonRepository implements AiCandidateComparisonRepository {
  public constructor(private readonly pool: Pool) {}

  public async findEventMatches(
    events: readonly AtomicEventCandidate[],
  ): Promise<EventMatchRow[][]> {
    if (events.length === 0) return [];
    const inputs = events.map((event, inputIndex) => ({
      inputIndex,
      name: normalize(event.name),
      terms: [...new Set([event.name, ...event.aliases].map(normalize))],
    }));
    const result = await this.pool.query<EventRow>(
      `with input as (
         select "inputIndex" as input_index, name, terms
         from jsonb_to_recordset($1::jsonb)
           as source("inputIndex" integer, name text, terms jsonb)
       )
       select input.input_index,
              candidate.id,
              candidate.name,
              candidate.description,
              candidate.aliases,
              candidate.keywords,
              candidate.match_kind,
              candidate.similarity,
              candidate.updated_at
       from input
       join lateral (
         select event.id,
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
                case
                  when event.normalized_name = input.name then 'exact_name'
                  when event.normalized_name in (
                         select value from jsonb_array_elements_text(input.terms) value
                         where value <> input.name
                       )
                    or exists (
                      select 1
                      from event_aliases alias
                      where alias.event_id = event.id
                        and alias.normalized_alias in (
                          select value from jsonb_array_elements_text(input.terms) value
                        )
                    ) then 'exact_alias'
                  else 'fuzzy'
                end as match_kind,
                case
                  when event.normalized_name = input.name
                    or event.normalized_name in (
                      select value from jsonb_array_elements_text(input.terms) value
                      where value <> input.name
                    )
                    or exists (
                      select 1
                      from event_aliases alias
                      where alias.event_id = event.id
                        and alias.normalized_alias in (
                          select value from jsonb_array_elements_text(input.terms) value
                        )
                    ) then null
                  else score.similarity
                end::float8 as similarity,
                event.updated_at
         from abstract_events event
         cross join lateral (
           select max(
             greatest(
               similarity(event.normalized_name, term.value),
               coalesce((
                 select max(similarity(alias.normalized_alias, term.value))
                 from event_aliases alias
                 where alias.event_id = event.id
               ), 0)
             )
           ) as similarity
           from jsonb_array_elements_text(input.terms) term(value)
         ) score
         where event.normalized_name in (
                 select value from jsonb_array_elements_text(input.terms) value
               )
            or exists (
                 select 1
                 from event_aliases alias
                 where alias.event_id = event.id
                   and alias.normalized_alias in (
                     select value from jsonb_array_elements_text(input.terms) value
                   )
               )
            or exists (
                 select 1
                 from jsonb_array_elements_text(input.terms) term(value)
                 where event.normalized_name like term.value || '%'
                    or term.value like event.normalized_name || '%'
                    or event.normalized_name % term.value
                    or exists (
                      select 1
                      from event_aliases alias
                      where alias.event_id = event.id
                        and (
                          alias.normalized_alias like term.value || '%'
                          or term.value like alias.normalized_alias || '%'
                          or alias.normalized_alias % term.value
                        )
                    )
               )
         order by
           case
             when event.normalized_name = input.name then 1
             when event.normalized_name in (
                    select value from jsonb_array_elements_text(input.terms) value
                    where value <> input.name
                  )
               or exists (
                 select 1
                 from event_aliases alias
                 where alias.event_id = event.id
                   and alias.normalized_alias in (
                     select value from jsonb_array_elements_text(input.terms) value
                   )
               ) then 2
             else 3
           end,
           score.similarity desc,
           event.updated_at desc,
           event.id
         limit 10
       ) candidate on true
       order by input.input_index,
                case candidate.match_kind
                  when 'exact_name' then 1
                  when 'exact_alias' then 2
                  else 3
                end,
                candidate.similarity desc nulls last,
                candidate.updated_at desc,
                candidate.id`,
      [JSON.stringify(inputs)],
    );

    const matches = Array.from({ length: events.length }, () => [] as EventMatchRow[]);
    for (const row of result.rows) {
      matches[row.input_index]?.push({
        ...eventRecord(row),
        matchKind: row.match_kind,
        similarity: row.similarity === null ? null : Number(row.similarity),
      });
    }
    return matches;
  }

  public async findCaseMatches(cases: readonly ConcreteCaseCandidate[]): Promise<CaseMatchRow[][]> {
    if (cases.length === 0) return [];
    const inputs = cases.map((concreteCase, inputIndex) => ({
      inputIndex,
      content: concreteCase.content,
      normalizedContent: normalize(concreteCase.content),
    }));
    const result = await this.pool.query<CaseRow>(
      `with input as (
         select "inputIndex" as input_index, content, "normalizedContent" as normalized_content
         from jsonb_to_recordset($1::jsonb)
           as source(
             "inputIndex" integer,
             content text,
             "normalizedContent" text
           )
       )
       select input.input_index,
              candidate.id,
              candidate.content,
              candidate.match_kind,
              candidate.similarity,
              candidate.updated_at
       from input
       join lateral (
         select concrete_case.id,
                concrete_case.content,
                case
                  when concrete_case.content = input.content then 'exact_content'
                  else 'fuzzy'
                end as match_kind,
                case
                  when concrete_case.content = input.content then null
                  else similarity(lower(concrete_case.content), input.normalized_content)
                end::float8 as similarity,
                concrete_case.updated_at
         from concrete_cases concrete_case
         where concrete_case.content = input.content
            or lower(concrete_case.content) like input.normalized_content || '%'
            or input.normalized_content like lower(concrete_case.content) || '%'
            or lower(concrete_case.content) % input.normalized_content
         order by
           case when concrete_case.content = input.content then 1 else 2 end,
           similarity(lower(concrete_case.content), input.normalized_content) desc,
           concrete_case.updated_at desc,
           concrete_case.id
         limit 10
       ) candidate on true
       order by input.input_index,
                case candidate.match_kind when 'exact_content' then 1 else 2 end,
                candidate.similarity desc nulls last,
                candidate.updated_at desc,
                candidate.id`,
      [JSON.stringify(inputs)],
    );

    const matches = Array.from({ length: cases.length }, () => [] as CaseMatchRow[]);
    for (const row of result.rows) {
      matches[row.input_index]?.push({
        ...caseRecord(row),
        matchKind: row.match_kind,
        similarity: row.similarity === null ? null : Number(row.similarity),
      });
    }
    return matches;
  }

  public async findEventsByIds(ids: readonly string[]): Promise<EventRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query<EventRecordRow>(
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
    return result.rows.map(eventRecord);
  }

  public async findCasesByIds(ids: readonly string[]): Promise<CaseRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query<CaseRecordRow>(
      `select id, content, updated_at
       from concrete_cases
       where id = any($1::uuid[])
       order by id`,
      [[...new Set(ids)]],
    );
    return result.rows.map(caseRecord);
  }

  public async findRelationMatches(
    relations: readonly ResolvedRelationProbe[],
  ): Promise<RelationMatch[]> {
    if (relations.length === 0) return [];
    const result = await this.pool.query<RelationRow>(
      `with input as (
         select ref, "causeEventId"::uuid as cause_event_id,
                "effectEventId"::uuid as effect_event_id
         from jsonb_to_recordset($1::jsonb)
           as source(ref text, "causeEventId" text, "effectEventId" text)
       )
       select input.ref,
              case
                when relation.cause_event_id = input.cause_event_id
                  and relation.effect_event_id = input.effect_event_id
                then 'existing'
                else 'reverse'
              end as direction,
              relation.id,
              relation.cause_event_id,
              relation.effect_event_id,
              relation.description,
              relation.confidence,
              (select count(*)::int
               from causal_relation_cases link
               where link.causal_relation_id = relation.id) as case_count,
              relation.updated_at
       from input
       join causal_relations relation
         on (relation.cause_event_id = input.cause_event_id
             and relation.effect_event_id = input.effect_event_id)
         or (relation.cause_event_id = input.effect_event_id
             and relation.effect_event_id = input.cause_event_id)
       order by input.ref,
                case
                  when relation.cause_event_id = input.cause_event_id
                    and relation.effect_event_id = input.effect_event_id
                  then 1
                  else 2
                end,
                relation.id`,
      [JSON.stringify(relations)],
    );
    return result.rows.map((row) => ({
      ref: row.ref,
      direction: row.direction,
      relation: {
        id: row.id,
        causeEventId: row.cause_event_id,
        effectEventId: row.effect_event_id,
        description: row.description,
        confidence: Number(row.confidence),
        caseCount: Number(row.case_count),
        updatedAt: row.updated_at.toISOString(),
      },
    }));
  }

  public async findLinkMatches(links: readonly ResolvedLinkProbe[]): Promise<LinkMatch[]> {
    if (links.length === 0) return [];
    const result = await this.pool.query<LinkRow>(
      `with input as (
         select "relationRef" as relation_ref,
                "relationId"::uuid as relation_id,
                "caseRef" as case_ref,
                "caseId"::uuid as case_id
         from jsonb_to_recordset($1::jsonb)
           as source(
             "relationRef" text,
             "relationId" text,
             "caseRef" text,
             "caseId" text
           )
       )
       select input.relation_ref, input.case_ref
       from input
       join causal_relation_cases link
         on link.causal_relation_id = input.relation_id
        and link.concrete_case_id = input.case_id
       order by input.relation_ref, input.case_ref`,
      [JSON.stringify(links)],
    );
    return result.rows.map((row) => ({
      relationRef: row.relation_ref,
      caseRef: row.case_ref,
    }));
  }
}
