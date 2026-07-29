import type {
  AiCaptureCandidateSet,
  AiCaptureComparison,
  AiImportCommitResult,
  AiImportPlan,
  AiImportPlanStatus,
  AiWorkflowError,
  PrepareAiImportPlanInput,
} from '@causality/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CausalityApiClientError } from '../src/api/causalityApiClient.js';
import {
  registerCaptureTools,
  type CausalityCaptureApi,
} from '../src/tools/registerCaptureTools.js';

const existingEventId = '10000000-0000-4000-8000-000000000001';
const planId = '40000000-0000-4000-8000-000000000001';
const historyId = '50000000-0000-4000-8000-000000000001';
const timestamp = '2026-07-28T12:00:00.000Z';

const candidates: AiCaptureCandidateSet = {
  topic: '供应链变化',
  clientName: 'capture-tools-test',
  atomicEvents: [
    {
      ref: 'event-cause',
      name: '供应链中断',
      description: '关键物流节点无法正常运转',
      aliases: ['物流受阻'],
      keywords: ['供应链'],
    },
    {
      ref: 'event-effect',
      name: '交付周期延长',
      description: null,
      aliases: [],
      keywords: ['交付'],
    },
  ],
  concreteCases: [
    {
      ref: 'case-port',
      content: '港口停运后工厂原料延迟到货',
    },
  ],
  causalRelations: [
    {
      ref: 'relation-delay',
      causeEventRef: 'event-cause',
      effectEventRef: 'event-effect',
      description: '物流受阻会延长交付周期',
    },
  ],
  relationCaseLinks: [
    {
      relationRef: 'relation-delay',
      caseRef: 'case-port',
    },
  ],
};

const comparison: AiCaptureComparison = {
  atomicEvents: [
    { ref: 'event-cause', matches: [] },
    { ref: 'event-effect', matches: [] },
  ],
  concreteCases: [{ ref: 'case-port', matches: [] }],
  causalRelations: [{ ref: 'relation-delay', status: 'missing' }],
  relationCaseLinks: [{ relationRef: 'relation-delay', caseRef: 'case-port', exists: false }],
};

const prepareInput: PrepareAiImportPlanInput = {
  candidates,
  comparison,
  decisions: {
    atomicEvents: [
      {
        ref: 'event-cause',
        action: 'reuse',
        existingId: existingEventId,
        appendAliases: ['供应受阻'],
        appendKeywords: ['物流'],
        replaceDescription: '关键运输节点无法正常运转',
      },
      { ref: 'event-effect', action: 'create' },
    ],
    concreteCases: [{ ref: 'case-port', action: 'create' }],
    causalRelations: [{ ref: 'relation-delay', action: 'create' }],
    relationCaseLinks: [
      {
        relationRef: 'relation-delay',
        caseRef: 'case-port',
        action: 'create',
      },
    ],
  },
};

const counts = {
  eventCreated: 1,
  eventReused: 1,
  eventUpdated: 1,
  caseCreated: 1,
  caseReused: 0,
  relationCreated: 1,
  relationReused: 0,
  relationCaseCreated: 1,
  confidenceChanged: 1,
};

const plan: AiImportPlan = {
  id: planId,
  version: 1,
  replacesPlanId: null,
  status: 'pending',
  topic: candidates.topic,
  clientName: candidates.clientName,
  candidates,
  comparison,
  decisions: prepareInput.decisions,
  summary: counts,
  createdAt: timestamp,
  expiresAt: '2026-07-28T12:30:00.000Z',
  committedAt: null,
  error: null,
  result: null,
};

const commitResult: AiImportCommitResult = {
  planId,
  historyId,
  marker: `[Causality-Capture: ${historyId}]`,
  noChanges: false,
  counts,
  completedAt: timestamp,
};

class FakeCaptureApi implements CausalityCaptureApi {
  public comparedInput: AiCaptureCandidateSet | null = null;
  public preparedInput: PrepareAiImportPlanInput | null = null;
  public compareError: Error | null = null;
  public commitError: Error | null = null;

  public async compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison> {
    if (this.compareError) throw this.compareError;
    this.comparedInput = input;
    return comparison;
  }

  public async prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan> {
    this.preparedInput = input;
    return plan;
  }

  public async planStatus(): Promise<AiImportPlanStatus> {
    return 'pending';
  }

  public async commit(): Promise<AiImportCommitResult> {
    if (this.commitError) throw this.commitError;
    return commitResult;
  }

