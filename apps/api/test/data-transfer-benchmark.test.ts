import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  assertDataTransferBenchmarkTargets,
  createBenchmarkCsv,
  summarizeDataTransferBenchmark,
} from '../src/database/benchmark/dataTransferBenchmark.js';
import { parseImportCsv } from '../src/features/data-transfer/csvCodec.js';

describe('data-transfer benchmark', () => {
  it('generates strict quoted mixed CSV with embedded punctuation and multiline fields', async () => {
    const csv = createBenchmarkCsv({ events: 4, cases: 3, relations: 3 });
    const parsed = await parseImportCsv(Readable.from([csv]), new AbortController().signal);

    expect(parsed.logicalRecordCount).toBe(10);
    expect(parsed.invalidRecordCount).toBe(0);
    expect(parsed.validRecords).toHaveLength(10);
    expect(parsed.validRecords).toContainEqual({
      type: 'event',
      sequence: 1,
      name: '基准事件 0',
      description: '跨领域说明，包含逗号, 引号"与换行\n第二行 0',
      aliases: ['基准别名 0'],
      keywords: ['基准关键词 0'],
    });
    expect(parsed.validRecords).toContainEqual({
      type: 'case',
      sequence: 5,
      content: '基准案例 0，包含逗号, 引号"与换行\n第二行',
    });
  });

  it('rounds report values without changing measured counts', () => {
    expect(
      summarizeDataTransferBenchmark({
        logicalRecords: 50_000,
        importMilliseconds: 12_345.678,
        peakRssDeltaBytes: 123_456_789,
        importStatementCount: 37,
        exportOutputRows: 65_000,
        rowsPulledAtFirstChunk: 100,
      }),
    ).toEqual({
      logicalRecords: 50_000,
      importMilliseconds: 12_345.68,
      peakRssDeltaMiB: 117.74,
      importStatementCount: 37,
      exportOutputRows: 65_000,
      rowsPulledAtFirstChunk: 100,
    });
  });

  it('accepts exact limits and rejects time, memory, SQL, and buffered export breaches', () => {
    const limits = {
      maximumImportMilliseconds: 300_000,
      maximumPeakRssDeltaBytes: 1.5 * 1024 ** 3,
      maximumImportStatements: 500,
    };
    const boundary = {
      logicalRecords: 50_000,
      importMilliseconds: limits.maximumImportMilliseconds,
      peakRssDeltaBytes: limits.maximumPeakRssDeltaBytes,
      importStatementCount: limits.maximumImportStatements,
      exportOutputRows: 50_000,
      rowsPulledAtFirstChunk: 100,
    };

    expect(() => assertDataTransferBenchmarkTargets(boundary, limits)).not.toThrow();
    expect(() =>
      assertDataTransferBenchmarkTargets({ ...boundary, importMilliseconds: 300_001 }, limits),
    ).toThrow('Import benchmark 300001ms exceeds 300000ms');
    expect(() =>
      assertDataTransferBenchmarkTargets(
        { ...boundary, peakRssDeltaBytes: limits.maximumPeakRssDeltaBytes + 1 },
        limits,
      ),
    ).toThrow('Import benchmark peak RSS delta');
    expect(() =>
      assertDataTransferBenchmarkTargets({ ...boundary, importStatementCount: 501 }, limits),
    ).toThrow('Import benchmark executed 501 SQL statements; limit is 500');
    expect(() =>
      assertDataTransferBenchmarkTargets({ ...boundary, rowsPulledAtFirstChunk: 50_000 }, limits),
    ).toThrow('Export produced its first chunk only after pulling all 50000 rows');
  });
});
