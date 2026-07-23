import type {
  DeleteResult,
  EventCandidateListResponse,
  EventCandidateQuery,
  EventDeletionImpact,
  EventDetail,
  EventFormInput,
  EventListQuery,
  EventListResponse,
  EventRelationListQuery,
  EventRelationListResponse,
} from '@causality/contracts';

import type { EventRepository } from './eventRepository.js';

export type EventServiceErrorCode =
  'EVENT_NOT_FOUND' | 'EVENT_NAME_CONFLICT' | 'EVENT_ALIAS_CONFLICT' | 'EVENT_DELETE_BLOCKED';

export class EventServiceError extends Error {
  constructor(
    readonly code: EventServiceErrorCode,
    message: string,
    readonly field?: 'name' | 'aliases',
  ) {
    super(message);
    this.name = 'EventServiceError';
  }
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

function mapWriteError(error: unknown): never {
  const databaseError = error as PostgreSqlError;
  if (
    databaseError.code === '23505' &&
    databaseError.constraint === 'abstract_events_normalized_name_uidx'
  ) {
    throw new EventServiceError('EVENT_NAME_CONFLICT', '该标准名称已被使用', 'name');
  }
  if (
    databaseError.code === '23505' &&
    databaseError.constraint === 'event_aliases_event_normalized_uidx'
  ) {
    throw new EventServiceError('EVENT_ALIAS_CONFLICT', '同一事件不能有重复别名', 'aliases');
  }
  throw error;
}

export class EventService {
  constructor(private readonly repository: EventRepository) {}

  list(query: EventListQuery): Promise<EventListResponse> {
    return this.repository.list(query);
  }

  findCandidates(query: EventCandidateQuery): Promise<EventCandidateListResponse> {
    return this.repository.findCandidates(query);
  }

  async findById(id: string): Promise<EventDetail> {
    const event = await this.repository.findById(id);
    if (!event) throw new EventServiceError('EVENT_NOT_FOUND', '事件不存在');
    return event;
  }

  async listRelations(
    id: string,
    query: EventRelationListQuery,
  ): Promise<EventRelationListResponse> {
    if (!(await this.repository.existsById(id))) {
      throw new EventServiceError('EVENT_NOT_FOUND', '事件不存在');
    }
    return this.repository.listRelations(id, query);
  }

  async create(input: EventFormInput): Promise<EventDetail> {
    try {
      return await this.repository.create(input);
    } catch (error) {
      return mapWriteError(error);
    }
  }

  async replace(id: string, input: EventFormInput): Promise<EventDetail> {
    try {
      const event = await this.repository.replace(id, input);
      if (!event) throw new EventServiceError('EVENT_NOT_FOUND', '事件不存在');
      return event;
    } catch (error) {
      if (error instanceof EventServiceError) throw error;
      return mapWriteError(error);
    }
  }

  async deletionImpact(id: string): Promise<EventDeletionImpact> {
    const impact = await this.repository.deletionImpact(id);
    if (!impact) throw new EventServiceError('EVENT_NOT_FOUND', '事件不存在');
    return impact;
  }

  async delete(id: string): Promise<DeleteResult> {
    try {
      if (!(await this.repository.delete(id))) {
        throw new EventServiceError('EVENT_NOT_FOUND', '事件不存在');
      }
      return { deleted: true };
    } catch (error) {
      if (error instanceof EventServiceError) throw error;
      if ((error as { code?: string }).code === 'EVENT_DELETE_BLOCKED') {
        throw new EventServiceError(
          'EVENT_DELETE_BLOCKED',
          '这个原子事件存在关联因果关系，必须先删除相关因果关系',
        );
      }
      throw error;
    }
  }
}
