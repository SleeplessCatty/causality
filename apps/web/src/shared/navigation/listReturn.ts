export interface ListReturnState {
  listReturnPath?: string;
  listFocusId?: string;
}

interface ListLocation {
  pathname: string;
  search: string;
}

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

export function buildListPath(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

export function createListReturnState(location: ListLocation, focusId?: string): ListReturnState {
  return {
    listReturnPath: `${location.pathname}${location.search}`,
    ...(focusId ? { listFocusId: focusId } : {}),
  };
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
): { path: string } {
  const candidate = stateRecord(state)?.listReturnPath;
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
