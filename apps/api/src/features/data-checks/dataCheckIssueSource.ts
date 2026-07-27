import type {
  DataCheckIssueSource,
  DataCheckIssueType,
  DataCheckTargetType,
} from '@causality/contracts';
import type { PoolClient } from 'pg';

export interface DataCheckIssueSourceInput {
  id: string;
  issueType: DataCheckIssueType;
  targetType: DataCheckTargetType;
  targetId: string;
  relatedId: string | null;
}

interface EventRow {
  id: string;
  label: string;
}

interface CaseRow {
  id: string;
  label: string;
}

interface RelationRow {
  id: string;
  cause_event_id: string;
  cause_name: string | null;
  effect_event_id: string;
  effect_name: string | null;
}

interface OwnedValueRow {
  id: string;
  event_id: string;
  value: string;
  owner_name: string | null;
}

interface KeywordRow extends OwnedValueRow {
  position: number;
}

interface RelationCaseRow {
  relation_id: string;
  case_id: string;
  cause_event_id: string | null;
  cause_name: string | null;
  effect_event_id: string | null;
  effect_name: string | null;
  case_content: string | null;
}

interface SourceFacts {
  events: Map<string, string>;
  cases: Map<string, string>;
  relations: Map<string, RelationRow>;
  aliases: Map<string, OwnedValueRow>;
  keywords: Map<string, KeywordRow>;
  keywordCounts: Map<string, number>;
  relationCases: Map<string, RelationCaseRow>;
}

type SourceItem = DataCheckIssueSource['items'][number];
type SourceRole = SourceItem['role'];

const eventPairTypes = new Set<DataCheckIssueType>([
  'duplicate_event_name',
  'cross_event_alias_name',
  'cross_event_shared_alias',
  'semantic_duplicate_event',
]);
const casePairTypes = new Set<DataCheckIssueType>([
  'duplicate_case_content',
  'semantic_duplicate_case',
]);
const relationTypes = new Set<DataCheckIssueType>([
  'relation_self_loop',
  'relation_confidence_range',
  'invalid_relation_description',
  'invalid_relation_timestamp_order',
]);
const aliasTypes = new Set<DataCheckIssueType>([
  'delete_missing_alias',
  'delete_duplicate_alias',
  'invalid_alias_text',
]);
const keywordTypes = new Set<DataCheckIssueType>([
  'delete_missing_keyword',
  'delete_duplicate_keyword',
  'invalid_keyword_text',
]);
const eventTypes = new Set<DataCheckIssueType>([
  'invalid_event_name',
  'invalid_event_description',
  'invalid_event_timestamp_order',
]);
const caseTypes = new Set<DataCheckIssueType>([
  'invalid_case_content',
  'invalid_case_timestamp_order',
]);

function unique(values: Iterable<string | null>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))].sort();
}

function relationCaseKey(relationId: string, caseId: string): string {
  return `${relationId}:${caseId}`;
}

function readableItem(
  type: SourceItem['type'],
  role: SourceRole,
  label: string,
  detailPath: string | null,
): SourceItem {
  return { type, role, label, detailPath };
}

function missingItem(role: SourceRole, label: string): SourceItem {
  return readableItem('missing', role, label, null);
}

function eventItem(facts: SourceFacts, eventId: string, role: SourceRole): SourceItem {
  const label = facts.events.get(eventId);
  return label
    ? readableItem('event', role, label, `/events/${eventId}`)
    : missingItem(
        role,
        role === 'cause'
          ? '原因事件已不存在'
          : role === 'effect'
            ? '结果事件已不存在'
            : '原子事件已不存在',
      );
}

function caseItem(facts: SourceFacts, caseId: string, role: SourceRole): SourceItem {
  const label = facts.cases.get(caseId);
  return label
    ? readableItem('case', role, label, `/cases/${caseId}`)
    : missingItem(role, '具体案例已不存在');
}

