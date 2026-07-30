import type {
  AiCaptureCandidateSet,
  AiCaptureComparison,
  AiCaptureQualityReport,
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

const warningReport: AiCaptureQualityReport = {
  version: 1,
  status: 'warning',
  issues: [
    {
      code: 'AI_QUALITY_RELATION_WITHOUT_CASE',
      severity: 'warning',
      phase: 'candidate',
      entityType: 'relation',
      refs: ['relation-delay'],
      paths: ['/causalRelations/0'],
      message: '因果关系没有关联具体案例',
      suggestedAction: '补充支持该因果关系的具体案例',
      aiCanRepair: true,
    },
  ],
  topicRelevance: [{ ref: 'event-cause', similarity: 0.83 }],
};

const blockedReport: AiCaptureQualityReport = {
  version: 1,
  status: 'blocked',
  issues: [
    {
      code: 'AI_QUALITY_ORPHAN_EVENT',
      severity: 'error',
      phase: 'candidate',
      entityType: 'event',
      refs: ['event-cause'],
      paths: ['/atomicEvents/0'],
      message: '原子事件未参与任何因果关系',
      suggestedAction: '为原子事件补充因果关系，或将其从候选中移除',
      aiCanRepair: true,
    },
  ],
  topicRelevance: [],
};

const comparison: AiCaptureComparison = {
  atomicEvents: [
    { ref: 'event-cause', matches: [] },
    { ref: 'event-effect', matches: [] },
  ],
  concreteCases: [{ ref: 'case-port', matches: [] }],
  causalRelations: [{ ref: 'relation-delay', status: 'missing' }],
  relationCaseLinks: [{ relationRef: 'relation-delay', caseRef: 'case-port', exists: false }],
  qualityReport: warningReport,
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
  relationCaseReused: 0,
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
  public prepareError: Error | null = null;
  public commitError: Error | null = null;
  public comparisonResult: AiCaptureComparison = comparison;
  public planResult: AiImportPlan = plan;
  public commitCalls = 0;

  public async compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison> {
    this.comparedInput = input;
    if (this.compareError) throw this.compareError;
    return this.comparisonResult;
  }

  public async prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan> {
    this.preparedInput = input;
    if (this.prepareError) throw this.prepareError;
    return this.planResult;
  }

  public async planStatus(): Promise<AiImportPlanStatus> {
    return 'pending';
  }

  public async commit(): Promise<AiImportCommitResult> {
    this.commitCalls += 1;
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
    expect(result.structuredContent).toMatchObject({ qualityReport: warningReport });
    expect(textContent(result)).toContain('质量检查：存疑');
    expect(textContent(result)).toContain('阻断问题：0');
    expect(textContent(result)).toContain('存疑问题：1');
    expect(textContent(result)).toContain('[AI_QUALITY_RELATION_WITHOUT_CASE]');
    expect(textContent(result)).not.toContain('0.83');
  });

  it('carries a repaired warning workflow through MCP without calling commit', async () => {
    const malformedCandidates: AiCaptureCandidateSet = {
      topic: '港口停运影响供应链',
      clientName: 'capture-repair-flow',
      atomicEvents: [
        {
          ref: 'event-port-closed',
          name: '港口停止作业',
          description: null,
          aliases: [],
          keywords: ['港口'],
        },
        {
          ref: 'event-port-closed-copy',
          name: '港口停止作业',
          description: null,
          aliases: [],
          keywords: ['港口'],
        },
        {
          ref: 'event-parts-delayed',
          name: '零部件到货延迟',
          description: null,
          aliases: [],
          keywords: ['零部件'],
        },
        {
          ref: 'event-production-down',
          name: '工厂产量下降',
          description: null,
          aliases: [],
          keywords: ['产量'],
        },
      ],
      concreteCases: [
        { ref: 'case-port', content: '2026年某港口停运后零部件到货延迟' },
        { ref: 'case-port-copy', content: '2026年某港口停运后零部件到货延迟' },
      ],
      causalRelations: [
        {
          ref: 'relation-self-loop',
          causeEventRef: 'event-port-closed',
          effectEventRef: 'event-port-closed',
          description: null,
        },
        {
          ref: 'relation-missing-ref',
          causeEventRef: 'event-missing',
          effectEventRef: 'event-parts-delayed',
          description: null,
        },
      ],
      relationCaseLinks: [
        { relationRef: 'relation-self-loop', caseRef: 'case-port' },
        { relationRef: 'relation-missing-ref', caseRef: 'case-port-copy' },
      ],
    };
    const repairedCandidates: AiCaptureCandidateSet = {
      topic: malformedCandidates.topic,
      clientName: malformedCandidates.clientName,
      atomicEvents: [
        malformedCandidates.atomicEvents[0]!,
        malformedCandidates.atomicEvents[2]!,
        malformedCandidates.atomicEvents[3]!,
      ],
      concreteCases: [malformedCandidates.concreteCases[0]!],
      causalRelations: [
        {
          ref: 'relation-port-delay',
          causeEventRef: 'event-port-closed',
          effectEventRef: 'event-parts-delayed',
          description: '港口停运使零部件物流延迟',
        },
        {
          ref: 'relation-delay-production',
          causeEventRef: 'event-parts-delayed',
          effectEventRef: 'event-production-down',
          description: '零部件迟到导致产量下降',
        },
        {
          ref: 'relation-port-production',
          causeEventRef: 'event-port-closed',
          effectEventRef: 'event-production-down',
          description: '港口停运后产量下降',
        },
      ],
      relationCaseLinks: [
        { relationRef: 'relation-port-delay', caseRef: 'case-port' },
        { relationRef: 'relation-delay-production', caseRef: 'case-port' },
      ],
    };
    const repairedReport: AiCaptureQualityReport = {
      version: 1,
      status: 'warning',
      issues: [
        {
          code: 'AI_QUALITY_RELATION_WITHOUT_CASE',
          severity: 'warning',
          phase: 'comparison',
          entityType: 'relation',
          refs: ['relation-port-production'],
          paths: ['/causalRelations/2'],
          message: '候选因果关系尚未关联具体案例',
          suggestedAction: '补充案例关联或确认保留',
          aiCanRepair: true,
        },
        {
          code: 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED',
          severity: 'warning',
          phase: 'comparison',
          entityType: 'relation',
          refs: ['relation-port-production'],
          paths: ['/causalRelations/2'],
          message: '候选因果关系可能跳过传递路径中的中间原子事件',
          suggestedAction: '确认是否存在独立的直接因果依据',
          aiCanRepair: true,
        },
      ],
      topicRelevance: repairedCandidates.atomicEvents.map(({ ref }) => ({ ref, similarity: 1 })),
    };
    const repairedComparison: AiCaptureComparison = {
      atomicEvents: repairedCandidates.atomicEvents.map(({ ref }) => ({ ref, matches: [] })),
      concreteCases: [{ ref: 'case-port', matches: [] }],
      causalRelations: repairedCandidates.causalRelations.map(({ ref }) => ({
        ref,
        status: 'missing' as const,
      })),
      relationCaseLinks: repairedCandidates.relationCaseLinks.map((link) => ({
        ...link,
        exists: false,
      })),
      qualityReport: repairedReport,
    };
    const repairedDecisions: PrepareAiImportPlanInput['decisions'] = {
      atomicEvents: repairedCandidates.atomicEvents.map(({ ref }) => ({
        ref,
        action: 'create',
      })),
      concreteCases: [{ ref: 'case-port', action: 'create' }],
      causalRelations: [
        { ref: 'relation-port-delay', action: 'create' },
        { ref: 'relation-delay-production', action: 'create' },
        {
          ref: 'relation-port-production',
          action: 'skip',
          reason: '缺少独立案例且可能是传递快捷边',
        },
      ],
      relationCaseLinks: [
        { relationRef: 'relation-port-delay', caseRef: 'case-port', action: 'create' },
        { relationRef: 'relation-delay-production', caseRef: 'case-port', action: 'create' },
      ],
    };
    const repairedPlan: AiImportPlan = {
      ...plan,
      topic: repairedCandidates.topic,
      clientName: repairedCandidates.clientName,
      candidates: repairedCandidates,
      comparison: repairedComparison,
      decisions: repairedDecisions,
      summary: {
        ...counts,
        eventCreated: 3,
        caseCreated: 1,
        relationCreated: 2,
        relationCaseCreated: 2,
      },
    };
    const firstBlockedReport: AiCaptureQualityReport = {
      version: 1,
      status: 'blocked',
      issues: [
        {
          code: 'AI_QUALITY_DUPLICATE_EVENT_NAME',
          severity: 'error',
          phase: 'candidate',
          entityType: 'event',
          refs: ['event-port-closed-copy'],
          paths: ['/atomicEvents/1/name'],
          message: '候选原子事件名称重复',
          suggestedAction: '合并为一个事件候选',
          aiCanRepair: true,
        },
        {
          code: 'AI_QUALITY_DUPLICATE_CASE_CONTENT',
          severity: 'error',
          phase: 'candidate',
          entityType: 'case',
          refs: ['case-port-copy'],
          paths: ['/concreteCases/1/content'],
          message: '候选具体案例内容重复',
          suggestedAction: '合并为一个案例候选',
          aiCanRepair: true,
        },
        {
          code: 'AI_QUALITY_REFERENCE_MISSING',
          severity: 'error',
          phase: 'candidate',
          entityType: 'relation',
          refs: ['relation-missing-ref'],
          paths: ['/causalRelations/1/causeEventRef'],
          message: '原因事件引用不存在',
          suggestedAction: '补齐引用或移除依赖项',
          aiCanRepair: true,
        },
        {
          code: 'AI_QUALITY_SELF_LOOP',
          severity: 'error',
          phase: 'candidate',
          entityType: 'relation',
          refs: ['relation-self-loop'],
          paths: ['/causalRelations/0/effectEventRef'],
          message: '因果关系不能形成自环',
          suggestedAction: '修正端点或移除关系',
          aiCanRepair: true,
        },
      ],
      topicRelevance: [],
    };
    api.compareError = workflowClientError(
      {
        category: 'data',
        code: 'AI_CANDIDATE_QUALITY_BLOCKED',
        message: '候选集合存在必须修复的质量问题',
        affectedRefs: firstBlockedReport.issues.flatMap((issue) => issue.refs),
        aiCanRepair: true,
        retryCurrentPlan: false,
        suggestedAction: '根据质量报告修正完整候选集合后重新对比',
        qualityReport: firstBlockedReport,
      },
      400,
    );

    const blocked = await mcpClient.callTool({
      name: 'compare_knowledge_candidates',
      arguments: malformedCandidates,
    });

    expect(blocked.isError).toBe(true);
    expect(api.comparedInput).toEqual(malformedCandidates);
    expect(blocked.structuredContent).toMatchObject({ qualityReport: firstBlockedReport });
    for (const issue of firstBlockedReport.issues) {
      expect(textContent(blocked)).toContain(`[${issue.code}]`);
    }

    api.compareError = null;
    api.comparisonResult = repairedComparison;
    const compared = await mcpClient.callTool({
      name: 'compare_knowledge_candidates',
      arguments: repairedCandidates,
    });

    expect(compared.isError).not.toBe(true);
    expect(compared.structuredContent).toMatchObject({ qualityReport: repairedReport });
    expect(textContent(compared)).toContain('质量检查：存疑');
    expect(textContent(compared)).toContain('存疑问题：2');
    for (const issue of repairedReport.issues) {
      expect(textContent(compared)).toContain(`[${issue.code}]`);
    }

    const malformedComparison: AiCaptureComparison = {
      atomicEvents: malformedCandidates.atomicEvents.map(({ ref }) => ({ ref, matches: [] })),
      concreteCases: malformedCandidates.concreteCases.map(({ ref }) => ({ ref, matches: [] })),
      causalRelations: malformedCandidates.causalRelations.map(({ ref }) => ({
        ref,
        status: 'missing' as const,
      })),
      relationCaseLinks: malformedCandidates.relationCaseLinks.map((link) => ({
        ...link,
        exists: false,
      })),
      qualityReport: firstBlockedReport,
    };
    const malformedDecisions: PrepareAiImportPlanInput['decisions'] = {
      atomicEvents: malformedCandidates.atomicEvents.map(({ ref }) => ({
        ref,
        action: 'create',
      })),
      concreteCases: malformedCandidates.concreteCases.map(({ ref }) => ({
        ref,
        action: 'create',
      })),
      causalRelations: malformedCandidates.causalRelations.map(({ ref }) => ({
        ref,
        action: 'create',
      })),
      relationCaseLinks: malformedCandidates.relationCaseLinks.map((link) => ({
        ...link,
        action: 'create' as const,
      })),
    };
    const planBlockedReport: AiCaptureQualityReport = {
      version: 1,
      status: 'blocked',
      issues: [
        {
          code: 'AI_QUALITY_REPORT_BLOCKED',
          severity: 'error',
          phase: 'plan',
          entityType: 'batch',
          refs: ['relation-missing-ref', 'relation-self-loop'],
          paths: ['/decisions'],
          message: '候选集合重新检查后仍存在阻断问题',
          suggestedAction: '检查质量报告中的关联候选并修正',
          aiCanRepair: true,
        },
      ],
      topicRelevance: [],
    };
    api.prepareError = workflowClientError(
      {
        category: 'data',
        code: 'AI_PLAN_QUALITY_BLOCKED',
        message: '入库方案存在必须修复的质量问题',
        affectedRefs: ['relation-missing-ref', 'relation-self-loop'],
        aiCanRepair: true,
        retryCurrentPlan: false,
        suggestedAction: '根据质量报告修正完整决策集合后重新生成方案',
        qualityReport: planBlockedReport,
      },
      400,
    );

    const blockedPlan = await mcpClient.callTool({
      name: 'prepare_knowledge_changes',
      arguments: {
        candidates: malformedCandidates,
        comparison: malformedComparison,
        decisions: malformedDecisions,
      },
    });

    expect(blockedPlan.isError).toBe(true);
    expect(api.preparedInput).toMatchObject({ candidates: malformedCandidates });
    expect(blockedPlan.structuredContent).toMatchObject({ qualityReport: planBlockedReport });
    expect(textContent(blockedPlan)).toContain('[AI_QUALITY_REPORT_BLOCKED]');

    api.prepareError = null;
    api.planResult = repairedPlan;
    const prepared = await mcpClient.callTool({
      name: 'prepare_knowledge_changes',
      arguments: {
        candidates: repairedCandidates,
        comparison: repairedComparison,
        decisions: repairedDecisions,
      },
    });

    expect(prepared.isError).not.toBe(true);
    expect(prepared.structuredContent).toMatchObject({
      decisions: {
        causalRelations: expect.arrayContaining([
          expect.objectContaining({ ref: 'relation-port-production', action: 'skip' }),
        ]),
      },
      comparison: { qualityReport: repairedReport },
    });
    expect(textContent(prepared)).toContain('relation-port-production：暂不入库');
    for (const issue of repairedReport.issues) {
      expect(textContent(prepared)).toContain(`[${issue.code}]`);
    }
    expect(api.commitCalls).toBe(0);
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
    expect(text).toContain('新增/复用案例关联：1/0');
    expect(text).toContain('置信度变化：1');
    expect(text).toContain('失效时间：2026-07-28T12:30:00.000Z');
    expect(text).toContain('质量检查：存疑');
    expect(text).toContain('[AI_QUALITY_RELATION_WITHOUT_CASE]');
    expect(text).not.toContain('0.83');
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
        qualityReport: blockedReport,
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
      qualityReport: blockedReport,
    });
    const text = textContent(result);
    expect(text).toContain('[AI_QUALITY_ORPHAN_EVENT]');
    expect(text).toContain('路径：/atomicEvents/0');
    expect(text).toContain('相关项：event-cause');
    expect(text).toContain('建议：为原子事件补充因果关系，或将其从候选中移除');
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
