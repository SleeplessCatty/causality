import type {
  DataCheckActionContext,
  DataCheckActionImpact,
  DataCheckActionOption,
  DataCheckActionRequest,
  DataCheckActionResponse,
  DataCheckIssue,
  DataCheckTargetType,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import {
  buildDataCheckActionContext,
  getDataCheckIssueEvaluator,
} from './dataCheckIssueEvaluator.js';
import { authorizeDataCheckActions } from './dataCheckActionKey.js';
import {
  DataCheckRepositoryError,
  mapDataCheckIssue,
  markIssueHandled,
  readCurrentIssue,
  readCurrentIssueForUpdate,
} from './dataCheckRepository.js';

type AffectedIds = Pick<
  DataCheckActionResponse,
  'affectedEventIds' | 'affectedCaseIds' | 'affectedRelationIds'
>;

type ActionResult = AffectedIds & { impact: DataCheckActionImpact };
type MergeResult = ActionResult;

function impact(values: Partial<DataCheckActionImpact> = {}): DataCheckActionImpact {
  return {
    relationsMoved: 0,
    relationsDeleted: 0,
    relationCaseLinksMoved: 0,
    relationCaseLinksDeleted: 0,
    recordsDeleted: 0,
    recordsUpdated: 0,
    ...values,
  };
}

export function assertMergePairMembership(
  issue: DataCheckIssue,
  keepId: string,
  mergeId: string,
): void {
  if (
    !issue.relatedId ||
    !(
      (keepId === issue.targetId && mergeId === issue.relatedId) ||
      (keepId === issue.relatedId && mergeId === issue.targetId)
    )
  ) {
    throw new DataCheckRepositoryError(
      'DATA_CHECK_ACTION_CONFLICT',
      '合并方向必须使用当前问题中的两条记录',
    );
  }
}

function unsafe(message = '数据已变化，无法安全执行当前问题的操作'): never {
  throw new DataCheckRepositoryError('DATA_CHECK_ACTION_CONFLICT', message);
}

function notAllowed(message = '当前问题类型不允许此操作'): never {
  throw new DataCheckRepositoryError('DATA_CHECK_ACTION_NOT_ALLOWED', message);
}

async function lockRows(
  client: PoolClient,
  table: 'abstract_events' | 'concrete_cases' | 'causal_relations',
  ids: readonly string[],
): Promise<void> {
  const sortedIds = [...ids].sort();
  const result = await client.query<{ id: string }>(
    `select id::text as id
     from ${table}
     where id::text = any($1::text[])
     order by id
     for update`,
    [sortedIds],
  );
  if (
    result.rows.length !== sortedIds.length ||
    result.rows.some((row, index) => row.id !== sortedIds[index])
  ) {
    unsafe('当前问题中的记录已不存在');
  }
}

async function linkedCaseIds(
  client: PoolClient,
  relationIds: readonly string[],
): Promise<string[]> {
  if (relationIds.length === 0) return [];
  const result = await client.query<{ id: string }>(
    `select distinct concrete_case_id::text as id
     from causal_relation_cases
     where causal_relation_id::text = any($1::text[])
     order by id`,
    [relationIds],
  );
  return result.rows.map((row) => row.id);
}

async function mergeRelationLinks(
  client: PoolClient,
  keepRelationId: string,
  mergeRelationId: string,
): Promise<{ moved: number; deleted: number }> {
  const impact = await client.query<{ moved: number; deleted: number }>(
    `select count(*) filter (where retained.concrete_case_id is null)::int as moved,
            count(*) filter (where retained.concrete_case_id is not null)::int as deleted
     from causal_relation_cases source
     left join causal_relation_cases retained
       on retained.causal_relation_id = $1
      and retained.concrete_case_id = source.concrete_case_id
     where source.causal_relation_id = $2`,
    [keepRelationId, mergeRelationId],
  );
  await client.query(
    `insert into causal_relation_cases (causal_relation_id, concrete_case_id, linked_at)
     select $1::uuid, concrete_case_id, linked_at
     from causal_relation_cases
     where causal_relation_id = $2
     on conflict (causal_relation_id, concrete_case_id) do nothing`,
    [keepRelationId, mergeRelationId],
  );
  await client.query(`delete from causal_relation_cases where causal_relation_id = $1`, [
    mergeRelationId,
  ]);
  return {
    moved: Number(impact.rows[0]?.moved ?? 0),
    deleted: Number(impact.rows[0]?.deleted ?? 0),
  };
}

async function mergeEventAliases(
  client: PoolClient,
  keepId: string,
  mergeId: string,
): Promise<void> {
  await client.query(
    `select id from event_aliases
     where event_id in ($1, $2)
     order by id
     for update`,
    [keepId, mergeId],
  );
  const result = await client.query<{
    id: string;
    alias: string;
    normalized_alias: string;
    created_at: Date;
  }>(
    `select id::text, alias, normalized_alias, created_at
     from event_aliases
     where event_id in ($1, $2)
     order by case when event_id = $1 then 0 else 1 end, created_at, id`,
    [keepId, mergeId],
  );
  const seenAliases = new Set<string>();
  const retained = result.rows.filter((row) => {
    if (seenAliases.has(row.normalized_alias)) return false;
    seenAliases.add(row.normalized_alias);
    return true;
  });
  if (retained.length > 20) unsafe('合并后的别名数量将超过 20 个');
  if (result.rows.length === 0) return;
  await client.query(`delete from event_aliases where event_id in ($1, $2)`, [keepId, mergeId]);
  if (retained.length === 0) return;
  await client.query(
    `insert into event_aliases (id, event_id, alias, created_at)
     select alias.id, alias.event_id, alias.alias, alias.created_at
     from unnest($1::uuid[], $2::uuid[], $3::varchar[], $4::timestamptz[])
       as alias(id, event_id, alias, created_at)`,
    [
      retained.map((row) => row.id),
      retained.map(() => keepId),
      retained.map((row) => row.alias),
      retained.map((row) => row.created_at),
    ],
  );
}

async function mergeEventKeywords(
  client: PoolClient,
  keepId: string,
  mergeId: string,
): Promise<void> {
  await client.query(
    `select id from event_keywords
     where event_id in ($1, $2)
     order by id
     for update`,
    [keepId, mergeId],
  );
  const result = await client.query<{
    id: string;
    keyword: string;
    normalized_keyword: string;
  }>(
    `select id::text, keyword, normalized_keyword
     from event_keywords
     where event_id in ($1, $2)
     order by case when event_id = $1 then 0 else 1 end, position, id`,
    [keepId, mergeId],
  );
  const seenKeywords = new Set<string>();
  const retained = result.rows.filter((row) => {
    if (seenKeywords.has(row.normalized_keyword)) return false;
    seenKeywords.add(row.normalized_keyword);
    return true;
  });
  if (retained.length > 20) unsafe('合并后的关键词数量将超过 20 个');
  if (result.rows.length === 0) return;
  await client.query(`delete from event_keywords where event_id in ($1, $2)`, [keepId, mergeId]);
  if (retained.length === 0) return;
  await client.query(
    `insert into event_keywords (id, event_id, keyword, position)
     select keyword.id, keyword.event_id, keyword.keyword, keyword.position
     from unnest($1::uuid[], $2::uuid[], $3::varchar[], $4::int[])
       as keyword(id, event_id, keyword, position)`,
    [
      retained.map((row) => row.id),
      retained.map(() => keepId),
      retained.map((row) => row.keyword),
      retained.map((_row, index) => index + 1),
    ],
  );
}

async function mergeEvents(
  client: PoolClient,
  keepId: string,
  mergeId: string,
): Promise<MergeResult> {
  await lockRows(client, 'abstract_events', [keepId, mergeId]);
  const lockedRelations = await client.query<{ id: string }>(
    `with redirected as (
       select source.id,
              case when source.cause_event_id::text = $2 then $1::uuid
                   else source.cause_event_id end as next_cause_id,
              case when source.effect_event_id::text = $2 then $1::uuid
                   else source.effect_event_id end as next_effect_id
       from causal_relations source
       where source.cause_event_id::text = $2 or source.effect_event_id::text = $2
     ), affected as (
       select id from redirected
       union
       select collision.id
       from redirected
       join causal_relations collision
         on collision.cause_event_id = redirected.next_cause_id
        and collision.effect_event_id = redirected.next_effect_id
        and collision.id <> redirected.id
     )
     select relation.id::text as id
     from causal_relations relation
     join affected on affected.id = relation.id
     order by relation.id
     for update of relation`,
    [keepId, mergeId],
  );
  const relations = await client.query<{
    id: string;
    cause_event_id: string;
    effect_event_id: string;
  }>(
    `select id::text,
            cause_event_id::text,
            effect_event_id::text
     from causal_relations
     where cause_event_id::text = $1 or effect_event_id::text = $1
     order by id`,
    [mergeId],
  );
  const relationIds = lockedRelations.rows.map((row) => row.id);
  const impact: DataCheckActionImpact = {
    relationsMoved: 0,
    relationsDeleted: 0,
    relationCaseLinksMoved: 0,
    relationCaseLinksDeleted: 0,
    recordsDeleted: 1,
    recordsUpdated: 0,
  };
  const affectedCaseIds = await linkedCaseIds(
    client,
    relations.rows.map((row) => row.id),
  );

  for (const relation of relations.rows) {
    const nextCauseId = relation.cause_event_id === mergeId ? keepId : relation.cause_event_id;
    const nextEffectId = relation.effect_event_id === mergeId ? keepId : relation.effect_event_id;
    if (nextCauseId === nextEffectId) {
      const links = await client.query<{ count: number }>(
        `select count(*)::int as count
         from causal_relation_cases
         where causal_relation_id = $1`,
        [relation.id],
      );
      impact.relationsDeleted += 1;
      impact.relationCaseLinksDeleted += Number(links.rows[0]?.count ?? 0);
      await client.query(`delete from causal_relation_cases where causal_relation_id = $1`, [
        relation.id,
      ]);
      await client.query(`delete from causal_relations where id = $1`, [relation.id]);
      continue;
    }

    const collision = await client.query<{ id: string }>(
      `select id::text as id
       from causal_relations
       where cause_event_id = $1
         and effect_event_id = $2
       and id::text <> $3
       order by id
       limit 1`,
      [nextCauseId, nextEffectId, relation.id],
    );
    const preservedId = collision.rows[0]?.id;
    if (preservedId) {
      if (!relationIds.includes(preservedId)) relationIds.push(preservedId);
      const linkImpact = await mergeRelationLinks(client, preservedId, relation.id);
      impact.relationsDeleted += 1;
      impact.relationCaseLinksMoved += linkImpact.moved;
      impact.relationCaseLinksDeleted += linkImpact.deleted;
      await client.query(`delete from causal_relations where id = $1`, [relation.id]);
      continue;
    }
    await client.query(
      `update causal_relations
       set cause_event_id = $1, effect_event_id = $2, updated_at = clock_timestamp()
       where id = $3`,
      [nextCauseId, nextEffectId, relation.id],
    );
    impact.relationsMoved += 1;
  }

  await mergeEventAliases(client, keepId, mergeId);
  await mergeEventKeywords(client, keepId, mergeId);

  await client.query(`delete from abstract_events where id = $1`, [mergeId]);
  return {
    affectedEventIds: [keepId, mergeId].sort(),
    affectedCaseIds,
    affectedRelationIds: [...new Set(relationIds)].sort(),
    impact,
  };
}

async function mergeCases(
  client: PoolClient,
  keepId: string,
  mergeId: string,
): Promise<MergeResult> {
  await lockRows(client, 'concrete_cases', [keepId, mergeId]);
  const relations = await client.query<{ id: string }>(
    `select causal_relation_id::text as id
     from causal_relation_cases
     where concrete_case_id in ($1, $2)
     order by causal_relation_id
     for update`,
    [keepId, mergeId],
  );
  const impactResult = await client.query<{ moved: number; deleted: number }>(
    `select count(*) filter (where retained.causal_relation_id is null)::int as moved,
            count(*) filter (where retained.causal_relation_id is not null)::int as deleted
     from causal_relation_cases source
     left join causal_relation_cases retained
       on retained.concrete_case_id = $1
      and retained.causal_relation_id = source.causal_relation_id
     where source.concrete_case_id = $2`,
    [keepId, mergeId],
  );
  await client.query(
    `insert into causal_relation_cases (causal_relation_id, concrete_case_id, linked_at)
     select causal_relation_id, $1::uuid, linked_at
     from causal_relation_cases
     where concrete_case_id = $2
     on conflict (causal_relation_id, concrete_case_id) do nothing`,
    [keepId, mergeId],
  );
  await client.query(`delete from causal_relation_cases where concrete_case_id = $1`, [mergeId]);
  await client.query(`delete from concrete_cases where id = $1`, [mergeId]);
  return {
    affectedEventIds: [],
    affectedCaseIds: [keepId, mergeId].sort(),
    affectedRelationIds: [...new Set(relations.rows.map((row) => row.id))].sort(),
    impact: {
      relationsMoved: 0,
      relationsDeleted: 0,
      relationCaseLinksMoved: Number(impactResult.rows[0]?.moved ?? 0),
      relationCaseLinksDeleted: Number(impactResult.rows[0]?.deleted ?? 0),
      recordsDeleted: 1,
      recordsUpdated: 0,
    },
  };
}

async function mergeRelations(
  client: PoolClient,
  keepId: string,
  mergeId: string,
): Promise<MergeResult> {
  await lockRows(client, 'causal_relations', [keepId, mergeId]);
  const rows = await client.query<{
    id: string;
    cause_event_id: string;
    effect_event_id: string;
  }>(
    `select id::text, cause_event_id::text, effect_event_id::text
     from causal_relations where id in ($1, $2) order by id`,
    [keepId, mergeId],
  );
  if (
    rows.rows[0]?.cause_event_id !== rows.rows[1]?.cause_event_id ||
    rows.rows[0]?.effect_event_id !== rows.rows[1]?.effect_event_id
  ) {
    unsafe('两条因果关系的方向已不再相同');
  }
  const affectedCaseIds = await linkedCaseIds(client, [keepId, mergeId]);
  const linkImpact = await mergeRelationLinks(client, keepId, mergeId);
  await client.query(`delete from causal_relations where id = $1`, [mergeId]);
  return {
    affectedEventIds: [
      ...new Set(rows.rows.flatMap((row) => [row.cause_event_id, row.effect_event_id])),
    ].sort(),
    affectedCaseIds,
    affectedRelationIds: [keepId, mergeId].sort(),
    impact: {
      relationsMoved: 0,
      relationsDeleted: 0,
      relationCaseLinksMoved: linkImpact.moved,
      relationCaseLinksDeleted: linkImpact.deleted,
      recordsDeleted: 1,
      recordsUpdated: 0,
    },
  };
}

async function applyMerge(
  client: PoolClient,
  issue: DataCheckIssue,
  action: Extract<DataCheckActionRequest, { type: 'merge' }>,
): Promise<MergeResult> {
  assertMergePairMembership(issue, action.keepId, action.mergeId);
  if (issue.targetType === 'event') return mergeEvents(client, action.keepId, action.mergeId);
  if (issue.targetType === 'case') return mergeCases(client, action.keepId, action.mergeId);
  if (issue.targetType === 'relation') return mergeRelations(client, action.keepId, action.mergeId);
  return notAllowed('当前问题类型不支持合并');
}

async function resequenceKeywords(client: PoolClient, eventId: string): Promise<string[]> {
  const rows = await client.query<{
    id: string;
    keyword: string;
    normalized_keyword: string;
  }>(
    `select id::text, keyword, normalized_keyword from event_keywords
     where event_id::text = $1 order by position, id for update`,
    [eventId],
  );
  if (rows.rows.length > 20) unsafe('关键词数量超过 20 个，无法自动重排');
  if (rows.rows.length === 0) return [];
  if (new Set(rows.rows.map((row) => row.normalized_keyword)).size !== rows.rows.length) {
    unsafe('关键词仍包含重复值，请先清理重复关键词');
  }
  await client.query(`delete from event_keywords where event_id::text = $1`, [eventId]);
  await client.query(
    `insert into event_keywords (id, event_id, keyword, position)
     select keyword.id, keyword.event_id, keyword.keyword, keyword.position
     from unnest($1::uuid[], $2::uuid[], $3::varchar[], $4::int[])
       as keyword(id, event_id, keyword, position)`,
    [
      rows.rows.map((row) => row.id),
      rows.rows.map(() => eventId),
      rows.rows.map((row) => row.keyword),
      rows.rows.map((_row, index) => index + 1),
    ],
  );
  return rows.rows.map((row) => row.id);
}

async function applyCleanup(client: PoolClient, issue: DataCheckIssue): Promise<ActionResult> {
  switch (issue.issueType) {
    case 'delete_missing_alias': {
      const deleted = await client.query(`delete from event_aliases where id::text = $1`, [
        issue.targetId,
      ]);
      return {
        affectedEventIds: [],
        affectedCaseIds: [],
        affectedRelationIds: [],
        impact: impact({ recordsDeleted: deleted.rowCount ?? 0 }),
      };
    }
    case 'delete_missing_keyword': {
      const deleted = await client.query(`delete from event_keywords where id::text = $1`, [
        issue.targetId,
      ]);
      return {
        affectedEventIds: [],
        affectedCaseIds: [],
        affectedRelationIds: [],
        impact: impact({ recordsDeleted: deleted.rowCount ?? 0 }),
      };
    }
    case 'delete_missing_relation_case': {
      if (!issue.relatedId) return unsafe();
      const deleted = await client.query(
        `delete from causal_relation_cases
         where causal_relation_id::text = $1 and concrete_case_id::text = $2`,
        [issue.targetId, issue.relatedId],
      );
      return {
        affectedEventIds: [],
        affectedCaseIds: [issue.relatedId],
        affectedRelationIds: [issue.targetId],
        impact: impact({ relationCaseLinksDeleted: deleted.rowCount ?? 0 }),
      };
    }
    case 'delete_duplicate_alias': {
      const event = await client.query<{ event_id: string }>(
        `select event_id::text from event_aliases where id::text = $1 for update`,
        [issue.targetId],
      );
      const eventId = event.rows[0]?.event_id;
      if (!eventId) return unsafe();
      const deleted = await client.query(`delete from event_aliases where id::text = $1`, [
        issue.targetId,
      ]);
      return {
        affectedEventIds: [eventId],
        affectedCaseIds: [],
        affectedRelationIds: [],
        impact: impact({ recordsDeleted: deleted.rowCount ?? 0 }),
      };
    }
    case 'delete_duplicate_keyword': {
      const event = await client.query<{ event_id: string }>(
        `select event_id::text from event_keywords where id::text = $1 for update`,
        [issue.targetId],
      );
      const eventId = event.rows[0]?.event_id;
      if (!eventId) return unsafe();
      const deleted = await client.query(`delete from event_keywords where id::text = $1`, [
        issue.targetId,
      ]);
      await resequenceKeywords(client, eventId);
      return {
        affectedEventIds: [eventId],
        affectedCaseIds: [],
        affectedRelationIds: [],
        impact: impact({ recordsDeleted: deleted.rowCount ?? 0 }),
      };
    }
    case 'resequence_keywords': {
      const updatedIds = await resequenceKeywords(client, issue.targetId);
      return {
        affectedEventIds: [issue.targetId],
        affectedCaseIds: [],
        affectedRelationIds: [],
        impact: impact({ recordsUpdated: updatedIds.length }),
      };
    }
    default:
      return notAllowed('当前问题类型不允许清理操作');
  }
}

async function deleteRelation(client: PoolClient, issue: DataCheckIssue): Promise<ActionResult> {
  if (
    issue.targetType !== 'relation' ||
    ![
      'relation_self_loop',
      'missing_relation_cause_event',
      'missing_relation_effect_event',
    ].includes(issue.issueType)
  ) {
    return notAllowed('当前问题类型不允许删除因果关系');
  }
  await lockRows(client, 'causal_relations', [issue.targetId]);
  const relation = await client.query<{ cause_event_id: string; effect_event_id: string }>(
    `select cause_event_id::text, effect_event_id::text
     from causal_relations where id::text = $1`,
    [issue.targetId],
  );
  const affectedCaseIds = await linkedCaseIds(client, [issue.targetId]);
  const deletedLinks = await client.query(
    `delete from causal_relation_cases where causal_relation_id::text = $1`,
    [issue.targetId],
  );
  const deletedRelation = await client.query(`delete from causal_relations where id::text = $1`, [
    issue.targetId,
  ]);
  return {
    affectedEventIds: relation.rows[0]
      ? [...new Set([relation.rows[0].cause_event_id, relation.rows[0].effect_event_id])].sort()
      : [],
    affectedCaseIds,
    affectedRelationIds: [issue.targetId],
    impact: impact({
      relationsDeleted: deletedRelation.rowCount ?? 0,
      relationCaseLinksDeleted: deletedLinks.rowCount ?? 0,
      recordsDeleted: deletedRelation.rowCount ?? 0,
    }),
  };
}

async function repairTimestamp(client: PoolClient, issue: DataCheckIssue): Promise<ActionResult> {
  const whitelist: Record<
    string,
    {
      table: 'abstract_events' | 'causal_relations' | 'concrete_cases';
      targetType: DataCheckTargetType;
    }
  > = {
    invalid_event_timestamp_order: { table: 'abstract_events', targetType: 'event' },
    invalid_relation_timestamp_order: { table: 'causal_relations', targetType: 'relation' },
    invalid_case_timestamp_order: { table: 'concrete_cases', targetType: 'case' },
  };
  const allowed = whitelist[issue.issueType];
  if (!allowed || issue.targetType !== allowed.targetType) {
    return notAllowed('当前问题类型不允许修复时间');
  }
  const result = await client.query(
    `update ${allowed.table}
     set updated_at = greatest(updated_at, created_at)
     where id::text = $1 and updated_at < created_at`,
    [issue.targetId],
  );
  if (result.rowCount !== 1) return unsafe();
  return {
    affectedEventIds: issue.targetType === 'event' ? [issue.targetId] : [],
    affectedCaseIds: issue.targetType === 'case' ? [issue.targetId] : [],
    affectedRelationIds: issue.targetType === 'relation' ? [issue.targetId] : [],
    impact: impact({ recordsUpdated: result.rowCount ?? 0 }),
  };
}

function assertActionAllowed(
  actions: readonly DataCheckActionOption[],
  request: DataCheckActionRequest,
): DataCheckActionOption {
  const option = actions.find(
    (option) =>
      option.type === request.type &&
      (request.type !== 'merge' ||
        (option.keepId === request.keepId && option.mergeId === request.mergeId)),
  );
  if (!option) notAllowed();
  if (request.type !== 'ignore' && option.actionKey !== request.actionKey) {
    unsafe('数据已变化，请重新加载处理方案');
  }
  return option;
}

export function dataCheckImpactEquals(
  actual: DataCheckActionImpact,
  expected: DataCheckActionImpact,
): boolean {
  return (
    actual.relationsMoved === expected.relationsMoved &&
    actual.relationsDeleted === expected.relationsDeleted &&
    actual.relationCaseLinksMoved === expected.relationCaseLinksMoved &&
    actual.relationCaseLinksDeleted === expected.relationCaseLinksDeleted &&
    actual.recordsDeleted === expected.recordsDeleted &&
    actual.recordsUpdated === expected.recordsUpdated
  );
}

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '40001'
  );
}

