import type {
  CaseListResponse,
  CausalGraphResponse,
  EventDetail,
  EventListResponse,
  EventRelationListResponse,
  RelationCaseListResponse,
  RelationDetail,
} from '@causality/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCausalityMcpServer } from '../src/server/createMcpServer.js';
import type { CausalityKnowledgeApi } from '../src/tools/registerKnowledgeTools.js';

const eventId = '10000000-0000-4000-8000-000000000001';
const effectEventId = '10000000-0000-4000-8000-000000000002';
const relationId = '20000000-0000-4000-8000-000000000001';
const caseId = '30000000-0000-4000-8000-000000000001';
const timestamp = '2026-07-28T12:00:00.000Z';

const events: EventListResponse = {
  items: [
    {
      id: eventId,
      name: '供应链中断',
      aliases: ['物流受阻'],
      keywords: ['供应链'],
      relationCount: 1,
      updatedAt: timestamp,
    },
  ],
  page: 1,
  pageSize: 50,
  totalItems: 1,
  totalPages: 1,
  semanticIndexNotice: null,
};

const event: EventDetail = {
  ...events.items[0]!,
  description: '关键物流节点无法正常运转',
  listPage: 1,
  createdAt: timestamp,
};

const eventRelations: EventRelationListResponse = {
  items: [
    {
      id: relationId,
      causeEvent: { id: eventId, name: event.name },
      effectEvent: { id: effectEventId, name: '交付周期延长' },
      linkedAt: timestamp,
    },
  ],
  nextCursor: 'next-relation-page',
  hasMore: true,
};

const cases: CaseListResponse = {
  items: [
    {
      id: caseId,
      content: '港口停运后工厂原料延迟到货',
      relationCount: 1,
      updatedAt: timestamp,
    },
  ],
  page: 1,
  pageSize: 50,
  totalItems: 1,
  totalPages: 1,
  semanticIndexNotice: null,
};

const relation: RelationDetail = {
  id: relationId,
  causeEvent: { id: eventId, name: event.name },
  effectEvent: { id: effectEventId, name: '交付周期延长' },
  confidence: 20,
  caseCount: 1,
  description: '物流受阻会延长交付周期',
  listPage: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  recentCases: [{ id: caseId, content: cases.items[0]!.content }],
};

const relationCases: RelationCaseListResponse = {
  items: [{ ...cases.items[0]!, linkedAt: timestamp }],
  nextCursor: null,
  hasMore: false,
};

const graph: CausalGraphResponse = {
  nodes: [
    { id: eventId, name: event.name },
    { id: effectEventId, name: '交付周期延长' },
  ],
  relations: [
    {
      id: relationId,
      causeEventId: eventId,
      effectEventId,
      confidence: 20,
      caseCount: 1,
    },
  ],
  meta: {
    centerEventId: eventId,
    direction: 'both',
    nodeLimit: 20,
    relationLimit: 200,
    minConfidence: 0,
    minCaseCount: 0,
    nodeCount: 2,
    relationCount: 1,
    stopReason: 'exhausted',
  },
};

class FakeKnowledgeApi implements CausalityKnowledgeApi {
  public eventRelationInput: { id: string; limit: number; cursor?: string } | null = null;

  public async searchEvents(): Promise<EventListResponse> {
    return events;
  }

  public async getEvent(): Promise<EventDetail> {
    return event;
  }

  public async getEventRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<EventRelationListResponse> {
    this.eventRelationInput = { id, ...input };
    return eventRelations;
  }

  public async searchCases(): Promise<CaseListResponse> {
    return cases;
  }

  public async getRelation(): Promise<RelationDetail> {
    return relation;
  }

  public async getRelationCases(): Promise<RelationCaseListResponse> {
    return relationCases;
  }

  public async queryGraph(): Promise<CausalGraphResponse> {
    return graph;
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

describe('read-only knowledge tools', () => {
  let api: FakeKnowledgeApi;
  let mcpClient: Client;
  let mcpServer: ReturnType<typeof createCausalityMcpServer>;

  beforeEach(async () => {
    api = new FakeKnowledgeApi();
    mcpServer = createCausalityMcpServer({ apiClient: api });
    mcpClient = new Client({ name: 'knowledge-tools-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
  });

  afterEach(async () => {
    await mcpClient.close();
    await mcpServer.close();
  });

  it('lists exactly six strictly validated read-only tools', async () => {
    const listed = await mcpClient.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'search_atomic_events',
      'get_atomic_event',
      'search_concrete_cases',
      'get_causal_relation',
      'get_relation_cases',
      'query_local_causal_graph',
    ]);
    for (const tool of listed.tools) {
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

  it('returns readable text and structured database facts for every tool', async () => {
    const results = await Promise.all([
      mcpClient.callTool({
        name: 'search_atomic_events',
        arguments: { query: '供应链' },
      }),
      mcpClient.callTool({
        name: 'get_atomic_event',
        arguments: { eventId },
      }),
      mcpClient.callTool({
        name: 'search_concrete_cases',
        arguments: { query: '港口停运' },
      }),
      mcpClient.callTool({
        name: 'get_causal_relation',
        arguments: { relationId },
      }),
      mcpClient.callTool({
        name: 'get_relation_cases',
        arguments: { relationId },
      }),
      mcpClient.callTool({
        name: 'query_local_causal_graph',
        arguments: {
          centerEventId: eventId,
          direction: 'both',
          limit: 20,
          minConfidence: 0,
          minCaseCount: 0,
        },
      }),
    ]);

    for (const result of results) {
      expect(result.isError).not.toBe(true);
      expect(textContent(result).length).toBeGreaterThan(10);
      expect(result.structuredContent).toBeTypeOf('object');
    }
    expect(results[0]?.structuredContent).toEqual(events);
    expect(results[1]?.structuredContent).toEqual({
      event,
      relations: eventRelations,
    });
    expect(results[2]?.structuredContent).toEqual(cases);
    expect(results[3]?.structuredContent).toEqual(relation);
    expect(results[4]?.structuredContent).toEqual(relationCases);
    expect(results[5]?.structuredContent).toEqual(graph);
  });

  it('bounds event relations and exposes continuation state instead of silently truncating', async () => {
    const result = await mcpClient.callTool({
      name: 'get_atomic_event',
      arguments: { eventId, relationLimit: 20, relationCursor: 'current-page' },
    });

    expect(api.eventRelationInput).toEqual({
      id: eventId,
      limit: 20,
      cursor: 'current-page',
    });
    expect(result.structuredContent).toMatchObject({
      relations: {
        hasMore: true,
        nextCursor: 'next-relation-page',
      },
    });
    expect(textContent(result)).toContain('还有更多关联关系');
  });

  it('rejects unknown fields and unsupported graph limits before calling the API', async () => {
    const extraField = await mcpClient.callTool({
      name: 'search_atomic_events',
      arguments: { query: '供应链', unexpected: true },
    });
    const unsupportedLimit = await mcpClient.callTool({
      name: 'query_local_causal_graph',
      arguments: {
        centerEventId: eventId,
        direction: 'both',
        limit: 21,
        minConfidence: 0,
        minCaseCount: 0,
      },
    });

    expect(extraField.isError).toBe(true);
    expect(unsupportedLimit.isError).toBe(true);
  });
});
