import { dataCheckIssueTypes, type DataCheckIssueType } from './dataCheckSchemas.js';

export const dataCheckIssueTypeLabels = {
  missing_relation_cause_event: '原因事件引用失效',
  missing_relation_effect_event: '结果事件引用失效',
  delete_missing_alias: '失效别名',
  delete_missing_keyword: '失效关键词',
  delete_missing_relation_case: '失效关系案例关联',
  relation_self_loop: '关系自环',
  relation_confidence_range: '置信度范围',
  duplicate_relation_direction: '同方向重复关系',
  duplicate_event_name: '重复事件名称',
  duplicate_case_content: '重复案例内容',
  delete_duplicate_alias: '重复别名',
  delete_duplicate_keyword: '重复关键词',
  resequence_keywords: '关键词位置',
  invalid_event_name: '事件名称异常',
  invalid_case_content: '案例内容异常',
  invalid_alias_text: '别名内容异常',
  invalid_keyword_text: '关键词内容异常',
  invalid_event_description: '事件说明异常',
  invalid_relation_description: '关系说明异常',
  invalid_event_timestamp_order: '事件时间异常',
  invalid_relation_timestamp_order: '关系时间异常',
  invalid_case_timestamp_order: '案例时间异常',
  cross_event_alias_name: '别名与事件名称冲突',
  cross_event_shared_alias: '跨事件共享别名',
  semantic_duplicate_event: '语义重复事件',
  semantic_duplicate_case: '语义重复案例',
} as const satisfies Record<DataCheckIssueType, string>;

export const dataCheckIssueTypeOptions = dataCheckIssueTypes.map((value) => ({
  value,
  label: dataCheckIssueTypeLabels[value],
}));

export function dataCheckIssueTypeLabel(issueType: DataCheckIssueType): string {
  return dataCheckIssueTypeLabels[issueType];
}
