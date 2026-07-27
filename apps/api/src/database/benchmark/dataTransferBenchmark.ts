import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ExportCounts } from '@causality/contracts';
import { parse } from 'csv-parse';
import { Pool, type PoolClient } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { parseImportCsv } from '../../features/data-transfer/csvCodec.js';
import { ExportService } from '../../features/data-transfer/exportService.js';
import { PostgresExportRequestRepository } from '../../features/data-transfer/exportRequestRepository.js';
import {
  PostgresExportScopeRepository,
  type ExportScopeRepository,
} from '../../features/data-transfer/exportScopeRepository.js';
import { PostgresImportRepository } from '../../features/data-transfer/importRepository.js';
import { ImportService } from '../../features/data-transfer/importService.js';
import type {
  CaseExportRow,
  EventExportRow,
  RelationExportRow,
} from '../../features/data-transfer/dataTransferTypes.js';
import { runMigrations } from '../migrate.js';

const benchmarkRecordCounts = { events: 20_000, cases: 15_000, relations: 15_000 };
const existingRecordCount = 500;
const benchmarkLimits: DataTransferBenchmarkLimits = {
  maximumImportMilliseconds: 5 * 60 * 1_000,
  maximumPeakRssDeltaBytes: 1.5 * 1024 ** 3,
  maximumImportStatements: 500,
};

export interface BenchmarkCsvCounts {
  events: number;
  cases: number;
  relations: number;
}

export interface DataTransferBenchmarkMetrics {
  logicalRecords: number;
  importMilliseconds: number;
  peakRssDeltaBytes: number;
  importStatementCount: number;
  exportOutputRows: number;
  rowsPulledAtFirstChunk: number;
}

export interface DataTransferBenchmarkLimits {
  maximumImportMilliseconds: number;
  maximumPeakRssDeltaBytes: number;
  maximumImportStatements: number;
}

export interface DataTransferBenchmarkSummary {
  logicalRecords: number;
  importMilliseconds: number;
  peakRssDeltaMiB: number;
  importStatementCount: number;
  exportOutputRows: number;
  rowsPulledAtFirstChunk: number;
}

function quoteCsvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function csvRecord(fields: readonly string[]): string {
  return `${fields.map(quoteCsvField).join(',')}\n`;
}

export function createBenchmarkCsv(counts: BenchmarkCsvCounts): string {
  const total = counts.events + counts.cases + counts.relations;
  if (
    !Number.isInteger(counts.events) ||
    !Number.isInteger(counts.cases) ||
    !Number.isInteger(counts.relations) ||
    counts.events < 0 ||
    counts.cases < 0 ||
    counts.relations < 0 ||
    total > 50_000 ||
    (counts.relations > 0 && counts.events < 2)
  ) {
    throw new Error('Invalid data-transfer benchmark record counts');
  }

  const records: string[] = [];
  for (let index = 0; index < counts.events; index += 1) {
    records.push(
      csvRecord([
        '原子事件',
        `基准事件 ${index}`,
        `跨领域说明，包含逗号, 引号"与换行\n第二行 ${index}`,
        `基准别名 ${index}`,
        `基准关键词 ${index}`,
      ]),
    );
  }
  for (let index = 0; index < counts.cases; index += 1) {
    records.push(csvRecord(['具体案例', `基准案例 ${index}，包含逗号, 引号"与换行\n第二行`]));
  }
  for (let index = 0; index < counts.relations; index += 1) {
    const effectIndex = index < 10 ? (index + 1) % 10 : (index + 1) % counts.events;
    records.push(
      csvRecord([
        '因果关系',
        `基准事件 ${index % counts.events}`,
        `基准事件 ${effectIndex}`,
        String(10 + (index % 91)),
        `基准关系说明 ${index}，包含逗号, 引号"与换行\n第二行`,
        `基准案例 ${index % Math.max(1, counts.cases)}，包含逗号, 引号"与换行\n第二行`,
      ]),
    );
  }
  return records.join('');
}

function roundHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeDataTransferBenchmark(
  metrics: DataTransferBenchmarkMetrics,
): DataTransferBenchmarkSummary {
  return {
    logicalRecords: metrics.logicalRecords,
    importMilliseconds: roundHundredth(metrics.importMilliseconds),
    peakRssDeltaMiB: roundHundredth(metrics.peakRssDeltaBytes / 1024 ** 2),
    importStatementCount: metrics.importStatementCount,
    exportOutputRows: metrics.exportOutputRows,
    rowsPulledAtFirstChunk: metrics.rowsPulledAtFirstChunk,
  };
}

