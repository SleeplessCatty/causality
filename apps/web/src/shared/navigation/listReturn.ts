export interface ListReturnState {
  listReturnPath?: string;
  listFocusId?: string;
}

export interface DataCheckReturnState {
  dataCheckReturnPath: string;
  dataCheckSnapshotId: string;
  dataCheckIssueId: string;
  dataCheckReturnMode: 'cancel' | 'saved';
}

interface ListLocation {
  pathname: string;
  search: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stateRecord(state: unknown): Record<string, unknown> | null {
  return typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null;
}

function belongsToList(path: string, basePath: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  return pathname === basePath;
}

function isSafeReturnPath(path: string, allowedPath: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return false;
  if (path.split(/[?#]/, 1)[0] !== allowedPath) return false;
  let decoded = path;
  try {
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return false;
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\')) return false;
  const pathname = decoded.split(/[?#]/, 1)[0];
  return pathname === allowedPath;
}

function appendRecheckMarker(path: string): string {
  const url = new URL(path, 'http://local.invalid');
  url.searchParams.set('recheck', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildListPath(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

export function createListReturnState(location: ListLocation, focusId?: string): ListReturnState {
  return {
    listReturnPath: `${location.pathname}${location.search}`,
    ...(focusId ? { listFocusId: focusId } : {}),
  };
}

export function createDataCheckEditReturnState(
  location: ListLocation,
  snapshotId: string,
  issueId: string,
): DataCheckReturnState {
  return {
    dataCheckReturnPath: `${location.pathname}${location.search}`,
    dataCheckSnapshotId: snapshotId,
    dataCheckIssueId: issueId,
    dataCheckReturnMode: 'cancel',
  };
}

export function getDataCheckReturnState(state: unknown): DataCheckReturnState | null {
  const record = stateRecord(state);
  const dataCheckReturnPath = record?.dataCheckReturnPath;
  const snapshotId = record?.dataCheckSnapshotId;
  const issueId = record?.dataCheckIssueId;
  const returnMode = record?.dataCheckReturnMode;
  return typeof dataCheckReturnPath === 'string' &&
    isSafeReturnPath(dataCheckReturnPath, '/maintenance') &&
    typeof snapshotId === 'string' &&
    uuidPattern.test(snapshotId) &&
    typeof issueId === 'string' &&
    uuidPattern.test(issueId) &&
    (returnMode === 'cancel' || returnMode === 'saved')
    ? {
        dataCheckReturnPath,
        dataCheckSnapshotId: snapshotId,
        dataCheckIssueId: issueId,
        dataCheckReturnMode: returnMode,
      }
    : null;
}

export function resolveListReturnPath(
  state: unknown,
  basePath: string,
  fallbackPage: number,
): string {
  const candidate = stateRecord(state)?.listReturnPath;
  return typeof candidate === 'string' && belongsToList(candidate, basePath)
    ? candidate
    : buildListPath(basePath, fallbackPage);
}

export function resolveRecordReturnTarget(
  state: unknown,
  normalBasePath: string,
  fallbackPage: number,
): {
  path: string;
  dataCheck?: { snapshotId: string; issueId: string; recheck: boolean };
} {
  const record = stateRecord(state);
  const dataCheckReturn = getDataCheckReturnState(state);
  if (dataCheckReturn) {
    const recheck = dataCheckReturn.dataCheckReturnMode === 'saved';
    return {
      path: recheck
        ? appendRecheckMarker(dataCheckReturn.dataCheckReturnPath)
        : dataCheckReturn.dataCheckReturnPath,
      dataCheck: {
        snapshotId: dataCheckReturn.dataCheckSnapshotId,
        issueId: dataCheckReturn.dataCheckIssueId,
        recheck,
      },
    };
  }

  const candidate = record?.listReturnPath;
  return {
    path:
      typeof candidate === 'string' && isSafeReturnPath(candidate, normalBasePath)
        ? candidate
        : buildListPath(normalBasePath, fallbackPage),
  };
}

export function getListFocusId(state: unknown): string | undefined {
  const focusId = stateRecord(state)?.listFocusId;
  return typeof focusId === 'string' && focusId.length > 0 ? focusId : undefined;
}

export function listFocusState(focusId: string): ListReturnState {
  return { listFocusId: focusId };
}
