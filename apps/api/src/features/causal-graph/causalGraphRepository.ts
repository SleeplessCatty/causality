import type { CausalGraphNode, CausalGraphQuery, CausalGraphRelation } from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import type {
  CausalGraphFilters,
  CausalGraphRepository,
  CausalGraphSnapshot,
} from './causalGraphTypes.js';

interface EventRow {
  id: string;
  name: string;
}

interface RelationRow {
  id: string;
  cause_event_id: string;
  effect_event_id: string;
  confidence: number;
  case_count: number;
}

function mapRelation(row: RelationRow): CausalGraphRelation {
  return {
    id: row.id,
    causeEventId: row.cause_event_id,
    effectEventId: row.effect_event_id,
    confidence: row.confidence,
    caseCount: Number(row.case_count),
  };
}

class PostgresCausalGraphSnapshot implements CausalGraphSnapshot {
  constructor(private readonly client: PoolClient) {}

  async findEvent(id: string): Promise<CausalGraphNode | null> {
    const result = await this.client.query<EventRow>(
      `select id, name
       from abstract_events
       where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findEvents(ids: string[]): Promise<CausalGraphNode[]> {
    if (ids.length === 0) return [];
    const result = await this.client.query<EventRow>(
      `select id, name
       from abstract_events
       where id = any($1::uuid[])`,
      [ids],
    );
    return result.rows;
  }

  async findAdjacentRelations(
    eventIds: string[],
    direction: CausalGraphQuery['direction'],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]> {
    if (eventIds.length === 0) return [];
    const directionCondition =
      direction === 'upstream'
        ? 'r.effect_event_id = any($1::uuid[])'
        : direction === 'downstream'
          ? 'r.cause_event_id = any($1::uuid[])'
          : '(r.cause_event_id = any($1::uuid[]) or r.effect_event_id = any($1::uuid[]))';
    const result = await this.client.query<RelationRow>(
      `select r.id,
              r.cause_event_id,
              r.effect_event_id,
              r.confidence,
              count(crc.concrete_case_id)::int as case_count
       from causal_relations r
       left join causal_relation_cases crc on crc.causal_relation_id = r.id
       where ${directionCondition}
         and r.confidence >= $2
       group by r.id
       having count(crc.concrete_case_id) >= $3
       order by r.confidence desc, case_count desc, r.id asc`,
      [eventIds, filters.minConfidence, filters.minCaseCount],
    );
    return result.rows.map(mapRelation);
  }

  async findRelationsBetween(
    eventIds: string[],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]> {
    if (eventIds.length === 0) return [];
    const result = await this.client.query<RelationRow>(
      `select r.id,
              r.cause_event_id,
              r.effect_event_id,
              r.confidence,
              count(crc.concrete_case_id)::int as case_count
       from causal_relations r
       left join causal_relation_cases crc on crc.causal_relation_id = r.id
       where r.cause_event_id = any($1::uuid[])
         and r.effect_event_id = any($1::uuid[])
         and r.confidence >= $2
       group by r.id
       having count(crc.concrete_case_id) >= $3
       order by r.confidence desc, case_count desc, r.id asc`,
      [eventIds, filters.minConfidence, filters.minCaseCount],
    );
    return result.rows.map(mapRelation);
  }
}

export class PostgresCausalGraphRepository implements CausalGraphRepository {
  constructor(private readonly pool: Pool) {}

  async withSnapshot<T>(operation: (snapshot: CausalGraphSnapshot) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const result = await operation(new PostgresCausalGraphSnapshot(client));
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
