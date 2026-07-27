import type {
  ExportAvailabilityResponse,
  ExportPreviewInput,
  ExportPreviewResponse,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import { openExportCsvWithDependencies, type ExportCsvStream } from './exportCsvStream.js';
import {
  ExportRequestError,
  isExportTokenFormat,
  PostgresExportRequestRepository,
  type ExportRequestRepository,
} from './exportRequestRepository.js';
import {
  ExportScopeError,
  normalizeExportInput,
  PostgresExportScopeRepository,
  type ExportScopeRepository,
} from './exportScopeRepository.js';

const DEFAULT_TOKEN_LIFETIME_MS = 10 * 60 * 1000;

export interface ExportServiceOptions {
  now?: () => Date;
  createToken?: () => string;
  tokenLifetimeMs?: number;
}

export class ExportServiceError extends Error {
  public constructor(
    public readonly code:
      'EXPORT_TOKEN_INVALID' | 'EXPORT_TOKEN_EXPIRED' | 'EXPORT_START_EVENT_NOT_FOUND',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExportServiceError';
  }
}

async function rollback(client: PoolClient, transactionStarted: boolean): Promise<void> {
  if (!transactionStarted) return;
  try {
    await client.query('rollback');
  } catch {
    // The original transaction error is more useful to callers.
  }
}

export class ExportService {
  private readonly now: () => Date;
  private readonly tokenLifetimeMs: number;

  public constructor(
    private readonly pool: Pool,
    private readonly scopeRepository: ExportScopeRepository,
    private readonly requestRepository: ExportRequestRepository,
    options: ExportServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.tokenLifetimeMs = options.tokenLifetimeMs ?? DEFAULT_TOKEN_LIFETIME_MS;
  }

  public async previewExport(rawInput: ExportPreviewInput): Promise<ExportPreviewResponse> {
    const input = normalizeExportInput(rawInput);
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query('begin transaction isolation level repeatable read');
      transactionStarted = true;
      const counts = await this.scopeRepository.materialize(client, input);
      const createdAt = this.now();
      const expiresAt = new Date(createdAt.getTime() + this.tokenLifetimeMs);
      await this.requestRepository.deleteExpired(client, createdAt);
      const token = await this.requestRepository.create(client, input, createdAt, expiresAt);
      await client.query('commit');
      transactionStarted = false;
      return { token, expiresAt: expiresAt.toISOString(), counts };
    } catch (error) {
      await rollback(client, transactionStarted);
      throw error;
    } finally {
      client.release();
    }
  }

  public async checkExportAvailability(token: string): Promise<ExportAvailabilityResponse> {
    if (!isExportTokenFormat(token)) {
      throw new ExportServiceError('EXPORT_TOKEN_INVALID', '导出令牌无效');
    }
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      transactionStarted = true;
      const request = await this.requestRepository.read(client, token);
      if (request.expiresAt.getTime() <= this.now().getTime()) {
        throw new ExportServiceError('EXPORT_TOKEN_EXPIRED', '导出令牌已过期');
      }
      if (request.input.type === 'filtered') {
        const result = await client.query<{ count: number | string }>(
          `select count(*)::int as count
           from abstract_events
           where id = any($1::uuid[])`,
          [request.input.startEventIds],
        );
        if (Number(result.rows[0]?.count ?? 0) !== request.input.startEventIds.length) {
          throw new ExportServiceError('EXPORT_START_EVENT_NOT_FOUND', '起始原子事件不存在');
        }
      }
      await client.query('commit');
      transactionStarted = false;
      return { available: true, expiresAt: request.expiresAt.toISOString() };
    } catch (error) {
      await rollback(client, transactionStarted);
      if (error instanceof ExportRequestError || error instanceof ExportScopeError) throw error;
      throw error;
    } finally {
      client.release();
    }
  }

  public openExportCsv(token: string, signal: AbortSignal): Promise<ExportCsvStream> {
    return openExportCsvWithDependencies(token, signal, {
      pool: this.pool,
      scopeRepository: this.scopeRepository,
      requestRepository: this.requestRepository,
      now: this.now,
    });
  }
}

export function createExportService(pool: Pool, options: ExportServiceOptions = {}): ExportService {
  return new ExportService(
    pool,
    new PostgresExportScopeRepository(),
    new PostgresExportRequestRepository({
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.createToken === undefined ? {} : { createToken: options.createToken }),
    }),
    options,
  );
}
