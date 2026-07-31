import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createCausalityMcpServer,
  type CausalityMcpApi,
} from '../../src/server/createMcpServer.js';

export interface ConnectedTestMcpClient {
  client: Client;
  server: McpServer;
  close(): Promise<void>;
}

export async function connectTestMcpClient(api: CausalityMcpApi): Promise<ConnectedTestMcpClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCausalityMcpServer({ apiClient: api });
  const client = new Client({ name: 'causality-mcp-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    async close() {
      await client.close();
      await server.close();
    },
  };
}
