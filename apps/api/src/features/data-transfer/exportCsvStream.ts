import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Pool, PoolClient } from 'pg';
import { stringify } from 'csv-stringify';

import { encodeCaseRow, encodeEventRow, encodeRelationRow } from './csvCodec.js';
import {
  ExportRequestError,
  isExportTokenFormat,
  type ExportRequestRepository,
} from './exportRequestRepository.js';
import type { ExportScopeRepository } from './exportScopeRepository.js';

const DEFAULT_EXPORT_BATCH_SIZE = 100;

export interface ExportCsvStream {
  filename: string;
  stream: NodeJS.ReadableStream;
  close(): Promise<void>;
}

export interface OpenExportCsvDependencies {
  pool: Pool;
  scopeRepository: ExportScopeRepository;
  requestRepository: ExportRequestRepository;
  now: () => Date;
  batchSize?: number;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('rollback');
  } catch {
    // Preserve the original stream or transaction failure for the consumer.
  }
}

function safeFilenameFragment(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && codePoint !== 34 && codePoint !== 127;
    })
    .join('');
}

function timestampFragment(date: Date): string {
  return date.toISOString().slice(0, 19).replaceAll('-', '').replace('T', '-').replaceAll(':', '');
}

async function* encodedRows(
  client: PoolClient,
  scopeRepository: ExportScopeRepository,
  batchSize: number,
  signal: AbortSignal,
): AsyncIterable<string[]> {
  for await (const batch of scopeRepository.streamEvents(client, batchSize, signal)) {
    signal.throwIfAborted();
    for (const row of batch) yield encodeEventRow(row);
  }
  for await (const batch of scopeRepository.streamCases(client, batchSize, signal)) {
    signal.throwIfAborted();
    for (const row of batch) yield encodeCaseRow(row);
  }
  for await (const batch of scopeRepository.streamRelations(client, batchSize, signal)) {
    signal.throwIfAborted();
    for (const row of batch) yield encodeRelationRow(row);
  }
}

export async function openExportCsvWithDependencies(
  token: string,
  signal: AbortSignal,
  dependencies: OpenExportCsvDependencies,
): Promise<ExportCsvStream> {
  if (!isExportTokenFormat(token)) {
    throw new ExportRequestError('EXPORT_TOKEN_INVALID', '导出令牌无效');
  }
  signal.throwIfAborted();

  const client = await dependencies.pool.connect();
  let transactionStarted = false;
  try {
    signal.throwIfAborted();
    await client.query('begin transaction isolation level repeatable read');
    transactionStarted = true;
    signal.throwIfAborted();
    const request = await dependencies.requestRepository.read(client, token, { forUpdate: true });
    signal.throwIfAborted();
    if (request.expiresAt.getTime() <= dependencies.now().getTime()) {
      throw new ExportRequestError('EXPORT_TOKEN_EXPIRED', '导出令牌已过期');
    }
    await dependencies.scopeRepository.materialize(client, request.input, signal);
    signal.throwIfAborted();

    const controller = new AbortController();
    const batchSize = dependencies.batchSize ?? DEFAULT_EXPORT_BATCH_SIZE;
    const csv = stringify({
      bom: false,
      header: false,
      quoted: true,
      quoted_empty: true,
      delimiter: ',',
      record_delimiter: '\n',
    });
    let output: Readable;
    let finalization: Promise<void> | undefined;
    const onAbort = () => {
      controller.abort(signal.reason);
      output.destroy();
    };

    const finalize = (commit: boolean): Promise<void> => {
      finalization ??= (async () => {
        signal.removeEventListener('abort', onAbort);
        try {
          if (transactionStarted) {
            if (commit) {
              try {
                await client.query('commit');
              } catch (error) {
                await rollback(client);
                transactionStarted = false;
                throw error;
              }
            } else {
              await rollback(client);
            }
            transactionStarted = false;
          }
        } finally {
          client.release();
        }
      })();
      return finalization;
    };

    const source = Readable.from(
      encodedRows(client, dependencies.scopeRepository, batchSize, controller.signal),
      { objectMode: true },
    );
    const producer = pipeline(source, csv, { signal: controller.signal });
    void producer.catch(() => undefined);

    async function* transactionalOutput(): AsyncIterable<Buffer> {
      try {
        for await (const chunk of csv) yield Buffer.from(chunk);
        await producer;
        controller.signal.throwIfAborted();
        await finalize(true);
      } catch (error) {
        controller.abort(error);
        await producer.catch(() => undefined);
        await finalize(false).catch(() => undefined);
        throw error;
      } finally {
        controller.abort();
        await producer.catch(() => undefined);
        await finalize(false).catch(() => undefined);
      }
    }

    output = Readable.from(transactionalOutput());
    const close = async (): Promise<void> => {
      controller.abort();
      output.destroy();
      await finalize(false).catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    const filename = safeFilenameFragment(
      `causality-${request.input.type}-${timestampFragment(dependencies.now())}.csv`,
    );
    return { filename, stream: output, close };
  } catch (error) {
    if (transactionStarted) await rollback(client);
    client.release();
    throw error;
  }
}
