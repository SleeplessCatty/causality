import type { DataCheckIssueType, DataCheckTargetType } from '@causality/contracts';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  loadDataCheckIssueSources,
  type DataCheckIssueSourceInput,
} from '../src/features/data-checks/dataCheckIssueSource.js';

const eventA = '10000000-0000-4000-8000-000000000002';
const eventB = '10000000-0000-4000-8000-000000000003';
const caseA = '20000000-0000-4000-8000-000000000001';
const caseB = '20000000-0000-4000-8000-000000000002';
const relationId = '30000000-0000-4000-8000-000000000001';
const aliasId = '40000000-0000-4000-8000-000000000001';

function issue(
  id: string,
  issueType: DataCheckIssueType,
  targetType: DataCheckTargetType,
  targetId: string,
  relatedId: string | null = null,
): DataCheckIssueSourceInput {
  return { id, issueType, targetType, targetId, relatedId };
}

function sourceClient(): { client: PoolClient; queries: string[] } {
  const queries: string[] = [];
  const client = {
    async query(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
      queries.push(sql);
      if (sql.includes('from event_aliases')) {
        return {
          rows: [
            {
              id: aliasId,
              event_id: eventA,
              value: '需求走弱',
              owner_name: '市场需求下降',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('from event_keywords')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('from causal_relations')) {
        return {
          rows: [
            {
              id: relationId,
              cause_event_id: eventA,
              cause_name: '供应中断',
              effect_event_id: eventA,
              effect_name: '供应中断',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('from causal_relation_cases')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('from abstract_events')) {
        return {
          rows: [
            { id: eventA, label: '供应中断' },
            { id: eventB, label: '物流周期延长' },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('from concrete_cases')) {
        return {
          rows: [
            { id: caseA, label: '案例 A' },
            { id: caseB, label: '案例 B' },
          ],
          rowCount: 2,
        };
      }
      throw new Error(`Unexpected source query: ${sql}`);
    },
  } as PoolClient;
  return { client, queries };
}

describe('data-check issue sources', () => {
  it('builds readable pair, relation, and owned-value sources', async () => {
    const { client } = sourceClient();
    const sources = await loadDataCheckIssueSources(client, [
      issue(
        '50000000-0000-4000-8000-000000000001',
        'duplicate_event_name',
        'event',
        eventA,
        eventB,
      ),
      issue('50000000-0000-4000-8000-000000000002', 'duplicate_case_content', 'case', caseA, caseB),
      issue('50000000-0000-4000-8000-000000000003', 'relation_self_loop', 'relation', relationId),
      issue('50000000-0000-4000-8000-000000000004', 'invalid_alias_text', 'alias', aliasId, eventA),
    ]);

    expect(sources.get('50000000-0000-4000-8000-000000000001')).toMatchObject({
      displayKind: 'pair',
      items: [
        { type: 'event', label: '供应中断', detailPath: `/events/${eventA}` },
        { type: 'event', label: '物流周期延长', detailPath: `/events/${eventB}` },
      ],
    });
    expect(sources.get('50000000-0000-4000-8000-000000000002')).toMatchObject({
      displayKind: 'pair',
      items: [
        { type: 'case', label: '案例 A', detailPath: `/cases/${caseA}` },
        { type: 'case', label: '案例 B', detailPath: `/cases/${caseB}` },
      ],
    });
    expect(sources.get('50000000-0000-4000-8000-000000000003')).toMatchObject({
      displayKind: 'relation',
      items: [
        { role: 'cause', label: '供应中断' },
        { role: 'effect', label: '供应中断' },
      ],
      relationDetailPaths: [`/relations/${relationId}`],
    });
    expect(sources.get('50000000-0000-4000-8000-000000000004')).toMatchObject({
      displayKind: 'owned_value',
      items: [
        { role: 'owner', label: '市场需求下降', detailPath: `/events/${eventA}` },
        { role: 'value', label: '需求走弱', detailPath: null },
      ],
    });
  });

  it('uses a fixed six-query source load for one or fifty rows', async () => {
    const one = sourceClient();
    await loadDataCheckIssueSources(one.client, [
      issue('50000000-0000-4000-8000-000000000010', 'invalid_event_name', 'event', eventA),
    ]);
    const fifty = sourceClient();
    await loadDataCheckIssueSources(
      fifty.client,
      Array.from({ length: 50 }, (_value, index) =>
        issue(
          `50000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
          'invalid_event_name',
          'event',
          index % 2 === 0 ? eventA : eventB,
        ),
      ),
    );

    expect(one.queries).toHaveLength(6);
    expect(fifty.queries).toHaveLength(6);
  });

  it('uses readable missing states instead of leaking raw ids', async () => {
    const { client } = sourceClient();
    const missingId = '90000000-0000-4000-8000-000000000001';
    const sources = await loadDataCheckIssueSources(client, [
      issue(
        '50000000-0000-4000-8000-000000000020',
        'missing_relation_cause_event',
        'relation',
        missingId,
      ),
    ]);
    const source = sources.get('50000000-0000-4000-8000-000000000020');

    expect(source?.displayKind).toBe('broken_reference');
    expect(JSON.stringify(source)).not.toContain(missingId);
    expect(source?.items.some((item) => item.type === 'missing')).toBe(true);
  });
});
