export const E2E_WRITE_BATCH_SIZE = 10;

export async function runInBatches<T>(
  items: readonly T[],
  batchSize: number,
  operation: (item: T) => Promise<unknown>,
): Promise<void> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('E2E batch size must be a positive integer');
  }
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(operation));
  }
}
