import {
  healthResponseSchema,
  readinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse,
} from '@causality/contracts';

const requestTimeoutMilliseconds = 5_000;

function withTimeout(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMilliseconds)]);
}

export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    headers: { Accept: 'application/json' },
    signal: withTimeout(signal),
  });

  if (!response.ok) {
    throw new Error('Health endpoint unavailable');
  }

  return healthResponseSchema.parse(await response.json());
}

export async function getReadiness(signal: AbortSignal): Promise<ReadinessResponse> {
  const response = await fetch('/api/ready', {
    headers: { Accept: 'application/json' },
    signal: withTimeout(signal),
  });
  const readiness = readinessResponseSchema.parse(await response.json());

  if (response.status !== 200 && response.status !== 503) {
    throw new Error('Readiness endpoint unavailable');
  }

  return readiness;
}
