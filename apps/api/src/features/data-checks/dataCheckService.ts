import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  DataCheckIssueDraft,
  DataCheckRule,
  DataCheckScanResult,
  DataCheckSemanticResult,
  DataCheckSemanticRule,
  DataCheckScanner,
} from './dataCheckTypes.js';

interface DataCheckServiceOptions {
  createSnapshotId?: () => string;
  now?: () => Date;
  semanticRule?: DataCheckSemanticRule;
}

interface OrphanCountRow {
  orphan_event_count: string;
  orphan_relation_count: string;
  orphan_case_count: string;
}

const orphanCountsSql = `
select
  (
    select count(*)
    from abstract_events event
    where not exists (
      select 1
      from causal_relations relation
      where relation.cause_event_id = event.id
         or relation.effect_event_id = event.id
    )
  )::text as orphan_event_count,
  (
    select count(*)
    from causal_relations relation
    where not exists (
      select 1
      from causal_relation_cases relation_case
      where relation_case.causal_relation_id = relation.id
    )
  )::text as orphan_relation_count,
  (
    select count(*)
    from concrete_cases concrete_case
    where not exists (
      select 1
      from causal_relation_cases relation_case
      where relation_case.concrete_case_id = concrete_case.id
    )
  )::text as orphan_case_count
`;

function assertCompactDraft(draft: DataCheckIssueDraft): void {
  for (const value of [draft.description, draft.suggestion]) {
    if (value.length > 300 || /<[^>]*>/.test(value)) {
      throw new Error(`Invalid compact issue copy for ${draft.issueType}`);
    }
  }
}

export class DataCheckService implements DataCheckScanner {
  private readonly createSnapshotId: () => string;
  private readonly now: () => Date;
  private readonly semanticRule: DataCheckSemanticRule | undefined;

  public constructor(
    private readonly pool: Pool,
    private readonly rules: readonly DataCheckRule[],
    options: DataCheckServiceOptions = {},
  ) {
    this.createSnapshotId = options.createSnapshotId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.semanticRule = options.semanticRule;
  }

  private async scanSemantic(): Promise<{ issues: DataCheckIssueDraft[]; semantic: DataCheckSemanticResult }> {
    if (!this.semanticRule) {
      return {
        issues: [],
        semantic: { status: 'skipped', reason: 'not_recorded', issueCount: 0 },
      };
    }
    try {
      return await this.semanticRule.scan();
    } catch {
      return {
        issues: [],
        semantic: { status: 'failed', reason: 'internal_failure', issueCount: 0 },
      };
    }
  }

  public async run(): Promise<DataCheckScanResult> {
    const client = await this.pool.connect();
    const snapshotId = this.createSnapshotId();

    try {
      const semanticResult = await this.scanSemantic();
      await client.query('begin transaction isolation level repeatable read read only');
      const orphanResult = await client.query<OrphanCountRow>(orphanCountsSql);
      const orphanRow = orphanResult.rows[0];
      if (!orphanRow) {
        throw new Error('Unable to read orphan counts');
      }

      const issues: DataCheckIssueDraft[] = [...semanticResult.issues];
      const timings: DataCheckScanResult['timings'] = [];
      for (const rule of this.rules) {
        const startedAt = performance.now();
        const drafts = await rule.scan(client, snapshotId);
        for (const draft of drafts) {
          assertCompactDraft(draft);
        }
        issues.push(...drafts);
        timings.push({
          rule: rule.issueType,
          milliseconds: Math.max(0, performance.now() - startedAt),
        });
      }

      await client.query('commit');
      return {
        snapshotId,
        checkedAt: this.now(),
        orphanCounts: {
          events: Number(orphanRow.orphan_event_count),
          relations: Number(orphanRow.orphan_relation_count),
          cases: Number(orphanRow.orphan_case_count),
        },
        issues,
        timings,
        semantic: semanticResult.semantic,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
