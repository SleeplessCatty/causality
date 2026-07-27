import type {
  DataCheckActionContext,
  DataCheckActionRequest,
  DataCheckActionResponse,
  DataCheckIssue,
  DataCheckIssueListQuery,
  DataCheckIssueListResponse,
  DataCheckLatestResponse,
  DataCheckRecheckResponse,
} from '@causality/contracts';

import type {
  DataCheckActionHandler,
  DataCheckRepository,
  DataCheckScanner,
} from './dataCheckTypes.js';

export class DataCheckCoordinator {
  private currentPromise: Promise<void> | null = null;

  public constructor(
    private readonly repository: DataCheckRepository,
    private readonly scanner: DataCheckScanner,
    private readonly actionService?: DataCheckActionHandler,
  ) {}

  public async start(): Promise<DataCheckLatestResponse> {
    const result = await this.repository.tryStart();
    if (result.started && !this.currentPromise) {
      const task = this.runInBackground();
      this.currentPromise = task;
      void task.finally(() => {
        if (this.currentPromise === task) {
          this.currentPromise = null;
        }
      });
    }
    return result.latest;
  }

  public latest(): Promise<DataCheckLatestResponse> {
    return this.repository.latest();
  }

  public listIssues(query: DataCheckIssueListQuery): Promise<DataCheckIssueListResponse> {
    return this.repository.listIssues(query);
  }

  public autoHandle(issueId: string, snapshotId: string): Promise<DataCheckIssue> {
    return this.repository.autoHandle(issueId, snapshotId);
  }

  public manualHandle(issueId: string, snapshotId: string): Promise<DataCheckIssue> {
    return this.repository.manualHandle(issueId, snapshotId);
  }

  public actionContext(issueId: string, snapshotId: string): Promise<DataCheckActionContext> {
    if (!this.actionService) throw new Error('Data-check action service is not configured');
    return this.actionService.context(issueId, snapshotId);
  }

  public applyAction(
    issueId: string,
    request: DataCheckActionRequest,
  ): Promise<DataCheckActionResponse> {
    if (!this.actionService) throw new Error('Data-check action service is not configured');
    return this.actionService.apply(issueId, request);
  }

  public recheckIssue(issueId: string, snapshotId: string): Promise<DataCheckRecheckResponse> {
    if (!this.actionService) throw new Error('Data-check action service is not configured');
    return this.actionService.recheck(issueId, snapshotId);
  }

  public recoverInterrupted(): Promise<DataCheckLatestResponse> {
    return this.repository.recoverInterrupted();
  }

  public async waitForCurrent(): Promise<void> {
    await this.currentPromise;
  }

  private async runInBackground(): Promise<void> {
    try {
      const result = await this.scanner.run();
      await this.repository.replaceSnapshot(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '数据检查失败';
      try {
        await this.repository.markFailure(message);
      } catch {
        // A later API restart recovers a persisted running state.
      }
    }
  }
}
