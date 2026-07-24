import { describe, expect, it, vi } from 'vitest';

import {
  HttpSemanticWorkerClient,
  SemanticWorkerClientError,
} from '../src/features/semantic/semanticWorkerClient.js';

const vector384 = Array.from({ length: 384 }, () => 0.05);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpSemanticWorkerClient', () => {
  it('returns a strictly validated vector for the requested model', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        modelCode: 'multilingual-e5-small',
        dimensions: 384,
        vector: vector384,
      }),
    );
    const client = new HttpSemanticWorkerClient({
      baseUrl: 'http://127.0.0.1:3100',
      timeoutMs: 1_000,
      fetchFn,
    });

    await expect(client.embedQuery('multilingual-e5-small', '政策收紧')).resolves.toEqual(
      vector384,
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:3100/internal/embed-query',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          modelCode: 'multilingual-e5-small',
          text: '政策收紧',
        }),
      }),
    );
  });

  it('maps timeout and connection failures to a stable unavailable error', async () => {
    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const timeoutClient = new HttpSemanticWorkerClient({
      baseUrl: 'http://127.0.0.1:3100',
      timeoutMs: 5,
      fetchFn: timeoutFetch,
    });
    const unavailableClient = new HttpSemanticWorkerClient({
      baseUrl: 'http://127.0.0.1:3100',
      timeoutMs: 1_000,
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('connection refused')),
    });

    await expect(timeoutClient.embedQuery('multilingual-e5-small', '政策收紧')).rejects.toEqual(
      expect.objectContaining({ code: 'SEMANTIC_WORKER_UNAVAILABLE' }),
    );
    await expect(
      unavailableClient.embedQuery('multilingual-e5-small', '政策收紧'),
    ).rejects.toBeInstanceOf(SemanticWorkerClientError);
  });

  it('rejects malformed, mismatched, and non-success Worker responses', async () => {
    for (const response of [
      jsonResponse({
        modelCode: 'multilingual-e5-small',
        dimensions: 1024,
        vector: vector384,
      }),
      jsonResponse({
        modelCode: 'bge-m3',
        dimensions: 384,
        vector: vector384,
      }),
      jsonResponse({ code: 'SEMANTIC_MODEL_UNAVAILABLE' }, 409),
    ]) {
      const client = new HttpSemanticWorkerClient({
        baseUrl: 'http://127.0.0.1:3100',
        timeoutMs: 1_000,
        fetchFn: vi.fn<typeof fetch>().mockResolvedValue(response),
      });
      await expect(client.embedQuery('multilingual-e5-small', '政策收紧')).rejects.toMatchObject({
        code: 'SEMANTIC_WORKER_UNAVAILABLE',
      });
    }
  });
});
