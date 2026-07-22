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
  const headers = new Headers(options.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, {
    ...options,
    headers,
    signal: withTimeout(signal, timeoutMilliseconds),
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiClientError(unavailableError);
    }
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiClientError(parsed.success ? parsed.data : unavailableError);
  }

  return response.json();
}
