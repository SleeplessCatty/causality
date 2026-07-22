import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, requestJson } from './httpClient';

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

    await expect(pending).rejects.toBeTruthy();
  });

  it('adds JSON headers when the request has a body', async () => {
    const fetchMock = vi.fn(async () => response({ id: 'event-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/api/events', {
      method: 'POST',
      body: JSON.stringify({ name: '油价上涨' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('does not add Content-Type when the request has no body', async () => {
    const fetchMock = vi.fn(async () => response({ id: 'event-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/api/events');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/events',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });
});
