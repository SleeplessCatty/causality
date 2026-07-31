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

let csrfTokenProvider: () => string | null = () => null;

export function setCsrfTokenProvider(provider: () => string | null): void {
  csrfTokenProvider = provider;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (response.ok) return response.json();

  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('causality:unauthorized'));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError(unavailableError);
  }
  const apiError = apiErrorSchema.safeParse(body);
  if (apiError.success) throw new ApiClientError(apiError.data);
  throw new ApiClientError(unavailableError);
}

function isMutationMethod(method: string | undefined): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method ?? 'GET').toUpperCase());
}

function addCsrfHeader(headers: Headers, method: string | undefined): void {
  if (!isMutationMethod(method)) return;
  const csrfToken = csrfTokenProvider();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
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
  addCsrfHeader(headers, options.method);
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
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
  const headers = new Headers({ Accept: 'application/json' });
  addCsrfHeader(headers, 'POST');
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'same-origin',
    signal: withTimeout(signal, timeoutMilliseconds),
  });
  return parseJsonResponse(response);
}

export function startBrowserDownload(url: string, filename?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.hidden = true;
  anchor.download = filename ?? '';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
