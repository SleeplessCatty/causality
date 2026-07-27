import type {
  DataCheckActionOption,
  DataCheckActionRecord,
  DataCheckIssue,
} from '@causality/contracts';
import { createHash } from 'node:crypto';

type UnsignedDataCheckActionOption = Omit<DataCheckActionOption, 'actionKey'>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function createDataCheckActionKey(
  issue: DataCheckIssue,
  records: readonly DataCheckActionRecord[],
  option: UnsignedDataCheckActionOption,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          issue: {
            snapshotId: issue.snapshotId,
            issueId: issue.id,
            issueType: issue.issueType,
            targetId: issue.targetId,
            relatedId: issue.relatedId,
          },
          records,
          option,
        }),
      ),
    )
    .digest('hex');
}

export function authorizeDataCheckActions(
  issue: DataCheckIssue,
  records: readonly DataCheckActionRecord[],
  actions: readonly DataCheckActionOption[],
): DataCheckActionOption[] {
  return actions.map((option) => {
    if (option.type === 'ignore') return { ...option, actionKey: null };
    const unsigned: UnsignedDataCheckActionOption = {
      type: option.type,
      label: option.label,
      keepId: option.keepId,
      mergeId: option.mergeId,
      impact: option.impact,
    };
    return {
      ...option,
      actionKey: createDataCheckActionKey(issue, records, unsigned),
    };
  });
}