export function assertDataTransferBenchmarkTargets(
  metrics: DataTransferBenchmarkMetrics,
  limits: DataTransferBenchmarkLimits,
): void {
  if (metrics.importMilliseconds > limits.maximumImportMilliseconds) {
    throw new Error(
      `Import benchmark ${metrics.importMilliseconds}ms exceeds ${limits.maximumImportMilliseconds}ms`,
    );
  }
  if (metrics.peakRssDeltaBytes > limits.maximumPeakRssDeltaBytes) {
    throw new Error(
      `Import benchmark peak RSS delta ${metrics.peakRssDeltaBytes} bytes exceeds ${limits.maximumPeakRssDeltaBytes} bytes`,
    );
  }
  if (metrics.importStatementCount > limits.maximumImportStatements) {
    throw new Error(
      `Import benchmark executed ${metrics.importStatementCount} SQL statements; limit is ${limits.maximumImportStatements}`,
    );
  }
  if (metrics.exportOutputRows > 0 && metrics.rowsPulledAtFirstChunk >= metrics.exportOutputRows) {
    throw new Error(
      `Export produced its first chunk only after pulling all ${metrics.exportOutputRows} rows`,
    );
  }
}

interface CountingPool {
  pool: Pool;
  reset(): void;
  statementCount(): number;
}

function wrapQueryTarget<T extends object>(target: T, count: () => void): T {
  return new Proxy(target, {
    get(current, property, receiver) {
      if (property === 'query') {
        const query = Reflect.get(current, property, receiver) as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          count();
          return query.apply(current, args);
        };
      }
      const value = Reflect.get(current, property, receiver) as unknown;
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(current)
        : value;
    },
  });
}

function createCountingPool(pool: Pool): CountingPool {
  let statements = 0;
  const wrapped = new Proxy(pool, {
    get(current, property, receiver) {
      if (property === 'connect') {
        return async () => {
          const client = await current.connect();
          return wrapQueryTarget(client, () => {
            statements += 1;
          });
        };
      }
      if (property === 'query') {
        const query = Reflect.get(current, property, receiver) as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          statements += 1;
          return query.apply(current, args);
        };
      }
      const value = Reflect.get(current, property, receiver) as unknown;
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(current)
        : value;
    },
  }) as Pool;
  return {
    pool: wrapped,
    reset: () => {
      statements = 0;
    },
    statementCount: () => statements,
  };
}

class CountingExportScopeRepository implements ExportScopeRepository {
  public rowsPulled = 0;

  public constructor(private readonly delegate: ExportScopeRepository) {}

  public materialize(
    client: PoolClient,
    input: Parameters<ExportScopeRepository['materialize']>[1],
    signal?: AbortSignal,
  ): Promise<ExportCounts> {
    return this.delegate.materialize(client, input, signal);
  }

  public async *streamEvents(
    client: PoolClient,
    batchSize: number,
    signal?: AbortSignal,
  ): AsyncIterable<EventExportRow[]> {
    for await (const batch of this.delegate.streamEvents(client, batchSize, signal)) {
      this.rowsPulled += batch.length;
      yield batch;
    }
  }

  public async *streamCases(
    client: PoolClient,
    batchSize: number,
    signal?: AbortSignal,
  ): AsyncIterable<CaseExportRow[]> {
    for await (const batch of this.delegate.streamCases(client, batchSize, signal)) {
      this.rowsPulled += batch.length;
      yield batch;
    }
  }

  public async *streamRelations(
    client: PoolClient,
    batchSize: number,
    signal?: AbortSignal,
  ): AsyncIterable<RelationExportRow[]> {
    for await (const batch of this.delegate.streamRelations(client, batchSize, signal)) {
      this.rowsPulled += batch.length;
      yield batch;
    }
  }
}

async function seedExistingRecords(pool: Pool): Promise<void> {
  await pool.query(
    `insert into abstract_events (name, description)
     select '基准事件 ' || value,
            '预置基准事件 ' || value
     from generate_series(0, $1::integer) as value`,
    [existingRecordCount],
  );
  await pool.query(
    `insert into concrete_cases (content)
     select '基准案例 ' || value || '，包含逗号, 引号"与换行' || E'\n' || '第二行'
     from generate_series(0, $1::integer - 1) as value`,
    [existingRecordCount],
  );
  await pool.query(
    `with pairs as (
       select value as cause_index,
              case when value < 10 then (value + 1) % 10 else value + 1 end as effect_index
       from generate_series(0, $1::integer - 1) as value
     )
     insert into causal_relations (
       cause_event_id,
       effect_event_id,
       confidence,
       description
     )
     select cause.id,
            effect.id,
            10 + (pairs.cause_index % 91),
            '预置基准关系 ' || pairs.cause_index
     from pairs
     join abstract_events cause
       on cause.normalized_name = lower('基准事件 ' || pairs.cause_index)
     join abstract_events effect
       on effect.normalized_name = lower('基准事件 ' || pairs.effect_index)`,
    [existingRecordCount],
  );
  await pool.query(
    `with pairs as (
       select value as cause_index,
              case when value < 10 then (value + 1) % 10 else value + 1 end as effect_index
       from generate_series(0, $1::integer - 1) as value
     )
     insert into causal_relation_cases (causal_relation_id, concrete_case_id)
     select relation.id, concrete_case.id
     from pairs
     join abstract_events cause
       on cause.normalized_name = lower('基准事件 ' || pairs.cause_index)
     join abstract_events effect
       on effect.normalized_name = lower('基准事件 ' || pairs.effect_index)
     join causal_relations relation
       on relation.cause_event_id = cause.id
      and relation.effect_event_id = effect.id
     join concrete_cases concrete_case
       on concrete_case.content =
          '基准案例 ' || pairs.cause_index || '，包含逗号, 引号"与换行' || E'\n' || '第二行'`,
    [existingRecordCount],
  );
}

