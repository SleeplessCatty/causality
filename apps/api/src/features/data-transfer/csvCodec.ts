import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  caseContentSchema,
  eventFormInputSchema,
  eventNameSchema,
  relationConfidenceSchema,
  relationDescriptionSchema,
} from '@causality/contracts';
import { CsvError, parse } from 'csv-parse';

import { isBlankRawCsvRecord, isStrictQuotedCsvRecord } from './csvLexicalValidator.js';
import {
  CsvFileError,
  type CaseExportRow,
  type CsvParseResult,
  type EventExportRow,
  type ParsedImportRecord,
  type RelationExportRow,
} from './dataTransferTypes.js';

export { CsvFileError } from './dataTransferTypes.js';
export type {
  CaseExportRow,
  CsvParseResult,
  EventExportRow,
  ParsedImportRecord,
  RelationExportRow,
} from './dataTransferTypes.js';

const maximumFileBytes = 20 * 1024 * 1024;
const maximumLogicalRecords = 50_000;
const maximumRelationCases = 1_000;

interface CsvParserOutput {
  raw: string;
  record: string[];
}

class Utf8ByteLimitTransform extends Transform {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private totalBytes = 0;

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > maximumFileBytes) {
      callback(new CsvFileError('CSV_FILE_TOO_LARGE', 'CSV 文件不能超过 20 MiB'));
      return;
    }

    try {
      this.decoder.decode(chunk, { stream: true });
      callback(null, chunk);
    } catch (error) {
      callback(
        new CsvFileError('CSV_INVALID_UTF8', 'CSV 文件不是有效的 UTF-8 文本', { cause: error }),
      );
    }
  }

  public override _flush(callback: TransformCallback): void {
    try {
      this.decoder.decode();
      callback();
    } catch (error) {
      callback(
        new CsvFileError('CSV_INVALID_UTF8', 'CSV 文件不是有效的 UTF-8 文本', { cause: error }),
      );
    }
  }
}

function decodeEscapedList(value: string | undefined): string[] | null {
  const source = value?.trim() ?? '';
  if (source.length === 0) return [];

  const values: string[] = [];
  let current = '';

  for (let position = 0; position < source.length; position += 1) {
    const character = source[position]!;
    if (character === ';') {
      values.push(current.trim());
      current = '';
      continue;
    }
    if (character !== '\\') {
      current += character;
      continue;
    }

    const escaped = source[position + 1];
    if (escaped !== ';' && escaped !== '\\') return null;
    current += escaped;
    position += 1;
  }

  values.push(current.trim());
  return values;
}

function hasNonemptyExtraFields(fields: readonly string[], expectedLength: number): boolean {
  return fields.slice(expectedLength).some((field) => field.trim().length > 0);
}

function decodeEvent(fields: readonly string[], sequence: number): ParsedImportRecord | null {
  if (hasNonemptyExtraFields(fields, 5)) return null;
  const aliases = decodeEscapedList(fields[3]);
  const keywords = decodeEscapedList(fields[4]);
  if (!aliases || !keywords) return null;

  const parsed = eventFormInputSchema.safeParse({
    name: fields[1] ?? '',
    description: fields[2] ?? null,
    aliases,
    keywords,
  });
  if (!parsed.success) return null;

  return {
    type: 'event',
    sequence,
    name: parsed.data.name,
    description: parsed.data.description,
    aliases: parsed.data.aliases,
    keywords: parsed.data.keywords,
  };
}

function decodeCase(fields: readonly string[], sequence: number): ParsedImportRecord | null {
  if (hasNonemptyExtraFields(fields, 2)) return null;
  const content = caseContentSchema.safeParse(fields[1] ?? '');
  if (!content.success) return null;
  return { type: 'case', sequence, content: content.data };
}

function decodeConfidence(
  value: string | undefined,
): { confidence: number; confidenceManuallyEdited: boolean } | null {
  const source = value?.trim() ?? '';
  if (source.length === 0) {
    return { confidence: 10, confidenceManuallyEdited: false };
  }
  const parsed = relationConfidenceSchema.safeParse(Number(source));
  return parsed.success ? { confidence: parsed.data, confidenceManuallyEdited: true } : null;
}

function decodeRelationCases(fields: readonly string[]): string[] | null {
  const uniqueCases = new Set<string>();

  for (const field of fields.slice(5)) {
    if (field.trim().length === 0) continue;
    const parsed = caseContentSchema.safeParse(field);
    if (!parsed.success) return null;
    uniqueCases.add(parsed.data);
    if (uniqueCases.size > maximumRelationCases) return null;
  }

  return [...uniqueCases];
}

