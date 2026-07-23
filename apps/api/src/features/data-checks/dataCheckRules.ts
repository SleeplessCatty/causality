import type { PoolClient } from 'pg';

import type { DataCheckIssueDraft, DataCheckRule } from './dataCheckTypes.js';

interface IssueRow {
  severity: DataCheckIssueDraft['severity'];
  issue_type: string;
  target_type: DataCheckIssueDraft['targetType'];
  target_id: string;
  related_id: string | null;
  description: string;
  suggestion: string;
  action_mode: DataCheckIssueDraft['actionMode'];
}

class SqlDataCheckRule implements DataCheckRule {
  public constructor(
    public readonly issueType: string,
    private readonly sql: string,
  ) {}

  public async scan(client: PoolClient, snapshotId: string): Promise<DataCheckIssueDraft[]> {
    void snapshotId;
    const result = await client.query<IssueRow>(this.sql);
    return result.rows.map((row) => ({
      severity: row.severity,
      issueType: row.issue_type,
      targetType: row.target_type,
      targetId: row.target_id,
      relatedId: row.related_id,
      description: row.description,
      suggestion: row.suggestion,
      actionMode: row.action_mode,
    }));
  }
}

const missingRequiredReferences = new SqlDataCheckRule(
  'missing_required_references',
  `
  select 'error'::text as severity,
         'missing_relation_cause_event'::text as issue_type,
         'relation'::text as target_type,
         relation.id::text as target_id,
         relation.cause_event_id::text as related_id,
         '因果关系引用的原因事件不存在'::text as description,
         '编辑或删除该因果关系'::text as suggestion,
         'manual'::text as action_mode
  from causal_relations relation
  left join abstract_events event on event.id = relation.cause_event_id
  where event.id is null
  union all
  select 'error', 'missing_relation_effect_event', 'relation',
         relation.id::text, relation.effect_event_id::text,
         '因果关系引用的结果事件不存在', '编辑或删除该因果关系', 'manual'
  from causal_relations relation
  left join abstract_events event on event.id = relation.effect_event_id
  where event.id is null
  union all
  select 'error', 'delete_missing_relation_case', 'relation_case',
         relation_case.causal_relation_id::text, relation_case.concrete_case_id::text,
         '关系与案例的关联指向不存在的记录', '删除失效的关系与案例关联', 'auto'
  from causal_relation_cases relation_case
  left join causal_relations relation on relation.id = relation_case.causal_relation_id
  left join concrete_cases concrete_case on concrete_case.id = relation_case.concrete_case_id
  where relation.id is null or concrete_case.id is null
  union all
  select 'error', 'delete_missing_alias', 'alias',
         alias.id::text, alias.event_id::text,
         '事件别名引用的原子事件不存在', '删除失效别名', 'auto'
  from event_aliases alias
  left join abstract_events event on event.id = alias.event_id
  where event.id is null
  union all
  select 'error', 'delete_missing_keyword', 'keyword',
         keyword.id::text, keyword.event_id::text,
         '事件关键词引用的原子事件不存在', '删除失效关键词', 'auto'
  from event_keywords keyword
  left join abstract_events event on event.id = keyword.event_id
  where event.id is null
  order by issue_type, target_id, related_id
  `,
);

const relationSelfLoop = new SqlDataCheckRule(
  'relation_self_loop',
  `
  select 'error'::text as severity,
         'relation_self_loop'::text as issue_type,
         'relation'::text as target_type,
         id::text as target_id,
         null::text as related_id,
         '因果关系的原因事件与结果事件相同'::text as description,
         '编辑或删除该因果关系'::text as suggestion,
         'manual'::text as action_mode
  from causal_relations
  where cause_event_id = effect_event_id
  order by id
  `,
);

const relationConfidenceRange = new SqlDataCheckRule(
  'relation_confidence_range',
  `
  select 'error'::text as severity,
         'relation_confidence_range'::text as issue_type,
         'relation'::text as target_type,
         id::text as target_id,
         null::text as related_id,
         '因果关系置信度不在 0% 至 100% 范围内'::text as description,
         '编辑该因果关系的置信度'::text as suggestion,
         'manual'::text as action_mode
  from causal_relations
  where confidence < 0 or confidence > 100
  order by id
  `,
);

