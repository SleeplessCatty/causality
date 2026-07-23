import type {
  CaseDeletionImpact,
  CaseCandidateListResponse,
  CaseCandidateQuery,
  CaseDetail,
  CaseFormInput,
  CaseListQuery,
  CaseListResponse,
  CaseRelationListQuery,
  CaseRelationListResponse,
  DeleteResult,
} from '@causality/contracts';

import type { CaseRepository } from './caseRepository.js';

export type CaseServiceErrorCode = 'CASE_NOT_FOUND' | 'CASE_CONTENT_CONFLICT';

export class CaseServiceError extends Error {
  constructor(
    readonly code: CaseServiceErrorCode,
    message: string,
    readonly existingId?: string,
  ) {
    super(message);
    this.name = 'CaseServiceError';
  }
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

export class CaseService {
  constructor(private readonly repository: CaseRepository) {}

  list(query: CaseListQuery): Promise<CaseListResponse> {
    return this.repository.list(query);
  }

  candidates(query: CaseCandidateQuery): Promise<CaseCandidateListResponse> {
    return this.repository.candidates(query);
  }

  async findById(id: string): Promise<CaseDetail> {
    const found = await this.repository.findById(id);
    if (!found) throw new CaseServiceError('CASE_NOT_FOUND', '案例不存在');
    return found;
  }

  async listRelations(id: string, query: CaseRelationListQuery): Promise<CaseRelationListResponse> {
    await this.findById(id);
    return this.repository.listRelations(id, query);
  }

  async create(input: CaseFormInput): Promise<CaseDetail> {
    try {
      return await this.repository.create(input);
    } catch (error) {
      return this.mapWriteError(error, input.content);
    }
  }

  async replace(id: string, input: CaseFormInput): Promise<CaseDetail> {
    try {
      const found = await this.repository.replace(id, input);
      if (!found) throw new CaseServiceError('CASE_NOT_FOUND', '案例不存在');
      return found;
    } catch (error) {
      if (error instanceof CaseServiceError) throw error;
      return this.mapWriteError(error, input.content);
    }
  }

  private async mapWriteError(error: unknown, content: string): Promise<never> {
    const databaseError = error as PostgreSqlError;
    if (
      databaseError.code === '23505' &&
      databaseError.constraint === 'concrete_cases_content_uidx'
    ) {
      const existing = await this.repository.findByContent(content);
      throw new CaseServiceError('CASE_CONTENT_CONFLICT', '案例内容已存在', existing?.id);
    }
    throw error;
  }

  async deletionImpact(id: string): Promise<CaseDeletionImpact> {
    const impact = await this.repository.deletionImpact(id);
    if (!impact) throw new CaseServiceError('CASE_NOT_FOUND', '案例不存在');
    return impact;
  }

  async delete(id: string): Promise<DeleteResult> {
    if (!(await this.repository.delete(id))) {
      throw new CaseServiceError('CASE_NOT_FOUND', '案例不存在');
    }
    return { deleted: true };
  }
}