function decodeRelation(fields: readonly string[], sequence: number): ParsedImportRecord | null {
  const causeEventName = eventNameSchema.safeParse(fields[1] ?? '');
  const effectEventName = eventNameSchema.safeParse(fields[2] ?? '');
  const confidenceInput = decodeConfidence(fields[3]);
  const description = relationDescriptionSchema.safeParse(fields[4] ?? null);
  const caseContents = decodeRelationCases(fields);
  if (
    !causeEventName.success ||
    !effectEventName.success ||
    confidenceInput === null ||
    !description.success ||
    !caseContents
  ) {
    return null;
  }

  return {
    type: 'relation',
    sequence,
    causeEventName: causeEventName.data,
    effectEventName: effectEventName.data,
    ...confidenceInput,
    description: description.data,
    caseContents,
  };
}

function decodeRecord(fields: readonly string[], sequence: number): ParsedImportRecord | null {
  switch (fields[0]?.trim()) {
    case '原子事件':
      return decodeEvent(fields, sequence);
    case '具体案例':
      return decodeCase(fields, sequence);
    case '因果关系':
      return decodeRelation(fields, sequence);
    default:
      return null;
  }
}

function asParserOutput(value: unknown): CsvParserOutput {
  return value as CsvParserOutput;
}

function normalizeStreamError(error: unknown): Error {
  if (error instanceof CsvFileError) return error;
  if (error instanceof Error && error.name === 'AbortError') return error;
  if (error instanceof CsvError) {
    return new CsvFileError('CSV_UNRECOVERABLE_SYNTAX', 'CSV 文件包含无法恢复的语法错误', {
      cause: error,
    });
  }
  if (error instanceof Error) return error;
  return new Error('CSV 输入流处理失败', { cause: error });
}

export async function parseImportCsv(
  input: NodeJS.ReadableStream,
  signal: AbortSignal,
): Promise<CsvParseResult> {
  const utf8Validator = new Utf8ByteLimitTransform();
  const parser = parse({
    bom: true,
    delimiter: ',',
    quote: '"',
    escape: '"',
    record_delimiter: ['\r\n', '\n'],
    raw: true,
    relax_quotes: false,
    relax_column_count: true,
    skip_empty_lines: false,
  });
  const pipelineOutcome = pipeline(input, utf8Validator, parser, { signal }).then(
    () => null,
    (error: unknown) => error,
  );

  const validRecords: ParsedImportRecord[] = [];
  let logicalRecordCount = 0;
  let invalidRecordCount = 0;
  let processingError: unknown = null;

  try {
    for await (const value of parser) {
      const output = asParserOutput(value);
      if (isBlankRawCsvRecord(output.raw)) continue;

      logicalRecordCount += 1;
      if (logicalRecordCount > maximumLogicalRecords) {
        throw new CsvFileError(
          'CSV_TOO_MANY_RECORDS',
          `CSV 文件最多包含 ${maximumLogicalRecords} 条记录`,
        );
      }

      if (!isStrictQuotedCsvRecord(output.raw)) {
        invalidRecordCount += 1;
        continue;
      }

      const decoded = decodeRecord(output.record, logicalRecordCount);
      if (decoded) validRecords.push(decoded);
      else invalidRecordCount += 1;
    }
  } catch (error) {
    processingError = error;
  }

  const pipelineError = await pipelineOutcome;
  const error = processingError ?? pipelineError;
  if (error) throw normalizeStreamError(error);
  if (validRecords.length === 0) {
    throw new CsvFileError('CSV_NO_VALID_RECORDS', 'CSV 文件中没有可导入的有效记录');
  }

  return { validRecords, logicalRecordCount, invalidRecordCount };
}

function encodeEscapedList(values: readonly string[]): string {
  return values.map((value) => value.replaceAll('\\', '\\\\').replaceAll(';', '\\;')).join(';');
}

export function encodeEventRow(input: EventExportRow): string[] {
  return [
    '原子事件',
    input.name,
    input.description ?? '',
    encodeEscapedList(input.aliases),
    encodeEscapedList(input.keywords),
  ];
}

export function encodeCaseRow(input: CaseExportRow): string[] {
  return ['具体案例', input.content];
}

export function encodeRelationRow(input: RelationExportRow): string[] {
  return [
    '因果关系',
    input.causeEventName,
    input.effectEventName,
    String(input.confidence),
    input.description ?? '',
    ...input.caseContents,
  ];
}