const duplicateRelationDirection = new SqlDataCheckRule(
  'duplicate_relation_direction',
  `
  with ranked as (
    select id, row_number() over (
             partition by cause_event_id, effect_event_id order by created_at, id
           ) as duplicate_rank,
           first_value(id) over (
             partition by cause_event_id, effect_event_id order by created_at, id
           ) as retained_id
    from causal_relations
  )
  select 'error'::text as severity,
         'duplicate_relation_direction'::text as issue_type,
         'relation'::text as target_type,
         id::text as target_id,
         retained_id::text as related_id,
         '存在原因事件和结果事件均相同的重复因果关系'::text as description,
         '比较后手动合并或删除重复关系'::text as suggestion,
         'manual'::text as action_mode
  from ranked
  where duplicate_rank > 1
  order by id
  `,
);

const duplicateEventName = new SqlDataCheckRule(
  'duplicate_event_name',
  `
  with ranked as (
    select id, row_number() over (
             partition by normalized_name order by created_at, id
           ) as duplicate_rank,
           first_value(id) over (
             partition by normalized_name order by created_at, id
           ) as retained_id
    from abstract_events
  )
  select 'error'::text as severity,
         'duplicate_event_name'::text as issue_type,
         'event'::text as target_type,
         id::text as target_id,
         retained_id::text as related_id,
         '存在标准化名称相同的原子事件'::text as description,
         '比较后手动合并或重命名事件'::text as suggestion,
         'manual'::text as action_mode
  from ranked
  where duplicate_rank > 1
  order by id
  `,
);

const duplicateCaseContent = new SqlDataCheckRule(
  'duplicate_case_content',
  `
  with ranked as (
    select id, row_number() over (
             partition by content order by created_at, id
           ) as duplicate_rank,
           first_value(id) over (
             partition by content order by created_at, id
           ) as retained_id
    from concrete_cases
  )
  select 'error'::text as severity,
         'duplicate_case_content'::text as issue_type,
         'case'::text as target_type,
         id::text as target_id,
         retained_id::text as related_id,
         '存在内容完全相同的具体案例'::text as description,
         '比较后手动合并或修改案例'::text as suggestion,
         'manual'::text as action_mode
  from ranked
  where duplicate_rank > 1
  order by id
  `,
);

const duplicateEventAlias = new SqlDataCheckRule(
  'duplicate_event_alias',
  `
  with ranked as (
    select id, row_number() over (
             partition by event_id, normalized_alias order by created_at, id
           ) as duplicate_rank,
           first_value(id) over (
             partition by event_id, normalized_alias order by created_at, id
           ) as retained_id
    from event_aliases
  )
  select 'error'::text as severity,
         'delete_duplicate_alias'::text as issue_type,
         'alias'::text as target_type,
         id::text as target_id,
         retained_id::text as related_id,
         '同一原子事件存在重复别名'::text as description,
         '删除排序靠后的重复别名'::text as suggestion,
         'auto'::text as action_mode
  from ranked
  where duplicate_rank > 1
  order by id
  `,
);

const duplicateEventKeyword = new SqlDataCheckRule(
  'duplicate_event_keyword',
  `
  with ranked as (
    select id, row_number() over (
             partition by event_id, normalized_keyword order by position, id
           ) as duplicate_rank,
           first_value(id) over (
             partition by event_id, normalized_keyword order by position, id
           ) as retained_id
    from event_keywords
  )
  select 'error'::text as severity,
         'delete_duplicate_keyword'::text as issue_type,
         'keyword'::text as target_type,
         id::text as target_id,
         retained_id::text as related_id,
         '同一原子事件存在重复关键词'::text as description,
         '删除排序靠后的重复关键词'::text as suggestion,
         'auto'::text as action_mode
  from ranked
  where duplicate_rank > 1
  order by id
  `,
);

const invalidRequiredText = new SqlDataCheckRule(
  'invalid_required_text',
  `
  select 'error'::text as severity, 'invalid_event_name'::text as issue_type,
         'event'::text as target_type, id::text as target_id, null::text as related_id,
         '原子事件名称为空、未去除首尾空格或长度不合法'::text as description,
         '编辑原子事件名称'::text as suggestion, 'manual'::text as action_mode
  from abstract_events
  where name <> btrim(name) or char_length(btrim(name)) not between 1 and 50
  union all
  select 'error', 'invalid_case_content', 'case', id::text, null,
         '具体案例内容为空、未去除首尾空格或长度不合法',
         '编辑具体案例内容', 'manual'
  from concrete_cases
  where content <> btrim(content) or char_length(btrim(content)) not between 1 and 100
  union all
  select 'error', 'invalid_alias_text', 'alias', id::text, event_id::text,
         '事件别名为空、未去除首尾空格或长度不合法',
         '编辑原子事件的别名', 'manual'
  from event_aliases
  where alias <> btrim(alias) or char_length(btrim(alias)) not between 1 and 80
  union all
  select 'error', 'invalid_keyword_text', 'keyword', id::text, event_id::text,
         '事件关键词为空、未去除首尾空格或长度不合法',
         '编辑原子事件的关键词', 'manual'
  from event_keywords
  where keyword <> btrim(keyword) or char_length(btrim(keyword)) not between 1 and 50
  order by issue_type, target_id
  `,
);

