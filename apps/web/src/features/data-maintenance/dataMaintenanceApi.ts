import {
  dataCheckActionContextSchema,
  dataCheckActionResponseSchema,
  dataCheckIssueListResponseSchema,
  dataCheckLatestResponseSchema,
  dataCheckRecheckResponseSchema,
  type DataCheckActionContext,
  type DataCheckActionRequest,
  type DataCheckActionResponse,
  type DataCheckIssueListQuery,
  type DataCheckIssueListResponse,
  type DataCheckLatestResponse,
  type DataCheckRecheckResponse,
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

export async function getDataCheckActionContext(
  issueId: string,
  snapshotId: string,
  signal?: AbortSignal,
): Promise<DataCheckActionContext> {
  const parameters = new URLSearchParams({ snapshotId });
  return dataCheckActionContextSchema.parse(
    await requestJson(
      `/api/data-checks/issues/${issueId}/action-context?${parameters}`,
      {},
      signal,
    ),
  );
}

export async function applyDataCheckAction(
  issueId: string,
  request: DataCheckActionRequest,
): Promise<DataCheckActionResponse> {
  return dataCheckActionResponseSchema.parse(
    await requestJson(`/api/data-checks/issues/${issueId}/actions`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  );
}

export async function recheckDataCheckIssue(
  issueId: string,
  snapshotId: string,
): Promise<DataCheckRecheckResponse> {
  return dataCheckRecheckResponseSchema.parse(
    await requestJson(`/api/data-checks/issues/${issueId}/recheck`, {
      method: 'POST',
      body: JSON.stringify({ snapshotId }),
    }),
  );
}
