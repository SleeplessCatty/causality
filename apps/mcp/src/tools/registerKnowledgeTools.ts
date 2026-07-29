import {
  caseListResponseSchema,
  causalGraphResponseSchema,
  eventDetailSchema,
  eventListResponseSchema,
  eventRelationListResponseSchema,
  relationCaseListResponseSchema,
  relationDetailSchema,
  type CaseListResponse,
  type CausalGraphQuery,
  type CausalGraphResponse,
  type EventDetail,
  type EventListResponse,
  type EventRelationListResponse,
  type RelationCaseListResponse,
  type RelationDetail,
} from '@causality/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface CausalityKnowledgeApi {
  searchEvents(query: string, page?: number): Promise<EventListResponse>;
  getEvent(id: string): Promise<EventDetail>;
  getEventRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<EventRelationListResponse>;
  searchCases(query: string, page?: number): Promise<CaseListResponse>;
  getRelation(id: string): Promise<RelationDetail>;
  getRelationCases(
    id: string,
    input?: { limit: number; cursor?: string },
  ): Promise<RelationCaseListResponse>;
  queryGraph(input: CausalGraphQuery): Promise<CausalGraphResponse>;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const searchEventsInputSchema = z
  .object({
    query: z.string().trim().min(1).max(80).describe('原子事件名称、别名或关键词'),
    page: z.number().int().min(1).max(100_000).default(1).describe('结果页码'),
  })
  .strict();

const getEventInputSchema = z
  .object({
    eventId: z.uuid().describe('原子事件 ID'),
    relationLimit: z.number().int().min(1).max(100).default(20).describe('本次关联关系数量'),
    relationCursor: z.string().min(1).max(2_000).optional().describe('关联关系续页游标'),
  })
  .strict();

const searchCasesInputSchema = z
  .object({
    query: z.string().trim().min(1).max(100).describe('具体案例内容关键词'),
    page: z.number().int().min(1).max(100_000).default(1).describe('结果页码'),
  })
  .strict();

const relationInputSchema = z
  .object({
    relationId: z.uuid().describe('因果关系 ID'),
  })
  .strict();

const relationCasesInputSchema = z
  .object({
    relationId: z.uuid().describe('因果关系 ID'),
    caseLimit: z.number().int().min(1).max(100).default(20).describe('本次具体案例数量'),
    caseCursor: z.string().min(1).max(2_000).optional().describe('具体案例续页游标'),
  })
  .strict();

const graphInputSchema = z
  .object({
    centerEventId: z.uuid().describe('中心原子事件 ID'),
    direction: z.enum(['upstream', 'downstream', 'both']).describe('查询方向'),
    limit: z.union([z.literal(20), z.literal(50), z.literal(100)]).describe('节点上限'),
    minConfidence: z.number().min(0).max(100).describe('最低置信度百分比'),
    minCaseCount: z.number().int().min(0).max(10).describe('最少具体案例数'),
  })
  .strict();

const eventWithRelationsSchema = z
  .object({
    event: eventDetailSchema,
    relations: eventRelationListResponseSchema,
  })
  .strict();

function textResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent,
  };
}

function eventSearchText(result: EventListResponse): string {
  const lines = result.items.map(
    (event) =>
      `- ${event.name}（ID: ${event.id}；别名: ${event.aliases.join('、') || '无'}；关键词: ${
        event.keywords.join('、') || '无'
      }；关联关系数: ${event.relationCount}）`,
  );
  return [
    `数据库中找到 ${result.totalItems} 条匹配的原子事件，当前返回第 ${result.page}/${result.totalPages} 页。`,
    ...lines,
  ].join('\n');
}

function eventDetailText(event: EventDetail, relations: EventRelationListResponse): string {
  const relationLines = relations.items.map(
    (relation) =>
      `- ${relation.causeEvent.name} → ${relation.effectEvent.name}（关系 ID: ${relation.id}）`,
  );
  return [
    `原子事件：${event.name}（ID: ${event.id}）`,
    `说明：${event.description ?? '无'}`,
    `别名：${event.aliases.join('、') || '无'}`,
    `关键词：${event.keywords.join('、') || '无'}`,
    `数据库关联关系总数：${event.relationCount}`,
    `本页关联关系：${relations.items.length} 条`,
    ...relationLines,
    relations.hasMore
      ? `还有更多关联关系；下一页游标：${relations.nextCursor ?? '未返回'}`
      : '关联关系已经返回完毕。',
  ].join('\n');
}

function caseSearchText(result: CaseListResponse): string {
  const lines = result.items.map(
    (item) => `- ${item.content}（ID: ${item.id}；关联关系数: ${item.relationCount}）`,
  );
  return [
    `数据库中找到 ${result.totalItems} 条匹配的具体案例，当前返回第 ${result.page}/${result.totalPages} 页。`,
    ...lines,
  ].join('\n');
}

