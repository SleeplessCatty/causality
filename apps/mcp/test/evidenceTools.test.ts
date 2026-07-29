import type {
  CaseDetail,
  CaseRelationListResponse,
  RelationListResponse,
} from '@causality/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type CausalityEvidenceApi,
  registerEvidenceTools,
} from '../src/tools/registerEvidenceTools.js';

const eventId = '10000000-0000-4000-8000-000000000001';
const effectEventId = '10000000-0000-4000-8000-000000000002';
const relationId = '20000000-0000-4000-8000-000000000001';
const caseId = '30000000-0000-4000-8000-000000000001';
const timestamp = '2026-07-30T02:30:00.000Z';

const concreteCase: CaseDetail = {
  id: caseId,
  content: '港口停运后工厂原料延迟到货',
  relationCount: 1,
  listPage: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const caseRelations: CaseRelationListResponse = {
  items: [
    {
      id: relationId,
      causeEvent: { id: eventId, name: '供应链中断' },
      effectEvent: { id: effectEventId, name: '交付周期延长' },
      linkedAt: timestamp,
    },
  ],
  nextCursor: 'next-case-relations',
  hasMore: true,
};

const relationSearch: RelationListResponse = {
  items: [
    {
      id: relationId,
      causeEvent: { id: eventId, name: '供应链中断' },
      effectEvent: { id: effectEventId, name: '交付周期延长' },
      confidence: 20,
      caseCount: 1,
      updatedAt: timestamp,
    },
  ],
  page: 1,
  pageSize: 50,
  totalItems: 1,
  totalPages: 1,
  semanticIndexNotice: null,
};

class FakeEvidenceApi implements CausalityEvidenceApi {
  public caseRelationInput: { id: string; limit: number; cursor?: string } | null = null;
  public relationSearchInput: {
    query: string;
    searchMode: 'standard' | 'enhanced';
    page: number;
  } | null = null;

  public async getCase(): Promise<CaseDetail> {
    return concreteCase;
  }

  public async getCaseRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<CaseRelationListResponse> {
    this.caseRelationInput = { id, ...input };
    return caseRelations;
  }

  public async searchRelations(
    query: string,
    searchMode: 'standard' | 'enhanced',
    page = 1,
  ): Promise<RelationListResponse> {
    this.relationSearchInput = { query, searchMode, page };
    return relationSearch;
  }
}

function textContent(result: unknown): string {
  const parsed = CallToolResultSchema.parse(result);
  return parsed.content
    .filter((item): item is Extract<(typeof parsed.content)[number], { type: 'text' }> => {
      return item.type === 'text';
    })
    .map((item) => item.text)
    .join('\n');
}

describe('read-only evidence tools', () => {
  let api: FakeEvidenceApi;
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    api = new FakeEvidenceApi();
    server = new McpServer({ name: 'evidence-tools-test', version: '1.0.0' });
    registerEvidenceTools(server, api);
    client = new Client({ name: 'evidence-tools-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('registers the first two strict read-only evidence tools', async () => {
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'get_concrete_case',
      'search_causal_relations',
    ]);
    for (const tool of tools.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
    }
  });

  it('returns a case with bounded relation continuation', async () => {
    const result = await client.callTool({
      name: 'get_concrete_case',
      arguments: {
        caseId,
        relationLimit: 20,
        relationCursor: 'current-case-relations',
      },
    });

    expect(api.caseRelationInput).toEqual({
      id: caseId,
      limit: 20,
      cursor: 'current-case-relations',
    });
    expect(result.structuredContent).toEqual({
      concreteCase,
      relations: caseRelations,
    });
    expect(textContent(result)).toContain('数据库关联关系总数：1');
    expect(textContent(result)).toContain('下一页游标：next-case-relations');
  });

  it('forwards explicit enhanced relation search without fallback', async () => {
    const result = await client.callTool({
      name: 'search_causal_relations',
      arguments: {
        query: '供应链',
        searchMode: 'enhanced',
        page: 3,
      },
    });

    expect(api.relationSearchInput).toEqual({
      query: '供应链',
      searchMode: 'enhanced',
      page: 3,
    });
    expect(result.structuredContent).toEqual(relationSearch);
    expect(textContent(result)).toContain('供应链中断 → 交付周期延长');
    expect(textContent(result)).toContain('置信度: 20%');
    expect(textContent(result)).toContain('第 1/1 页');
  });

  it('uses standard search and pagination defaults', async () => {
    await client.callTool({
      name: 'search_causal_relations',
      arguments: { query: '供应链' },
    });

    expect(api.relationSearchInput).toEqual({
      query: '供应链',
      searchMode: 'standard',
      page: 1,
    });
  });

  it('rejects invalid limits and unknown fields before API calls', async () => {
    const invalidLimit = await client.callTool({
      name: 'get_concrete_case',
      arguments: { caseId, relationLimit: 101 },
    });
    const unknownField = await client.callTool({
      name: 'search_causal_relations',
      arguments: { query: '供应链', unexpected: true },
    });

    expect(invalidLimit.isError).toBe(true);
    expect(unknownField.isError).toBe(true);
    expect(api.caseRelationInput).toBeNull();
    expect(api.relationSearchInput).toBeNull();
  });
});
