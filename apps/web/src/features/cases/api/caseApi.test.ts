import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCases } from './caseApi';

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);
}

describe('caseApi list search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds enhanced mode only to enhanced case searches', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(() =>
      jsonResponse({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getCases({ q: '政策收紧', page: 1, searchMode: 'enhanced' });
    await getCases({ q: '政策收紧', page: 1 });

    expect(String(fetchMock.mock.calls[0]![0])).toContain('searchMode=enhanced');
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain('searchMode=');
  });
});
