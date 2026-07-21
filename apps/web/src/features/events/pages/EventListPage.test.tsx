import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { EventListPage } from './EventListPage';

const firstPage = {
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: '原油价格上涨',
      aliases: ['油价上涨', '原油上涨', '国际油价上涨', '第四个别名'],
      keywords: ['原油', '能源价格'],
      updatedAt: '2026-07-21T03:00:00.000Z',
    },
  ],
  nextCursor: 'cursor-next',
  hasMore: true,
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderList(initialEntry = '/events') {
  const router = createMemoryRouter(
    [
      { path: '/events', element: <EventListPage /> },
      { path: '/events/new', element: <div>创建页面</div> },
      { path: '/events/:eventId', element: <div>详情页面</div> },
    ],
    { initialEntries: [initialEntry] },
  );

  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('EventListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders event rows, trims long metadata, and links to create and detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(firstPage)),
    );
    renderList();

    expect(screen.getByText('加载事件…')).toBeTruthy();
    expect(await screen.findByRole('link', { name: '原油价格上涨' })).toBeTruthy();
    expect(screen.getByText('油价上涨、原油上涨、国际油价上涨')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByRole('link', { name: '创建事件' }).getAttribute('href')).toBe('/events/new');
    expect(screen.getByRole('link', { name: '原油价格上涨' }).getAttribute('href')).toBe(
      '/events/11111111-1111-4111-8111-111111111111',
    );
  });

  it('debounces search, stores it in the URL, and requests the normalized query', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      void input;
      return jsonResponse({ ...firstPage, nextCursor: null, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderList();
    await screen.findByRole('link', { name: '原油价格上涨' });

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索事件' }), {
      target: { value: '  油价  ' },
    });

    await waitFor(() => expect(router.state.location.search).toBe('?q=%E6%B2%B9%E4%BB%B7'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('q=%E6%B2%B9%E4%BB%B7')),
      ).toBe(true),
    );
  });

  it('uses the next cursor and can return to the previous page', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return url.includes('cursor=cursor-next')
        ? jsonResponse({
            items: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                name: '市场流动性收紧',
                aliases: [],
                keywords: [],
                updatedAt: '2026-07-20T03:00:00.000Z',
              },
            ],
            nextCursor: null,
            hasMore: false,
          })
        : jsonResponse(firstPage);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList();

    await screen.findByRole('link', { name: '原油价格上涨' });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByRole('link', { name: '市场流动性收紧' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(await screen.findByRole('link', { name: '原油价格上涨' })).toBeTruthy();
  });

  it('shows empty and retryable failure states', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ code: 'INTERNAL_ERROR', message: '失败' }, 500))
      .mockImplementationOnce(() => jsonResponse({ items: [], nextCursor: null, hasMore: false }));
    vi.stubGlobal('fetch', fetchMock);
    renderList();

    expect(await screen.findByText('无法加载事件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('还没有原子事件')).toBeTruthy();
  });
});
