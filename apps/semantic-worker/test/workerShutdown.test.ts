import { describe, expect, it, vi } from 'vitest';

import { waitForWorkerDrain } from '../src/workerShutdown.js';

describe('waitForWorkerDrain', () => {
  it('returns drained when active polling settles before the deadline', async () => {
    await expect(waitForWorkerDrain(Promise.resolve(), 100)).resolves.toBe('drained');
  });

  it('returns timed_out instead of waiting forever for active work', async () => {
    vi.useFakeTimers();
    const neverSettles = new Promise<void>(() => undefined);

    const result = waitForWorkerDrain(neverSettles, 50);
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBe('timed_out');
    vi.useRealTimers();
  });
});
