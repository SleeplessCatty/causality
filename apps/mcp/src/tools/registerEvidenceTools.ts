import {
  caseDetailSchema,
  caseRelationListResponseSchema,
  causalEvidenceBundleResponseSchema,
  causalPathResponseSchema,
  relationListResponseSchema,
  type CaseDetail,
  type CaseRelationListResponse,
  type CausalEvidenceBundleInput,
  type CausalEvidenceBundleResponse,
  type CausalPathQuery,
  type CausalPathResponse,
  type RelationListResponse,
  type SearchMode,
} from '@causality/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MCP_TOOL_NAMES, toolRegistrationMetadata } from '../capabilities/capabilityManifest.js';
import { executeTool, silentToolLogger, type ToolExecutionLogger } from './executeTool.js';
import { textResult } from './toolResult.js';

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
  findCausalPaths(input: CausalPathQuery): Promise<CausalPathResponse>;
  getCausalEvidenceBundle(input: CausalEvidenceBundleInput): Promise<CausalEvidenceBundleResponse>;
}

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

const findPathsInputSchema = z
  .object({
    sourceEventId: z.uuid().describe('起点原子事件 ID'),
    targetEventId: z.uuid().describe('终点原子事件 ID'),
    maxDepth: z.number().int().min(1).max(10).default(5).describe('最大关系层数'),
    pathLimit: z.number().int().min(1).max(10).default(10).describe('最多返回路径数'),
    minConfidence: z.number().min(0).max(100).default(0).describe('最低置信度百分比'),
    minCaseCount: z.number().int().min(0).max(1_000).default(0).describe('最少案例数'),
  })
  .strict();

const evidenceBundleInputSchema = z
  .object({
    relationIds: z.array(z.uuid()).min(1).max(10).describe('按路径顺序排列的关系 ID'),
    caseLimitPerRelation: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe('每条关系返回的案例数'),
  })
  .strict();

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

function pathText(result: CausalPathResponse): string {
  const lines = result.paths.map((path, index) => {
    const eventChain = path.events.map((event) => event.name).join(' → ');
    const relationIds = path.relations.map((relation) => relation.id).join('、');
    return (
      '- 路径 ' +
      String(index + 1) +
      '：' +
      eventChain +
      '（关系 ID: ' +
      relationIds +
      '；跳数: ' +
      path.hopCount +
      '；最低置信度: ' +
      path.minimumConfidence +
      '%；案例总数: ' +
      path.totalCaseCount +
      '）'
    );
  });
  return [
    result.truncated
      ? '结果不完整；停止原因：' + result.truncatedReason + '。'
      : '路径查询已经在当前限制内完成。',
    '从 ' +
      result.sourceEvent.name +
      ' 到 ' +
      result.targetEvent.name +
      ' 找到 ' +
      result.paths.length +
      ' 条有向路径。',
    ...(lines.length > 0 ? lines : ['当前筛选条件下没有找到有向路径。']),
  ].join('\n');
}

function evidenceBundleText(result: CausalEvidenceBundleResponse): string {
  const names = new Map(result.events.map((event) => [event.id, event.name]));
  const relationLines = result.relations.flatMap((relation) => {
    const header =
      '- ' +
      (names.get(relation.causeEventId) ?? relation.causeEventId) +
      ' → ' +
      (names.get(relation.effectEventId) ?? relation.effectEventId) +
      '（关系 ID: ' +
      relation.id +
      '；置信度: ' +
      relation.confidence +
      '%；案例总数: ' +
      relation.caseCount +
      '；说明: ' +
      (relation.description ?? '无') +
      '）';
    if (relation.evidenceStatus === 'no_cases') return [header, '  无案例依据'];
    return [
      header,
      ...relation.cases.map(
        (concreteCase) =>
          '  案例：' +
          concreteCase.content +
          '（案例 ID: ' +
          concreteCase.id +
          '；关联时间: ' +
          concreteCase.linkedAt +
          '）',
      ),
      relation.casesTruncated ? '  仍有更多案例，可使用关系案例工具继续查询。' : '',
    ].filter(Boolean);
  });
  return [
    '证据路径：' + result.events.map((event) => event.name).join(' → '),
    '跳数：' +
      result.hopCount +
      '；最低置信度：' +
      result.minimumConfidence +
      '%；案例总数：' +
      result.totalCaseCount,
    ...relationLines,
  ].join('\n');
}

export function registerEvidenceTools(
  server: McpServer,
  apiClient: CausalityEvidenceApi,
  logger: ToolExecutionLogger = silentToolLogger,
): void {
  server.registerTool(
    MCP_TOOL_NAMES.getConcreteCase,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.getConcreteCase),
      inputSchema: getCaseInputSchema,
      outputSchema: caseWithRelationsSchema,
    },
    ({ caseId, relationLimit, relationCursor }) =>
      executeTool(MCP_TOOL_NAMES.getConcreteCase, logger, async () => {
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
      }),
  );

  server.registerTool(
    MCP_TOOL_NAMES.searchCausalRelations,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.searchCausalRelations),
      inputSchema: searchRelationsInputSchema,
      outputSchema: relationListResponseSchema,
    },
    ({ query, searchMode, page }) =>
      executeTool(MCP_TOOL_NAMES.searchCausalRelations, logger, async () => {
        const result = await apiClient.searchRelations(query, searchMode, page);
        return textResult(relationSearchText(result), { ...result });
      }),
  );

  server.registerTool(
    MCP_TOOL_NAMES.findCausalPaths,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.findCausalPaths),
      inputSchema: findPathsInputSchema,
      outputSchema: causalPathResponseSchema,
    },
    (input) =>
      executeTool(MCP_TOOL_NAMES.findCausalPaths, logger, async () => {
        const result = await apiClient.findCausalPaths(input);
        return textResult(pathText(result), { ...result });
      }),
  );

  server.registerTool(
    MCP_TOOL_NAMES.getCausalEvidenceBundle,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.getCausalEvidenceBundle),
      inputSchema: evidenceBundleInputSchema,
      outputSchema: causalEvidenceBundleResponseSchema,
    },
    (input) =>
      executeTool(MCP_TOOL_NAMES.getCausalEvidenceBundle, logger, async () => {
        const result = await apiClient.getCausalEvidenceBundle(input);
        return textResult(evidenceBundleText(result), { ...result });
      }),
  );
}
