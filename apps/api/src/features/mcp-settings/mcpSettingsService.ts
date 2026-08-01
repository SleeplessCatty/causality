import type { McpSettingsResponse } from '@causality/contracts';

import type { McpSettingsRecord, McpSettingsRepository } from './mcpSettingsRepository.js';

export type McpHealthProbe = (url: string, timeoutMs: number) => Promise<boolean>;

export interface McpSettingsServiceOptions {
  endpoint: string;
  healthUrl: string;
  healthTimeoutMs?: number;
  probe?: McpHealthProbe;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 1_000;

async function defaultProbe(url: string, timeoutMs: number): Promise<boolean> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return response.ok;
}

export class McpSettingsService {
  private readonly healthTimeoutMs: number;
  private readonly probe: McpHealthProbe;

  public constructor(
    private readonly repository: McpSettingsRepository,
    private readonly options: McpSettingsServiceOptions,
  ) {
    this.healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.probe = options.probe ?? defaultProbe;
  }

  public async get(): Promise<McpSettingsResponse> {
    const [settings, running] = await Promise.all([this.repository.get(), this.isRunning()]);
    return this.response(settings, running);
  }

  private async isRunning(): Promise<boolean> {
    try {
      return await this.probe(this.options.healthUrl, this.healthTimeoutMs);
    } catch {
      return false;
    }
  }

  private response(settings: McpSettingsRecord, running: boolean): McpSettingsResponse {
    return {
      serviceStatus: running ? 'running' : 'stopped',
      endpoint: this.options.endpoint,
      updatedAt: settings.updatedAt,
      clientConfig: {
        transport: 'streamable-http',
        url: this.options.endpoint,
      },
    };
  }
}
