import { describe, expect, it } from 'vitest';

import {
  dataCheckActionContextSchema,
  dataCheckAllowedActionSchema,
  dataCheckIssueSourceSchema,
  dataCheckIssueTypeSchema,
  dataCheckActionRequestSchema,
  dataCheckActionResponseSchema,
  dataCheckPanelKindSchema,
  dataCheckIssueListQuerySchema,
  dataCheckIssueListResponseSchema,
  dataCheckIssueSchema,
  dataCheckLatestResponseSchema,
  dataCheckSnapshotSummarySchema,
} from '../src/index.js';

const snapshotId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const relatedEventId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-07-23T08:00:00.000Z';

const snapshot = {
  snapshotId,
  checkedAt: timestamp,
  orphanEventCount: 2,
  orphanRelationCount: 3,
  orphanCaseCount: 4,
  errorCount: 5,
  warningCount: 6,
  openCount: 7,
  handledCount: 4,
  semanticStatus: 'completed',
  semanticReason: null,
};

const issue = {
  id: issueId,
  snapshotId,
  severity: 'warning',
  issueType: 'cross_event_shared_alias',
  description: '事件别名与另一个事件的标准名称相同',
  suggestion: '检查两个事件是否应当合并',
  status: 'open',
  targetType: 'event',
  targetId: eventId,
  relatedId: null,
  handledAt: null,
};

const issueTypes = [
  'missing_relation_cause_event',
  'missing_relation_effect_event',
  'delete_missing_alias',
  'delete_missing_keyword',
  'delete_missing_relation_case',
  'relation_self_loop',
  'relation_confidence_range',
  'duplicate_relation_direction',
  'duplicate_event_name',
  'duplicate_case_content',
  'delete_duplicate_alias',
  'delete_duplicate_keyword',
  'resequence_keywords',
  'invalid_event_name',
  'invalid_case_content',
  'invalid_alias_text',
  'invalid_keyword_text',
  'invalid_event_description',
  'invalid_relation_description',
  'invalid_event_timestamp_order',
  'invalid_relation_timestamp_order',
  'invalid_case_timestamp_order',
  'cross_event_alias_name',
  'cross_event_shared_alias',
  'semantic_duplicate_event',
  'semantic_duplicate_case',
] as const;

const source = {
  displayKind: 'pair',
  items: [
    {
      type: 'event',
      role: 'target',
      label: '事件 A',
      detailPath: `/events/${eventId}`,
    },
    {
      type: 'event',
      role: 'related',
      label: '事件 B',
      detailPath: `/events/${relatedEventId}`,
    },
  ],
  relationDetailPaths: [],
  auxiliaryText: null,
};

