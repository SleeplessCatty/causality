import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  exportAvailabilityResponseSchema,
  exportPreviewInputSchema,
  exportPreviewResponseSchema,
  importBatchListResponseSchema,
  importDetailQuerySchema,
  importHistoryQuerySchema,
  importRecordListResponseSchema,
  importRecordTypeSchema,
  importUploadResponseSchema,
} from '../src/index.js';

const batchId = '11111111-1111-4111-8111-111111111111';
const recordId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-07-27T10:00:00.000Z';

const batch = {
  id: batchId,
  filename: '因果数据.csv',
  completedAt: timestamp,
  recordTypes: ['event', 'case', 'relation', 'relation_case'],
  counts: {
    event: { created: 2, reused: 1 },
    case: { created: 3, reused: 0 },
    relation: { created: 1, reused: 1 },
    relationCase: { created: 2, reused: 0 },
  },
};

describe('data-transfer contracts', () => {
  it('normalizes import record types and fixed-page queries', () => {
    expect(importRecordTypeSchema.parse('relation_case')).toBe('relation_case');
    expect(importHistoryQuerySchema.parse({ page: '2' })).toEqual({ page: 2 });
    expect(importHistoryQuerySchema.parse({})).toEqual({ page: 1 });
    expect(importDetailQuerySchema.parse({ type: 'case', page: '3' })).toEqual({
      type: 'case',
      page: 3,
    });
    expect(importDetailQuerySchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });

  it('accepts strict fixed-size import history responses', () => {
    expect(
      importBatchListResponseSchema.parse({
        items: [batch],
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
      }),
    ).toMatchObject({ items: [{ id: batchId }], pageSize: 50 });
    expect(importUploadResponseSchema.parse({ batch })).toEqual({ batch });
    expect(
      importBatchListResponseSchema.safeParse({
        items: [batch],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      }).success,
    ).toBe(false);
    expect(importUploadResponseSchema.safeParse({ batch: { ...batch, extra: true } }).success).toBe(
      false,
    );
  });

  it('keeps import audit text readable and discriminated by record type', () => {
    const texts = [
      { type: 'event', eventName: '市场需求增长' },
      { type: 'case', caseContent: '2026年某地区市场需求连续三个月增长' },
      {
        type: 'relation',
        causeEventName: '市场需求增长',
        effectEventName: '企业扩大产能',
      },
      {
        type: 'relation_case',
        causeEventName: '市场需求增长',
        effectEventName: '企业扩大产能',
        caseContent: '2026年某制造企业宣布扩产',
      },
    ];

    expect(
      importRecordListResponseSchema
        .parse({
          items: texts.map((text, index) => ({
            id: recordId.replace(/.$/, String(index)),
            sequence: index + 1,
            outcome: index % 2 === 0 ? 'created' : 'reused',
            text,
          })),
          page: 1,
          pageSize: 50,
          totalItems: 4,
          totalPages: 1,
        })
        .items.map((item) => item.text),
    ).toEqual(texts);

    expect(
      importRecordListResponseSchema.safeParse({
        items: [
          {
            id: recordId,
            sequence: 1,
            outcome: 'created',
            text: { type: 'event', caseContent: '类型和字段不匹配' },
          },
        ],
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
      }).success,
    ).toBe(false);
  });

  it('accepts full and bounded filtered export previews', () => {
    expect(exportPreviewInputSchema.parse({ type: 'full' })).toEqual({ type: 'full' });
    expect(
      exportPreviewInputSchema.parse({
        type: 'filtered',
        startEventIds: [recordId],
        direction: 'both',
        depth: 10,
      }),
    ).toEqual({
      type: 'filtered',
      startEventIds: [recordId],
      direction: 'both',
      depth: 10,
    });
    expect(
      exportPreviewInputSchema.safeParse({
        type: 'filtered',
        startEventIds: [],
        direction: 'both',
        depth: 1,
      }).success,
    ).toBe(false);
    expect(
      exportPreviewInputSchema.safeParse({
        type: 'filtered',
        startEventIds: [recordId],
        direction: 'both',
        depth: 11,
      }).success,
    ).toBe(false);
  });

  it('accepts short-lived export token responses', () => {
    const preview = {
      token: 'opaque-download-token',
      expiresAt: timestamp,
      counts: { events: 3, cases: 4, relations: 2 },
    };
    expect(exportPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(
      exportAvailabilityResponseSchema.parse({
        available: true,
        expiresAt: timestamp,
      }),
    ).toEqual({ available: true, expiresAt: timestamp });
  });

  it('accepts stable import, export, and data-check action error codes', () => {
    for (const code of [
      'CSV_INVALID_UTF8',
      'CSV_UNRECOVERABLE_SYNTAX',
      'CSV_FILE_TOO_LARGE',
      'CSV_TOO_MANY_RECORDS',
      'CSV_NO_VALID_RECORDS',
      'IMPORT_CONFLICT_RETRY',
      'IMPORT_CANCELLED',
      'IMPORT_TIMEOUT',
      'IMPORT_BATCH_NOT_FOUND',
      'EXPORT_TOKEN_INVALID',
      'EXPORT_TOKEN_EXPIRED',
      'EXPORT_START_EVENT_NOT_FOUND',
      'DATA_CHECK_ACTION_NOT_ALLOWED',
      'DATA_CHECK_ACTION_CONFLICT',
    ] as const) {
      expect(apiErrorSchema.parse({ code, message: '操作未完成' }).code).toBe(code);
    }
  });
});
