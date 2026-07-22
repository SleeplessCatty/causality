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

interface NeighborRow {
  neighbor_id: string;
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

  async findAdjacentEventIds(
    frontierIds: string[],
    visitedIds: string[],
    direction: CausalGraphQuery['direction'],
    filters: CausalGraphFilters,
    limit: number,
  ): Promise<string[]> {
    if (frontierIds.length === 0 || limit <= 0) return [];
    const directionCondition =
      direction === 'upstream'
        ? 'r.effect_event_id = any($1::uuid[])'
        : direction === 'downstream'
          ? 'r.cause_event_id = any($1::uuid[])'
          : '(r.cause_event_id = any($1::uuid[]) or r.effect_event_id = any($1::uuid[]))';
    const neighborExpression =
      direction === 'upstream'
        ? 'r.cause_event_id'
        : direction === 'downstream'
          ? 'r.effect_event_id'
          : `case
               when r.cause_event_id = any($1::uuid[]) then r.effect_event_id
               else r.cause_event_id
             end`;
    const result = await this.client.query<NeighborRow>(
      `with adjacent as (
         select ${neighborExpression} as neighbor_id,
                r.confidence,
                count(crc.concrete_case_id)::int as case_count,
                r.id as relation_id
         from causal_relations r
         left join causal_relation_cases crc on crc.causal_relation_id = r.id
         where ${directionCondition}
           and r.confidence >= $3
         group by r.id, ${neighborExpression}
         having count(crc.concrete_case_id) >= $4
       ),
       ranked as (
         select neighbor_id,
                row_number() over (
                  partition by neighbor_id
                  order by confidence desc, case_count desc, relation_id asc
                ) as neighbor_rank,
                confidence,
                case_count,
                relation_id
         from adjacent
         where not (neighbor_id = any($2::uuid[]))
       )
       select neighbor_id
       from ranked
       where neighbor_rank = 1
       order by confidence desc, case_count desc, relation_id asc, neighbor_id asc
       limit $5`,
      [frontierIds, visitedIds, filters.minConfidence, filters.minCaseCount, limit],
    );
    return result.rows.map((row) => row.neighbor_id);
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
