import { describe, expect, it } from 'vitest';

import {
  dataCheckActionContextSchema,
  dataCheckActionRequestSchema,
  dataCheckActionResponseSchema,
  dataCheckHandlingRequestSchema,
  dataCheckIssueListQuerySchema,
  dataCheckIssueListResponseSchema,
  dataCheckIssueSchema,
  dataCheckLatestResponseSchema,
  dataCheckRecheckResponseSchema,
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
  issueType: 'cross_event_alias',
  description: '事件别名与另一个事件的标准名称相同',
  suggestion: '检查两个事件是否应当合并',
  actionMode: 'manual',
  status: 'open',
  targetType: 'event',
  targetId: eventId,
  relatedId: null,
  handledAt: null,
};

describe('data-check contracts', () => {
  it('normalizes fixed-size issue filters', () => {
    expect(
      dataCheckIssueListQuerySchema.parse({
        page: '2',
        severity: 'warning',
        issueType: ' cross_event_alias ',
        status: 'open',
      }),
    ).toEqual({
      page: 2,
      severity: 'warning',
      issueType: 'cross_event_alias',
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
        items: [issue],
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

  it('requires a snapshot id for issue handling', () => {
    expect(dataCheckHandlingRequestSchema.parse({ snapshotId })).toEqual({ snapshotId });
    expect(() => dataCheckHandlingRequestSchema.parse({})).toThrow();
    expect(() =>
      dataCheckHandlingRequestSchema.parse({ snapshotId, ignorePermanently: true }),
    ).toThrow();
  });

  it('accepts only strict typed governance action requests', () => {
    const requests = [
      { type: 'merge', snapshotId, keepId: eventId, mergeId: relatedEventId },
      { type: 'cleanup', snapshotId },
      { type: 'delete_relation', snapshotId },
      { type: 'repair_timestamp', snapshotId },
      { type: 'ignore', snapshotId },
    ] as const;

    for (const request of requests) {
      expect(dataCheckActionRequestSchema.parse(request)).toEqual(request);
      expect(
        dataCheckActionRequestSchema.safeParse({ ...request, sql: 'delete from abstract_events' })
          .success,
      ).toBe(false);
      expect(dataCheckActionRequestSchema.safeParse({ ...request, snapshotId: 'not-an-id' }).success)
        .toBe(false);
    }

    expect(
      dataCheckActionRequestSchema.safeParse({
        type: 'merge',
        snapshotId,
        keepId: eventId,
        mergeId: 'not-an-id',
      }).success,
    ).toBe(false);
    expect(
      dataCheckActionRequestSchema.safeParse({
        type: 'merge',
        snapshotId,
        keepId: eventId,
        mergeId: eventId,
      }).success,
    ).toBe(false);
    expect(
      dataCheckActionRequestSchema.safeParse({ type: 'drop_table', snapshotId }).success,
    ).toBe(false);
    expect(
      dataCheckActionRequestSchema.safeParse({
        type: 'cleanup',
        snapshotId,
        targetType: 'event',
      }).success,
    ).toBe(false);
  });

  it('validates strict server-authorized action contexts and responses', () => {
    const context = {
      snapshotId,
      issueId,
      issueType: 'duplicate_event_name',
      status: 'open',
      dialogKind: 'merge',
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
          editPath: null,
          impact: {
            relationsMoved: 3,
            relationsDeleted: 0,
            relationCaseLinksMoved: 2,
            relationCaseLinksDeleted: 0,
            recordsDeleted: 1,
          },
        },
      ],
      message: null,
    };
    expect(dataCheckActionContextSchema.parse(context)).toEqual(context);
    expect(dataCheckActionContextSchema.safeParse({ ...context, table: 'abstract_events' }).success)
      .toBe(false);
    expect(
      dataCheckActionResponseSchema.parse({
        issue: { ...issue, status: 'handled', handledAt: timestamp },
        affectedEventIds: [eventId, relatedEventId],
        affectedCaseIds: [],
        affectedRelationIds: [],
      }),
    ).toMatchObject({ affectedEventIds: [eventId, relatedEventId] });
    expect(
      dataCheckRecheckResponseSchema.parse({
        status: 'open',
        issue,
        context,
      }),
    ).toMatchObject({ status: 'open' });
    expect(
      dataCheckRecheckResponseSchema.parse({
        status: 'resolved',
        issue: { ...issue, status: 'handled', handledAt: timestamp },
        context: null,
      }),
    ).toMatchObject({ status: 'resolved' });
  });
});
