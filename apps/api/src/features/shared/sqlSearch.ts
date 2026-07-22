export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
