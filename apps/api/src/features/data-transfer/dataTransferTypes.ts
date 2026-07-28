import type { ImportRecordType } from '@causality/contracts';

export type ImportCsvRecordType = Exclude<ImportRecordType, 'relation_case'>;

export type ParsedImportRecord =
  | {
      type: 'event';
      sequence: number;
      name: string;
      description: string | null;
      aliases: string[];
      keywords: string[];
    }
  | {
      type: 'case';
      sequence: number;
      content: string;
    }
  | {
      type: 'relation';
      sequence: number;
      causeEventName: string;
      effectEventName: string;
      confidence: number;
      confidenceManuallyEdited: boolean;
      description: string | null;
      caseContents: string[];
    };

export interface CsvParseResult {
  validRecords: ParsedImportRecord[];
  logicalRecordCount: number;
  invalidRecordCount: number;
}

export interface EventExportRow {
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
}

export interface CaseExportRow {
  content: string;
}

export interface RelationExportRow {
  causeEventName: string;
  effectEventName: string;
  confidence: number;
  description: string | null;
  caseContents: string[];
}

export type CsvFileErrorCode =
  | 'CSV_INVALID_UTF8'
  | 'CSV_UNRECOVERABLE_SYNTAX'
  | 'CSV_FILE_TOO_LARGE'
  | 'CSV_TOO_MANY_RECORDS'
  | 'CSV_NO_VALID_RECORDS';

export class CsvFileError extends Error {
  public constructor(
    public readonly code: CsvFileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CsvFileError';
  }
}