describe('data-check contracts', () => {
  it('closes the supported issue taxonomy and source display shapes', () => {
    expect(issueTypes.every((value) => dataCheckIssueTypeSchema.safeParse(value).success)).toBe(
      true,
    );
    expect(dataCheckIssueTypeSchema.safeParse('unknown_issue').success).toBe(false);
    expect(
      dataCheckIssueSourceSchema.parse({
        displayKind: 'relation',
        items: [
          {
            type: 'event',
            role: 'cause',
            label: '供应中断',
            detailPath: `/events/${eventId}`,
          },
          {
            type: 'event',
            role: 'effect',
            label: '原材料价格上涨',
            detailPath: `/events/${relatedEventId}`,
          },
        ],
        relationDetailPaths: [`/relations/${issueId}`],
        auxiliaryText: null,
      }).displayKind,
    ).toBe('relation');

    const invalidPaths = [
      'https://example.com/events/33333333-3333-4333-8333-333333333333',
      '//example.com/events/33333333-3333-4333-8333-333333333333',
      `/events/${eventId}/edit`,
    ];
    for (const detailPath of invalidPaths) {
      expect(
        dataCheckIssueSourceSchema.safeParse({
          displayKind: 'single',
          items: [{ type: 'event', role: 'target', label: '事件', detailPath }],
          relationDetailPaths: [],
          auxiliaryText: null,
        }).success,
      ).toBe(false);
    }
    expect(
      dataCheckIssueSourceSchema.safeParse({
        displayKind: 'single',
        items: [
          {
            type: 'case',
            role: 'target',
            label: '案例',
            detailPath: `/events/${eventId}`,
          },
        ],
        relationDetailPaths: [],
        auxiliaryText: null,
      }).success,
    ).toBe(false);
  });

  it('normalizes fixed-size issue filters', () => {
    expect(
      dataCheckIssueListQuerySchema.parse({
        page: '2',
        severity: 'warning',
        issueType: 'cross_event_shared_alias',
        status: 'open',
      }),
    ).toEqual({
      page: 2,
      severity: 'warning',
      issueType: 'cross_event_shared_alias',
      status: 'open',
    });
    expect(dataCheckIssueListQuerySchema.parse({})).toEqual({ page: 1 });
    expect(dataCheckIssueListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(dataCheckIssueListQuerySchema.safeParse({ limit: '100' }).success).toBe(false);
  });

  it('accepts a strict successful snapshot with nonnegative counts', () => {
    expect(dataCheckSnapshotSummarySchema.parse(snapshot)).toEqual(snapshot);
    expect(dataCheckSnapshotSummarySchema.safeParse({ ...snapshot, errorCount: -1 }).success).toBe(
      false,
    );
    expect(dataCheckSnapshotSummarySchema.safeParse({ ...snapshot, extra: true }).success).toBe(
      false,
    );
  });

  it('enforces semantic-check status and reason combinations', () => {
    expect(
      dataCheckSnapshotSummarySchema.safeParse({
        ...snapshot,
        semanticStatus: 'truncated',
        semanticReason: 'candidate_limit',
      }).success,
    ).toBe(true);
    expect(
      dataCheckSnapshotSummarySchema.safeParse({
        ...snapshot,
        semanticStatus: 'skipped',
        semanticReason: 'worker_unreachable',
      }).success,
    ).toBe(true);
    expect(
      dataCheckSnapshotSummarySchema.safeParse({
        ...snapshot,
        semanticStatus: 'failed',
        semanticReason: 'internal_failure',
      }).success,
    ).toBe(true);
    expect(
      dataCheckSnapshotSummarySchema.safeParse({
        ...snapshot,
        semanticStatus: 'completed',
        semanticReason: 'candidate_limit',
      }).success,
    ).toBe(false);
    expect(
      dataCheckSnapshotSummarySchema.safeParse({
        ...snapshot,
        semanticStatus: 'skipped',
        semanticReason: null,
      }).success,
    ).toBe(false);
  });

  it('keeps latest failure and last successful snapshot together', () => {
    expect(
      dataCheckLatestResponseSchema.parse({
        task: {
          status: 'failed',
          startedAt: timestamp,
          finishedAt: timestamp,
        },
        snapshot,
        latestFailure: {
          failedAt: timestamp,
          message: '检查执行失败',
        },
      }),
    ).toMatchObject({
      task: { status: 'failed' },
      snapshot: { snapshotId },
      latestFailure: { message: '检查执行失败' },
    });

    expect(
      dataCheckLatestResponseSchema.parse({
        task: {
          status: 'never_run',
          startedAt: null,
          finishedAt: null,
        },
        snapshot: null,
        latestFailure: null,
      }),
    ).toMatchObject({ task: { status: 'never_run' }, snapshot: null });
  });

  it('accepts compact strict issues and fixed 50-row pagination metadata', () => {
    expect(dataCheckIssueSchema.parse(issue)).toEqual(issue);
    expect(
      dataCheckIssueListResponseSchema.parse({
        items: [{ ...issue, source }],
        page: 2,
        pageSize: 50,
        totalItems: 51,
        totalPages: 2,
      }),
    ).toMatchObject({ page: 2, pageSize: 50, totalItems: 51, totalPages: 2 });
    expect(() =>
      dataCheckIssueListResponseSchema.parse({
        items: [issue],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toThrow();
    expect(() => dataCheckIssueSchema.parse({ ...issue, associationNames: [] })).toThrow();
  });

  it('accepts only strict typed governance action requests', () => {
    const actionKey = 'a'.repeat(64);
    const requests = [
      { type: 'merge', snapshotId, keepId: eventId, mergeId: relatedEventId, actionKey },
      { type: 'cleanup', snapshotId, actionKey },
      { type: 'delete_relation', snapshotId, actionKey },
      { type: 'repair_timestamp', snapshotId, actionKey },
      { type: 'ignore', snapshotId },
    ] as const;

    for (const request of requests) {
      expect(dataCheckActionRequestSchema.parse(request)).toEqual(request);
      expect(
        dataCheckActionRequestSchema.safeParse({ ...request, sql: 'delete from abstract_events' })
          .success,
      ).toBe(false);
      expect(
        dataCheckActionRequestSchema.safeParse({ ...request, snapshotId: 'not-an-id' }).success,
      ).toBe(false);
    }

    expect(
      dataCheckActionRequestSchema.safeParse({
        type: 'merge',
        snapshotId,
        keepId: eventId,
        mergeId: 'not-an-id',
        actionKey,
      }).success,
    ).toBe(false);
    expect(
      dataCheckActionRequestSchema.safeParse({
        type: 'merge',
        snapshotId,
        keepId: eventId,
        mergeId: eventId,
        actionKey,
      }).success,
    ).toBe(false);
    expect(dataCheckActionRequestSchema.safeParse({ type: 'drop_table', snapshotId }).success).toBe(
      false,
    );
    expect(
      dataCheckActionRequestSchema.safeParse({
        type: 'cleanup',
        snapshotId,
      }).success,
    ).toBe(false);
    expect(
      dataCheckActionRequestSchema.safeParse({
        type: 'ignore',
        snapshotId,
        actionKey,
      }).success,
    ).toBe(false);
    expect(dataCheckAllowedActionSchema.safeParse('open_edit').success).toBe(false);
    expect(dataCheckPanelKindSchema.options).toEqual([
      'merge',
      'cleanup',
      'delete_relation',
      'repair_timestamp',
      'manual',
    ]);
  });

  it('validates strict server-authorized action contexts and responses', () => {
    const context = {
      snapshotId,
      issueId,
      issueType: 'duplicate_event_name',
      status: 'open',
      panelKind: 'merge',
      records: [
        {
          id: eventId,
          targetType: 'event',
          title: '事件 A',
          primaryText: '重复事件',
          secondaryText: ['说明 A'],
          detailPath: `/events/${eventId}`,
          relationCount: 2,
          caseCount: 1,
        },
        {
          id: relatedEventId,
          targetType: 'event',
          title: '事件 B',
          primaryText: '重复事件',
          secondaryText: [],
          detailPath: `/events/${relatedEventId}`,
          relationCount: 3,
          caseCount: 2,
        },
      ],
      actions: [
        {
          type: 'merge',
          label: '保留事件 A',
          keepId: eventId,
          mergeId: relatedEventId,
          actionKey: 'b'.repeat(64),
          impact: {
            relationsMoved: 3,
            relationsDeleted: 0,
            relationCaseLinksMoved: 2,
            relationCaseLinksDeleted: 0,
            recordsDeleted: 1,
            recordsUpdated: 0,
          },
        },
      ],
      message: null,
    };
    expect(dataCheckActionContextSchema.parse(context)).toEqual(context);
    expect(
      dataCheckActionContextSchema.safeParse({ ...context, table: 'abstract_events' }).success,
    ).toBe(false);
    expect(
      dataCheckActionResponseSchema.parse({
        issue: { ...issue, status: 'handled', handledAt: timestamp },
        affectedEventIds: [eventId, relatedEventId],
        affectedCaseIds: [],
        affectedRelationIds: [],
      }),
    ).toMatchObject({ affectedEventIds: [eventId, relatedEventId] });
  });
});
