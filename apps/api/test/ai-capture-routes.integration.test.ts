import {
  aiCaptureComparisonSchema,
  aiImportBatchDetailSchema,
  aiImportBatchListResponseSchema,
  aiImportCommitResultSchema,
  aiImportPlanSchema,
  aiImportRecordListResponseSchema,
  type AiCaptureCandidateSet,
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

describe.sequential('AI capture typed HTTP workflow', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let token: string;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_ai_capture_routes_test');
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
});
