import type { CausalPathEvent, CausalPathRelation } from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import type {
  CausalPathFilters,
  CausalPathRepository,
  CausalPathSnapshot,
} from './causalPathTypes.js';

interface EventRow {
  id: string;
  name: string;
}

interface RelationRow {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  confidence: number | string;
  case_count: number | string;
}

function mapRelation(row: RelationRow): CausalPathRelation {
  return {
    id: row.id,
    causeEventId: row.cause_event_id,
    effectEventId: row.effect_event_id,
    confidence: Number(row.confidence),
    caseCount: Number(row.case_count),
  };
}

class PostgresCausalPathSnapshot implements CausalPathSnapshot {
  public constructor(private readonly client: PoolClient) {}

  public async findEvents(ids: string[]): Promise<CausalPathEvent[]> {
    if (ids.length === 0) return [];
    const result = await this.client.query<EventRow>(
      ['select id, name', 'from abstract_events', 'where id = any($1::uuid[])'].join(' '),
      [ids],
    );
    return result.rows;
  }

  public async findOutgoingRelations(
    causeEventIds: string[],
    filters: CausalPathFilters,
    limit: number,
  ): Promise<CausalPathRelation[]> {
    if (causeEventIds.length === 0 || limit <= 0) return [];
    const result = await this.client.query<RelationRow>(
      [
        'select r.id,',
        'r.cause_event_id,',
        'r.effect_event_id,',
        'r.confidence,',
        'count(crc.concrete_case_id)::int as case_count',
        'from causal_relations r',
        'left join causal_relation_cases crc',
        'on crc.causal_relation_id = r.id',
        'where r.cause_event_id = any($1::uuid[])',
        'and r.confidence >= $2',
        'group by r.id',
        'having count(crc.concrete_case_id) >= $3',
        'order by r.cause_event_id, r.id',
        'limit $4',
      ].join(' '),
      [causeEventIds, filters.minConfidence, filters.minCaseCount, limit],
    );
    return result.rows.map(mapRelation);
  }
}

export class PostgresCausalPathRepository implements CausalPathRepository {
  public constructor(private readonly pool: Pool) {}

  public async withSnapshot<T>(
    operation: (snapshot: CausalPathSnapshot) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const result = await operation(new PostgresCausalPathSnapshot(client));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
