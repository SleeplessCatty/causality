import type { DataCheckIssue } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import {
  getDataCheckIssueEvaluator,
  issueEvaluatorRegistry,
  knownDataCheckIssueTypes,
} from '../src/features/data-checks/dataCheckIssueEvaluator.js';
import { assertMergePairMembership } from '../src/features/data-checks/dataCheckActionService.js';

const snapshotId = 'a1000000-0000-4000-8000-000000000001';
const issueId = 'b1000000-0000-4000-8000-000000000001';
const targetId = '11000000-0000-4000-8000-000000000001';
const relatedId = '11000000-0000-4000-8000-000000000002';

function issue(overrides: Partial<DataCheckIssue> = {}): DataCheckIssue {
  return {
    id: issueId,
    snapshotId,
    severity: 'error',
    issueType: 'duplicate_event_name',
    description: '存在标准化名称相同的原子事件',
    suggestion: '比较后手动合并或重命名事件',
    actionMode: 'manual',
    status: 'open',
    targetType: 'event',
    targetId,
    relatedId,
    handledAt: null,
    ...overrides,
  };
}

describe('data-check action service authorization', () => {
  it('keeps one closed evaluator entry for every known issue type', () => {
    expect(Object.keys(issueEvaluatorRegistry).sort()).toEqual(
      [...knownDataCheckIssueTypes].sort(),
    );
  });

  it.each([
    ['duplicate_event_name', 'merge'],
    ['duplicate_case_content', 'merge'],
    ['duplicate_relation_direction', 'merge'],
    ['semantic_duplicate_event', 'merge'],
    ['semantic_duplicate_case', 'merge'],
    ['delete_missing_alias', 'cleanup'],
    ['delete_missing_keyword', 'cleanup'],
    ['delete_missing_relation_case', 'cleanup'],
    ['delete_duplicate_alias', 'cleanup'],
    ['delete_duplicate_keyword', 'cleanup'],
    ['resequence_keywords', 'cleanup'],
    ['relation_self_loop', 'delete_relation'],
    ['missing_relation_cause_event', 'delete_relation'],
    ['missing_relation_effect_event', 'delete_relation'],
    ['invalid_event_timestamp_order', 'repair_timestamp'],
    ['invalid_relation_timestamp_order', 'repair_timestamp'],
    ['invalid_case_timestamp_order', 'repair_timestamp'],
    ['invalid_event_name', 'edit'],
    ['invalid_relation_description', 'edit'],
    ['relation_confidence_range', 'edit'],
  ] as const)('maps %s to the explicit %s dialog', (issueType, dialogKind) => {
    expect(issueEvaluatorRegistry[issueType]?.dialogKind).toBe(dialogKind);
  });

  it('uses a safe fallback for unknown issue types', () => {
    expect(getDataCheckIssueEvaluator('future_issue', 'event').dialogKind).toBe('edit');
    expect(getDataCheckIssueEvaluator('future_issue', 'alias').dialogKind).toBe('ignore_only');
  });

  it('accepts both issue-record merge directions and rejects arbitrary pairs', () => {
    expect(() => assertMergePairMembership(issue(), targetId, relatedId)).not.toThrow();
    expect(() => assertMergePairMembership(issue(), relatedId, targetId)).not.toThrow();
    expect(() =>
      assertMergePairMembership(
        issue(),
        targetId,
        '11000000-0000-4000-8000-000000000099',
      ),
    ).toThrow(/当前问题/);
    expect(() =>
      assertMergePairMembership(issue({ relatedId: null }), targetId, relatedId),
    ).toThrow(/当前问题/);
  });
});
