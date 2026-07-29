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
  relation_case_reused: number;
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
  event_name: string | null;
  case_content: string | null;
  cause_event_name: string | null;
  effect_event_name: string | null;
  relation_description: string | null;
}

function detailString(detail: Record<string, unknown>, key: string): string | undefined {
  const value = detail[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstDetailNullableString(
  detail: Record<string, unknown>,
  keys: readonly string[],
  fallback: string | null,
): string | null {
  for (const key of keys) {
    const value = detail[key];
    if (typeof value === 'string' || value === null) return value;
  }
  return fallback;
}

function readableRecordDetail(row: RecordRow): Record<string, unknown> {
  const detail = { ...row.detail };
  if (row.record_type === 'event') {
    return { ...detail, name: detailString(detail, 'name') ?? row.event_name ?? '未知原子事件' };
  }
  if (row.record_type === 'case') {
    return {
      ...detail,
      content: detailString(detail, 'content') ?? row.case_content ?? '未知具体案例',
    };
  }
  return {
    ...detail,
    causeEventName:
      detailString(detail, 'causeEventName') ?? row.cause_event_name ?? '未知原因事件',
    effectEventName:
      detailString(detail, 'effectEventName') ?? row.effect_event_name ?? '未知结果事件',
    relationDescription: firstDetailNullableString(
      detail,
      ['relationDescription', 'description'],
      row.relation_description,
    ),
    ...(row.record_type === 'relation_case'
      ? {
          caseContent: detailString(detail, 'caseContent') ?? row.case_content ?? '未知具体案例',
        }
      : {}),
  };
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
      relationCaseReused: row.relation_case_reused,
      confidenceChanged: row.confidence_changed,
    },
  };
}

const batchColumns = `id, plan_id, topic, plan_version, client_name, completed_at,
                      event_created, event_reused, event_updated,
                      case_created, case_reused,
                      relation_created, relation_reused,
                      relation_case_created, relation_case_reused, confidence_changed`;

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
      `select record.id, record.sequence, record.record_type, record.action,
              record.primary_record_id, record.related_record_id, record.detail,
              history_event.name as event_name,
              coalesce(history_case.content, linked_case.content) as case_content,
              cause_event.name as cause_event_name,
              effect_event.name as effect_event_name,
              history_relation.description as relation_description
       from ai_import_records record
       left join abstract_events history_event
         on record.record_type = 'event' and history_event.id = record.primary_record_id
       left join concrete_cases history_case
         on record.record_type = 'case' and history_case.id = record.primary_record_id
       left join causal_relations history_relation
         on record.record_type in ('relation', 'relation_case', 'confidence')
        and history_relation.id = record.primary_record_id
       left join abstract_events cause_event on cause_event.id = history_relation.cause_event_id
       left join abstract_events effect_event on effect_event.id = history_relation.effect_event_id
       left join concrete_cases linked_case
         on record.record_type = 'relation_case' and linked_case.id = record.related_record_id
       where record.batch_id = $1 and record.record_type = $2
       order by record.sequence
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
        detail: readableRecordDetail(row),
      })),
      page,
      pageSize: MAIN_LIST_PAGE_SIZE,
      totalItems,
      totalPages,
    };
  }
}
