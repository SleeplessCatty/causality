export interface LeaseHeartbeat {
  assertValid(): void;
  stop(): Promise<void>;
}

interface LeaseHeartbeatOptions {
  leaseMilliseconds: number;
  renew(): Promise<void>;
}

export function startLeaseHeartbeat(options: LeaseHeartbeatOptions): LeaseHeartbeat {
  let failure: unknown;
  let failed = false;
  let renewalTail = Promise.resolve();
  const heartbeat = setInterval(
    () => {
      renewalTail = renewalTail
        .then(async () => {
          if (!failed) await options.renew();
        })
        .catch((error: unknown) => {
          failed = true;
          failure = error;
        });
    },
    Math.max(1_000, Math.floor(options.leaseMilliseconds / 3)),
  );
  heartbeat.unref();

  return {
    assertValid() {
      if (failed) throw failure;
    },
    async stop() {
      clearInterval(heartbeat);
      await renewalTail;
    },
  };
}