function relationSource(
  relation: RelationRow | undefined,
  relationPaths: string[],
  broken: boolean,
  auxiliaryText: string | null = null,
): DataCheckIssueSource {
  if (!relation) {
    return {
      displayKind: 'broken_reference',
      items: [missingItem('target', '因果关系已不存在')],
      relationDetailPaths: [],
      auxiliaryText,
    };
  }
  const cause = relation.cause_name
    ? readableItem('event', 'cause', relation.cause_name, `/events/${relation.cause_event_id}`)
    : missingItem('cause', '原因事件已不存在');
  const effect = relation.effect_name
    ? readableItem('event', 'effect', relation.effect_name, `/events/${relation.effect_event_id}`)
    : missingItem('effect', '结果事件已不存在');
  const complete = Boolean(relation.cause_name && relation.effect_name);
  return {
    displayKind: broken || !complete ? 'broken_reference' : 'relation',
    items: [cause, effect],
    relationDetailPaths: complete ? relationPaths : [],
    auxiliaryText,
  };
}

function pairSource(
  left: SourceItem,
  right: SourceItem,
  auxiliaryText: string | null = null,
): DataCheckIssueSource {
  return {
    displayKind: left.type === 'missing' || right.type === 'missing' ? 'broken_reference' : 'pair',
    items: [left, right],
    relationDetailPaths: [],
    auxiliaryText,
  };
}

function ownedValueSource(
  owner: SourceItem,
  type: 'alias' | 'keyword',
  value: string,
  broken: boolean,
): DataCheckIssueSource {
  return {
    displayKind: broken || owner.type === 'missing' ? 'broken_reference' : 'owned_value',
    items: [owner, readableItem(type, 'value', value, null)],
    relationDetailPaths: [],
    auxiliaryText: null,
  };
}

