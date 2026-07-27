import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiClientError,
  requestJson,
  requestMultipartJson,
  startBrowserDownload,
} from './httpClient';

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('requestJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns a JSON body from a 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ id: 'event-1' })),
    );

    await expect(requestJson('/api/events/event-1')).resolves.toEqual({ id: 'event-1' });
  });

  it('throws the standard API error details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ code: 'EVENT_NOT_FOUND', message: '事件不存在' }, 404)),
    );

    await expect(requestJson('/api/events/missing')).rejects.toEqual(
      expect.objectContaining({
        name: 'ApiClientError',
        details: { code: 'EVENT_NOT_FOUND', message: '事件不存在' },
      }),
    );
  });

  it('falls back to the standard unavailable error for a non-standard error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: 'upstream unavailable' }, 502)),
    );

    await expect(requestJson('/api/events')).rejects.toEqual(
      new ApiClientError({ code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' }),
    );
  });

  it.each([
    ['HTML', new SyntaxError('Unexpected token < in JSON at position 0')],
    ['empty', new SyntaxError('Unexpected end of JSON input')],
  ])('falls back when a %s error response is not JSON', async (_kind, jsonError) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({ ok: false, json: async () => Promise.reject(jsonError) }) as unknown as Response,
      ),
    );

    await expect(requestJson('/api/events')).rejects.toEqual(
      new ApiClientError({ code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' }),
    );
  });

  it('forwards caller cancellation to the request', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            });
          }),
      ),
    );

    const pending = requestJson('/api/events', {}, controller.signal);
    controller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts a request after the default ten-second timeout', async () => {
    const timeoutController = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            });
          }),
      ),
    );

    const pending = requestJson('/api/events');
    expect(timeout).toHaveBeenCalledWith(10_000);
    timeoutController.abort(new DOMException('Timed out', 'TimeoutError'));

    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('adds JSON headers when the request has a body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ id: 'event-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/api/events', {
      method: 'POST',
      body: JSON.stringify({ name: '油价上涨' }),
    });

    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('Accept')).toBe('application/json');
    expect(requestHeaders.get('Content-Type')).toBe('application/json');
  });

  it('does not add Content-Type when the request has no body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ id: 'event-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/api/events');

    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('Accept')).toBe('application/json');
    expect(requestHeaders.has('Content-Type')).toBe(false);
  });

  it('preserves Headers custom headers and lets them override defaults', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ id: 'event-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/api/events', {
      method: 'POST',
      body: '{}',
      headers: new Headers({
        Accept: 'application/problem+json',
        'Content-Type': 'application/problem+json',
        'X-Request-Id': 'headers',
      }),
    });

    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('Accept')).toBe('application/problem+json');
    expect(requestHeaders.get('Content-Type')).toBe('application/problem+json');
    expect(requestHeaders.get('X-Request-Id')).toBe('headers');
  });

  it('preserves tuple-array custom headers and lets them override defaults', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ id: 'event-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/api/events', {
      method: 'POST',
      body: '{}',
      headers: [
        ['Accept', 'application/problem+json'],
        ['Content-Type', 'application/problem+json'],
        ['X-Request-Id', 'tuples'],
      ],
    });

    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('Accept')).toBe('application/problem+json');
    expect(requestHeaders.get('Content-Type')).toBe('application/problem+json');
    expect(requestHeaders.get('X-Request-Id')).toBe('tuples');
  });
});

describe('requestMultipartJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts FormData without manually setting multipart Content-Type', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ batch: { id: 'batch-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    form.append('file', new File(['csv'], 'data.csv'));

    await expect(
      requestMultipartJson(
        '/api/data-transfers/imports',
        form,
        new AbortController().signal,
        300_000,
      ),
    ).resolves.toEqual({ batch: { id: 'batch-1' } });

    const options = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(options?.headers);
    expect(options?.method).toBe('POST');
    expect(options?.body).toBe(form);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('uses the requested timeout and preserves caller cancellation', async () => {
    const caller = new AbortController();
    const timeoutController = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true,
            });
          }),
      ),
    );

    const pending = requestMultipartJson(
      '/api/data-transfers/imports',
      new FormData(),
      caller.signal,
      300_000,
    );
    expect(timeout).toHaveBeenCalledWith(300_000);
    caller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('uses the same standard API error parsing as JSON requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ code: 'CSV_NO_VALID_RECORDS', message: '没有有效记录' }, 400)),
    );

    await expect(
      requestMultipartJson(
        '/api/data-transfers/imports',
        new FormData(),
        new AbortController().signal,
        300_000,
      ),
    ).rejects.toEqual(
      new ApiClientError({ code: 'CSV_NO_VALID_RECORDS', message: '没有有效记录' }),
    );
  });
});

describe('startBrowserDownload', () => {
  afterEach(() => vi.restoreAllMocks());

  it('launches a browser download with the optional filename and removes the temporary anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const routeBeforeDownload = window.location.href;

    startBrowserDownload('/api/data-transfers/exports/token', '因果数据.csv');

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('/api/data-transfers/exports/token');
    expect(anchor.getAttribute('download')).toBe('因果数据.csv');
    expect(anchor.hidden).toBe(true);
    expect(document.body.contains(anchor)).toBe(false);
    expect(window.location.href).toBe(routeBeforeDownload);
  });

  it('uses an empty download attribute when the server supplies the filename', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    startBrowserDownload('/api/data-transfers/exports/token');

    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.hasAttribute('download')).toBe(true);
    expect(anchor.getAttribute('download')).toBe('');
  });
});
