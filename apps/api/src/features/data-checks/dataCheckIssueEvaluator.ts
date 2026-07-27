import type {
  DataCheckActionContext,
  DataCheckActionImpact,
  DataCheckActionOption,
  DataCheckActionRecord,
  DataCheckIssue,
  DataCheckIssueType,
  DataCheckPanelKind,
  DataCheckTargetType,
} from '@causality/contracts';
import { dataCheckIssueTypes } from '@causality/contracts';
import { buildSemanticDocument, hashSemanticDocument } from '@causality/semantic-core';
import type { PoolClient } from 'pg';

import { authorizeDataCheckActions } from './dataCheckActionKey.js';

export type DataCheckIssueEvaluation = 'present' | 'resolved' | 'missing' | 'unavailable';

export interface DataCheckIssueEvaluator {
  readonly panelKind: DataCheckPanelKind;
  loadContext(client: PoolClient, issue: DataCheckIssue): Promise<DataCheckActionRecord[]>;
  evaluate(client: PoolClient, issue: DataCheckIssue): Promise<DataCheckIssueEvaluation>;
  buildActions(
    client: PoolClient,
    issue: DataCheckIssue,
    records: readonly DataCheckActionRecord[],
  ): Promise<DataCheckActionOption[]>;
}

export const knownDataCheckIssueTypes = dataCheckIssueTypes;

const zeroImpact: DataCheckActionImpact = {
  relationsMoved: 0,
  relationsDeleted: 0,
  relationCaseLinksMoved: 0,
  relationCaseLinksDeleted: 0,
  recordsDeleted: 0,
  recordsUpdated: 0,
};

function action(
  type: DataCheckActionOption['type'],
  label: string,
  values: Partial<Omit<DataCheckActionOption, 'type' | 'label'>> = {},
): DataCheckActionOption {
  return {
    type,
    label,
    keepId: null,
    mergeId: null,
    actionKey: null,
    impact: zeroImpact,
    ...values,
  };
}

interface RecordRow {
  id: string;
  title: string;
  primary_text: string;
  secondary_text: string[];
  detail_path: string | null;
  relation_count: number;
  case_count: number;
}

