import type { ImportBatchSummary } from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedImportRecord } from '../src/features/data-transfer/csvCodec.js';
import { PostgresImportRepository } from '../src/features/data-transfer/importRepository.js';
import { ImportService } from '../src/features/data-transfer/importService.js';
import {
  startPostgresTestContext,
  type StartedPostgresTestContext,
} from './support/postgresTestContext.js';

const existingCauseId = '11000000-0000-4000-8000-000000000001';
const existingEffectId = '11000000-0000-4000-8000-000000000002';
const existingRelationId = '21000000-0000-4000-8000-000000000001';
const existingCaseId = '31000000-0000-4000-8000-000000000001';
const unlinkedExistingCaseId = '31000000-0000-4000-8000-000000000002';

function event(
  sequence: number,
  name: string,
  options: {
    description?: string | null;
    aliases?: string[];
    keywords?: string[];
  } = {},
): ParsedImportRecord {
  return {
    type: 'event',
    sequence,
    name,
    description: options.description ?? null,
    aliases: options.aliases ?? [],
    keywords: options.keywords ?? [],
  };
}

function concreteCase(sequence: number, content: string): ParsedImportRecord {
  return { type: 'case', sequence, content };
}

function relation(
  sequence: number,
  causeEventName: string,
  effectEventName: string,
  caseContents: string[] = [],
  options: { confidence?: number; description?: string | null } = {},
): ParsedImportRecord {
  return {
    type: 'relation',
    sequence,
    causeEventName,
    effectEventName,
    confidence: options.confidence ?? 10,
    description: options.description ?? null,
    caseContents,
  };
}

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    delete from import_batches;
    delete from causal_relation_cases;
    delete from causal_relations;
    delete from event_aliases;
    delete from event_keywords;
    delete from abstract_events;
    delete from concrete_cases;
    delete from semantic_embeddings;
    delete from semantic_jobs;
    update semantic_index_state
    set active_model_code = null,
        status = 'empty',
        state_version = 0,
        processed_items = 0,
        total_items = 0,
        pending_items = 0,
        failed_items = 0,
        failure_stage = null,
        failure_kind = null,
        failure_code = null,
        error = null;
  `);
}

async function seedExistingGraph(pool: Pool): Promise<void> {
  await pool.query(
    `insert into abstract_events (id, name, description)
     values
       ($1, '已有原因事件', '数据库原始事件说明'),
       ($2, '已有结果事件', null)`,
    [existingCauseId, existingEffectId],
  );
  await pool.query(
    `insert into event_aliases (event_id, alias)
     values ($1, '数据库原始别名')`,
    [existingCauseId],
  );
  await pool.query(
    `insert into event_keywords (event_id, keyword, position)
     values ($1, '数据库原始关键词', 1)`,
    [existingCauseId],
  );
  await pool.query(
    `insert into causal_relations (
       id,
       cause_event_id,
       effect_event_id,
       confidence,
       description
     )
     values ($3, $1, $2, 60, '数据库原始关系说明')`,
    [existingCauseId, existingEffectId, existingRelationId],
  );
  await pool.query(
    `insert into concrete_cases (id, content)
     values
       ($1, '已有案例'),
       ($2, '待新增关联的已有案例')`,
    [existingCaseId, unlinkedExistingCaseId],
  );
  await pool.query(
    `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
     values ($1, $2)`,
    [existingRelationId, existingCaseId],
  );
}

function runImport(
  pool: Pool,
  records: ParsedImportRecord[],
  options: {
    filename?: string;
    signal?: AbortSignal;
    statementTimeoutMs?: number;
  } = {},
): Promise<{ batch: ImportBatchSummary }> {
  const repository = new PostgresImportRepository(pool, {
    ...(options.statementTimeoutMs === undefined
      ? {}
      : { statementTimeoutMs: options.statementTimeoutMs }),
  });
  const service = new ImportService(repository);
  return service.execute({
    filename: options.filename ?? '导入测试.csv',
    parseResult: {
      validRecords: records,
      logicalRecordCount: records.length,
      invalidRecordCount: 0,
    },
    signal: options.signal ?? new AbortController().signal,
  });
}

describe.sequential('append-only data import transaction', () => {
  let context: StartedPostgresTestContext | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_data_transfer_test');
    pool = context.pool;
  }, 120_000);

  beforeEach(async () => {
    await resetDatabase(pool!);
  });

  afterAll(async () => {
    await context?.close();
  });

  it('reuses existing rows unchanged and atomically adds new entities, links, logs, and jobs', async () => {
    await seedExistingGraph(pool!);
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'bge-small-zh-v1.5',
           status = 'ready',
           state_version = 1`,
    );

    const result = await runImport(pool!, [
      event(1, '已有原因事件', {
        description: '不得覆盖数据库说明',
        aliases: ['不得添加的别名'],
        keywords: ['不得添加的关键词'],
      }),
      concreteCase(2, '已有案例'),
      relation(3, '已有原因事件', '已有结果事件', ['已有案例', '待新增关联的已有案例', '新案例'], {
        confidence: 99,
        description: '不得覆盖数据库关系',
      }),
      event(4, '新原因事件', { aliases: ['首次别名'] }),
      event(5, '新原因事件', {
        description: '后续说明不得补写',
        aliases: ['后续别名'],
      }),
      event(6, '新结果事件'),
      relation(7, '新原因事件', '新结果事件', ['新案例', '另一个新案例'], {
        confidence: 80,
        description: '新关系说明',
      }),
    ]);

    expect(result.batch).toMatchObject({
      filename: '导入测试.csv',
      recordTypes: ['event', 'case', 'relation', 'relation_case'],
      counts: {
        event: { created: 2, reused: 1 },
        case: { created: 2, reused: 2 },
        relation: { created: 1, reused: 1 },
        relationCase: { created: 4, reused: 1 },
      },
    });

    const existingEvent = await pool!.query<{
      aliases: string[];
      description: string | null;
      keywords: string[];
    }>(
      `select event.description,
              coalesce(array_agg(distinct alias.alias) filter (where alias.id is not null), '{}')
                as aliases,
              coalesce(array_agg(distinct keyword.keyword) filter (where keyword.id is not null), '{}')
                as keywords
       from abstract_events event
       left join event_aliases alias on alias.event_id = event.id
       left join event_keywords keyword on keyword.event_id = event.id
       where event.id = $1
       group by event.id`,
      [existingCauseId],
    );
    expect(existingEvent.rows[0]).toEqual({
      description: '数据库原始事件说明',
      aliases: ['数据库原始别名'],
      keywords: ['数据库原始关键词'],
    });

    const newEvent = await pool!.query<{
      aliases: string[];
      description: string | null;
    }>(
      `select event.description,
              coalesce(array_agg(alias.alias order by alias.created_at)
                filter (where alias.id is not null), '{}') as aliases
       from abstract_events event
       left join event_aliases alias on alias.event_id = event.id
       where event.name = '新原因事件'
       group by event.id`,
    );
    expect(newEvent.rows[0]).toEqual({
      description: null,
      aliases: ['首次别名'],
    });

    const relations = await pool!.query<{
      confidence: string;
      description: string | null;
      cause_name: string;
      effect_name: string;
    }>(
      `select relation.confidence,
              relation.description,
              cause.name as cause_name,
              effect.name as effect_name
       from causal_relations relation
       join abstract_events cause on cause.id = relation.cause_event_id
       join abstract_events effect on effect.id = relation.effect_event_id
       order by cause.name`,
    );
    expect(relations.rows).toEqual([
      {
        cause_name: '已有原因事件',
        effect_name: '已有结果事件',
        confidence: '60.0000',
        description: '数据库原始关系说明',
      },
      {
        cause_name: '新原因事件',
        effect_name: '新结果事件',
        confidence: '80.0000',
        description: '新关系说明',
      },
    ]);

    const jobs = await pool!.query<{ entity_type: string; count: number }>(
      `select entity_type, count(*)::int as count
       from semantic_jobs
       where job_type = 'incremental'
       group by entity_type
       order by entity_type`,
    );
    expect(jobs.rows).toEqual([
      { entity_type: 'case', count: 2 },
      { entity_type: 'event', count: 2 },
      { entity_type: 'relation', count: 1 },
    ]);

    const audit = await pool!.query<{ count: number }>(
      `select count(*)::int as count
       from import_records
       where batch_id = $1`,
      [result.batch.id],
    );
    expect(audit.rows[0]?.count).toBe(14);
  });

  it('collapses duplicate logical records inside one CSV without counting them as reused', async () => {
    const result = await runImport(pool!, [
      event(1, '文件内原因事件'),
      event(2, '文件内结果事件'),
      event(3, ' 文件内原因事件 ', { description: '后续字段不覆盖首次记录' }),
      concreteCase(4, '文件内重复案例'),
      concreteCase(5, '文件内重复案例'),
      relation(6, '文件内原因事件', '文件内结果事件', ['文件内重复案例']),
      relation(7, '文件内原因事件', '文件内结果事件', ['文件内重复案例']),
    ]);

    expect(result.batch.counts).toEqual({
      event: { created: 2, reused: 0 },
      case: { created: 1, reused: 0 },
      relation: { created: 1, reused: 0 },
      relationCase: { created: 1, reused: 0 },
    });

    const audit = await pool!.query<{
      outcome: string;
      record_type: string;
      source_sequence: number;
    }>(
      `select source_sequence, record_type, outcome
       from import_records
       where batch_id = $1
       order by source_sequence, item_sequence`,
      [result.batch.id],
    );
    expect(audit.rows).toEqual([
      { source_sequence: 1, record_type: 'event', outcome: 'created' },
      { source_sequence: 2, record_type: 'event', outcome: 'created' },
      { source_sequence: 4, record_type: 'case', outcome: 'created' },
      { source_sequence: 6, record_type: 'relation', outcome: 'created' },
      { source_sequence: 6, record_type: 'relation_case', outcome: 'created' },
    ]);
  });

  it('skips relations with unresolved endpoints and excludes their embedded cases', async () => {
    const result = await runImport(pool!, [
      relation(1, '不存在原因', '不存在结果', ['不应创建的内嵌案例']),
      concreteCase(2, '应创建的独立案例'),
    ]);

    expect(result.batch.counts).toEqual({
      event: { created: 0, reused: 0 },
      case: { created: 1, reused: 0 },
      relation: { created: 0, reused: 0 },
      relationCase: { created: 0, reused: 0 },
    });
    const cases = await pool!.query<{ content: string }>(
      `select content from concrete_cases order by content`,
    );
    expect(cases.rows).toEqual([{ content: '应创建的独立案例' }]);
  });

  it('keeps readable audit snapshots after live records are edited or deleted', async () => {
    const result = await runImport(pool!, [
      event(1, '导入时事件名称'),
      concreteCase(2, '导入时案例内容'),
    ]);
    const eventRow = await pool!.query<{ id: string }>(
      `select id from abstract_events where name = '导入时事件名称'`,
    );
    await pool!.query(`update abstract_events set name = '编辑后的事件名称' where id = $1`, [
      eventRow.rows[0]!.id,
    ]);
    await pool!.query(`delete from concrete_cases where content = '导入时案例内容'`);

    const snapshots = await pool!.query<{ text_snapshot: unknown }>(
      `select text_snapshot
       from import_records
       where batch_id = $1
       order by source_sequence, item_sequence`,
      [result.batch.id],
    );
    expect(snapshots.rows.map((row) => row.text_snapshot)).toEqual([
      { type: 'event', eventName: '导入时事件名称' },
      { type: 'case', caseContent: '导入时案例内容' },
    ]);
  });

  it('rolls back business rows, semantic jobs, batch, and details after a late write failure', async () => {
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'bge-small-zh-v1.5',
           status = 'ready',
           state_version = 1;
       create function fail_import_record_write()
       returns trigger
       language plpgsql
       as $$
       begin
         raise exception 'forced import record failure';
       end;
       $$;
       create trigger fail_import_record_write_trigger
       before insert on import_records
       for each row execute function fail_import_record_write()`,
    );

    try {
      await expect(runImport(pool!, [event(1, '应整体回滚的事件')])).rejects.toThrow(
        'forced import record failure',
      );
    } finally {
      await pool!.query(
        `drop trigger if exists fail_import_record_write_trigger on import_records;
         drop function if exists fail_import_record_write()`,
      );
    }

    const counts = await pool!.query<{
      batches: string;
      details: string;
      events: string;
      jobs: string;
    }>(
      `select
         (select count(*) from abstract_events) as events,
         (select count(*) from semantic_jobs) as jobs,
         (select count(*) from import_batches) as batches,
         (select count(*) from import_records) as details`,
    );
    expect(counts.rows[0]).toEqual({
      events: '0',
      jobs: '0',
      batches: '0',
      details: '0',
    });
  });

  it('maps a real in-flight client cancellation and rolls back the transaction', async () => {
    await pool!.query(
      `create function slow_import_event_write()
       returns trigger
       language plpgsql
       as $$
       begin
         perform pg_sleep(5);
         return new;
       end;
       $$;
       create trigger slow_import_event_write_trigger
       before insert on abstract_events
       for each row execute function slow_import_event_write()`,
    );
    const controller = new AbortController();
    const operation = runImport(pool!, [event(1, '取消中的事件')], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    try {
      await expect(operation).rejects.toMatchObject({
        name: 'ImportError',
        code: 'IMPORT_CANCELLED',
      });
    } finally {
      await pool!.query(
        `drop trigger if exists slow_import_event_write_trigger on abstract_events;
         drop function if exists slow_import_event_write()`,
      );
    }

    const counts = await pool!.query<{ batches: string; events: string }>(
      `select
         (select count(*) from abstract_events) as events,
         (select count(*) from import_batches) as batches`,
    );
    expect(counts.rows[0]).toEqual({ events: '0', batches: '0' });
  });

  it('maps the five-minute statement timeout policy without leaving partial data', async () => {
    await pool!.query(
      `create function timeout_import_event_write()
       returns trigger
       language plpgsql
       as $$
       begin
         perform pg_sleep(5);
         return new;
       end;
       $$;
       create trigger timeout_import_event_write_trigger
       before insert on abstract_events
       for each row execute function timeout_import_event_write()`,
    );

    try {
      await expect(
        runImport(pool!, [event(1, '超时中的事件')], { statementTimeoutMs: 50 }),
      ).rejects.toMatchObject({
        name: 'ImportError',
        code: 'IMPORT_TIMEOUT',
      });
    } finally {
      await pool!.query(
        `drop trigger if exists timeout_import_event_write_trigger on abstract_events;
         drop function if exists timeout_import_event_write()`,
      );
    }

    const events = await pool!.query<{ count: string }>(`select count(*) from abstract_events`);
    expect(events.rows[0]?.count).toBe('0');
  });

  it('returns one success and one retryable conflict for concurrent identical imports', async () => {
    await pool!.query(
      `create function delay_conflicting_event_write()
       returns trigger
       language plpgsql
       as $$
       begin
         perform pg_sleep(0.2);
         return new;
       end;
       $$;
       create trigger delay_conflicting_event_write_trigger
       before insert on abstract_events
       for each row execute function delay_conflicting_event_write()`,
    );

    let outcomes: PromiseSettledResult<{ batch: ImportBatchSummary }>[];
    try {
      outcomes = await Promise.allSettled([
        runImport(pool!, [event(1, '并发相同事件')], { filename: '并发一.csv' }),
        runImport(pool!, [event(1, '并发相同事件')], { filename: '并发二.csv' }),
      ]);
    } finally {
      await pool!.query(
        `drop trigger if exists delay_conflicting_event_write_trigger on abstract_events;
         drop function if exists delay_conflicting_event_write()`,
      );
    }

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      name: 'ImportError',
      code: 'IMPORT_CONFLICT_RETRY',
    });
    const counts = await pool!.query<{ batches: string; events: string }>(
      `select
         (select count(*) from abstract_events) as events,
         (select count(*) from import_batches) as batches`,
    );
    expect(counts.rows[0]).toEqual({ events: '1', batches: '1' });
  });

  it('skips only database-ambiguous records and their affected dependencies', async () => {
    await seedExistingGraph(pool!);
    await pool!.query(
      `drop index abstract_events_normalized_name_uidx;
       drop index concrete_cases_content_uidx;
       drop index causal_relations_direction_uidx;
       insert into abstract_events (id, name)
       values
         ('11000000-0000-4000-8000-000000000011', '歧义事件'),
         ('11000000-0000-4000-8000-000000000012', '歧义事件'),
         ('11000000-0000-4000-8000-000000000013', '重复关系原因'),
         ('11000000-0000-4000-8000-000000000014', '重复关系结果');
       insert into concrete_cases (id, content)
       values
         ('31000000-0000-4000-8000-000000000011', '歧义案例'),
         ('31000000-0000-4000-8000-000000000012', '歧义案例');
       insert into causal_relations (cause_event_id, effect_event_id, confidence)
       values
         ('11000000-0000-4000-8000-000000000013',
          '11000000-0000-4000-8000-000000000014', 10),
         ('11000000-0000-4000-8000-000000000013',
          '11000000-0000-4000-8000-000000000014', 20)`,
    );

    try {
      const result = await runImport(pool!, [
        event(1, '歧义事件'),
        relation(2, '已有原因事件', '已有结果事件', ['歧义案例', '唯一有效案例']),
        relation(3, '歧义事件', '已有结果事件', ['端点歧义时不得创建']),
        relation(4, '重复关系原因', '重复关系结果', ['关系歧义时不得创建']),
      ]);

      expect(result.batch.counts).toEqual({
        event: { created: 0, reused: 0 },
        case: { created: 1, reused: 0 },
        relation: { created: 0, reused: 1 },
        relationCase: { created: 1, reused: 0 },
      });
      const skipped = await pool!.query<{ content: string }>(
        `select content
         from concrete_cases
         where content in ('端点歧义时不得创建', '关系歧义时不得创建')
         order by content`,
      );
      expect(skipped.rows).toEqual([]);

      const batchesBefore = await pool!.query<{ count: string }>(
        `select count(*) from import_batches`,
      );
      await expect(
        runImport(pool!, [event(1, '歧义事件'), concreteCase(2, '歧义案例')]),
      ).rejects.toMatchObject({
        code: 'CSV_NO_VALID_RECORDS',
      });
      const batchesAfter = await pool!.query<{ count: string }>(
        `select count(*) from import_batches`,
      );
      expect(batchesAfter.rows[0]?.count).toBe(batchesBefore.rows[0]?.count);
    } finally {
      await pool!.query(
        `delete from causal_relation_cases;
         delete from causal_relations
         where cause_event_id in (
           '11000000-0000-4000-8000-000000000013',
           '11000000-0000-4000-8000-000000000014'
         );
         delete from abstract_events
         where id in (
           '11000000-0000-4000-8000-000000000011',
           '11000000-0000-4000-8000-000000000012',
           '11000000-0000-4000-8000-000000000013',
           '11000000-0000-4000-8000-000000000014'
         );
         delete from concrete_cases
         where id in (
           '31000000-0000-4000-8000-000000000011',
           '31000000-0000-4000-8000-000000000012'
         );
         create unique index abstract_events_normalized_name_uidx
           on abstract_events (normalized_name);
         create unique index concrete_cases_content_uidx
           on concrete_cases (content);
         create unique index causal_relations_direction_uidx
           on causal_relations (cause_event_id, effect_event_id)`,
      );
    }
  });
});
