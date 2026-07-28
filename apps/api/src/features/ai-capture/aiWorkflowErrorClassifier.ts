import type { AiWorkflowError } from '@causality/contracts';

import { AiCaptureDataError } from './aiCaptureErrors.js';

interface ErrorWithCode extends Error {
  code?: string;
}

const databaseConnectionCodes = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
]);

const dataConflictCodes = new Set(['22000', '22001', '23502', '23503', '23505', '23514']);

function postgresCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return (error as ErrorWithCode).code;
}

export class AiImportCommitError extends Error {
  public constructor(
    public readonly workflowError: AiWorkflowError,
    options?: ErrorOptions,
  ) {
    super(workflowError.message, options);
    this.name = 'AiImportCommitError';
  }
}

export function classifyAiImportCommitError(error: unknown): AiWorkflowError {
  if (error instanceof AiImportCommitError) return error.workflowError;

  if (error instanceof AiCaptureDataError) {
    return {
      category: 'data',
      code: error.code,
      message: '入库数据与当前数据库内容冲突，需要重新生成入库方案',
      affectedRefs: error.affectedRefs,
      aiCanRepair: true,
      retryCurrentPlan: false,
      suggestedAction: '根据当前数据库内容重新对比并生成新的入库方案',
    };
  }

  const code = postgresCode(error);
  if (code && databaseConnectionCodes.has(code)) {
    return {
      category: 'system',
      code: 'AI_COMMIT_DATABASE_UNAVAILABLE',
      message: '数据库暂时不可用，当前入库方案尚未成功执行',
      affectedRefs: [],
      aiCanRepair: false,
      retryCurrentPlan: true,
      suggestedAction: '恢复数据库连接后重新提交当前入库方案',
    };
  }
  if (code && dataConflictCodes.has(code)) {
    return {
      category: 'data',
      code: 'AI_COMMIT_DATA_CONFLICT',
      message: '提交时发现数据冲突，需要重新生成入库方案',
      affectedRefs: [],
      aiCanRepair: true,
      retryCurrentPlan: false,
      suggestedAction: '重新查询当前数据库内容并生成新的入库方案',
    };
  }

  return {
    category: 'system',
    code: 'AI_COMMIT_SYSTEM_FAILURE',
    message: '系统执行入库时发生错误，当前入库方案尚未成功执行',
    affectedRefs: [],
    aiCanRepair: false,
    retryCurrentPlan: true,
    suggestedAction: '处理系统故障后重新提交当前入库方案',
  };
}
