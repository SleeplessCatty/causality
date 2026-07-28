import {
  MAIN_LIST_PAGE_SIZE,
  aiImportCommitResultSchema,
  type AiImportBatchDetail,
  type AiImportBatchListResponse,
  type AiImportCommitResult,
  type AiImportRecordListResponse,
  type AiImportRecordType,
} from '@causality/contracts';
import type { Pool } from 'pg';

import { resolvePageWindow, type CountRow } from '../shared/pagePagination.js';

interface BatchRow {
  id: string;
  plan_id: string;
  topic: string;
  plan_version: number;
  client_name: string;
  completed_at: Date;
  event_created: number;
  event_reused: number;
  event_updated: number;
  case_created: number;
  case_reused: number;
  relation_created: number;
  relation_reused: number;
  relation_case_created: number;
  confidence_changed: number;
}

interface RecordRow {
  id: string;
  sequence: number;
  record_type: AiImportRecordType;
  action: 'created' | 'reused' | 'updated' | 'changed';
  primary_record_id: string;
  related_record_id: string | null;
  detail: Record<string, unknown>;
}

function batch(row: BatchRow): AiImportBatchDetail {
  return {
    id: row.id,
    planId: row.plan_id,
    topic: row.topic,
    planVersion: row.plan_version,
    clientName: row.client_name,
    completedAt: row.completed_at.toISOString(),
    counts: {
      eventCreated: row.event_created,
      eventReused: row.event_reused,
      eventUpdated: row.event_updated,
      caseCreated: row.case_created,
      caseReused: row.case_reused,
      relationCreated: row.relation_created,
      relationReused: row.relation_reused,
      relationCaseCreated: row.relation_case_created,
      confidenceChanged: row.confidence_changed,
    },
  };
}

const batchColumns = `id, plan_id, topic, plan_version, client_name, completed_at,
                      event_created, event_reused, event_updated,
                      case_created, case_reused,
                      relation_created, relation_reused,
                      relation_case_created, confidence_changed`;

export class PostgresAiImportHistoryRepository {
  public constructor(private readonly pool: Pool) {}

  public async list(requestedPage: number): Promise<AiImportBatchListResponse> {
    const count = await this.pool.query<CountRow>(
      `select count(*)::int as total from ai_import_batches`,
    );
    const totalItems = count.rows[0]!.total;
    const { page, totalPages, offset } = resolvePageWindow(
      totalItems,
      Math.max(1, requestedPage),
      MAIN_LIST_PAGE_SIZE,
    );
    const result = await this.pool.query<BatchRow>(
      `select ${batchColumns}
       from ai_import_batches
       order by completed_at desc, id desc
       limit $1 offset $2`,
      [MAIN_LIST_PAGE_SIZE, offset],
    );
    return {
      items: result.rows.map(batch),
      page,
      pageSize: MAIN_LIST_PAGE_SIZE,
      totalItems,
      totalPages,
    };
  }

  public async findById(id: string): Promise<AiImportBatchDetail | null> {
    const result = await this.pool.query<BatchRow>(
      `select ${batchColumns}
       from ai_import_batches
       where id = $1`,
      [id],
    );
    return result.rows[0] ? batch(result.rows[0]) : null;
  }

  public async findResult(historyId: string): Promise<AiImportCommitResult | null> {
    const result = await this.pool.query<{ result_payload: unknown }>(
      `select plan.result_payload
       from ai_import_batches batch
       join ai_import_plans plan on plan.id = batch.plan_id
       where batch.id = $1 and plan.status = 'committed'`,
      [historyId],
    );
    const parsed = aiImportCommitResultSchema.safeParse(result.rows[0]?.result_payload);
    return parsed.success ? parsed.data : null;
  }

  public async listRecords(
    batchId: string,
    recordType: AiImportRecordType,
    requestedPage: number,
  ): Promise<AiImportRecordListResponse> {
    const count = await this.pool.query<CountRow>(
      `select count(*)::int as total
       from ai_import_records
       where batch_id = $1 and record_type = $2`,
      [batchId, recordType],
    );
    const totalItems = count.rows[0]!.total;
    const { page, totalPages, offset } = resolvePageWindow(
      totalItems,
      Math.max(1, requestedPage),
      MAIN_LIST_PAGE_SIZE,
    );
    const result = await this.pool.query<RecordRow>(
      `select id, sequence, record_type, action,
              primary_record_id, related_record_id, detail
       from ai_import_records
       where batch_id = $1 and record_type = $2
       order by sequence
       limit $3 offset $4`,
      [batchId, recordType, MAIN_LIST_PAGE_SIZE, offset],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        recordType: row.record_type,
        action: row.action,
        primaryRecordId: row.primary_record_id,
        relatedRecordId: row.related_record_id,
        detail: row.detail,
      })),
      page,
      pageSize: MAIN_LIST_PAGE_SIZE,
      totalItems,
      totalPages,
    };
  }
}
