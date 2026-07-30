import type {
  AiCaptureComparison,
  AiImportCommitResult,
  AiImportPlan,
  AiImportPlanStatus,
  CaseDetail,
  CaseListResponse,
  CaseRelationListResponse,
  CausalEvidenceBundleResponse,
  CausalGraphResponse,
  CausalPathResponse,
  EventDetail,
  EventListResponse,
  EventRelationListResponse,
  RelationCaseListResponse,
  RelationDetail,
  RelationListResponse,
  SearchMode,
} from '@causality/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MCP_PROMPT_NAMES } from '../src/capabilities/capabilityManifest.js';
import { createCausalityMcpServer } from '../src/server/createMcpServer.js';
import type { CausalityMcpApi } from '../src/server/createMcpServer.js';

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

const concreteCase: CaseDetail = {
  ...cases.items[0]!,
  listPage: 1,
  createdAt: timestamp,
};

const caseRelations: CaseRelationListResponse = {
  items: eventRelations.items,
  nextCursor: 'next-case-relation-page',
  hasMore: true,
};

const relationList: RelationListResponse = {
  items: [
    {
      id: relationId,
      causeEvent: { id: eventId, name: event.name },
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

class FakeKnowledgeApi implements CausalityMcpApi {
  public eventSearchInput: { query: string; page: number; searchMode: SearchMode } | null = null;
  public eventRelationInput: { id: string; limit: number; cursor?: string } | null = null;
  public caseSearchInput: { query: string; page: number } | null = null;
  public relationCaseInput: { id: string; limit: number; cursor?: string } | null = null;

  public async searchEvents(
    query: string,
    page = 1,
    searchMode: SearchMode = 'standard',
  ): Promise<EventListResponse> {
    this.eventSearchInput = { query, page, searchMode };
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

  public async searchCases(query: string, page = 1): Promise<CaseListResponse> {
    this.caseSearchInput = { query, page };
    return cases;
  }

  public async getCase(): Promise<CaseDetail> {
    return concreteCase;
  }

  public async getCaseRelations(): Promise<CaseRelationListResponse> {
    return caseRelations;
  }

  public async searchRelations(): Promise<RelationListResponse> {
    return relationList;
  }

  public async getRelation(): Promise<RelationDetail> {
    return relation;
  }

  public async getRelationCases(
    id: string,
    input: { limit: number; cursor?: string } = { limit: 20 },
  ): Promise<RelationCaseListResponse> {
    this.relationCaseInput = { id, ...input };
    return relationCases;
  }

  public async queryGraph(): Promise<CausalGraphResponse> {
    return graph;
  }

  public async findCausalPaths(): Promise<CausalPathResponse> {
    throw new Error('not used');
  }

  public async getCausalEvidenceBundle(): Promise<CausalEvidenceBundleResponse> {
    throw new Error('not used');
  }

  public async getHealth(): Promise<never> {
    throw new Error('not used');
  }

  public async getReadiness(): Promise<never> {
    throw new Error('not used');
  }

  public async getSemanticLifecycle(): Promise<never> {
    throw new Error('not used');
  }

  public async compare(): Promise<AiCaptureComparison> {
    throw new Error('not used');
  }

  public async prepare(): Promise<AiImportPlan> {
    throw new Error('not used');
  }

  public async planStatus(): Promise<AiImportPlanStatus> {
    throw new Error('not used');
  }

  public async commit(): Promise<AiImportCommitResult> {
    throw new Error('not used');
  }

  public async result(): Promise<AiImportCommitResult> {
    throw new Error('not used');
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

  it('lists every strictly validated read-only tool', async () => {
    const listed = await mcpClient.listTools();
    const readTools = listed.tools.filter((tool) => tool.annotations?.readOnlyHint);

    expect(readTools.map((tool) => tool.name)).toEqual([
      'search_atomic_events',
      'get_atomic_event',
      'search_concrete_cases',
      'get_causal_relation',
      'get_relation_cases',
      'query_local_causal_graph',
      'get_concrete_case',
      'search_causal_relations',
      'find_causal_paths',
      'get_causal_evidence_bundle',
      'compare_knowledge_candidates',
      'get_import_plan_status',
      'get_import_result',
    ]);
    for (const tool of readTools) {
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

  it('exposes read, capture, and canonical prompt capabilities from one server factory', async () => {
    const [tools, prompts] = await Promise.all([mcpClient.listTools(), mcpClient.listPrompts()]);

    expect(tools.tools).toHaveLength(15);
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(Object.values(MCP_PROMPT_NAMES));
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

  it('forwards explicit search pages and relation-case continuation inputs', async () => {
    await mcpClient.callTool({
      name: 'search_atomic_events',
      arguments: { query: '供应链', page: 3, searchMode: 'enhanced' },
    });
    await mcpClient.callTool({
      name: 'search_concrete_cases',
      arguments: { query: '港口停运', page: 4 },
    });
    await mcpClient.callTool({
      name: 'get_relation_cases',
      arguments: { relationId, caseLimit: 50, caseCursor: 'case-cursor' },
    });

    expect(api.eventSearchInput).toEqual({
      query: '供应链',
      page: 3,
      searchMode: 'enhanced',
    });
    expect(api.caseSearchInput).toEqual({ query: '港口停运', page: 4 });
    expect(api.relationCaseInput).toEqual({
      id: relationId,
      limit: 50,
      cursor: 'case-cursor',
    });
  });

  it('keeps legacy knowledge-tool calls compatible through pagination defaults', async () => {
    await mcpClient.callTool({
      name: 'search_atomic_events',
      arguments: { query: '供应链' },
    });
    await mcpClient.callTool({
      name: 'search_concrete_cases',
      arguments: { query: '港口停运' },
    });
    await mcpClient.callTool({
      name: 'get_relation_cases',
      arguments: { relationId },
    });

    expect(api.eventSearchInput).toEqual({
      query: '供应链',
      page: 1,
      searchMode: 'standard',
    });
    expect(api.caseSearchInput).toEqual({ query: '港口停运', page: 1 });
    expect(api.relationCaseInput).toEqual({ id: relationId, limit: 20 });
  });

  it('rejects unknown fields and unsupported graph limits before calling the API', async () => {
    const extraField = await mcpClient.callTool({
      name: 'search_atomic_events',
      arguments: { query: '供应链', unexpected: true },
    });
    const invalidSearchMode = await mcpClient.callTool({
      name: 'search_atomic_events',
      arguments: { query: '供应链', searchMode: 'semantic' },
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
    const invalidPage = await mcpClient.callTool({
      name: 'search_concrete_cases',
      arguments: { query: '港口停运', page: 0 },
    });
    const invalidCaseLimit = await mcpClient.callTool({
      name: 'get_relation_cases',
      arguments: { relationId, caseLimit: 101 },
    });

    expect(extraField.isError).toBe(true);
    expect(invalidSearchMode.isError).toBe(true);
    expect(unsupportedLimit.isError).toBe(true);
    expect(invalidPage.isError).toBe(true);
    expect(invalidCaseLimit.isError).toBe(true);
  });
});
