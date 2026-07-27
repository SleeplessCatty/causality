import type {
  DataCheckActionContext,
  DataCheckActionRequest,
  DataCheckActionResponse,
  DataCheckIssueListQuery,
  DataCheckIssueListResponse,
  DataCheckLatestResponse,
  DataCheckSemanticReason,
  DataCheckSemanticStatus,
  DataCheckSeverity,
  DataCheckTargetType,
} from '@causality/contracts';
import type { PoolClient } from 'pg';

export type DataCheckActionMode = 'auto' | 'manual';

export interface DataCheckIssueDraft {
  severity: DataCheckSeverity;
  issueType: string;
  targetType: DataCheckTargetType;
  targetId: string;
  relatedId: string | null;
  description: string;
  suggestion: string;
  actionMode: DataCheckActionMode;
}

export interface DataCheckRule {
  readonly issueType: string;
  scan(client: PoolClient, snapshotId: string): Promise<DataCheckIssueDraft[]>;
}

export interface DataCheckOrphanCounts {
  events: number;
  relations: number;
  cases: number;
}

export interface DataCheckRuleTiming {
  rule: string;
  milliseconds: number;
}

export interface DataCheckSemanticResult {
  status: DataCheckSemanticStatus;
  reason: DataCheckSemanticReason;
  issueCount: number;
}

export interface DataCheckSemanticRule {
  scan(): Promise<{ issues: DataCheckIssueDraft[]; semantic: DataCheckSemanticResult }>;
}

export interface DataCheckScanResult {
  snapshotId: string;
  checkedAt: Date;
  orphanCounts: DataCheckOrphanCounts;
  issues: DataCheckIssueDraft[];
  timings: DataCheckRuleTiming[];
  semantic: DataCheckSemanticResult;
}

export interface DataCheckStartResult {
  started: boolean;
  latest: DataCheckLatestResponse;
}

export interface DataCheckRepository {
  tryStart(): Promise<DataCheckStartResult>;
  latest(): Promise<DataCheckLatestResponse>;
  replaceSnapshot(result: DataCheckScanResult): Promise<DataCheckLatestResponse>;
  markFailure(message: string): Promise<DataCheckLatestResponse>;
  recoverInterrupted(): Promise<DataCheckLatestResponse>;
  listIssues(query: DataCheckIssueListQuery): Promise<DataCheckIssueListResponse>;
}

export interface DataCheckScanner {
  run(): Promise<DataCheckScanResult>;
}

export interface DataCheckActionHandler {
  context(issueId: string, snapshotId: string): Promise<DataCheckActionContext>;
  apply(issueId: string, request: DataCheckActionRequest): Promise<DataCheckActionResponse>;
}
