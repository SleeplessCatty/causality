import { apiErrorSchema, type ApiError } from '@causality/contracts';

const defaultTimeoutMilliseconds = 10_000;
const unavailableError: ApiError = {
  code: 'INTERNAL_ERROR',
  message: '服务暂时不可用，请稍后重试',
};

export class ApiClientError extends Error {
  constructor(readonly details: ApiError) {
    super(details.message);
    this.name = 'ApiClientError';
  }
}

function withTimeout(signal: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function requestJson(
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal,
  timeoutMilliseconds = defaultTimeoutMilliseconds,
): Promise<unknown> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: withTimeout(signal, timeoutMilliseconds),
  });
  const body: unknown = await response.json();

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiClientError(parsed.success ? parsed.data : unavailableError);
  }

  return body;
}