  public async result(): Promise<AiImportCommitResult> {
    return commitResult;
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

function workflowClientError(workflowError: AiWorkflowError, status: number) {
  return new CausalityApiClientError({
    kind: 'api',
    status,
    code: workflowError.code,
    message: workflowError.message,
    traceId: '60000000-0000-4000-8000-000000000001',
    workflowError,
  });
}

describe('capture workflow tools', () => {
  let api: FakeCaptureApi;
  let errorLogs: unknown[];
  let mcpClient: Client;
  let mcpServer: McpServer;

  beforeEach(async () => {
    api = new FakeCaptureApi();
    errorLogs = [];
    mcpServer = new McpServer({ name: 'capture-tools-test', version: '1.0.0' });
    registerCaptureTools(mcpServer, api, {
      error: (entry: unknown) => errorLogs.push(entry),
    });
    mcpClient = new Client({ name: 'capture-tools-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
  });

  afterEach(async () => {
    await mcpClient.close();
    await mcpServer.close();
  });

  it('lists five tools with the required per-operation safety annotations', async () => {
    const listed = await mcpClient.listTools();

    expect(
      listed.tools.map((tool) => ({
        name: tool.name,
        annotations: tool.annotations,
      })),
    ).toEqual([
      {
        name: 'compare_knowledge_candidates',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'prepare_knowledge_changes',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'get_import_plan_status',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'commit_knowledge_changes',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'get_import_result',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ]);
  });

  it('passes all four candidate collections through one comparison call', async () => {
    const result = await mcpClient.callTool({
      name: 'compare_knowledge_candidates',
      arguments: candidates,
    });

    expect(result.isError).not.toBe(true);
    expect(api.comparedInput).toEqual(candidates);
    expect(result.structuredContent).toEqual(comparison);
    expect(textContent(result)).toContain('2 个原子事件');
    expect(textContent(result)).toContain('1 条具体案例');
    expect(textContent(result)).toContain('1 条因果关系');
    expect(textContent(result)).toContain('1 条案例关联');
  });

  it('returns a readable complete plan together with the full structured plan', async () => {
    const result = await mcpClient.callTool({
      name: 'prepare_knowledge_changes',
      arguments: prepareInput,
    });

    expect(result.isError).not.toBe(true);
    expect(api.preparedInput).toEqual(prepareInput);
    expect(result.structuredContent).toEqual(plan);
    const text = textContent(result);
    expect(text).toContain(`方案编号：${planId}`);
    expect(text).toContain('event-cause：复用');
    expect(text).toContain('event-effect：新增');
    expect(text).toContain('case-port：新增');
    expect(text).toContain('relation-delay：新增');
    expect(text).toContain('relation-delay + case-port：新增关联');
    expect(text).toContain('置信度变化：1');
    expect(text).toContain('失效时间：2026-07-28T12:30:00.000Z');
  });

  it('keeps commit input limited to one immutable plan ID and returns the exact marker', async () => {
    const listed = await mcpClient.listTools();
    const commitTool = listed.tools.find((tool) => tool.name === 'commit_knowledge_changes');
    const invalid = await mcpClient.callTool({
      name: 'commit_knowledge_changes',
      arguments: { planId, candidates },
    });
    const committed = await mcpClient.callTool({
      name: 'commit_knowledge_changes',
      arguments: { planId },
    });

    expect(commitTool?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['planId'],
    });
    expect(invalid.isError).toBe(true);
    expect(committed.structuredContent).toEqual(commitResult);
    expect(textContent(committed)).toContain(`[Causality-Capture: ${historyId}]`);
  });

  it('preserves AI-repair metadata for data failures', async () => {
    api.compareError = workflowClientError(
      {
        category: 'data',
        code: 'AI_PLAN_COMPARISON_STALE',
        message: '候选对比已经过期',
        affectedRefs: ['event-cause'],
        aiCanRepair: true,
        retryCurrentPlan: false,
        suggestedAction: '重新查询并生成完整方案',
      },
      409,
    );

    const result = await mcpClient.callTool({
      name: 'compare_knowledge_candidates',
      arguments: candidates,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      category: 'data',
      code: 'AI_PLAN_COMPARISON_STALE',
      affectedRefs: ['event-cause'],
      aiCanRepair: true,
      retryCurrentPlan: false,
    });
    expect(errorLogs).toEqual([
      expect.objectContaining({
        event: 'mcp_tool_failed',
        tool: 'compare_knowledge_candidates',
        errorKind: 'api',
        errorCode: 'AI_PLAN_COMPARISON_STALE',
        httpStatus: 409,
        traceId: '60000000-0000-4000-8000-000000000001',
      }),
    ]);
    expect(JSON.stringify(errorLogs)).not.toContain(candidates.topic);
    expect(JSON.stringify(errorLogs)).not.toContain(candidates.atomicEvents[0]!.description);
  });

  it('preserves retry guidance for system failures', async () => {
    api.commitError = workflowClientError(
      {
        category: 'system',
        code: 'AI_COMMIT_DATABASE_UNAVAILABLE',
        message: '数据库暂时不可用',
        affectedRefs: [],
        aiCanRepair: false,
        retryCurrentPlan: true,
        suggestedAction: '恢复数据库后重试当前方案',
      },
      503,
    );

    const result = await mcpClient.callTool({
      name: 'commit_knowledge_changes',
      arguments: { planId },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      category: 'system',
      code: 'AI_COMMIT_DATABASE_UNAVAILABLE',
      aiCanRepair: false,
      retryCurrentPlan: true,
    });
  });

  it('returns typed status and successful result from their read-only tools', async () => {
    const status = await mcpClient.callTool({
      name: 'get_import_plan_status',
      arguments: { planId },
    });
    const result = await mcpClient.callTool({
      name: 'get_import_result',
      arguments: { historyId },
    });

    expect(status.structuredContent).toEqual({ planId, status: 'pending' });
    expect(result.structuredContent).toEqual(commitResult);
  });
});
