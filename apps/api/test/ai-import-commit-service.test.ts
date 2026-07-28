import type { AiImportCommitResult, AiWorkflowError } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import { AiCaptureDataError } from '../src/features/ai-capture/aiCaptureErrors.js';
import {
  AiImportCommitService,
  type AiImportCommitRepository,
} from '../src/features/ai-capture/aiImportCommitService.js';
import { AiImportCommitError } from '../src/features/ai-capture/aiWorkflowErrorClassifier.js';

const planId = '10000000-0000-4000-8000-000000000001';
const historyId = '20000000-0000-4000-8000-000000000001';

const committedResult: AiImportCommitResult = {
  planId,
  historyId,
  marker: `[Causality-Capture: ${historyId}]`,
  noChanges: true,
  counts: {
    eventCreated: 0,
    eventReused: 0,
    eventUpdated: 0,
    caseCreated: 0,
    caseReused: 0,
    relationCreated: 0,
    relationReused: 0,
    relationCaseCreated: 0,
    confidenceChanged: 0,
  },
  completedAt: '2026-07-28T12:00:00.000Z',
};

class RecordingRepository implements AiImportCommitRepository {
  public failure: AiWorkflowError | null = null;

  public constructor(
    private readonly outcome: AiImportCommitResult | Error,
    private readonly failureWriteError?: Error,
  ) {}

  public async commit(): Promise<AiImportCommitResult> {
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }

  public async recordFailure(_planId: string, error: AiWorkflowError): Promise<void> {
    this.failure = error;
    if (this.failureWriteError) throw this.failureWriteError;
  }
}

describe('AI import commit service', () => {
  it('returns the exact repository result for a successful no-change commit', async () => {
    const repository = new RecordingRepository(committedResult);
    const service = new AiImportCommitService(repository);

    await expect(service.commit(planId)).resolves.toEqual(committedResult);
    expect(repository.failure).toBeNull();
  });

  it('classifies a data conflict as repairable and persists the failed state', async () => {
    const repository = new RecordingRepository(
      new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', ['event-a']),
    );
    const service = new AiImportCommitService(repository);

    const error = await service.commit(planId).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiImportCommitError);
    expect((error as AiImportCommitError).workflowError).toEqual({
      category: 'data',
      code: 'AI_PLAN_UNIQUE_CONFLICT',
      message: '入库数据与当前数据库内容冲突，需要重新生成入库方案',
      affectedRefs: ['event-a'],
      aiCanRepair: true,
      retryCurrentPlan: false,
      suggestedAction: '根据当前数据库内容重新对比并生成新的入库方案',
    });
    expect(repository.failure).toEqual((error as AiImportCommitError).workflowError);
  });

  it('classifies a PostgreSQL failure as a retryable system error', async () => {
    const databaseError = Object.assign(new Error('connection reset'), { code: '08006' });
    const repository = new RecordingRepository(databaseError);
    const service = new AiImportCommitService(repository);

    const error = await service.commit(planId).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiImportCommitError);
    expect((error as AiImportCommitError).workflowError).toEqual({
      category: 'system',
      code: 'AI_COMMIT_DATABASE_UNAVAILABLE',
      message: '数据库暂时不可用，当前入库方案尚未成功执行',
      affectedRefs: [],
      aiCanRepair: false,
      retryCurrentPlan: true,
      suggestedAction: '恢复数据库连接后重新提交当前入库方案',
    });
    expect(repository.failure).toEqual((error as AiImportCommitError).workflowError);
  });

  it('returns the original structured system error when the best-effort status write also fails', async () => {
    const repository = new RecordingRepository(
      new Error('unexpected commit failure'),
      new Error('database is completely unavailable'),
    );
    const service = new AiImportCommitService(repository);

    const error = await service.commit(planId).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiImportCommitError);
    expect((error as AiImportCommitError).workflowError).toMatchObject({
      category: 'system',
      code: 'AI_COMMIT_SYSTEM_FAILURE',
      retryCurrentPlan: true,
    });
  });
});