async function loadRecord(
  client: PoolClient,
  targetType: DataCheckTargetType,
  id: string,
  relatedId: string | null = null,
): Promise<DataCheckActionRecord | null> {
  let result;
  switch (targetType) {
    case 'event':
      result = await client.query<RecordRow>(
        `select event.id::text as id,
                '原子事件'::text as title,
                event.name::text as primary_text,
                array_remove(array[
                  event.description,
                  (
                    select case when count(*) = 0 then null
                                else '别名：' || string_agg(alias.alias, '、'
                                  order by alias.normalized_alias, alias.id) end
                    from event_aliases alias where alias.event_id = event.id
                  ),
                  (
                    select case when count(*) = 0 then null
                                else '关键词：' || string_agg(keyword.keyword, '、'
                                  order by keyword.position, keyword.id) end
                    from event_keywords keyword where keyword.event_id = event.id
                  )
                ], null)::text[] as secondary_text,
                ('/events/' || event.id)::text as detail_path,
                (
                  select count(*)::int from causal_relations relation
                  where relation.cause_event_id = event.id or relation.effect_event_id = event.id
                ) as relation_count,
                (
                  select count(distinct link.concrete_case_id)::int
                  from causal_relations relation
                  join causal_relation_cases link on link.causal_relation_id = relation.id
                  where relation.cause_event_id = event.id or relation.effect_event_id = event.id
                ) as case_count
         from abstract_events event
         where event.id::text = $1`,
        [id],
      );
      break;
    case 'case':
      result = await client.query<RecordRow>(
        `select concrete_case.id::text as id,
                '具体案例'::text as title,
                concrete_case.content::text as primary_text,
                array[]::text[] as secondary_text,
                ('/cases/' || concrete_case.id)::text as detail_path,
                count(link.causal_relation_id)::int as relation_count,
                0::int as case_count
         from concrete_cases concrete_case
         left join causal_relation_cases link on link.concrete_case_id = concrete_case.id
         where concrete_case.id::text = $1
         group by concrete_case.id`,
        [id],
      );
      break;
    case 'relation':
      result = await client.query<RecordRow>(
        `select relation.id::text as id,
                '因果关系'::text as title,
                (coalesce(cause.name, '缺失原因事件') || ' → ' ||
                 coalesce(effect.name, '缺失结果事件'))::text as primary_text,
                array_remove(array[
                  relation.description,
                  ('置信度：' || relation.confidence || '%')::text
                ], null)::text[] as secondary_text,
                ('/relations/' || relation.id)::text as detail_path,
                0::int as relation_count,
                count(link.concrete_case_id)::int as case_count
         from causal_relations relation
         left join abstract_events cause on cause.id = relation.cause_event_id
         left join abstract_events effect on effect.id = relation.effect_event_id
         left join causal_relation_cases link on link.causal_relation_id = relation.id
         where relation.id::text = $1
         group by relation.id, cause.name, effect.name`,
        [id],
      );
      break;
    case 'alias':
      result = await client.query<RecordRow>(
        `select alias.id::text as id,
                '事件别名'::text as title,
                alias.alias::text as primary_text,
                array[coalesce(event.name, '缺失原子事件')]::text[] as secondary_text,
                case when event.id is null then null
                     else ('/events/' || event.id)::text end as detail_path,
                0::int as relation_count,
                0::int as case_count
         from event_aliases alias
         left join abstract_events event on event.id = alias.event_id
         where alias.id::text = $1`,
        [id],
      );
      break;
    case 'keyword':
      result = await client.query<RecordRow>(
        `select keyword.id::text as id,
                '事件关键词'::text as title,
                keyword.keyword::text as primary_text,
                array[
                  coalesce(event.name, '缺失原子事件'),
                  ('位置：' || keyword.position)::text
                ]::text[] as secondary_text,
                case when event.id is null then null
                     else ('/events/' || event.id)::text end as detail_path,
                0::int as relation_count,
                0::int as case_count
         from event_keywords keyword
         left join abstract_events event on event.id = keyword.event_id
         where keyword.id::text = $1`,
        [id],
      );
      break;
    case 'relation_case':
      if (!relatedId) return null;
      result = await client.query<RecordRow>(
        `select link.causal_relation_id::text as id,
                '关系与案例关联'::text as title,
                (coalesce(cause.name, '缺失原因事件') || ' → ' ||
                 coalesce(effect.name, '缺失结果事件'))::text as primary_text,
                array[coalesce(concrete_case.content, '缺失具体案例')]::text[] as secondary_text,
                case when relation.id is null then null
                     else ('/relations/' || relation.id)::text end as detail_path,
                0::int as relation_count,
                case when concrete_case.id is null then 0 else 1 end::int as case_count
         from causal_relation_cases link
         left join causal_relations relation on relation.id = link.causal_relation_id
         left join abstract_events cause on cause.id = relation.cause_event_id
         left join abstract_events effect on effect.id = relation.effect_event_id
         left join concrete_cases concrete_case on concrete_case.id = link.concrete_case_id
         where link.causal_relation_id::text = $1
           and link.concrete_case_id::text = $2`,
        [id, relatedId],
      );
      break;
  }
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        targetType,
        title: row.title,
        primaryText: row.primary_text,
        secondaryText: row.secondary_text,
        detailPath: row.detail_path,
        relationCount: Number(row.relation_count),
        caseCount: Number(row.case_count),
      }
    : null;
}