function buildSource(issue: DataCheckIssueSourceInput, facts: SourceFacts): DataCheckIssueSource {
  if (eventPairTypes.has(issue.issueType)) {
    return pairSource(
      eventItem(facts, issue.targetId, 'target'),
      issue.relatedId
        ? eventItem(facts, issue.relatedId, 'related')
        : missingItem('related', '相关原子事件已不存在'),
    );
  }
  if (casePairTypes.has(issue.issueType)) {
    return pairSource(
      caseItem(facts, issue.targetId, 'target'),
      issue.relatedId
        ? caseItem(facts, issue.relatedId, 'related')
        : missingItem('related', '相关具体案例已不存在'),
    );
  }
  if (issue.issueType === 'duplicate_relation_direction') {
    const relation = facts.relations.get(issue.targetId);
    const paths = unique([issue.targetId, issue.relatedId])
      .filter((id) => {
        const current = facts.relations.get(id);
        return Boolean(current?.cause_name && current.effect_name);
      })
      .map((id) => `/relations/${id}`);
    return relationSource(relation, paths, !issue.relatedId, '2 条同方向关系');
  }
  if (
    issue.issueType === 'missing_relation_cause_event' ||
    issue.issueType === 'missing_relation_effect_event'
  ) {
    return relationSource(facts.relations.get(issue.targetId), [], true);
  }
  if (relationTypes.has(issue.issueType)) {
    return relationSource(
      facts.relations.get(issue.targetId),
      [`/relations/${issue.targetId}`],
      false,
    );
  }
  if (aliasTypes.has(issue.issueType)) {
    const alias = facts.aliases.get(issue.targetId);
    if (!alias) {
      return {
        displayKind: 'broken_reference',
        items: [missingItem('target', '事件别名已不存在')],
        relationDetailPaths: [],
        auxiliaryText: null,
      };
    }
    const owner = alias.owner_name
      ? readableItem('event', 'owner', alias.owner_name, `/events/${alias.event_id}`)
      : missingItem('owner', '所属原子事件已不存在');
    return ownedValueSource(
      owner,
      'alias',
      alias.value,
      issue.issueType === 'delete_missing_alias',
    );
  }
  if (keywordTypes.has(issue.issueType)) {
    const keyword = facts.keywords.get(issue.targetId);
    if (!keyword) {
      return {
        displayKind: 'broken_reference',
        items: [missingItem('target', '事件关键词已不存在')],
        relationDetailPaths: [],
        auxiliaryText: null,
      };
    }
    const owner = keyword.owner_name
      ? readableItem('event', 'owner', keyword.owner_name, `/events/${keyword.event_id}`)
      : missingItem('owner', '所属原子事件已不存在');
    return ownedValueSource(
      owner,
      'keyword',
      keyword.value,
      issue.issueType === 'delete_missing_keyword',
    );
  }
  if (issue.issueType === 'resequence_keywords') {
    const item = eventItem(facts, issue.targetId, 'target');
    return {
      displayKind: item.type === 'missing' ? 'broken_reference' : 'single',
      items: [item],
      relationDetailPaths: [],
      auxiliaryText: `${facts.keywordCounts.get(issue.targetId) ?? 0} 个关键词`,
    };
  }
  if (eventTypes.has(issue.issueType)) {
    const item = eventItem(facts, issue.targetId, 'target');
    return {
      displayKind: item.type === 'missing' ? 'broken_reference' : 'single',
      items: [item],
      relationDetailPaths: [],
      auxiliaryText: null,
    };
  }
  if (caseTypes.has(issue.issueType)) {
    const item = caseItem(facts, issue.targetId, 'target');
    return {
      displayKind: item.type === 'missing' ? 'broken_reference' : 'single',
      items: [item],
      relationDetailPaths: [],
      auxiliaryText: null,
    };
  }
  if (issue.issueType === 'delete_missing_relation_case') {
    if (!issue.relatedId) {
      return {
        displayKind: 'broken_reference',
        items: [missingItem('target', '关系与案例关联已不存在')],
        relationDetailPaths: [],
        auxiliaryText: null,
      };
    }
    const row = facts.relationCases.get(relationCaseKey(issue.targetId, issue.relatedId));
    if (!row) {
      return {
        displayKind: 'broken_reference',
        items: [missingItem('target', '关系与案例关联已不存在')],
        relationDetailPaths: [],
        auxiliaryText: null,
      };
    }
    const items: SourceItem[] = [];
    if (row.cause_event_id && row.cause_name) {
      items.push(readableItem('event', 'cause', row.cause_name, `/events/${row.cause_event_id}`));
    } else if (!row.cause_event_id) {
      items.push(missingItem('target', '因果关系已不存在'));
    } else {
      items.push(missingItem('cause', '原因事件已不存在'));
    }
    if (row.effect_event_id && row.effect_name) {
      items.push(
        readableItem('event', 'effect', row.effect_name, `/events/${row.effect_event_id}`),
      );
    } else if (row.effect_event_id) {
      items.push(missingItem('effect', '结果事件已不存在'));
    }
    items.push(
      row.case_content
        ? readableItem('case', 'related', row.case_content, `/cases/${row.case_id}`)
        : missingItem('related', '具体案例已不存在'),
    );
    const completeRelation = Boolean(
      row.cause_event_id && row.cause_name && row.effect_event_id && row.effect_name,
    );
    return {
      displayKind: 'broken_reference',
      items,
      relationDetailPaths: completeRelation ? [`/relations/${row.relation_id}`] : [],
      auxiliaryText: null,
    };
  }

  throw new Error(`Unsupported data-check issue type: ${issue.issueType}`);
}

