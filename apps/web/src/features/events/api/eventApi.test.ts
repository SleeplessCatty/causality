import { afterEach, describe, expect, it, vi } from 'vitest';

import { getEvents } from './eventApi';

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);
}

const emptyPage = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 1,
};

describe('eventApi list search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds enhanced mode only to enhanced event searches', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(() =>
      jsonResponse(emptyPage),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getEvents({ q: '政策收紧', page: 1, searchMode: 'enhanced' });
    await getEvents({ q: '政策收紧', page: 1 });

    expect(String(fetchMock.mock.calls[0]![0])).toContain('searchMode=enhanced');
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain('searchMode=');
  });
});
