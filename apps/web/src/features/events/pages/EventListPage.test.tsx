import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      relationCount: 2,
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

function renderList(
  initialEntry:
    string | { pathname: string; search?: string; state?: Record<string, unknown> } = '/events',
) {
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
    expect(screen.getByRole('columnheader', { name: '关联关系数' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '2' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '创建事件' }).getAttribute('href')).toBe('/events/new');
    expect(screen.getByRole('link', { name: '原油价格上涨' }).getAttribute('href')).toBe(
      '/events/11111111-1111-4111-8111-111111111111',
    );
  });

  it('preserves the current page for row navigation and restores the row position on return', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ ...firstPage, page: 3 })),
    );
    const router = renderList({
      pathname: '/events',
      search: '?q=%E5%8E%9F%E6%B2%B9&page=3',
      state: { listFocusId: firstPage.items[0]!.id },
    });

    const detailLink = await screen.findByRole('link', { name: '原油价格上涨' });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    fireEvent.click(detailLink);
    await waitFor(() => expect(router.state.location.pathname).toContain(firstPage.items[0]!.id));
    expect(router.state.location.state).toMatchObject({
      listReturnPath: '/events?q=%E5%8E%9F%E6%B2%B9&page=3',
      listFocusId: firstPage.items[0]!.id,
    });
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
                relationCount: 0,
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

  it('describes an empty hidden orphan filter as no matching events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 })),
    );
    renderList('/events?orphan=true');

    expect(await screen.findByText('没有找到事件')).toBeTruthy();
    expect(screen.queryByText('还没有原子事件')).toBeNull();
  });

  it('opens a blocked deletion dialog without association details and keeps hidden filters', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/deletion-impact')) {
        return jsonResponse({ canDelete: false, hasRelations: true });
      }
      return jsonResponse({ ...firstPage, page: 2, totalItems: 51, totalPages: 2 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList('/events?orphan=true&q=%E5%8E%9F%E6%B2%B9&page=2');

    const row = (await screen.findByRole('link', { name: '原油价格上涨' })).closest('tr')!;
    const edit = within(row).getByRole('link', { name: '编辑' });
    const remove = within(row).getByRole('button', { name: '删除' });
    expect(edit.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(remove);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('这个原子事件存在关联因果关系，必须先删除相关因果关系。')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('2 条')).toBeNull();
    expect(screen.getByRole('link', { name: '查看相关因果关系' }).getAttribute('href')).toBe(
      `/relations?eventId=${firstPage.items[0]!.id}`,
    );
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), 'http://localhost');
        return (
          url.pathname === '/api/events' &&
          url.searchParams.get('orphan') === 'true' &&
          url.searchParams.get('q') === '原油' &&
          url.searchParams.get('page') === '2'
        );
      }),
    ).toBe(true);
  });

  it('switches to blocked mode when a concurrent relation prevents deletion', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return jsonResponse(
          {
            code: 'EVENT_DELETE_BLOCKED',
            message: '这个原子事件存在关联因果关系，必须先删除相关因果关系',
          },
          409,
        );
      }
      if (String(input).includes('/deletion-impact')) {
        return jsonResponse({ canDelete: true, hasRelations: false });
      }
      return jsonResponse({ ...firstPage, totalItems: 1, totalPages: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    expect(
      await screen.findByText('这个原子事件存在关联因果关系，必须先删除相关因果关系。'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull();
    expect(screen.getByRole('link', { name: '查看相关因果关系' })).toBeTruthy();
  });

  it('treats an already deleted event as success and refreshes the list', async () => {
    let listRequests = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return jsonResponse({ code: 'EVENT_NOT_FOUND', message: '事件不存在' }, 404);
      }
      if (String(input).includes('/deletion-impact')) {
        return jsonResponse({ canDelete: true, hasRelations: false });
      }
      listRequests += 1;
      return jsonResponse(
        listRequests === 1
          ? { ...firstPage, totalItems: 1, totalPages: 1 }
          : { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    expect(await screen.findByText('还没有原子事件')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('automatically dismisses an impact loading error after three seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input).includes('/deletion-impact')
        ? jsonResponse({ code: 'INTERNAL_ERROR', message: '无法检查删除影响' }, 500)
        : jsonResponse({ ...firstPage, totalItems: 1, totalPages: 1 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderList();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('alert').textContent).toBe('无法检查删除影响');

    await act(() => vi.advanceTimersByTimeAsync(2_999));
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a stale impact response after another row is selected', async () => {
    const secondEvent = {
      ...firstPage.items[0]!,
      id: '22222222-2222-4222-8222-222222222222',
      name: '市场流动性收紧',
    };
    let resolveFirst: (response: Response) => void = () => {};
    let resolveSecond: (response: Response) => void = () => {};
    const firstImpact = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const secondImpact = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`${firstPage.items[0]!.id}/deletion-impact`)) return firstImpact;
      if (url.includes(`${secondEvent.id}/deletion-impact`)) return secondImpact;
      return jsonResponse({
        ...firstPage,
        items: [firstPage.items[0]!, secondEvent],
        totalItems: 2,
        totalPages: 1,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList();

    const firstRow = (await screen.findByRole('link', { name: '原油价格上涨' })).closest('tr')!;
    const secondRow = screen.getByRole('link', { name: '市场流动性收紧' }).closest('tr')!;
    fireEvent.click(within(firstRow).getByRole('button', { name: '删除' }));
    fireEvent.click(within(secondRow).getByRole('button', { name: '删除' }));

    await act(async () => {
      resolveSecond(await jsonResponse({ canDelete: false, hasRelations: true }));
    });
    expect(screen.getByRole('link', { name: '查看相关因果关系' }).getAttribute('href')).toBe(
      `/relations?eventId=${secondEvent.id}`,
    );

    await act(async () => {
      resolveFirst(await jsonResponse({ canDelete: false, hasRelations: true }));
    });
    expect(screen.getByRole('link', { name: '查看相关因果关系' }).getAttribute('href')).toBe(
      `/relations?eventId=${secondEvent.id}`,
    );
  });

  it('runs enhanced search from page one without storing the mode in the URL', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      return jsonResponse({
        ...firstPage,
        page: Number(url.searchParams.get('page')),
        totalItems: 101,
        totalPages: 3,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderList('/events?q=%E6%94%BF%E7%AD%96&page=2');
    await screen.findByText('共 101 条 · 第 2/3 页');

    fireEvent.click(screen.getByRole('button', { name: '增强查询' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input), 'http://localhost');
          return (
            url.pathname === '/api/events' &&
            url.searchParams.get('searchMode') === 'enhanced' &&
            url.searchParams.get('page') === '1'
          );
        }),
      ).toBe(true),
    );
    expect(new URLSearchParams(router.state.location.search).has('searchMode')).toBe(false);
  });

  it('keeps normal event rows and links settings when enhanced search is unavailable', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      return url.searchParams.get('searchMode') === 'enhanced'
        ? jsonResponse({ code: 'SEMANTIC_INDEX_FAILED', message: '索引失败详情' }, 503)
        : jsonResponse({ ...firstPage, totalItems: 1, totalPages: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList('/events?q=%E6%94%BF%E7%AD%96');
    expect(await screen.findByRole('link', { name: '原油价格上涨' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '增强查询' }));

    expect(await screen.findByText('语义索引生成失败')).toBeTruthy();
    expect(screen.getByRole('link', { name: '前往参数配置' }).getAttribute('href')).toBe(
      '/settings',
    );
    expect(screen.getByRole('link', { name: '原油价格上涨' })).toBeTruthy();
    expect(screen.queryByText('无法加载事件')).toBeNull();
  });
});
