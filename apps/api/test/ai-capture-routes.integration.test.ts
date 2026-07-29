import {
  aiCaptureComparisonSchema,
  aiImportBatchDetailSchema,
  aiImportBatchListResponseSchema,
  aiImportCommitResultSchema,
  aiImportPlanSchema,
  aiImportRecordListResponseSchema,
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AiImportPlan,
  type AiWorkflowError,
} from '@causality/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';

const emptyCandidates: AiCaptureCandidateSet = {
  topic: '空变化验证',
  clientName: 'integration-test',
  atomicEvents: [],
  concreteCases: [],
  causalRelations: [],
  relationCaseLinks: [],
};

const malformedRepairCandidates: AiCaptureCandidateSet = {
  topic: '港口停运影响供应链',
  clientName: 'integration-repair-flow',
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

const repairedWarningCandidates: AiCaptureCandidateSet = {
  topic: malformedRepairCandidates.topic,
  clientName: malformedRepairCandidates.clientName,
  atomicEvents: [
    malformedRepairCandidates.atomicEvents[0]!,
    malformedRepairCandidates.atomicEvents[2]!,
    malformedRepairCandidates.atomicEvents[3]!,
  ],
  concreteCases: [malformedRepairCandidates.concreteCases[0]!],
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

describe.sequential('AI capture typed HTTP workflow', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let token: string;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_ai_capture_routes_test', {
      semanticWorkerClient: {
        health: async () => ({
          status: 'ok',
          modelLoaded: true,
          activeModelCode: 'multilingual-e5-small',
        }),
        embedQuery: async () => [1, ...Array.from({ length: 383 }, () => 0)],
        embedQueries: async (_modelCode, texts) =>
          texts.map(() => [1, ...Array.from({ length: 383 }, () => 0)]),
      },
    });
    const settings = await context.pool.query<{ access_token: string }>(
      `select access_token from mcp_settings where singleton_key = true`,
    );
    token = settings.rows[0]!.access_token;
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('runs the authenticated workflow and exposes successful history without authentication', async () => {
    const auth = { 'x-causality-mcp-token': token };
    const compared = await context.app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: auth,
      payload: emptyCandidates,
    });
    expect(compared.statusCode).toBe(200);
    expect(aiCaptureComparisonSchema.safeParse(compared.json()).success).toBe(true);

    const prepared = await context.app.inject({
      method: 'POST',
      url: '/api/ai-captures/plans',
      headers: auth,
      payload: {
        candidates: emptyCandidates,
        comparison: compared.json(),
        decisions: {
          atomicEvents: [],
          concreteCases: [],
          causalRelations: [],
          relationCaseLinks: [],
        },
      },
    });
    expect(prepared.statusCode).toBe(201);
    expect(aiImportPlanSchema.safeParse(prepared.json()).success).toBe(true);
    const planId = prepared.json().id as string;

    const status = await context.app.inject({
      method: 'GET',
      url: `/api/ai-captures/plans/${planId}`,
      headers: auth,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ id: planId, status: 'pending' });

    const committed = await context.app.inject({
      method: 'POST',
      url: `/api/ai-captures/plans/${planId}/commit`,
      headers: auth,
    });
    const repeated = await context.app.inject({
      method: 'POST',
      url: `/api/ai-captures/plans/${planId}/commit`,
      headers: auth,
    });
    expect(committed.statusCode).toBe(200);
    expect(aiImportCommitResultSchema.safeParse(committed.json()).success).toBe(true);
    expect(repeated.json()).toEqual(committed.json());
    const historyId = committed.json().historyId as string;

    const result = await context.app.inject({
      method: 'GET',
      url: `/api/ai-captures/results/${historyId}`,
      headers: auth,
    });
    const history = await context.app.inject({
      method: 'GET',
      url: '/api/ai-captures/history?page=1',
    });
    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/ai-captures/history/${historyId}`,
    });
    const records = await context.app.inject({
      method: 'GET',
      url: `/api/ai-captures/history/${historyId}/records?type=event&page=1`,
    });

    expect(result.json()).toEqual(committed.json());
    expect(aiImportBatchListResponseSchema.safeParse(history.json()).success).toBe(true);
    expect(history.json()).toMatchObject({ totalItems: 1 });
    expect(aiImportBatchDetailSchema.safeParse(detail.json()).success).toBe(true);
    expect(aiImportRecordListResponseSchema.safeParse(records.json()).success).toBe(true);
  });

  it('returns stable authorization, not-found, and expired responses', async () => {
    const unauthorized = await context.app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: { 'x-causality-mcp-token': 'b'.repeat(64) },
      payload: emptyCandidates,
    });
    const missing = await context.app.inject({
      method: 'GET',
      url: '/api/ai-captures/plans/90000000-0000-4000-8000-000000000001',
      headers: { 'x-causality-mcp-token': token },
    });

    const comparison = {
      atomicEvents: [],
      concreteCases: [],
      causalRelations: [],
      relationCaseLinks: [],
      qualityReport: {
        version: 1,
        status: 'passed' as const,
        issues: [],
        topicRelevance: [],
      },
    };
    const prepared = await context.app.inject({
      method: 'POST',
      url: '/api/ai-captures/plans',
      headers: { 'x-causality-mcp-token': token },
      payload: {
        candidates: { ...emptyCandidates, topic: '过期方案' },
        comparison,
        decisions: {
          atomicEvents: [],
          concreteCases: [],
          causalRelations: [],
          relationCaseLinks: [],
        },
      },
    });
    const expiredPlanId = prepared.json().id as string;
    await context.pool.query(
      `update ai_import_plans
       set created_at = clock_timestamp() - interval '31 minutes',
           expires_at = clock_timestamp() - interval '1 minute'
       where id = $1`,
      [expiredPlanId],
    );
    const expired = await context.app.inject({
      method: 'GET',
      url: `/api/ai-captures/plans/${expiredPlanId}`,
      headers: { 'x-causality-mcp-token': token },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(missing.statusCode).toBe(404);
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toMatchObject({
      category: 'data',
      code: 'AI_PLAN_EXPIRED',
      affectedRefs: [expiredPlanId],
      aiCanRepair: true,
      retryCurrentPlan: false,
    });
  });

  it('repairs a blocked full batch, skips its warning shortcut, and prepares without committing', async () => {
    const auth = { 'x-causality-mcp-token': token };
    const blocked = await context.app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: auth,
      payload: malformedRepairCandidates,
    });

    expect(blocked.statusCode).toBe(400);
    expect(blocked.json<AiWorkflowError>()).toMatchObject({
      category: 'data',
      code: 'AI_CANDIDATE_QUALITY_BLOCKED',
      aiCanRepair: true,
      retryCurrentPlan: false,
      qualityReport: {
        status: 'blocked',
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'AI_QUALITY_REFERENCE_MISSING' }),
          expect.objectContaining({ code: 'AI_QUALITY_SELF_LOOP' }),
        ]),
      },
    });

    await context.pool.query(
      `update semantic_model_settings
       set file_status = 'downloaded',
           downloaded_at = clock_timestamp()
       where model_code = 'multilingual-e5-small';
       update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = state_version + 1,
           updated_at = clock_timestamp()
       where singleton_key = true`,
    );

    const compared = await context.app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: auth,
      payload: repairedWarningCandidates,
    });
    const comparison = compared.json<AiCaptureComparison>();

    expect(compared.statusCode).toBe(200);
    expect(aiCaptureComparisonSchema.safeParse(comparison).success).toBe(true);
    expect(comparison.qualityReport).toMatchObject({
      status: 'warning',
      issues: [
        expect.objectContaining({
          code: 'AI_QUALITY_RELATION_WITHOUT_CASE',
          refs: ['relation-port-production'],
        }),
        expect.objectContaining({
          code: 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED',
          refs: ['relation-port-production'],
        }),
      ],
    });

    const prepared = await context.app.inject({
      method: 'POST',
      url: '/api/ai-captures/plans',
      headers: auth,
      payload: {
        candidates: repairedWarningCandidates,
        comparison,
        decisions: {
          atomicEvents: repairedWarningCandidates.atomicEvents.map(({ ref }) => ({
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
        },
      },
    });
    const plan = prepared.json<AiImportPlan>();

    expect(prepared.statusCode).toBe(201);
    expect(aiImportPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.status).toBe('pending');
    expect(plan.decisions.causalRelations).toContainEqual(
      expect.objectContaining({ ref: 'relation-port-production', action: 'skip' }),
    );
    expect(plan.comparison.qualityReport).toMatchObject({
      status: 'warning',
      issues: [expect.objectContaining({ code: 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED' })],
    });
    const committed = await context.pool.query<{ count: number }>(
      `select count(*)::int as count from ai_import_batches where plan_id = $1`,
      [plan.id],
    );
    expect(committed.rows[0]!.count).toBe(0);
  });
});
