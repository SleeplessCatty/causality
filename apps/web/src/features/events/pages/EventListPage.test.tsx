import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  page: 1,
  pageSize: 50,
  totalItems: 101,
  totalPages: 3,
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
      { path: '/events/:eventId/edit', element: <div>编辑页面</div> },
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
    vi.useRealTimers();
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

  it('links row editing and reveals all non-empty metadata after two seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ ...firstPage, totalItems: 1, totalPages: 1 })),
    );
    renderList();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole('link', { name: '编辑' }).getAttribute('href')).toBe(
      '/events/11111111-1111-4111-8111-111111111111/edit',
    );
    const aliases = screen
      .getByText('油价上涨、原油上涨、国际油价上涨')
      .closest('.event-table__metadata')!;
    fireEvent.mouseEnter(aliases);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole('tooltip').textContent).toContain('第四个别名');
    fireEvent.mouseLeave(aliases);

    const shortKeywords = screen.getByText('原油、能源价格').closest('.event-table__metadata');
    expect(shortKeywords?.getAttribute('tabindex')).toBe('0');
    expect(shortKeywords?.getAttribute('aria-describedby')).toBeNull();
    fireEvent.mouseEnter(shortKeywords!);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole('tooltip').textContent).toBe('原油、能源价格');
    vi.useRealTimers();
  });

  it('debounces search, stores it in the URL, and requests the normalized query', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      const hasQuery = url.searchParams.has('q');
      return jsonResponse({
        ...firstPage,
        page: hasQuery ? 1 : 3,
        totalItems: hasQuery ? 1 : 101,
        totalPages: hasQuery ? 1 : 3,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderList('/events?page=3');
    await screen.findByRole('link', { name: '原油价格上涨' });
    expect(screen.getByText('共 101 条 · 第 3/3 页')).toBeTruthy();

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

  it('restores URL pages and supports adjacent, numbered, and arbitrary page navigation', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page') ?? '1');
      return page > 1
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
            page,
            pageSize: 50,
            totalItems: 101,
            totalPages: 3,
          })
        : jsonResponse(firstPage);
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderList('/events?page=2');

    expect(await screen.findByText('共 101 条 · 第 2/3 页')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(await screen.findByRole('link', { name: '原油价格上涨' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByRole('link', { name: '市场流动性收紧' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '第 3 页' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '第 3 页' }));
    await waitFor(() => expect(router.state.location.search).toBe('?page=3'));
    const jump = screen.getByRole('spinbutton', { name: '跳转页码' });
    await waitFor(() => expect(jump.hasAttribute('disabled')).toBe(false));
    fireEvent.change(jump, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '跳转' }));
    await waitFor(() => expect(router.state.location.search).toBe('?page=1'));
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.search).toBe('?page=3'));
    expect(await screen.findByText('共 101 条 · 第 3/3 页')).toBeTruthy();
  });

  it('shows empty and retryable failure states', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ code: 'INTERNAL_ERROR', message: '失败' }, 500))
      .mockImplementationOnce(() =>
        jsonResponse({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderList();

    expect(await screen.findByText('无法加载事件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('还没有原子事件')).toBeTruthy();
    expect(screen.getByText('共 0 条 · 第 1/1 页')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
  });
});
