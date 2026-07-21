import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCausalGraph } from './causalGraphApi';

const centerEventId = '11111111-1111-4111-8111-111111111111';

const response = {
  nodes: [{ id: centerEventId, name: '原油价格上涨' }],
  relations: [],
  meta: {
    centerEventId,
    direction: 'both',
    nodeLimit: 20,
    relationLimit: 200,
    minConfidence: 0,
    minCaseCount: 0,
    nodeCount: 1,
    relationCount: 0,
    stopReason: 'exhausted',
  },
};

describe('getCausalGraph', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests the selected direction with fixed P1-07 limits', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => ({ ok: true, json: async () => response }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCausalGraph(centerEventId, 'both')).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `/api/causal-graph?centerEventId=${centerEventId}&direction=both&limit=20&minConfidence=0&minCaseCount=0`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects a response that violates the shared schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({ ok: true, json: async () => ({ ...response, unexpected: true }) }) as Response,
      ),
    );

    await expect(getCausalGraph(centerEventId, 'both')).rejects.toThrow();
  });
});