export async function loadDataCheckIssueSources(
  client: PoolClient,
  issues: readonly DataCheckIssueSourceInput[],
): Promise<Map<string, DataCheckIssueSource>> {
  const aliasIds = unique(
    issues.filter((issue) => issue.targetType === 'alias').map((issue) => issue.targetId),
  );
  const keywordIds = unique(
    issues.filter((issue) => issue.targetType === 'keyword').map((issue) => issue.targetId),
  );
  const keywordEventIds = unique(
    issues
      .filter((issue) => issue.issueType === 'resequence_keywords')
      .map((issue) => issue.targetId),
  );
  const relationIds = unique(
    issues.flatMap((issue) => {
      if (issue.targetType === 'relation') return [issue.targetId, issue.relatedId];
      if (issue.targetType === 'relation_case') return [issue.targetId];
      return [];
    }),
  );
  const relationCaseRelationIds: string[] = [];
  const relationCaseCaseIds: string[] = [];
  for (const issue of issues) {
    if (issue.targetType !== 'relation_case' || !issue.relatedId) continue;
    relationCaseRelationIds.push(issue.targetId);
    relationCaseCaseIds.push(issue.relatedId);
  }

  const aliasResult = await client.query<OwnedValueRow>(
    `select alias.id::text,
            alias.event_id::text,
            alias.alias::text as value,
            event.name::text as owner_name
     from event_aliases alias
     left join abstract_events event on event.id = alias.event_id
     where alias.id::text = any($1::text[])
     order by alias.id`,
    [aliasIds],
  );
  const keywordResult = await client.query<KeywordRow>(
    `select keyword.id::text,
            keyword.event_id::text,
            keyword.keyword::text as value,
            keyword.position,
            event.name::text as owner_name
     from event_keywords keyword
     left join abstract_events event on event.id = keyword.event_id
     where keyword.id::text = any($1::text[])
        or keyword.event_id::text = any($2::text[])
     order by keyword.event_id, keyword.position, keyword.id`,
    [keywordIds, keywordEventIds],
  );
  const relationResult = await client.query<RelationRow>(
    `select relation.id::text,
            relation.cause_event_id::text,
            cause.name::text as cause_name,
            relation.effect_event_id::text,
            effect.name::text as effect_name
     from causal_relations relation
     left join abstract_events cause on cause.id = relation.cause_event_id
     left join abstract_events effect on effect.id = relation.effect_event_id
     where relation.id::text = any($1::text[])
     order by relation.id`,
    [relationIds],
  );
  const relationCaseResult = await client.query<RelationCaseRow>(
    `select link.causal_relation_id::text as relation_id,
            link.concrete_case_id::text as case_id,
            relation.cause_event_id::text,
            cause.name::text as cause_name,
            relation.effect_event_id::text,
            effect.name::text as effect_name,
            concrete_case.content::text as case_content
     from causal_relation_cases link
     left join causal_relations relation on relation.id = link.causal_relation_id
     left join abstract_events cause on cause.id = relation.cause_event_id
     left join abstract_events effect on effect.id = relation.effect_event_id
     left join concrete_cases concrete_case on concrete_case.id = link.concrete_case_id
     where (link.causal_relation_id::text, link.concrete_case_id::text) in (
       select relation_id, case_id
       from unnest($1::text[], $2::text[]) as requested(relation_id, case_id)
     )
     order by link.causal_relation_id, link.concrete_case_id`,
    [relationCaseRelationIds, relationCaseCaseIds],
  );

  const directEventIds = issues.flatMap((issue) =>
    issue.targetType === 'event' ? [issue.targetId, issue.relatedId] : [],
  );
  const eventIds = unique([
    ...directEventIds,
    ...aliasResult.rows.map((row) => row.event_id),
    ...keywordResult.rows.map((row) => row.event_id),
    ...relationResult.rows.flatMap((row) => [row.cause_event_id, row.effect_event_id]),
    ...relationCaseResult.rows.flatMap((row) => [row.cause_event_id, row.effect_event_id]),
  ]);
  const caseIds = unique([
    ...issues.flatMap((issue) =>
      issue.targetType === 'case' ? [issue.targetId, issue.relatedId] : [],
    ),
    ...relationCaseResult.rows.map((row) => row.case_id),
  ]);

  const eventResult = await client.query<EventRow>(
    `select id::text, name::text as label
     from abstract_events
     where id::text = any($1::text[])
     order by id`,
    [eventIds],
  );
  const caseResult = await client.query<CaseRow>(
    `select id::text, content::text as label
     from concrete_cases
     where id::text = any($1::text[])
     order by id`,
    [caseIds],
  );

  const keywordCounts = new Map<string, number>();
  for (const row of keywordResult.rows) {
    keywordCounts.set(row.event_id, (keywordCounts.get(row.event_id) ?? 0) + 1);
  }
  const facts: SourceFacts = {
    events: new Map(eventResult.rows.map((row) => [row.id, row.label])),
    cases: new Map(caseResult.rows.map((row) => [row.id, row.label])),
    relations: new Map(relationResult.rows.map((row) => [row.id, row])),
    aliases: new Map(aliasResult.rows.map((row) => [row.id, row])),
    keywords: new Map(keywordResult.rows.map((row) => [row.id, row])),
    keywordCounts,
    relationCases: new Map(
      relationCaseResult.rows.map((row) => [relationCaseKey(row.relation_id, row.case_id), row]),
    ),
  };

  return new Map(issues.map((issue) => [issue.id, buildSource(issue, facts)]));
}
