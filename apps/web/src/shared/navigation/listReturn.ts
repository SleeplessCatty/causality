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

export function getListFocusId(state: unknown): string | undefined {
  const focusId = stateRecord(state)?.listFocusId;
  return typeof focusId === 'string' && focusId.length > 0 ? focusId : undefined;
}

export function listFocusState(focusId: string): ListReturnState {
  return { listFocusId: focusId };
}
