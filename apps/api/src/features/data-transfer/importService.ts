import type { CsvParseResult } from './dataTransferTypes.js';
import { ImportError, type ImportCommitResult, type ImportRepository } from './importRepository.js';

export interface ExecuteImportCommand {
  filename: string;
  parseResult: CsvParseResult;
  signal: AbortSignal;
}

export class ImportService {
  public constructor(private readonly repository: ImportRepository) {}

  public execute(command: ExecuteImportCommand): Promise<ImportCommitResult> {
    if (command.signal.aborted) {
      throw new ImportError('IMPORT_CANCELLED', '导入任务已取消');
    }
    if (command.parseResult.validRecords.length === 0) {
      throw new ImportError('CSV_NO_VALID_RECORDS', 'CSV 文件中没有可导入的有效记录');
    }

    return this.repository.commit({
      filename: command.filename,
      records: command.parseResult.validRecords,
      signal: command.signal,
    });
  }
}
