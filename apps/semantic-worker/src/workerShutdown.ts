import { setTimeout as delay } from 'node:timers/promises';

export type WorkerDrainResult = 'drained' | 'timed_out';

export class WorkerShutdownRequestedError extends Error {
  public constructor() {
    super('Semantic worker shutdown was requested');
    this.name = 'WorkerShutdownRequestedError';
  }
}

export function assertWorkerActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkerShutdownRequestedError();
}

export async function waitForWorkerDrain(
  polling: Promise<void> | undefined,
  timeoutMilliseconds: number,
): Promise<WorkerDrainResult> {
  if (!polling) return 'drained';
  const timeout = delay(timeoutMilliseconds, 'timed_out' as const, { ref: false });
  return Promise.race([polling.then(() => 'drained' as const), timeout]);
}
