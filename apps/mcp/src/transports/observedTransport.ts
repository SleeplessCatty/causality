import { randomUUID } from 'node:crypto';

import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

import {
  describeMcpMessage,
  observeMcpRequest,
  type McpLogger,
} from '../observability/mcpRequestLogging.js';

interface ClientInfo {
  name?: string;
  version?: string;
}

function initializeClientInfo(message: JSONRPCMessage): ClientInfo | undefined {
  if (!('method' in message) || message.method !== 'initialize') return undefined;
  const params =
    typeof message.params === 'object' && message.params !== null ? message.params : {};
  const rawClientInfo =
    'clientInfo' in params && typeof params.clientInfo === 'object' && params.clientInfo !== null
      ? params.clientInfo
      : {};
  const clientInfo = rawClientInfo as Record<string, unknown>;
  return {
    ...(typeof clientInfo.name === 'string' ? { name: clientInfo.name } : {}),
    ...(typeof clientInfo.version === 'string' ? { version: clientInfo.version } : {}),
  };
}

export class ObservedTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  public sessionId?: string;

  private clientInfo: ClientInfo = {};

  public constructor(
    private readonly transport: Transport,
    private readonly logger: McpLogger,
  ) {}

  public async start(): Promise<void> {
    this.transport.onclose = () => this.onclose?.();
    this.transport.onerror = (error) => this.onerror?.(error);
    this.transport.onmessage = (message, extra) => {
      const initialized = initializeClientInfo(message);
      if (initialized) this.clientInfo = initialized;
      const operation = describeMcpMessage(message);
      void observeMcpRequest(
        {
          requestId: randomUUID(),
          transport: 'stdio',
          ...operation,
          ...(this.clientInfo.name === undefined ? {} : { clientName: this.clientInfo.name }),
          ...(this.clientInfo.version === undefined
            ? {}
            : { clientVersion: this.clientInfo.version }),
        },
        () => this.onmessage?.(message, extra),
        this.logger,
      ).catch((error: unknown) => {
        this.onerror?.(error instanceof Error ? error : new Error('Observed transport failed'));
      });
    };
    await this.transport.start();
    if (this.transport.sessionId !== undefined) this.sessionId = this.transport.sessionId;
  }

  public send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.transport.send(message, options);
  }

  public close(): Promise<void> {
    return this.transport.close();
  }

  public setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version);
  }
}
