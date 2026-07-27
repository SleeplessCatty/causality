import type { DataCheckIssueType } from '@causality/contracts';

export type DataCheckIssueSourceStrategy =
  | 'event_pair'
  | 'case_pair'
  | 'duplicate_relation'
  | 'broken_relation'
  | 'relation'
  | 'alias'
  | 'keyword'
  | 'event_keywords'
  | 'event'
  | 'case'
  | 'relation_case';

const dataCheckIssueSourceStrategies = {
  missing_relation_cause_event: 'broken_relation',
  missing_relation_effect_event: 'broken_relation',
  delete_missing_alias: 'alias',
  delete_missing_keyword: 'keyword',
  delete_missing_relation_case: 'relation_case',
  relation_self_loop: 'relation',
  relation_confidence_range: 'relation',
  duplicate_relation_direction: 'duplicate_relation',
  duplicate_event_name: 'event_pair',
  duplicate_case_content: 'case_pair',
  delete_duplicate_alias: 'alias',
  delete_duplicate_keyword: 'keyword',
  resequence_keywords: 'event_keywords',
  invalid_event_name: 'event',
  invalid_case_content: 'case',
  invalid_alias_text: 'alias',
  invalid_keyword_text: 'keyword',
  invalid_event_description: 'event',
  invalid_relation_description: 'relation',
  invalid_event_timestamp_order: 'event',
  invalid_relation_timestamp_order: 'relation',
  invalid_case_timestamp_order: 'case',
  cross_event_alias_name: 'event_pair',
  cross_event_shared_alias: 'event_pair',
  semantic_duplicate_event: 'event_pair',
  semantic_duplicate_case: 'case_pair',
} as const satisfies Record<DataCheckIssueType, DataCheckIssueSourceStrategy>;

export function getDataCheckIssueSourceStrategy(
  issueType: DataCheckIssueType,
): DataCheckIssueSourceStrategy {
  return dataCheckIssueSourceStrategies[issueType];
}
