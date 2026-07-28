import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { Pool } from 'pg';

export interface McpSettingsRecord {
  accessToken: string;
  tokenVersion: number;
  updatedAt: string;
}

export interface McpSettingsRepository {
  get(): Promise<McpSettingsRecord>;
  authorize(token: string): Promise<boolean>;
  authorizeVersion(token: string): Promise<number | null>;
  rotate(): Promise<McpSettingsRecord>;
}

interface SettingsRow {
  access_token: string;
  token_version: number;
  updated_at: Date;
}

function record(row: SettingsRow): McpSettingsRecord {
  return {
    accessToken: row.access_token,
    tokenVersion: row.token_version,
    updatedAt: row.updated_at.toISOString(),
  };
}

function tokenMatches(stored: string, candidate: string): boolean {
  const storedBuffer = Buffer.from(stored, 'utf8');
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  return (
    storedBuffer.length === candidateBuffer.length && timingSafeEqual(storedBuffer, candidateBuffer)
  );
}

export class PostgresMcpSettingsRepository implements McpSettingsRepository {
  public constructor(private readonly pool: Pool) {}

  public async get(): Promise<McpSettingsRecord> {
    const result = await this.pool.query<SettingsRow>(
      `select access_token, token_version, updated_at
       from mcp_settings
       where singleton_key = true`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('MCP settings singleton is missing');
    return record(row);
  }

  public async authorize(token: string): Promise<boolean> {
    return (await this.authorizeVersion(token)) !== null;
  }

  public async authorizeVersion(token: string): Promise<number | null> {
    const current = await this.get();
    return tokenMatches(current.accessToken, token) ? current.tokenVersion : null;
  }

  public async rotate(): Promise<McpSettingsRecord> {
    const nextToken = randomBytes(32).toString('hex');
    const result = await this.pool.query<SettingsRow>(
      `update mcp_settings
       set access_token = $1,
           token_version = token_version + 1,
           updated_at = clock_timestamp()
       where singleton_key = true
       returning access_token, token_version, updated_at`,
      [nextToken],
    );
    const row = result.rows[0];
    if (!row) throw new Error('MCP settings singleton is missing');
    return record(row);
  }
}
