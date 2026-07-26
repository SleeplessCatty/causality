import { afterEach, describe, expect, it, vi } from 'vitest';

import { startLeaseHeartbeat } from '../src/jobs/leaseHeartbeat.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('startLeaseHeartbeat', () => {
  it('serializes renewals and preserves the renewal failure for the lease guard', async () => {
    vi.useFakeTimers();
    let releaseFirstRenewal!: () => void;
    let rejectSecondRenewal!: (error: Error) => void;
    const firstRenewal = new Promise<void>((resolve) => {
      releaseFirstRenewal = resolve;
    });
    const secondRenewal = new Promise<void>((_resolve, reject) => {
      rejectSecondRenewal = reject;
    });
    const renew = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRenewal)
      .mockImplementationOnce(() => secondRenewal);
    const heartbeat = startLeaseHeartbeat({
      leaseMilliseconds: 3_000,
      renew,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(1);

    releaseFirstRenewal();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(renew).toHaveBeenCalledTimes(2);

    const leaseFailure = new Error('lease renewal failed');
    rejectSecondRenewal(leaseFailure);
    await heartbeat.stop();

    expect(() => heartbeat.assertValid()).toThrow(leaseFailure);
  });

  it('treats an undefined renewal rejection as a lost lease', async () => {
    vi.useFakeTimers();
    const heartbeat = startLeaseHeartbeat({
      leaseMilliseconds: 3_000,
      renew: async () => Promise.reject(undefined),
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await heartbeat.stop();
    let rejected = false;
    try {
      heartbeat.assertValid();
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });
});
