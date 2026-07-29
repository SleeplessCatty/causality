import type { CausalEvidenceCase, CausalPathEvent } from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import type {
  CausalEvidenceBundleRepository,
  CausalEvidenceBundleSnapshot,
  EvidenceCasesByRelation,
  EvidenceRelationRecord,
} from './causalEvidenceBundleTypes.js';

interface RelationRow {
  id: string;
  cause_event_id: string;
  cause_event_name: string;
  effect_event_id: string;
  effect_event_name: string;
  description: string | null;
  confidence: number | string;
}

interface CaseRow {
  relation_id: string;
  id: string;
  content: string;
  linked_at: Date;
  total_count: number | string;
}

function event(id: string, name: string): CausalPathEvent {
  return { id, name };
}

function relation(row: RelationRow): EvidenceRelationRecord {
  return {
    id: row.id,
    causeEvent: event(row.cause_event_id, row.cause_event_name),
    effectEvent: event(row.effect_event_id, row.effect_event_name),
    description: row.description,
    confidence: Number(row.confidence),
  };
}

function evidenceCase(row: CaseRow): CausalEvidenceCase {
  return {
    id: row.id,
    content: row.content,
    linkedAt: row.linked_at.toISOString(),
  };
}

class PostgresCausalEvidenceBundleSnapshot implements CausalEvidenceBundleSnapshot {
  public constructor(private readonly client: PoolClient) {}

  public async findRelations(ids: string[]): Promise<EvidenceRelationRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.client.query<RelationRow>(
      [
        'select r.id,',
        'r.cause_event_id,',
        'cause.name as cause_event_name,',
        'r.effect_event_id,',
        'effect.name as effect_event_name,',
        'r.description,',
        'r.confidence',
        'from causal_relations r',
        'join abstract_events cause on cause.id = r.cause_event_id',
        'join abstract_events effect on effect.id = r.effect_event_id',
        'where r.id = any($1::uuid[])',
      ].join(' '),
      [ids],
    );
    return result.rows.map(relation);
  }

  public async findCasesByRelationIds(
    ids: string[],
    limitPerRelation: number,
  ): Promise<EvidenceCasesByRelation[]> {
    if (ids.length === 0) return [];
    const result = await this.client.query<CaseRow>(
      [
        'with ranked_cases as (',
        'select crc.causal_relation_id as relation_id,',
        'c.id,',
        'c.content,',
        'crc.linked_at,',
        'count(*) over (partition by crc.causal_relation_id)::int as total_count,',
        'row_number() over (',
        'partition by crc.causal_relation_id',
        'order by crc.linked_at desc, c.id',
        ') as row_number',
        'from causal_relation_cases crc',
        'join concrete_cases c on c.id = crc.concrete_case_id',
        'where crc.causal_relation_id = any($1::uuid[])',
        ')',
        'select relation_id, id, content, linked_at, total_count',
        'from ranked_cases',
        'where row_number <= $2',
        'order by relation_id, row_number',
      ].join(' '),
      [ids, limitPerRelation],
    );

    const groups = new Map<string, EvidenceCasesByRelation>();
    for (const row of result.rows) {
      const group = groups.get(row.relation_id);
      if (group) {
        group.cases.push(evidenceCase(row));
      } else {
        groups.set(row.relation_id, {
          relationId: row.relation_id,
          totalCount: Number(row.total_count),
          cases: [evidenceCase(row)],
        });
      }
    }
    return [...groups.values()];
  }
}

export class PostgresCausalEvidenceBundleRepository implements CausalEvidenceBundleRepository {
  public constructor(private readonly pool: Pool) {}

  public async withSnapshot<T>(
    operation: (snapshot: CausalEvidenceBundleSnapshot) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const result = await operation(new PostgresCausalEvidenceBundleSnapshot(client));
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
