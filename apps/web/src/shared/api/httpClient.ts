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

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (response.ok) return response.json();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError(unavailableError);
  }
  const parsed = apiErrorSchema.safeParse(body);
  throw new ApiClientError(parsed.success ? parsed.data : unavailableError);
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

  return parseJsonResponse(response);
}

export async function requestMultipartJson(
  url: string,
  form: FormData,
  signal: AbortSignal,
  timeoutMilliseconds: number,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
    signal: withTimeout(signal, timeoutMilliseconds),
  });
  return parseJsonResponse(response);
}

export function startBrowserDownload(url: string, filename?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  if (filename) anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