async function measurePeakRss<T>(
  operation: (sample: () => void) => Promise<T>,
): Promise<{ result: T; peakRssDeltaBytes: number }> {
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const sample = () => {
    peak = Math.max(peak, process.memoryUsage().rss);
  };
  const interval = setInterval(sample, 10);
  try {
    const result = await operation(sample);
    sample();
    return { result, peakRssDeltaBytes: Math.max(0, peak - baseline) };
  } finally {
    clearInterval(interval);
  }
}

async function drainExport(
  stream: NodeJS.ReadableStream,
  scope: CountingExportScopeRepository,
): Promise<{ outputRows: number; rowsPulledAtFirstChunk: number }> {
  const parser = parse({
    bom: false,
    delimiter: ',',
    quote: '"',
    escape: '"',
    record_delimiter: ['\r\n', '\n'],
    relax_column_count: true,
  });
  let outputRows = 0;
  const parserDone = (async () => {
    const records = parser[Symbol.asyncIterator]();
    while (!(await records.next()).done) outputRows += 1;
  })();
  let rowsPulledAtFirstChunk = -1;
  for await (const chunk of stream) {
    if (rowsPulledAtFirstChunk < 0) rowsPulledAtFirstChunk = scope.rowsPulled;
    parser.write(chunk);
  }
  parser.end();
  await parserDone;
  return {
    outputRows,
    rowsPulledAtFirstChunk: Math.max(0, rowsPulledAtFirstChunk),
  };
}

async function runBenchmark(): Promise<void> {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  try {
    process.stdout.write('Starting disposable PostgreSQL data-transfer benchmark container...\n');
    container = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
      .withEnvironment({
        POSTGRES_DB: 'causality_data_transfer_benchmark',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_data_transfer_benchmark'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_data_transfer_benchmark`,
    });
    await runMigrations(pool);
    await seedExistingRecords(pool);
    const countingPool = createCountingPool(pool);
    countingPool.reset();
    const startedAt = performance.now();
    const measuredImport = await measurePeakRss(async (sample) => {
      const csv = createBenchmarkCsv(benchmarkRecordCounts);
      sample();
      const parsed = await parseImportCsv(
        Readable.from([Buffer.from(csv)]),
        new AbortController().signal,
      );
      sample();
      const imported = await new ImportService(
        new PostgresImportRepository(countingPool.pool),
      ).execute({
        filename: 'data-transfer-benchmark.csv',
        parseResult: parsed,
        signal: new AbortController().signal,
      });
      sample();
      return { parsed, imported };
    });
    const importMilliseconds = performance.now() - startedAt;
    const importStatementCount = countingPool.statementCount();

    const startEvent = await pool.query<{ id: string }>(
      `select id from abstract_events where normalized_name = lower('基准事件 0')`,
    );
    const cycleScope = new PostgresExportScopeRepository();
    const cycleService = new ExportService(pool, cycleScope, new PostgresExportRequestRepository());
    const cycle = await cycleService.prepareExport({
      type: 'filtered',
      startEventIds: [startEvent.rows[0]!.id],
      direction: 'both',
      depth: 10,
    });
    if (cycle.counts.events < 10 || cycle.counts.relations < 10) {
      throw new Error('Depth-10 cyclic export scope was not materialized');
    }

    const streamingScope = new CountingExportScopeRepository(new PostgresExportScopeRepository());
    const exportService = new ExportService(
      pool,
      streamingScope,
      new PostgresExportRequestRepository(),
    );
    const prepared = await exportService.prepareExport({ type: 'full' });
    const exported = await exportService.openExportCsv(
      prepared.token,
      new AbortController().signal,
    );
    const exportMetrics = await drainExport(exported.stream, streamingScope);
    await exported.close();

    const metrics: DataTransferBenchmarkMetrics = {
      logicalRecords: measuredImport.result.parsed.logicalRecordCount,
      importMilliseconds,
      peakRssDeltaBytes: measuredImport.peakRssDeltaBytes,
      importStatementCount,
      exportOutputRows: exportMetrics.outputRows,
      rowsPulledAtFirstChunk: exportMetrics.rowsPulledAtFirstChunk,
    };
    const summary = summarizeDataTransferBenchmark(metrics);
    const report = {
      input: benchmarkRecordCounts,
      limits: benchmarkLimits,
      summary,
      importCounts: measuredImport.result.imported.batch.counts,
      cycleScope: cycle.counts,
      passed: true,
    };
    assertDataTransferBenchmarkTargets(metrics, benchmarkLimits);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool?.end();
    await container?.stop();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runBenchmark();
}
