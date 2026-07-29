import type {
  AiCaptureCandidateSet,
  AiCaptureComparison,
  AiImportBatchDetail,
  AiImportBatchListResponse,
  AiImportCommitResult,
  AiImportPlan,
  AiImportRecordListResponse,
} from '@causality/contracts';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AiCaptureDataError } from '../src/features/ai-capture/aiCaptureErrors.js';
import {
  registerAiCaptureRoutes,
  type AiCaptureRouteDependencies,
} from '../src/features/ai-capture/aiCaptureRoutes.js';
import { SemanticQueryError } from '../src/features/semantic/semanticQueryService.js';

const token = 'a'.repeat(64);
const existingEventId = '00000000-0000-4000-8000-000000000001';
const effectEventId = '00000000-0000-4000-8000-000000000002';
const existingRelationId = '00000000-0000-4000-8000-000000000003';
const planId = '10000000-0000-4000-8000-000000000001';
const historyId = '20000000-0000-4000-8000-000000000001';
const timestamp = '2026-07-28T12:00:00.000Z';

const candidates: AiCaptureCandidateSet = {
  topic: '供应链变化',
  clientName: 'route-test',
  atomicEvents: [],
  concreteCases: [],
  causalRelations: [],
  relationCaseLinks: [],
};

const comparison: AiCaptureComparison = {
  atomicEvents: [],
  concreteCases: [],
  causalRelations: [],
  relationCaseLinks: [],
};

const nonEmptyCandidates: AiCaptureCandidateSet = {
  topic: '供应链变化',
  clientName: 'route-test',
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
  concreteCases: [],
  causalRelations: [
    {
      ref: 'relation-delay',
      causeEventRef: 'event-cause',
      effectEventRef: 'event-effect',
      description: '物流受阻会延长交付周期',
    },
  ],
  relationCaseLinks: [],
};

const nonEmptyComparison: AiCaptureComparison = {
  atomicEvents: [
    {
      ref: 'event-cause',
      matches: [
        {
          id: existingEventId,
          name: '供应链中断',
          description: '已有事件说明',
          aliases: ['物流受阻'],
          keywords: ['供应链'],
          matchKind: 'exact_name',
          similarity: 1,
          updatedAt: timestamp,
        },
      ],
    },
    { ref: 'event-effect', matches: [] },
  ],
  concreteCases: [],
  causalRelations: [
    {
      ref: 'relation-delay',
      status: 'existing',
      relation: {
        id: existingRelationId,
        causeEventId: existingEventId,
        effectEventId,
        description: '已有关系说明',
        confidence: 30,
        caseCount: 2,
        updatedAt: timestamp,
      },
    },
  ],
  relationCaseLinks: [],
};

const counts = {
  eventCreated: 0,
  eventReused: 0,
  eventUpdated: 0,
  caseCreated: 0,
  caseReused: 0,
  relationCreated: 0,
  relationReused: 0,
  relationCaseCreated: 0,
  confidenceChanged: 0,
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
  decisions: {
    atomicEvents: [],
    concreteCases: [],
    causalRelations: [],
    relationCaseLinks: [],
  },
  summary: counts,
  createdAt: timestamp,
  expiresAt: '2026-07-28T12:30:00.000Z',
  committedAt: null,
  error: null,
  result: null,
};

const nonEmptyPlan: AiImportPlan = {
  ...plan,
  topic: nonEmptyCandidates.topic,
  clientName: nonEmptyCandidates.clientName,
  candidates: nonEmptyCandidates,
  comparison: nonEmptyComparison,
  decisions: {
    atomicEvents: [
      {
        ref: 'event-cause',
        action: 'reuse',
        existingId: existingEventId,
        appendAliases: ['供应中断'],
        appendKeywords: ['物流'],
        replaceDescription: '更新后的已有事件说明',
      },
      { ref: 'event-effect', action: 'create' },
    ],
    concreteCases: [],
    causalRelations: [
      {
        ref: 'relation-delay',
        action: 'reuse',
        existingId: existingRelationId,
      },
    ],
    relationCaseLinks: [],
  },
  summary: {
    ...counts,
    eventCreated: 1,
    eventReused: 1,
    eventUpdated: 1,
    relationReused: 1,
  },
};

const commitResult: AiImportCommitResult = {
  planId,
  historyId,
  marker: `[Causality-Capture: ${historyId}]`,
  noChanges: true,
  counts,
  completedAt: timestamp,
};

const batch: AiImportBatchDetail = {
  id: historyId,
  planId,
  topic: candidates.topic,
  planVersion: 1,
  clientName: candidates.clientName,
  completedAt: timestamp,
  counts,
};

class RecordingDependencies implements AiCaptureRouteDependencies {
  public compareCalls = 0;
  public prepareCalls = 0;

  public comparisonService = {
    compare: async (): Promise<AiCaptureComparison> => {
      this.compareCalls += 1;
      return comparison;
    },
  };

