import { createHash, randomBytes } from 'node:crypto';

import type { ExportPreviewInput } from '@causality/contracts';
import type { PoolClient } from 'pg';

import { normalizeExportInput } from './exportScopeRepository.js';

export interface StoredExportRequest {
  id: string;
  input: ExportPreviewInput;
  createdAt: Date;
  expiresAt: Date;
}

export interface ExportRequestRepository {
  create(client: PoolClient, input: ExportPreviewInput, expiresAt: Date): Promise<string>;
  read(client: PoolClient, rawToken: string): Promise<StoredExportRequest>;
  deleteExpired(client: PoolClient, now: Date): Promise<number>;
}

export class ExportRequestError extends Error {
  public constructor(
    public readonly code: 'EXPORT_TOKEN_INVALID' | 'EXPORT_TOKEN_EXPIRED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExportRequestError';
  }
}

export interface ExportRequestRepositoryOptions {
  now?: () => Date;
  createToken?: () => string;
}

export function createExportToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isExportTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(token) && Buffer.from(token, 'base64url').byteLength >= 32;
}

function tokenHash(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

interface ExportRequestRow {
  id: string;
  export_type: 'full' | 'filtered';
  start_event_ids: string[];
  direction: 'upstream' | 'downstream' | 'both' | null;
  depth: number | null;
  created_at: Date;
  expires_at: Date;
}

function toStoredRequest(row: ExportRequestRow): StoredExportRequest {
  const input: ExportPreviewInput =
    row.export_type === 'full'
      ? { type: 'full' }
      : {
          type: 'filtered',
          startEventIds: row.start_event_ids,
          direction: row.direction!,
          depth: row.depth!,
        };
  return { id: row.id, input, createdAt: row.created_at, expiresAt: row.expires_at };
}

export class PostgresExportRequestRepository implements ExportRequestRepository {
  private readonly now: () => Date;
  private readonly createToken: () => string;

  public constructor(options: ExportRequestRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createToken = options.createToken ?? createExportToken;
  }

  public async create(client: PoolClient, rawInput: ExportPreviewInput, expiresAt: Date): Promise<string> {
    const input = normalizeExportInput(rawInput);
    const rawToken = this.createToken();
    if (!isExportTokenFormat(rawToken)) {
      throw new Error('Export token generator returned an invalid token');
    }
    const createdAt = this.now();
    await client.query(
      `insert into export_requests (
         token_hash, export_type, start_event_ids, direction, depth, created_at, expires_at
       ) values ($1, $2, $3::uuid[], $4, $5, $6, $7)`,
      input.type === 'full'
        ? [tokenHash(rawToken), 'full', [], null, null, createdAt, expiresAt]
        : [
            tokenHash(rawToken),
            'filtered',
            input.startEventIds,
            input.direction,
            input.depth,
            createdAt,
            expiresAt,
          ],
    );
    return rawToken;
  }

  public async read(client: PoolClient, rawToken: string): Promise<StoredExportRequest> {
    if (!isExportTokenFormat(rawToken)) {
      throw new ExportRequestError('EXPORT_TOKEN_INVALID', '导出令牌无效');
    }
    const result = await client.query<ExportRequestRow>(
      `select id, export_type, start_event_ids, direction, depth, created_at, expires_at
       from export_requests
       where token_hash = $1`,
      [tokenHash(rawToken)],
    );
    const row = result.rows[0];
    if (!row) throw new ExportRequestError('EXPORT_TOKEN_INVALID', '导出令牌无效');
    if (row.expires_at.getTime() <= this.now().getTime()) {
      throw new ExportRequestError('EXPORT_TOKEN_EXPIRED', '导出令牌已过期');
    }
    return toStoredRequest(row);
  }

  public async deleteExpired(client: PoolClient, now: Date): Promise<number> {
    const result = await client.query('delete from export_requests where expires_at <= $1', [now]);
    return result.rowCount ?? 0;
  }
}
