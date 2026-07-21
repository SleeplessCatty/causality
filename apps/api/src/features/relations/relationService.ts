import type {
  RelationDetail,
  RelationFormInput,
  RelationListQuery,
  RelationListResponse,
  RelationPairCheckQuery,
  RelationPairCheckResponse,
} from '@causality/contracts';

import type { RelationRepository } from './relationRepository.js';
import {
  RelationCaseContentConflictError,
  RelationCaseNotFoundError,
} from './relationRepository.js';

export type RelationServiceErrorCode =
  | 'RELATION_NOT_FOUND'
  | 'RELATION_EVENT_NOT_FOUND'
  | 'RELATION_SELF_LOOP'
  | 'RELATION_DIRECTION_CONFLICT'
  | 'CASE_NOT_FOUND'
  | 'CASE_CONTENT_CONFLICT';

export class RelationServiceError extends Error {
  constructor(
    readonly code: RelationServiceErrorCode,
    message: string,
    readonly field?: 'causeEventId' | 'effectEventId',
    readonly existingId?: string,
  ) {
    super(message);
    this.name = 'RelationServiceError';
  }
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

function mapWriteError(error: unknown): never {
  if (error instanceof RelationCaseNotFoundError) {
    throw new RelationServiceError('CASE_NOT_FOUND', '所选案例不存在');
  }
  if (error instanceof RelationCaseContentConflictError) {
    throw new RelationServiceError(
      'CASE_CONTENT_CONFLICT',
      '案例内容已存在',
      undefined,
      error.existingId,
    );
  }
  const databaseError = error as PostgreSqlError;
  if (
    databaseError.code === '23505' &&
    databaseError.constraint === 'causal_relations_direction_uidx'
  ) {
    throw new RelationServiceError('RELATION_DIRECTION_CONFLICT', '该方向的因果关系已存在');
  }
  if (databaseError.code === '23503') {
    throw new RelationServiceError('RELATION_EVENT_NOT_FOUND', '所选事件不存在');
  }
  if (
    databaseError.code === '23514' &&
    databaseError.constraint === 'causal_relations_no_self_loop_check'
  ) {
    throw new RelationServiceError(
      'RELATION_SELF_LOOP',
      '原因事件和结果事件不能相同',
      'effectEventId',
    );
  }
  throw error;
}

export class RelationService {
  constructor(private readonly repository: RelationRepository) {}

  list(query: RelationListQuery): Promise<RelationListResponse> {
    return this.repository.list(query);
  }

  checkPair(query: RelationPairCheckQuery): Promise<RelationPairCheckResponse> {
    return this.repository.checkPair(query);
  }

  async findById(id: string): Promise<RelationDetail> {
    const relation = await this.repository.findById(id);
    if (!relation) throw new RelationServiceError('RELATION_NOT_FOUND', '因果关系不存在');
    return relation;
  }

  async create(input: RelationFormInput): Promise<RelationDetail> {
    try {
      return await this.repository.create(input);
    } catch (error) {
      return mapWriteError(error);
    }
  }

  async replace(id: string, input: RelationFormInput): Promise<RelationDetail> {
    try {
      const relation = await this.repository.replace(id, input);
      if (!relation) throw new RelationServiceError('RELATION_NOT_FOUND', '因果关系不存在');
      return relation;
    } catch (error) {
      if (error instanceof RelationServiceError) throw error;
      return mapWriteError(error);
    }
  }
}