export class DataCheckActionService {
  public constructor(private readonly pool: Pool) {}

  public async context(issueId: string, snapshotId: string): Promise<DataCheckActionContext> {
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const row = await readCurrentIssue(client, issueId, snapshotId);
      const issue = mapDataCheckIssue(row);
      const context = await buildDataCheckActionContext(client, issue);
      await client.query('commit');
      return context;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async apply(
    issueId: string,
    request: DataCheckActionRequest,
  ): Promise<DataCheckActionResponse> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query('begin isolation level serializable');
        const row = await readCurrentIssueForUpdate(client, issueId, request.snapshotId);
        const issue = mapDataCheckIssue(row);
        if (issue.status === 'handled') unsafe('此问题已处理');
        if (request.type === 'ignore') {
          const handled = await markIssueHandled(client, row);
          await client.query('commit');
          return {
            issue: handled,
            affectedEventIds: [],
            affectedCaseIds: [],
            affectedRelationIds: [],
          };
        }
        const evaluator = getDataCheckIssueEvaluator(issue.issueType);
        const evaluation = await evaluator.evaluate(client, issue);
        if (evaluation !== 'present') unsafe();
        const records = await evaluator.loadContext(client, issue);
        const allowedActions = authorizeDataCheckActions(
          issue,
          records,
          await evaluator.buildActions(client, issue, records),
        );
        const selectedAction = assertActionAllowed(allowedActions, request);

        let result: ActionResult;
        switch (request.type) {
          case 'merge':
            result = await applyMerge(client, issue, request);
            break;
          case 'cleanup':
            result = await applyCleanup(client, issue);
            break;
          case 'delete_relation':
            result = await deleteRelation(client, issue);
            break;
          case 'repair_timestamp':
            result = await repairTimestamp(client, issue);
            break;
        }
        if (!dataCheckImpactEquals(result.impact, selectedAction.impact)) {
          unsafe('实际数据影响与确认前的处理方案不一致');
        }
        const handled = await markIssueHandled(client, row);
        await client.query('commit');
        return {
          issue: handled,
          affectedEventIds: result.affectedEventIds,
          affectedCaseIds: result.affectedCaseIds,
          affectedRelationIds: result.affectedRelationIds,
        };
      } catch (error) {
        await client.query('rollback');
        if (isSerializationFailure(error) && attempt === 0) continue;
        if (isSerializationFailure(error)) unsafe('并发操作已改变当前问题，请重新加载');
        throw error;
      } finally {
        client.release();
      }
    }
    return unsafe();
  }
}