const invalidOptionalText = new SqlDataCheckRule(
  'invalid_optional_text',
  `
  select 'error'::text as severity, 'invalid_event_description'::text as issue_type,
         'event'::text as target_type, id::text as target_id, null::text as related_id,
         '原子事件说明只包含空白字符'::text as description,
         '清空或编辑原子事件说明'::text as suggestion, 'manual'::text as action_mode
  from abstract_events
  where description is not null and btrim(description) = ''
  union all
  select 'error', 'invalid_relation_description', 'relation', id::text, null,
         '因果关系说明只包含空白字符',
         '清空或编辑因果关系说明', 'manual'
  from causal_relations
  where description is not null and btrim(description) = ''
  order by issue_type, target_id
  `,
);

const invalidKeywordPosition = new SqlDataCheckRule(
  'invalid_keyword_position',
  `
  select 'error'::text as severity,
         'resequence_keywords'::text as issue_type,
         'event'::text as target_type,
         event_id::text as target_id,
         null::text as related_id,
         '事件关键词位置重复、越界或不连续'::text as description,
         '按当前稳定顺序重新排列关键词'::text as suggestion,
         'auto'::text as action_mode
  from event_keywords
  group by event_id
  having min(position) <> 1
      or max(position) > 20
      or max(position) <> count(*)
      or count(distinct position) <> count(*)
  order by event_id
  `,
);

const invalidTimestampOrder = new SqlDataCheckRule(
  'invalid_timestamp_order',
  `
  select 'error'::text as severity, 'invalid_event_timestamp_order'::text as issue_type,
         'event'::text as target_type, id::text as target_id, null::text as related_id,
         '原子事件更新时间早于创建时间'::text as description,
         '手动检查并修正时间字段'::text as suggestion, 'manual'::text as action_mode
  from abstract_events where updated_at < created_at
  union all
  select 'error', 'invalid_relation_timestamp_order', 'relation', id::text, null,
         '因果关系更新时间早于创建时间', '手动检查并修正时间字段', 'manual'
  from causal_relations where updated_at < created_at
  union all
  select 'error', 'invalid_case_timestamp_order', 'case', id::text, null,
         '具体案例更新时间早于创建时间', '手动检查并修正时间字段', 'manual'
  from concrete_cases where updated_at < created_at
  order by issue_type, target_id
  `,
);

const crossEventAliasName = new SqlDataCheckRule(
  'cross_event_alias_name',
  `
  select 'warning'::text as severity,
         'cross_event_alias_name'::text as issue_type,
         'event'::text as target_type,
         alias.event_id::text as target_id,
         event.id::text as related_id,
         '一个事件的别名与另一个事件的标准名称相同'::text as description,
         '比较两个事件并决定是否需要归类或调整别名'::text as suggestion,
         'manual'::text as action_mode
  from event_aliases alias
  join abstract_events event on event.normalized_name = alias.normalized_alias
  where event.id <> alias.event_id
  order by alias.event_id, event.id, alias.id
  `,
);

const crossEventSharedAlias = new SqlDataCheckRule(
  'cross_event_shared_alias',
  `
  select 'warning'::text as severity,
         'cross_event_shared_alias'::text as issue_type,
         'event'::text as target_type,
         left_alias.event_id::text as target_id,
         right_alias.event_id::text as related_id,
         '同一个标准化别名被不同事件使用'::text as description,
         '比较两个事件并决定是否需要归类或调整别名'::text as suggestion,
         'manual'::text as action_mode
  from event_aliases left_alias
  join event_aliases right_alias
    on right_alias.normalized_alias = left_alias.normalized_alias
   and right_alias.event_id > left_alias.event_id
  order by left_alias.event_id, right_alias.event_id, left_alias.id, right_alias.id
  `,
);

export function createDataCheckRules(): DataCheckRule[] {
  return [
    missingRequiredReferences,
    relationSelfLoop,
    relationConfidenceRange,
    duplicateRelationDirection,
    duplicateEventName,
    duplicateCaseContent,
    duplicateEventAlias,
    duplicateEventKeyword,
    invalidRequiredText,
    invalidOptionalText,
    invalidKeywordPosition,
    invalidTimestampOrder,
    crossEventAliasName,
    crossEventSharedAlias,
  ];
}
