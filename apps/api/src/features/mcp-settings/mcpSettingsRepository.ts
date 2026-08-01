import type { Pool } from 'pg';

export interface McpSettingsRecord {
  updatedAt: string;
}

export interface McpSettingsRepository {
  get(): Promise<McpSettingsRecord>;
}

interface SettingsRow {
  updated_at: Date;
}

function record(row: SettingsRow): McpSettingsRecord {
  return {
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresMcpSettingsRepository implements McpSettingsRepository {
  public constructor(private readonly pool: Pool) {}

  public async get(): Promise<McpSettingsRecord> {
    const result = await this.pool.query<SettingsRow>(
      `select updated_at
       from mcp_settings
       where singleton_key = true`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('MCP settings singleton is missing');
    return record(row);
  }
}
