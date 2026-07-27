import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { CsvFileError } from '../src/features/data-transfer/csvCodec.js';
import {
  encodeCaseRow,
  encodeEventRow,
  encodeRelationRow,
  parseImportCsv,
} from '../src/features/data-transfer/csvCodec.js';

const signal = new AbortController().signal;

function inputStream(input: string | Buffer | readonly Buffer[]): Readable {
  return Readable.from(Array.isArray(input) ? input : [input]);
}

function quotedRow(fields: readonly string[], delimiter = '\n'): string {
  return `${fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(',')}${delimiter}`;
}

async function expectCsvFileError(
  operation: Promise<unknown>,
  code: CsvFileError['code'],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: 'CsvFileError',
    code,
  });
}

describe('strict import CSV parser', () => {
  it('parses quoted commas, embedded newlines, doubled quotes, LF, and CRLF', async () => {
    const result = await parseImportCsv(
      inputStream('"具体案例","包含,逗号\n和""引号""的案例"\r\n' + '"具体案例","第二条案例"\n'),
      signal,
    );

    expect(result).toEqual({
      validRecords: [
        {
          type: 'case',
          sequence: 1,
          content: '包含,逗号\n和"引号"的案例',
        },
        {
          type: 'case',
          sequence: 2,
          content: '第二条案例',
        },
      ],
      logicalRecordCount: 2,
      invalidRecordCount: 0,
    });
  });

  it('decodes escaped event lists and accepts omitted trailing optional fields', async () => {
    const result = await parseImportCsv(
      inputStream(
        '"原子事件","事件","说明","别名一;带\\;号的别名;路径\\\\末尾","关键词"\n' +
          '"原子事件","只有名称"\n',
      ),
      signal,
    );

    expect(result.validRecords).toEqual([
      {
        type: 'event',
        sequence: 1,
        name: '事件',
        description: '说明',
        aliases: ['别名一', '带;号的别名', '路径\\末尾'],
        keywords: ['关键词'],
      },
      {
        type: 'event',
        sequence: 2,
        name: '只有名称',
        description: null,
        aliases: [],
        keywords: [],
      },
    ]);
  });

  it('ignores a UTF-8 BOM, blank logical records, and empty trailing event/case fields', async () => {
    const result = await parseImportCsv(
      inputStream(
        '\uFEFF"原子事件","事件","","","",""\n' + '\n' + '   \r\n' + '"具体案例","案例","",""\n',
      ),
      signal,
    );

    expect(result).toEqual({
      validRecords: [
        {
          type: 'event',
          sequence: 1,
          name: '事件',
          description: null,
          aliases: [],
          keywords: [],
        },
        {
          type: 'case',
          sequence: 2,
          content: '案例',
        },
      ],
      logicalRecordCount: 2,
      invalidRecordCount: 0,
    });
  });

  it('preserves original logical sequence while recovering from invalid rows', async () => {
    const result = await parseImportCsv(
      inputStream(
        '"具体案例","有效案例"\n' + '"因果关系","结果","原因","101"\n' + '"原子事件","有效事件"\n',
      ),
      signal,
    );

    expect(result).toEqual({
      validRecords: [
        { type: 'case', sequence: 1, content: '有效案例' },
        {
          type: 'event',
          sequence: 3,
          name: '有效事件',
          description: null,
          aliases: [],
          keywords: [],
        },
      ],
      logicalRecordCount: 3,
      invalidRecordCount: 1,
    });
  });

  it('requires every non-empty CSV field to be double-quoted', async () => {
    const result = await parseImportCsv(
      inputStream('具体案例,"未加引号"\n"具体案例","有效案例"\n'),
      signal,
    );

    expect(result).toEqual({
      validRecords: [{ type: 'case', sequence: 2, content: '有效案例' }],
      logicalRecordCount: 2,
      invalidRecordCount: 1,
    });
  });

  it('rejects unknown or dangling list escapes and duplicate aliases or keywords per row', async () => {
    const result = await parseImportCsv(
      inputStream(
        '"原子事件","未知转义","","别名\\x",""\n' +
          '"原子事件","悬空转义","","别名\\",""\n' +
          '"原子事件","重复别名","","别名;别名",""\n' +
          '"原子事件","重复关键词","","","关键词;关键词"\n' +
          '"原子事件","有效事件","","别名","关键词"\n',
      ),
      signal,
    );

    expect(result).toEqual({
      validRecords: [
        {
          type: 'event',
          sequence: 5,
          name: '有效事件',
          description: null,
          aliases: ['别名'],
          keywords: ['关键词'],
        },
      ],
      logicalRecordCount: 5,
      invalidRecordCount: 4,
    });
  });

  it('invalidates non-empty extra event/case fields but ignores empty extras', async () => {
    const result = await parseImportCsv(
      inputStream(
        '"原子事件","事件","","","","额外内容"\n' +
          '"具体案例","案例","额外内容"\n' +
          '"原子事件","有效事件","","","",""\n' +
          '"具体案例","有效案例","",""\n',
      ),
      signal,
    );

    expect(result.validRecords).toEqual([
      {
        type: 'event',
        sequence: 3,
        name: '有效事件',
        description: null,
        aliases: [],
        keywords: [],
      },
      { type: 'case', sequence: 4, content: '有效案例' },
    ]);
    expect(result.logicalRecordCount).toBe(4);
    expect(result.invalidRecordCount).toBe(2);
  });

  it('defaults relation confidence to 10 and ignores empty relation-case cells', async () => {
    const result = await parseImportCsv(
      inputStream(
        '"因果关系","原因","结果","","","案例一","","案例二"\n' +
          '"因果关系","另一个原因","另一个结果"\n',
      ),
      signal,
    );

    expect(result.validRecords).toEqual([
      {
        type: 'relation',
        sequence: 1,
        causeEventName: '原因',
        effectEventName: '结果',
        confidence: 10,
        description: null,
        caseContents: ['案例一', '案例二'],
      },
      {
        type: 'relation',
        sequence: 2,
        causeEventName: '另一个原因',
        effectEventName: '另一个结果',
        confidence: 10,
        description: null,
        caseContents: [],
      },
    ]);
  });

  it('deduplicates relation cases after normalization', async () => {
    const result = await parseImportCsv(
      inputStream('"因果关系","原因","结果","80",""," 案例一 ","案例一","案例二"\n'),
      signal,
    );

    expect(result.validRecords[0]).toMatchObject({
      type: 'relation',
      confidence: 80,
      caseContents: ['案例一', '案例二'],
    });
  });

  it('caps unique relation cases at 1,000 without counting empty cells', async () => {
    const allowed = quotedRow([
      '因果关系',
      '原因',
      '结果',
      '',
      '',
      ...Array.from({ length: 1_001 }, () => ''),
      '唯一案例',
    ]);
    const tooMany = quotedRow([
      '因果关系',
      '另一个原因',
      '另一个结果',
      '',
      '',
      ...Array.from({ length: 1_001 }, (_, index) => `案例${index + 1}`),
    ]);
    const result = await parseImportCsv(inputStream(allowed + tooMany), signal);

    expect(result.validRecords).toHaveLength(1);
    expect(result.validRecords[0]).toMatchObject({
      type: 'relation',
      caseContents: ['唯一案例'],
    });
    expect(result.logicalRecordCount).toBe(2);
    expect(result.invalidRecordCount).toBe(1);
  });

  it('decodes a multibyte UTF-8 character split across input chunks', async () => {
    const bytes = Buffer.from('"具体案例","中文案例"\n');
    const firstChineseByte = bytes.indexOf(Buffer.from('中'));
    const result = await parseImportCsv(
      inputStream([
        bytes.subarray(0, firstChineseByte + 1),
        bytes.subarray(firstChineseByte + 1, firstChineseByte + 2),
        bytes.subarray(firstChineseByte + 2),
      ]),
      signal,
    );

    expect(result.validRecords).toEqual([{ type: 'case', sequence: 1, content: '中文案例' }]);
  });

  it('rejects an unrecoverable unclosed quote', async () => {
    await expectCsvFileError(
      parseImportCsv(inputStream('"具体案例","未闭合'), signal),
      'CSV_UNRECOVERABLE_SYNTAX',
    );
  });

  it('rejects invalid UTF-8 bytes', async () => {
    await expectCsvFileError(
      parseImportCsv(inputStream(Buffer.from([0xc3, 0x28])), signal),
      'CSV_INVALID_UTF8',
    );
  });

  it('rejects input larger than 20 MiB by actual bytes', async () => {
    await expectCsvFileError(
      parseImportCsv(inputStream(Buffer.alloc(20 * 1024 * 1024 + 1, 0x20)), signal),
      'CSV_FILE_TOO_LARGE',
    );
  });

  it('rejects more than 50,000 nonblank logical records', async () => {
    const input = '"具体案例","案例"\n'.repeat(50_001);
    await expectCsvFileError(parseImportCsv(inputStream(input), signal), 'CSV_TOO_MANY_RECORDS');
  });

  it('rejects files without any valid records', async () => {
    await expectCsvFileError(
      parseImportCsv(inputStream('"因果关系","结果","原因","101"\n'), signal),
      'CSV_NO_VALID_RECORDS',
    );
  });

  it('preserves unexpected input stream failures instead of reporting a CSV syntax error', async () => {
    const source = new Readable({
      read() {
        this.destroy(new Error('读取输入流失败'));
      },
    });

    await expect(parseImportCsv(source, signal)).rejects.toMatchObject({
      name: 'Error',
      message: '读取输入流失败',
    });
  });
});

describe('CSV export row encoders', () => {
  it('encodes events in readable field order with escaped lists and empty optional columns', () => {
    expect(
      encodeEventRow({
        name: '事件',
        description: null,
        aliases: ['普通别名', '带;分号', '带\\斜线'],
        keywords: [],
      }),
    ).toEqual(['原子事件', '事件', '', '普通别名;带\\;分号;带\\\\斜线', '']);
  });

  it('encodes an independent case without IDs or timestamps', () => {
    expect(encodeCaseRow({ content: '真实发生的具体案例' })).toEqual([
      '具体案例',
      '真实发生的具体案例',
    ]);
  });

  it('encodes relations with stable optional columns followed by every case', () => {
    expect(
      encodeRelationRow({
        causeEventName: '原因事件',
        effectEventName: '结果事件',
        confidence: 75,
        description: null,
        caseContents: ['案例一', '案例二'],
      }),
    ).toEqual(['因果关系', '原因事件', '结果事件', '75', '', '案例一', '案例二']);
  });
});
