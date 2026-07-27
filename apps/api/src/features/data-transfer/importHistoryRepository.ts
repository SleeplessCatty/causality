import {
  importBatchListResponseSchema,
  importBatchSummarySchema,
  importRecordItemSchema,
  importRecordListResponseSchema,
  MAIN_LIST_PAGE_SIZE,
  type ImportBatchListResponse,
  type ImportBatchSummary,
  type ImportDetailQuery,
  type ImportHistoryQuery,
  type ImportRecordListResponse,
} from '@causality/contracts';
import type { Pool } from 'pg';

import { resolvePageWindow } from '../shared/pagePagination.js';

interface ImportBatchRow {
  id: string;
  filename: string;
  completed_at: Date;
  record_types: string[];
  event_created: number;
  event_reused: number;
  case_created: number;
  case_reused: number;
  relation_created: number;
  relation_reused: number;
  relation_case_created: number;
  relation_case_reused: number;
}

interface ImportRecordRow {
  id: string;
  source_sequence: number;
  outcome: string;
  text_snapshot: unknown;
}

function mapBatch(row: ImportBatchRow): ImportBatchSummary {
  return importBatchSummarySchema.parse({
    id: row.id,
    filename: row.filename,
    completedAt: row.completed_at.toISOString(),
    recordTypes: row.record_types,
    counts: {
      event: { created: row.event_created, reused: row.event_reused },
      case: { created: row.case_created, reused: row.case_reused },
      relation: { created: row.relation_created, reused: row.relation_reused },
      relationCase: {
        created: row.relation_case_created,
        reused: row.relation_case_reused,
      },
    },
  });
}

const batchColumns = `
  id,
  filename,
  completed_at,
  record_types,
  event_created,
  event_reused,
  case_created,
  case_reused,
  relation_created,
  relation_reused,
  relation_case_created,
  relation_case_reused
`;

export interface ImportHistoryRepository {
  listBatches(query: ImportHistoryQuery): Promise<ImportBatchListResponse>;
  findBatch(batchId: string): Promise<ImportBatchSummary | null>;
  listRecords(batchId: string, query: ImportDetailQuery): Promise<ImportRecordListResponse | null>;
}

export class PostgresImportHistoryRepository implements ImportHistoryRepository {
  public constructor(private readonly pool: Pool) {}

  public async listBatches(query: ImportHistoryQuery): Promise<ImportBatchListResponse> {
    const countResult = await this.pool.query<{ total: number }>(
      `select count(*)::int as total from import_batches`,
    );
    const totalItems = countResult.rows[0]?.total ?? 0;
    const { page, totalPages, offset } = resolvePageWindow(
      totalItems,
      query.page,
      MAIN_LIST_PAGE_SIZE,
    );
    const result = await this.pool.query<ImportBatchRow>(
      `select ${batchColumns}
       from import_batches
       order by completed_at desc, id desc
       limit $1 offset $2`,
      [MAIN_LIST_PAGE_SIZE, offset],
    );

    return importBatchListResponseSchema.parse({
      items: result.rows.map(mapBatch),
      page,
      pageSize: MAIN_LIST_PAGE_SIZE,
      totalItems,
      totalPages,
    });
  }

  public async findBatch(batchId: string): Promise<ImportBatchSummary | null> {
    const result = await this.pool.query<ImportBatchRow>(
      `select ${batchColumns}
       from import_batches
       where id = $1`,
      [batchId],
    );
    return result.rows[0] ? mapBatch(result.rows[0]) : null;
  }

  public async listRecords(
    batchId: string,
    query: ImportDetailQuery,
  ): Promise<ImportRecordListResponse | null> {
    const state = await this.pool.query<{ batch_exists: boolean; total: number }>(
      `select
         exists(select 1 from import_batches where id = $1) as batch_exists,
         count(*)::int as total
       from import_records
       where batch_id = $1
         and ($2::text is null or record_type = $2)`,
      [batchId, query.type ?? null],
    );
    if (!state.rows[0]?.batch_exists) return null;

    const totalItems = state.rows[0].total;
    const { page, totalPages, offset } = resolvePageWindow(
      totalItems,
      query.page,
      MAIN_LIST_PAGE_SIZE,
    );
    const result = await this.pool.query<ImportRecordRow>(
      `select id, source_sequence, outcome, text_snapshot
       from import_records
       where batch_id = $1
         and ($2::text is null or record_type = $2)
       order by source_sequence, item_sequence, id
       limit $3 offset $4`,
      [batchId, query.type ?? null, MAIN_LIST_PAGE_SIZE, offset],
    );

    return importRecordListResponseSchema.parse({
      items: result.rows.map((row) =>
        importRecordItemSchema.parse({
          id: row.id,
          sequence: row.source_sequence,
          outcome: row.outcome,
          text: row.text_snapshot,
        }),
      ),
      page,
      pageSize: MAIN_LIST_PAGE_SIZE,
      totalItems,
      totalPages,
    });
  }
}
