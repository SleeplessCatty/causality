import {
  dataCheckIssueListResponseSchema,
  dataCheckIssueSchema,
  dataCheckLatestResponseSchema,
  type DataCheckIssue,
  type DataCheckIssueListQuery,
  type DataCheckIssueListResponse,
  type DataCheckLatestResponse,
} from '@causality/contracts';

import { requestJson } from '../../shared/api/httpClient';

export async function getLatestDataCheck(signal?: AbortSignal): Promise<DataCheckLatestResponse> {
  return dataCheckLatestResponseSchema.parse(
    await requestJson('/api/data-checks/latest', {}, signal),
  );
}

export async function startDataCheck(): Promise<DataCheckLatestResponse> {
  return dataCheckLatestResponseSchema.parse(
    await requestJson('/api/data-checks', { method: 'POST' }),
  );
}

export async function getDataCheckIssues(
  query: DataCheckIssueListQuery,
  signal?: AbortSignal,
): Promise<DataCheckIssueListResponse> {
  const parameters = new URLSearchParams({ page: String(query.page) });
  if (query.severity) parameters.set('severity', query.severity);
  if (query.issueType) parameters.set('issueType', query.issueType);
  if (query.status) parameters.set('status', query.status);
  return dataCheckIssueListResponseSchema.parse(
    await requestJson(`/api/data-checks/latest/issues?${parameters}`, {}, signal),
  );
}

export async function autoHandleDataCheckIssue(
  id: string,
  snapshotId: string,
): Promise<DataCheckIssue> {
  return dataCheckIssueSchema.parse(
    await requestJson(`/api/data-checks/issues/${id}/auto-handle`, {
      method: 'POST',
      body: JSON.stringify({ snapshotId }),
    }),
  );
}

export async function manualHandleDataCheckIssue(
  id: string,
  snapshotId: string,
): Promise<DataCheckIssue> {
  return dataCheckIssueSchema.parse(
    await requestJson(`/api/data-checks/issues/${id}/manual-handle`, {
      method: 'POST',
      body: JSON.stringify({ snapshotId }),
    }),
  );
}
