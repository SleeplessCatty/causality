import {
  caseDetailSchema,
  caseRelationListResponseSchema,
  relationListResponseSchema,
  type CaseDetail,
  type CaseRelationListResponse,
  type RelationListResponse,
  type SearchMode,
} from '@causality/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface CausalityEvidenceApi {
  getCase(id: string): Promise<CaseDetail>;
  getCaseRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<CaseRelationListResponse>;
  searchRelations(
    query: string,
    searchMode: SearchMode,
    page?: number,
  ): Promise<RelationListResponse>;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const getCaseInputSchema = z
  .object({
    caseId: z.uuid().describe('具体案例 ID'),
    relationLimit: z.number().int().min(1).max(100).default(20).describe('本次关联关系数量'),
    relationCursor: z.string().min(1).max(2_000).optional().describe('关联关系续页游标'),
  })
  .strict();

const searchRelationsInputSchema = z
  .object({
    query: z.string().trim().min(1).max(120).describe('原因事件、结果事件或关系说明关键词'),
    searchMode: z.enum(['standard', 'enhanced']).default('standard').describe('普通或语义增强搜索'),
    page: z.number().int().min(1).max(100_000).default(1).describe('结果页码'),
  })
  .strict();

const caseWithRelationsSchema = z
  .object({
    concreteCase: caseDetailSchema,
    relations: caseRelationListResponseSchema,
  })
  .strict();

function textResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent,
  };
}

function caseDetailText(concreteCase: CaseDetail, relations: CaseRelationListResponse): string {
  const relationLines = relations.items.map(
    (relation) =>
      '- ' +
      relation.causeEvent.name +
      ' → ' +
      relation.effectEvent.name +
      '（关系 ID: ' +
      relation.id +
      '；关联时间: ' +
      relation.linkedAt +
      '）',
  );
  return [
    '具体案例：' + concreteCase.content + '（ID: ' + concreteCase.id + '）',
    '数据库关联关系总数：' + concreteCase.relationCount,
    '本次返回关联关系：' + relations.items.length + ' 条',
    ...relationLines,
    relations.hasMore
      ? '还有更多关联关系；下一页游标：' + (relations.nextCursor ?? '未返回')
      : '关联关系已经返回完毕。',
  ].join('\n');
}

function relationSearchText(result: RelationListResponse): string {
  const lines = result.items.map(
    (relation) =>
      '- ' +
      relation.causeEvent.name +
      ' → ' +
      relation.effectEvent.name +
      '（关系 ID: ' +
      relation.id +
      '；置信度: ' +
      relation.confidence +
      '%；案例数: ' +
      relation.caseCount +
      '）',
  );
  return [
    '数据库中找到 ' +
      result.totalItems +
      ' 条匹配的因果关系，当前返回第 ' +
      result.page +
      '/' +
      result.totalPages +
      ' 页。',
    ...lines,
  ].join('\n');
}

export function registerEvidenceTools(server: McpServer, apiClient: CausalityEvidenceApi): void {
  server.registerTool(
    'get_concrete_case',
    {
      title: '查看具体案例',
      description: '读取一个具体案例及一页明确限量的关联因果关系。',
      inputSchema: getCaseInputSchema,
      outputSchema: caseWithRelationsSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ caseId, relationLimit, relationCursor }) => {
      const relationInput = {
        limit: relationLimit,
        ...(relationCursor === undefined ? {} : { cursor: relationCursor }),
      };
      const [concreteCase, relations] = await Promise.all([
        apiClient.getCase(caseId),
        apiClient.getCaseRelations(caseId, relationInput),
      ]);
      return textResult(caseDetailText(concreteCase, relations), {
        concreteCase,
        relations,
      });
    },
  );

  server.registerTool(
    'search_causal_relations',
    {
      title: '搜索因果关系',
      description: '按原因事件、结果事件或关系说明执行普通或显式语义增强搜索。',
      inputSchema: searchRelationsInputSchema,
      outputSchema: relationListResponseSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ query, searchMode, page }) => {
      const result = await apiClient.searchRelations(query, searchMode, page);
      return textResult(relationSearchText(result), { ...result });
    },
  );
}