  public planService = {
    prepare: async (): Promise<AiImportPlan> => {
      this.prepareCalls += 1;
      return plan;
    },
    get: async (): Promise<AiImportPlan> => plan,
  };

  public commitService = {
    commit: async (): Promise<AiImportCommitResult> => commitResult,
  };

  public historyRepository = {
    list: async (): Promise<AiImportBatchListResponse> => ({
      items: [batch],
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
    }),
    findById: async (): Promise<AiImportBatchDetail | null> => batch,
    findResult: async (): Promise<AiImportCommitResult | null> => commitResult,
    listRecords: async (): Promise<AiImportRecordListResponse> => ({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
    }),
  };

  public authorizer = {
    authorize: async (candidate: string): Promise<boolean> => candidate === token,
  };
}

async function createApp(dependencies = new RecordingDependencies(), requestTimeoutMs = 100) {
  const app = Fastify({ logger: false });
  registerAiCaptureRoutes(app, dependencies, { requestTimeoutMs });
  await app.ready();
  return { app, dependencies };
}

describe('AI capture routes', () => {
  const apps: Array<Awaited<ReturnType<typeof createApp>>['app']> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('requires a valid MCP token for every workflow endpoint but not history', async () => {
    const { app } = await createApp();
    apps.push(app);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      payload: candidates,
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: { 'x-causality-mcp-token': 'b'.repeat(64) },
      payload: candidates,
    });
    const missingWithInvalidBody = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      payload: { topic: '' },
    });
    const history = await app.inject({
      method: 'GET',
      url: '/api/ai-captures/history?page=1',
    });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(missingWithInvalidBody.statusCode).toBe(401);
    expect(history.statusCode).toBe(200);
  });

  it('rejects 51 events through the shared schema before candidate comparison', async () => {
    const { app, dependencies } = await createApp();
    apps.push(app);
    const overLimit: AiCaptureCandidateSet = {
      ...candidates,
      atomicEvents: Array.from({ length: 51 }, (_, index) => ({
        ref: `event-${index}`,
        name: `事件 ${index}`,
        description: null,
        aliases: [],
        keywords: [],
      })),
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: { 'x-causality-mcp-token': token },
      payload: overLimit,
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.compareCalls).toBe(0);
  });

  it('rejects bodies above 8 MiB before comparison or plan creation', async () => {
    const { app, dependencies } = await createApp();
    apps.push(app);
    const oversized = JSON.stringify({
      ...candidates,
      unexpected: 'x'.repeat(8 * 1024 * 1024),
    });

    const compare = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: {
        'content-type': 'application/json',
        'x-causality-mcp-token': token,
      },
      payload: oversized,
    });
    const prepare = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/plans',
      headers: {
        'content-type': 'application/json',
        'x-causality-mcp-token': token,
      },
      payload: oversized,
    });

    expect(compare.statusCode).toBe(413);
    expect(prepare.statusCode).toBe(413);
    expect(dependencies.compareCalls).toBe(0);
    expect(dependencies.prepareCalls).toBe(0);
  });

  it('returns typed compare, plan, commit, result, history, detail, and record responses', async () => {
    const { app } = await createApp();
    apps.push(app);
    const auth = { 'x-causality-mcp-token': token };

    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/ai-captures/compare',
        headers: auth,
        payload: candidates,
      }),
      app.inject({
        method: 'POST',
        url: '/api/ai-captures/plans',
        headers: auth,
        payload: { candidates, comparison, decisions: plan.decisions },
      }),
      app.inject({ method: 'GET', url: `/api/ai-captures/plans/${planId}`, headers: auth }),
      app.inject({
        method: 'POST',
        url: `/api/ai-captures/plans/${planId}/commit`,
        headers: auth,
      }),
      app.inject({ method: 'GET', url: `/api/ai-captures/results/${historyId}`, headers: auth }),
      app.inject({ method: 'GET', url: '/api/ai-captures/history?page=1' }),
      app.inject({ method: 'GET', url: `/api/ai-captures/history/${historyId}` }),
      app.inject({
        method: 'GET',
        url: `/api/ai-captures/history/${historyId}/records?type=event&page=1`,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 201, 200, 200, 200, 200, 200, 200,
    ]);
    expect(responses[1]!.json()).toMatchObject({ id: planId });
    expect(responses[3]!.json()).toEqual(commitResult);
    expect(responses[4]!.json()).toEqual(commitResult);
  });

  it('serializes non-empty event and relation matches in a comparison response', async () => {
    const dependencies = new RecordingDependencies();
    dependencies.comparisonService.compare = async () => nonEmptyComparison;
    const { app } = await createApp(dependencies);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: { 'x-causality-mcp-token': token },
      payload: nonEmptyCandidates,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(nonEmptyComparison);
  });

  it('serializes non-empty candidates and decisions when creating and reading a plan', async () => {
    const dependencies = new RecordingDependencies();
    dependencies.planService.prepare = async () => nonEmptyPlan;
    dependencies.planService.get = async () => nonEmptyPlan;
    const { app } = await createApp(dependencies);
    apps.push(app);
    const auth = { 'x-causality-mcp-token': token };

    const created = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/plans',
      headers: auth,
      payload: {
        candidates: nonEmptyCandidates,
        comparison: nonEmptyComparison,
        decisions: nonEmptyPlan.decisions,
      },
    });
    const read = await app.inject({
      method: 'GET',
      url: `/api/ai-captures/plans/${planId}`,
      headers: auth,
    });

    expect(created.statusCode).toBe(201);
    expect(read.statusCode).toBe(200);
    expect(created.json()).toEqual(nonEmptyPlan);
    expect(read.json()).toEqual(nonEmptyPlan);
  });

  it('maps missing, conflicting, expired, and unavailable dependencies to stable HTTP statuses', async () => {
    const dependencies = new RecordingDependencies();
    let error: Error = new AiCaptureDataError('AI_PLAN_NOT_FOUND');
    dependencies.planService.get = async () => {
      throw error;
    };
    dependencies.comparisonService.compare = async () => {
      throw error;
    };
    const { app } = await createApp(dependencies);
    apps.push(app);
    const auth = { 'x-causality-mcp-token': token };

    const missing = await app.inject({
      method: 'GET',
      url: `/api/ai-captures/plans/${planId}`,
      headers: auth,
    });
    error = new AiCaptureDataError('AI_PLAN_COMPARISON_STALE', ['event-a']);
    const conflict = await app.inject({
      method: 'GET',
      url: `/api/ai-captures/plans/${planId}`,
      headers: auth,
    });
    error = new AiCaptureDataError('AI_PLAN_EXPIRED');
    const expired = await app.inject({
      method: 'GET',
      url: `/api/ai-captures/plans/${planId}`,
      headers: auth,
    });
    error = new SemanticQueryError('SEMANTIC_MODEL_UNAVAILABLE');
    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: auth,
      payload: candidates,
    });

    expect([
      missing.statusCode,
      conflict.statusCode,
      expired.statusCode,
      unavailable.statusCode,
    ]).toEqual([404, 409, 410, 503]);
    expect(conflict.json()).toMatchObject({
      category: 'data',
      code: 'AI_PLAN_COMPARISON_STALE',
      affectedRefs: ['event-a'],
      aiCanRepair: true,
      retryCurrentPlan: false,
    });
    expect(unavailable.json()).toMatchObject({
      category: 'configuration',
      code: 'SEMANTIC_MODEL_UNAVAILABLE',
      aiCanRepair: false,
    });
  });

  it.each([
    ['replaced', 409, 'AI_PLAN_NOT_LATEST'],
    ['invalidated', 409, 'AI_PLAN_DEPENDENCY_CHANGED'],
    ['expired', 410, 'AI_PLAN_EXPIRED'],
  ] as const)(
    'maps a %s plan returned by the repository to a workflow error',
    async (status, expectedStatus, expectedCode) => {
      const dependencies = new RecordingDependencies();
      dependencies.planService.get = async () => ({ ...plan, status });
      const { app } = await createApp(dependencies);
      apps.push(app);

      const response = await app.inject({
        method: 'GET',
        url: `/api/ai-captures/plans/${planId}`,
        headers: { 'x-causality-mcp-token': token },
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json()).toMatchObject({
        category: 'data',
        code: expectedCode,
        affectedRefs: [planId],
        aiCanRepair: true,
        retryCurrentPlan: false,
      });
    },
  );

  it('bounds compare and prepare execution time', async () => {
    const dependencies = new RecordingDependencies();
    dependencies.comparisonService.compare = () => new Promise(() => {});
    const { app } = await createApp(dependencies, 5);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: { 'x-causality-mcp-token': token },
      payload: candidates,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      category: 'system',
      code: 'AI_REQUEST_TIMEOUT',
      aiCanRepair: false,
      retryCurrentPlan: true,
    });
  });

  it('returns 400 for malformed JSON and 404 for missing history or result', async () => {
    const dependencies = new RecordingDependencies();
    dependencies.historyRepository.findById = async () => null;
    dependencies.historyRepository.findResult = async () => null;
    const { app } = await createApp(dependencies);
    apps.push(app);

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/ai-captures/compare',
      headers: {
        'content-type': 'application/json',
        'x-causality-mcp-token': token,
      },
      payload: '{"topic":',
    });
    const missingHistory = await app.inject({
      method: 'GET',
      url: `/api/ai-captures/history/${historyId}`,
    });
    const missingResult = await app.inject({
      method: 'GET',
      url: `/api/ai-captures/results/${historyId}`,
      headers: { 'x-causality-mcp-token': token },
    });

    expect(malformed.statusCode).toBe(400);
    expect(missingHistory.statusCode).toBe(404);
    expect(missingResult.statusCode).toBe(404);
  });
});