function relationText(relation: RelationDetail): string {
  return [
    `因果关系：${relation.causeEvent.name} → ${relation.effectEvent.name}`,
    `关系 ID：${relation.id}`,
    `置信度：${relation.confidence}%`,
    `关联具体案例数：${relation.caseCount}`,
    `关系说明：${relation.description ?? '无'}`,
  ].join('\n');
}

function relationCasesText(result: RelationCaseListResponse): string {
  const lines = result.items.map(
    (item) => `- ${item.content}（案例 ID: ${item.id}；关联时间: ${item.linkedAt}）`,
  );
  return [
    `本页返回 ${result.items.length} 条关联具体案例。`,
    ...lines,
    result.hasMore
      ? `还有更多具体案例；下一页游标：${result.nextCursor ?? '未返回'}`
      : '关联具体案例已经返回完毕。',
  ].join('\n');
}

function graphText(result: CausalGraphResponse): string {
  const names = new Map(result.nodes.map((node) => [node.id, node.name]));
  const relationLines = result.relations.map(
    (relation) =>
      `- ${names.get(relation.causeEventId) ?? relation.causeEventId} → ${
        names.get(relation.effectEventId) ?? relation.effectEventId
      }（关系 ID: ${relation.id}；置信度: ${relation.confidence}%；案例数: ${relation.caseCount}）`,
  );
  return [
    `局部因果图包含 ${result.meta.nodeCount} 个原子事件和 ${result.meta.relationCount} 条因果关系。`,
    `查询方向：${result.meta.direction}；停止原因：${result.meta.stopReason}。`,
    ...relationLines,
  ].join('\n');
}

export function registerKnowledgeTools(server: McpServer, apiClient: CausalityKnowledgeApi): void {
  server.registerTool(
    'search_atomic_events',
    {
      title: '搜索原子事件',
      description: '按名称、别名或关键词搜索 Causality 数据库中的原子事件。',
      inputSchema: searchEventsInputSchema,
      outputSchema: eventListResponseSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ query, page }) => {
      const result = await apiClient.searchEvents(query, page);
      return textResult(eventSearchText(result), { ...result });
    },
  );

  server.registerTool(
    'get_atomic_event',
    {
      title: '查看原子事件',
      description: '读取一个原子事件及一页明确限量的关联因果关系。',
      inputSchema: getEventInputSchema,
      outputSchema: eventWithRelationsSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ eventId, relationLimit, relationCursor }) => {
      const relationInput = {
        limit: relationLimit,
        ...(relationCursor === undefined ? {} : { cursor: relationCursor }),
      };
      const [event, relations] = await Promise.all([
        apiClient.getEvent(eventId),
        apiClient.getEventRelations(eventId, relationInput),
      ]);
      return textResult(eventDetailText(event, relations), { event, relations });
    },
  );

  server.registerTool(
    'search_concrete_cases',
    {
      title: '搜索具体案例',
      description: '按内容关键词搜索 Causality 数据库中的真实具体案例记录。',
      inputSchema: searchCasesInputSchema,
      outputSchema: caseListResponseSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ query, page }) => {
      const result = await apiClient.searchCases(query, page);
      return textResult(caseSearchText(result), { ...result });
    },
  );

  server.registerTool(
    'get_causal_relation',
    {
      title: '查看因果关系',
      description: '读取一条因果关系的方向、置信度、案例数和关系说明。',
      inputSchema: relationInputSchema,
      outputSchema: relationDetailSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ relationId }) => {
      const result = await apiClient.getRelation(relationId);
      return textResult(relationText(result), { ...result });
    },
  );

  server.registerTool(
    'get_relation_cases',
    {
      title: '查看关系案例',
      description: '读取一条因果关系当前返回页中的关联具体案例。',
      inputSchema: relationCasesInputSchema,
      outputSchema: relationCaseListResponseSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ relationId, caseLimit, caseCursor }) => {
      const caseInput = {
        limit: caseLimit,
        ...(caseCursor === undefined ? {} : { cursor: caseCursor }),
      };
      const result = await apiClient.getRelationCases(relationId, caseInput);
      return textResult(relationCasesText(result), { ...result });
    },
  );

  server.registerTool(
    'query_local_causal_graph',
    {
      title: '查询局部因果图',
      description: '从一个已有原子事件出发，按方向和阈值查询受限的局部因果网络。',
      inputSchema: graphInputSchema,
      outputSchema: causalGraphResponseSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      const result = await apiClient.queryGraph(input);
      return textResult(graphText(result), { ...result });
    },
  );
}