async function targetExists(client: PoolClient, issue: DataCheckIssue): Promise<boolean> {
  if (issue.targetType === 'relation_case') {
    if (!issue.relatedId) return false;
    const result = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from causal_relation_cases
         where causal_relation_id::text = $1 and concrete_case_id::text = $2
       ) as exists`,
      [issue.targetId, issue.relatedId],
    );
    return result.rows[0]?.exists ?? false;
  }
  const tables: Record<Exclude<DataCheckTargetType, 'relation_case'>, string> = {
    event: 'abstract_events',
    relation: 'causal_relations',
    case: 'concrete_cases',
    alias: 'event_aliases',
    keyword: 'event_keywords',
  };
  const result = await client.query<{ exists: boolean }>(
    `select exists (select 1 from ${tables[issue.targetType]} where id::text = $1) as exists`,
    [issue.targetId],
  );
  return result.rows[0]?.exists ?? false;
}

async function evaluateSql(
  client: PoolClient,
  issue: DataCheckIssue,
  predicateSql: string,
): Promise<DataCheckIssueEvaluation> {
  if (!(await targetExists(client, issue))) return 'missing';
  const result = await client.query<{ present: boolean }>(
    `select exists (${predicateSql}) as present`,
    predicateSql.includes('$2') ? [issue.targetId, issue.relatedId] : [issue.targetId],
  );
  return result.rows[0]?.present ? 'present' : 'resolved';
}

async function loadDefaultContext(
  client: PoolClient,
  issue: DataCheckIssue,
): Promise<DataCheckActionRecord[]> {
  const record = await loadRecord(client, issue.targetType, issue.targetId, issue.relatedId);
  return record ? [record] : [];
}

async function loadPairContext(
  client: PoolClient,
  issue: DataCheckIssue,
): Promise<DataCheckActionRecord[]> {
  if (!issue.relatedId) return loadDefaultContext(client, issue);
  const [target, related] = await Promise.all([
    loadRecord(client, issue.targetType, issue.targetId),
    loadRecord(client, issue.targetType, issue.relatedId),
  ]);
  return [target, related].filter((record): record is DataCheckActionRecord => record !== null);
}

interface MergeImpactRow {
  relations_moved: number;
  relations_deleted: number;
  links_moved: number;
  links_deleted: number;
}

async function mergeImpact(
  client: PoolClient,
  targetType: DataCheckTargetType,
  keepId: string,
  mergeId: string,
): Promise<DataCheckActionImpact> {
  if (targetType === 'event') {
    const result = await client.query<MergeImpactRow>(
      `with redirected as (
         select relation.id,
                case when relation.cause_event_id::text = $2 then $1::uuid
                     else relation.cause_event_id end as next_cause_id,
                case when relation.effect_event_id::text = $2 then $1::uuid
                     else relation.effect_event_id end as next_effect_id
         from causal_relations relation
         where relation.cause_event_id::text = $2 or relation.effect_event_id::text = $2
       ), classified as (
         select redirected.id,
                redirected.next_cause_id = redirected.next_effect_id as self_loop,
                existing.id as collision_id
         from redirected
         left join causal_relations existing
           on existing.cause_event_id = redirected.next_cause_id
          and existing.effect_event_id = redirected.next_effect_id
          and existing.id <> redirected.id
       )
       select count(*) filter (where not self_loop and collision_id is null)::int
                as relations_moved,
              count(*) filter (where self_loop or collision_id is not null)::int
                as relations_deleted,
              coalesce(sum((
                select count(*) from causal_relation_cases link
                where link.causal_relation_id = classified.id
                  and collision_id is not null
                  and not exists (
                    select 1 from causal_relation_cases retained
                    where retained.causal_relation_id = collision_id
                      and retained.concrete_case_id = link.concrete_case_id
                  )
              )), 0)::int as links_moved,
              coalesce(sum((
                select count(*) from causal_relation_cases link
                where link.causal_relation_id = classified.id
                  and (
                    self_loop or (
                      collision_id is not null and exists (
                        select 1 from causal_relation_cases retained
                        where retained.causal_relation_id = collision_id
                          and retained.concrete_case_id = link.concrete_case_id
                      )
                    )
                  )
              )), 0)::int as links_deleted
       from classified`,
      [keepId, mergeId],
    );
    const row = result.rows[0]!;
    return {
      relationsMoved: Number(row.relations_moved),
      relationsDeleted: Number(row.relations_deleted),
      relationCaseLinksMoved: Number(row.links_moved),
      relationCaseLinksDeleted: Number(row.links_deleted),
      recordsDeleted: 1,
      recordsUpdated: 0,
    };
  }
  const table =
    targetType === 'case'
      ? {
          sourceColumn: 'concrete_case_id',
          otherColumn: 'causal_relation_id',
          linkTable: 'causal_relation_cases',
        }
      : {
          sourceColumn: 'causal_relation_id',
          otherColumn: 'concrete_case_id',
          linkTable: 'causal_relation_cases',
        };
  const result = await client.query<{ moved: number; deleted: number }>(
    `select count(*) filter (where retained.${table.otherColumn} is null)::int as moved,
            count(*) filter (where retained.${table.otherColumn} is not null)::int as deleted
     from ${table.linkTable} source
     left join ${table.linkTable} retained
       on retained.${table.sourceColumn}::text = $1
      and retained.${table.otherColumn} = source.${table.otherColumn}
     where source.${table.sourceColumn}::text = $2`,
    [keepId, mergeId],
  );
  return {
    ...zeroImpact,
    relationCaseLinksMoved: Number(result.rows[0]?.moved ?? 0),
    relationCaseLinksDeleted: Number(result.rows[0]?.deleted ?? 0),
    recordsDeleted: 1,
  };
}

function mergeEvaluator(predicateSql: string): DataCheckIssueEvaluator {
  return {
    panelKind: 'merge',
    loadContext: loadPairContext,
    evaluate: (client, issue) => evaluateSql(client, issue, predicateSql),
    async buildActions(client, issue, records) {
      if (!issue.relatedId || records.length !== 2) return [];
      const directions = [
        { keepId: issue.targetId, mergeId: issue.relatedId, label: '保留记录 A，合并记录 B' },
        { keepId: issue.relatedId, mergeId: issue.targetId, label: '保留记录 B，合并记录 A' },
      ];
      const options = await Promise.all(
        directions.map(async (direction) =>
          action('merge', direction.label, {
            keepId: direction.keepId,
            mergeId: direction.mergeId,
            impact: await mergeImpact(
              client,
              issue.targetType,
              direction.keepId,
              direction.mergeId,
            ),
          }),
        ),
      );
      return [...options, action('ignore', '忽略此问题')];
    },
  };
}

async function currentSemanticSourceHash(
  client: PoolClient,
  entityType: 'event' | 'case',
  entityId: string,
): Promise<string | null> {
  if (entityType === 'case') {
    const result = await client.query<{ content: string }>(
      `select content from concrete_cases where id::text = $1`,
      [entityId],
    );
    const row = result.rows[0];
    return row
      ? hashSemanticDocument(buildSemanticDocument({ type: 'case', content: row.content }))
      : null;
  }
  const result = await client.query<{
    name: string;
    description: string | null;
    aliases: string[];
    keywords: string[];
  }>(
    `select event.name,
            event.description,
            coalesce(
              (
                select array_agg(alias.alias order by alias.normalized_alias, alias.id)
                from event_aliases alias where alias.event_id = event.id
              ),
              array[]::varchar[]
            ) as aliases,
            coalesce(
              (
                select array_agg(keyword.keyword order by keyword.position, keyword.id)
                from event_keywords keyword where keyword.event_id = event.id
              ),
              array[]::varchar[]
            ) as keywords
     from abstract_events event where event.id::text = $1`,
    [entityId],
  );
  const row = result.rows[0];
  return row
    ? hashSemanticDocument(
        buildSemanticDocument({
          type: 'event',
          name: row.name,
          aliases: row.aliases,
          keywords: row.keywords,
          description: row.description,
        }),
      )
    : null;
}

function semanticPairSql(entityType: 'event' | 'case'): string {
  const table = entityType === 'event' ? 'abstract_events' : 'concrete_cases';
  const textColumn = entityType === 'event' ? 'normalized_name' : 'content';
  const candidates = (sourceParameter: '$1' | '$2') => `
    select candidate.entity_id::text as candidate_id
    from semantic_index_state state
    join semantic_model_settings setting on setting.model_code = state.active_model_code
    join semantic_embeddings source
      on source.model_code = setting.model_code
     and source.entity_type = '${entityType}'
     and source.entity_id::text = ${sourceParameter}
    join ${table} source_record on source_record.id = source.entity_id
    join semantic_embeddings candidate
      on candidate.model_code = setting.model_code
     and candidate.entity_type = '${entityType}'
     and candidate.entity_id <> source.entity_id
    join ${table} candidate_record on candidate_record.id = candidate.entity_id
    where state.singleton_key = true
      and state.status in ('ready', 'incomplete')
      and source_record.${textColumn} <> candidate_record.${textColumn}
      and 1 - (candidate.embedding <=> source.embedding)
            >= setting.dedupe_threshold::float8 / 100
    order by candidate.embedding <=> source.embedding, candidate.entity_id
    limit 5
  `;
  return `
    select (
      exists (select 1 from (${candidates('$1')}) ranked where candidate_id = $2)
      or exists (select 1 from (${candidates('$2')}) ranked where candidate_id = $1)
    ) as present
  `;
}

function semanticMergeEvaluator(entityType: 'event' | 'case'): DataCheckIssueEvaluator {
  const base = mergeEvaluator('select 1 where false');
  return {
    ...base,
    async evaluate(client, issue) {
      if (!(await targetExists(client, issue)) || !issue.relatedId) return 'missing';
      const relatedIssue = { ...issue, targetId: issue.relatedId };
      if (!(await targetExists(client, relatedIssue))) return 'missing';
      const state = await client.query<{ active_model_code: string; status: string }>(
        `select active_model_code, status
         from semantic_index_state
         where singleton_key = true`,
      );
      const currentState = state.rows[0];
      if (
        !currentState?.active_model_code ||
        !['ready', 'incomplete'].includes(currentState.status)
      ) {
        return 'unavailable';
      }
      const [targetHash, relatedHash] = await Promise.all([
        currentSemanticSourceHash(client, entityType, issue.targetId),
        currentSemanticSourceHash(client, entityType, issue.relatedId),
      ]);
      const embeddings = await client.query<{ entity_id: string; source_hash: string }>(
        `select entity_id::text, source_hash
         from semantic_embeddings
         where model_code = $1
           and entity_type = $2
           and entity_id::text = any($3::text[])
         order by entity_id`,
        [currentState.active_model_code, entityType, [issue.targetId, issue.relatedId].sort()],
      );
      const hashes = new Map(embeddings.rows.map((row) => [row.entity_id, row.source_hash]));
      if (
        !targetHash ||
        !relatedHash ||
        hashes.get(issue.targetId) !== targetHash ||
        hashes.get(issue.relatedId) !== relatedHash
      ) {
        return 'unavailable';
      }
      const result = await client.query<{ present: boolean }>(semanticPairSql(entityType), [
        issue.targetId,
        issue.relatedId,
      ]);
      return result.rows[0]?.present ? 'present' : 'resolved';
    },
  };
}

type CleanupImpactKind = 'record' | 'relation_case' | 'resequence';

function cleanupEvaluator(
  predicateSql: string,
  impactKind: CleanupImpactKind = 'record',
): DataCheckIssueEvaluator {
  return {
    panelKind: 'cleanup',
    loadContext: loadDefaultContext,
    evaluate: (client, issue) => evaluateSql(client, issue, predicateSql),
    async buildActions(client, issue) {
      let impact: DataCheckActionImpact;
      if (impactKind === 'relation_case') {
        impact = { ...zeroImpact, relationCaseLinksDeleted: 1 };
      } else if (impactKind === 'resequence') {
        const keywords = await client.query<{ count: number }>(
          `select count(*)::int as count
           from event_keywords
           where event_id::text = $1`,
          [issue.targetId],
        );
        impact = {
          ...zeroImpact,
          recordsUpdated: Number(keywords.rows[0]?.count ?? 0),
        };
      } else {
        impact = { ...zeroImpact, recordsDeleted: 1 };
      }
      return [
        action('cleanup', '清理此问题', {
          impact,
        }),
        action('ignore', '忽略此问题'),
      ];
    },
  };
}

function standardEvaluator(
  panelKind: Extract<DataCheckPanelKind, 'manual' | 'delete_relation' | 'repair_timestamp'>,
  predicateSql: string,
): DataCheckIssueEvaluator {
  return {
    panelKind,
    loadContext: loadDefaultContext,
    evaluate: (client, issue) => evaluateSql(client, issue, predicateSql),
    async buildActions(client, issue) {
      const options: DataCheckActionOption[] = [];
      if (panelKind === 'delete_relation') {
        const links = await client.query<{ count: number }>(
          `select count(*)::int as count
           from causal_relation_cases where causal_relation_id::text = $1`,
          [issue.targetId],
        );
        options.push(
          action('delete_relation', '删除此因果关系', {
            impact: {
              ...zeroImpact,
              relationsDeleted: 1,
              relationCaseLinksDeleted: Number(links.rows[0]?.count ?? 0),
              recordsDeleted: 1,
            },
          }),
        );
      } else if (panelKind === 'repair_timestamp') {
        options.push(
          action('repair_timestamp', '修复时间顺序', {
            impact: { ...zeroImpact, recordsUpdated: 1 },
          }),
        );
      }
      options.push(action('ignore', '忽略此问题'));
      return options;
    },
  };
}

const duplicateEventPredicate = `
  select 1
  from abstract_events target
  join abstract_events related on related.id::text = $2
  where target.id::text = $1 and target.normalized_name = related.normalized_name
`;
const duplicateCasePredicate = `
  select 1
  from concrete_cases target
  join concrete_cases related on related.id::text = $2
  where target.id::text = $1 and target.content = related.content
`;
const duplicateRelationPredicate = `
  select 1
  from causal_relations target
  join causal_relations related on related.id::text = $2
  where target.id::text = $1
    and target.cause_event_id = related.cause_event_id
    and target.effect_event_id = related.effect_event_id
`;
export const issueEvaluatorRegistry = {
  duplicate_event_name: mergeEvaluator(duplicateEventPredicate),
  duplicate_case_content: mergeEvaluator(duplicateCasePredicate),
  duplicate_relation_direction: mergeEvaluator(duplicateRelationPredicate),
  semantic_duplicate_event: semanticMergeEvaluator('event'),
  semantic_duplicate_case: semanticMergeEvaluator('case'),
  cross_event_alias_name: mergeEvaluator(`
    select 1 from event_aliases alias
    join abstract_events related on related.id::text = $2
    where alias.event_id::text = $1 and alias.normalized_alias = related.normalized_name
  `),
  cross_event_shared_alias: mergeEvaluator(`
    select 1 from event_aliases left_alias
    join event_aliases right_alias
      on right_alias.event_id::text = $2
     and right_alias.normalized_alias = left_alias.normalized_alias
    where left_alias.event_id::text = $1
  `),

  delete_missing_alias: cleanupEvaluator(`
    select 1 from event_aliases alias
    left join abstract_events event on event.id = alias.event_id
    where alias.id::text = $1 and event.id is null
  `),
  delete_missing_keyword: cleanupEvaluator(`
    select 1 from event_keywords keyword
    left join abstract_events event on event.id = keyword.event_id
    where keyword.id::text = $1 and event.id is null
  `),
  delete_missing_relation_case: cleanupEvaluator(
    `
      select 1 from causal_relation_cases link
      left join causal_relations relation on relation.id = link.causal_relation_id
      left join concrete_cases concrete_case on concrete_case.id = link.concrete_case_id
      where link.causal_relation_id::text = $1
        and link.concrete_case_id::text = $2
        and (relation.id is null or concrete_case.id is null)
    `,
    'relation_case',
  ),
  delete_duplicate_alias: cleanupEvaluator(`
    select 1 from event_aliases target
    join event_aliases retained on retained.id::text = $2
    where target.id::text = $1
      and target.event_id = retained.event_id
      and target.normalized_alias = retained.normalized_alias
  `),
  delete_duplicate_keyword: cleanupEvaluator(`
    select 1 from event_keywords target
    join event_keywords retained on retained.id::text = $2
    where target.id::text = $1
      and target.event_id = retained.event_id
      and target.normalized_keyword = retained.normalized_keyword
  `),
  resequence_keywords: cleanupEvaluator(
    `
    select 1 from event_keywords
    where event_id::text = $1
    group by event_id
    having min(position) <> 1 or max(position) > 20 or max(position) <> count(*)
       or count(distinct position) <> count(*)
  `,
    'resequence',
  ),

  relation_self_loop: standardEvaluator(
    'delete_relation',
    `select 1 from causal_relations where id::text = $1 and cause_event_id = effect_event_id`,
  ),
  missing_relation_cause_event: standardEvaluator(
    'delete_relation',
    `select 1 from causal_relations relation
     left join abstract_events event on event.id = relation.cause_event_id
     where relation.id::text = $1 and event.id is null`,
  ),
  missing_relation_effect_event: standardEvaluator(
    'delete_relation',
    `select 1 from causal_relations relation
     left join abstract_events event on event.id = relation.effect_event_id
     where relation.id::text = $1 and event.id is null`,
  ),

  invalid_event_timestamp_order: standardEvaluator(
    'repair_timestamp',
    `select 1 from abstract_events where id::text = $1 and updated_at < created_at`,
  ),
  invalid_relation_timestamp_order: standardEvaluator(
    'repair_timestamp',
    `select 1 from causal_relations where id::text = $1 and updated_at < created_at`,
  ),
  invalid_case_timestamp_order: standardEvaluator(
    'repair_timestamp',
    `select 1 from concrete_cases where id::text = $1 and updated_at < created_at`,
  ),

  invalid_event_name: standardEvaluator(
    'manual',
    `select 1 from abstract_events
     where id::text = $1 and (name <> btrim(name) or char_length(btrim(name)) not between 1 and 50)`,
  ),
  invalid_case_content: standardEvaluator(
    'manual',
    `select 1 from concrete_cases
     where id::text = $1
       and (content <> btrim(content) or char_length(btrim(content)) not between 1 and 100)`,
  ),
  invalid_alias_text: standardEvaluator(
    'manual',
    `select 1 from event_aliases
     where id::text = $1
       and (alias <> btrim(alias) or char_length(btrim(alias)) not between 1 and 80)`,
  ),
  invalid_keyword_text: standardEvaluator(
    'manual',
    `select 1 from event_keywords
     where id::text = $1
       and (keyword <> btrim(keyword) or char_length(btrim(keyword)) not between 1 and 50)`,
  ),
  invalid_event_description: standardEvaluator(
    'manual',
    `select 1 from abstract_events
     where id::text = $1 and description is not null and btrim(description) = ''`,
  ),
  invalid_relation_description: standardEvaluator(
    'manual',
    `select 1 from causal_relations
     where id::text = $1 and description is not null and btrim(description) = ''`,
  ),
  relation_confidence_range: standardEvaluator(
    'manual',
    `select 1 from causal_relations
     where id::text = $1 and (confidence < 0 or confidence > 100)`,
  ),
} satisfies Record<DataCheckIssueType, DataCheckIssueEvaluator>;

export function getDataCheckIssueEvaluator(issueType: DataCheckIssueType): DataCheckIssueEvaluator {
  return issueEvaluatorRegistry[issueType];
}

export async function buildDataCheckActionContext(
  client: PoolClient,
  issue: DataCheckIssue,
  evaluation?: DataCheckIssueEvaluation,
): Promise<DataCheckActionContext> {
  const evaluator = getDataCheckIssueEvaluator(issue.issueType);
  if (issue.status === 'handled') {
    return {
      snapshotId: issue.snapshotId,
      issueId: issue.id,
      issueType: issue.issueType,
      status: 'handled',
      panelKind: evaluator.panelKind,
      records: await evaluator.loadContext(client, issue),
      actions: [],
      message: '此问题已处理',
    };
  }
  const currentEvaluation = evaluation ?? (await evaluator.evaluate(client, issue));
  const records = await evaluator.loadContext(client, issue);
  if (currentEvaluation !== 'present') {
    return {
      snapshotId: issue.snapshotId,
      issueId: issue.id,
      issueType: issue.issueType,
      status: issue.status,
      panelKind: evaluator.panelKind,
      records,
      actions: [],
      message:
        currentEvaluation === 'missing'
          ? '目标记录已不存在，请重新执行完整数据检查'
          : currentEvaluation === 'unavailable'
            ? '语义索引尚未提供最新结果，请稍后重新执行完整数据检查'
            : '数据已变化，请重新执行完整数据检查',
    };
  }
  const actions = authorizeDataCheckActions(
    issue,
    records,
    await evaluator.buildActions(client, issue, records),
  );
  return {
    snapshotId: issue.snapshotId,
    issueId: issue.id,
    issueType: issue.issueType,
    status: issue.status,
    panelKind: evaluator.panelKind,
    records,
    actions,
    message: null,
  };
}
