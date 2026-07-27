import {
  dataCheckIssueTypes,
  type DataCheckActionRecord,
  type DataCheckIssue,
} from '@causality/contracts';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  authorizeDataCheckActions,
  createDataCheckActionKey,
} from '../src/features/data-checks/dataCheckActionKey.js';
import {
  getDataCheckIssueEvaluator,
  issueEvaluatorRegistry,
} from '../src/features/data-checks/dataCheckIssueEvaluator.js';
import {
  assertMergePairMembership,
  dataCheckImpactEquals,
} from '../src/features/data-checks/dataCheckActionService.js';

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
    expect(Object.keys(issueEvaluatorRegistry).sort()).toEqual([...dataCheckIssueTypes].sort());
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
    ['invalid_event_name', 'manual'],
    ['invalid_relation_description', 'manual'],
    ['relation_confidence_range', 'manual'],
  ] as const)('maps %s to the explicit %s panel', (issueType, panelKind) => {
    expect(issueEvaluatorRegistry[issueType]?.panelKind).toBe(panelKind);
  });

  it('offers only ignore for manual issues', async () => {
    const evaluator = getDataCheckIssueEvaluator('relation_confidence_range');
    await expect(
      evaluator.buildActions(
        {} as PoolClient,
        issue({ issueType: 'relation_confidence_range' }),
        [],
      ),
    ).resolves.toEqual([expect.objectContaining({ type: 'ignore', actionKey: null })]);
  });

  it('accepts both issue-record merge directions and rejects arbitrary pairs', () => {
    expect(() => assertMergePairMembership(issue(), targetId, relatedId)).not.toThrow();
    expect(() => assertMergePairMembership(issue(), relatedId, targetId)).not.toThrow();
    expect(() =>
      assertMergePairMembership(issue(), targetId, '11000000-0000-4000-8000-000000000099'),
    ).toThrow(/当前问题/);
    expect(() =>
      assertMergePairMembership(issue({ relatedId: null }), targetId, relatedId),
    ).toThrow(/当前问题/);
  });

  it('creates deterministic action keys from current issue evidence', () => {
    const records: DataCheckActionRecord[] = [
      {
        id: targetId,
        targetType: 'event',
        title: '原子事件',
        primaryText: '供应中断',
        secondaryText: [],
        detailPath: `/events/${targetId}`,
        relationCount: 1,
        caseCount: 0,
      },
    ];
    const unsigned = {
      type: 'cleanup' as const,
      label: '清理此问题',
      keepId: null,
      mergeId: null,
      impact: {
        relationsMoved: 0,
        relationsDeleted: 0,
        relationCaseLinksMoved: 0,
        relationCaseLinksDeleted: 0,
        recordsDeleted: 1,
        recordsUpdated: 0,
      },
    };

    const first = createDataCheckActionKey(issue(), records, unsigned);
    const second = createDataCheckActionKey(issue(), records, unsigned);
    const changed = createDataCheckActionKey(
      issue(),
      [{ ...records[0]!, primaryText: '供应中断（已变化）' }],
      unsigned,
    );
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
    expect(
      authorizeDataCheckActions(issue(), records, [
        { ...unsigned, actionKey: null },
        {
          ...unsigned,
          type: 'ignore',
          label: '忽略此问题',
          impact: { ...unsigned.impact, recordsDeleted: 0 },
          actionKey: null,
        },
      ]),
    ).toEqual([
      expect.objectContaining({ type: 'cleanup', actionKey: first }),
      expect.objectContaining({ type: 'ignore', actionKey: null }),
    ]);
  });

  it('compares every confirmed impact dimension exactly', () => {
    const impact = {
      relationsMoved: 1,
      relationsDeleted: 2,
      relationCaseLinksMoved: 3,
      relationCaseLinksDeleted: 4,
      recordsDeleted: 1,
      recordsUpdated: 0,
    };
    expect(dataCheckImpactEquals(impact, { ...impact })).toBe(true);
    for (const key of Object.keys(impact) as (keyof typeof impact)[]) {
      expect(dataCheckImpactEquals(impact, { ...impact, [key]: impact[key] + 1 })).toBe(false);
    }
  });
});
