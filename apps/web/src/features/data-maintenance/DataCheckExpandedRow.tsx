import type { DataCheckIssueListItem } from '@causality/contracts';

interface DataCheckExpandedRowProps {
  issue: DataCheckIssueListItem;
  snapshotId: string;
}

export function DataCheckExpandedRow({ issue, snapshotId }: DataCheckExpandedRowProps) {
  return (
    <div
      className="data-check-expanded"
      data-testid={`expanded-${issue.id}`}
      data-snapshot-id={snapshotId}
      aria-live="polite"
    >
      <span>正在准备处理信息…</span>
    </div>
  );
}
