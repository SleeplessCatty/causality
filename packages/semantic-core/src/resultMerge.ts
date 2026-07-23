export function mergeNormalFirst<T extends { id: string }>(
  normal: readonly T[],
  semantic: readonly T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const item of [...normal, ...semantic]) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    merged.push(item);
  }

  return merged;
}
