import type {
  McpAuthorizationResponse,
  McpSettingsResponse,
  McpTokenRotationResponse,
} from '@causality/contracts';

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

function maskToken(token: string): string {
  return `${token.slice(0, 4)}${'•'.repeat(8)}${token.slice(-4)}`;
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

  public async rotate(): Promise<McpTokenRotationResponse> {
    const settings = await this.repository.rotate();
    const running = await this.isRunning();
    return { settings: this.response(settings, running) };
  }

  public async authorize(token: string): Promise<McpAuthorizationResponse | null> {
    const tokenVersion = await this.repository.authorizeVersion(token);
    return tokenVersion === null ? null : { authorized: true, tokenVersion };
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
      maskedToken: maskToken(settings.accessToken),
      accessToken: settings.accessToken,
      tokenVersion: settings.tokenVersion,
      updatedAt: settings.updatedAt,
      clientConfig: {
        transport: 'streamable-http',
        url: this.options.endpoint,
        headers: { Authorization: `Bearer ${settings.accessToken}` },
      },
    };
  }
}
