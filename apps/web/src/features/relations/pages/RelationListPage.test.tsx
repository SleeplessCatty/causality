import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { RelationListPage } from './RelationListPage';

const relation = {
  id: '11111111-1111-4111-8111-111111111111',
  causeEvent: { id: '22222222-2222-4222-8222-222222222222', name: '原油价格上涨' },
  effectEvent: { id: '33333333-3333-4333-8333-333333333333', name: '航空成本上升' },
  confidence: 82,
  caseCount: 6,
  updatedAt: '2026-07-21T03:00:00.000Z',
};

const detail = {
  ...relation,
  listPage: 3,
  description: '燃油成本传导',
  createdAt: '2026-07-20T03:00:00.000Z',
  recentCases: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      content: '2025年4月美国宣布新一轮关税措施',
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderList(initialEntry = '/relations') {
  const router = createMemoryRouter(
    [
      { path: '/relations', element: <RelationListPage /> },
      { path: '/relations/new', element: <div>创建关系</div> },
      { path: '/relations/:relationId/edit', element: <div>编辑关系</div> },
      { path: '/relations/:relationId', element: <div>关系详情</div> },
      { path: '/events/:eventId', element: <div>事件详情</div> },
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

describe('RelationListPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps disabled pagination visible with the empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 })),
    );
    renderList();

    expect(await screen.findByText('还没有因果关系')).toBeTruthy();
    expect(screen.getByText('共 0 条 · 第 1/1 页')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
  });

  it('describes empty hidden filters as no matching relations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 })),
    );
    renderList('/relations?orphan=true');

    expect(await screen.findByText('没有找到因果关系')).toBeTruthy();
    expect(screen.queryByText('还没有因果关系')).toBeNull();
  });

  it('links the row entities and keeps expansion concise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).includes(`/api/relations/${relation.id}`)
          ? jsonResponse(detail)
          : jsonResponse({
              items: [relation],
              page: 1,
              pageSize: 50,
              totalItems: 1,
              totalPages: 1,
            }),
      ),
    );
    const router = renderList();

    expect(await screen.findByText('原油价格上涨')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '操作' }).querySelector('.sr-only')).toBeNull();
    expect(screen.getByRole('link', { name: '原油价格上涨' }).getAttribute('href')).toBe(
      `/events/${relation.causeEvent.id}`,
    );
    expect(screen.getByRole('link', { name: '查看因果关系详情' }).getAttribute('href')).toBe(
      `/relations/${relation.id}`,
    );
    const causeLink = screen.getByRole('link', { name: relation.causeEvent.name });
    const directionLink = screen.getByRole('link', { name: '查看因果关系详情' });
    const effectLink = screen.getByRole('link', { name: relation.effectEvent.name });
    expect(causeLink.className).toContain('relation-entity-link');
    expect(causeLink.className).toContain('overflow-text--single-line');
    expect(directionLink.className).toContain('relation-entity-link');
    expect(directionLink.className).toContain('relation-direction__link');
    expect(effectLink.className).toBe(causeLink.className);
    expect(screen.getByRole('link', { name: '编辑' }).getAttribute('href')).toBe(
      `/relations/${relation.id}/edit`,
    );
    expect(screen.getByText('82%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    expect((await screen.findByText('燃油成本传导')).className).toContain(
      'overflow-text--multi-line',
    );
    expect(screen.getByText('2025年4月美国宣布新一轮关税措施')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看全部 6 条' }).getAttribute('href')).toBe(
      `/cases?relationId=${relation.id}`,
    );
    expect(screen.queryByText('创建时间')).toBeNull();
    expect(screen.queryByRole('link', { name: '编辑关系' })).toBeNull();
    await waitFor(() => expect(router.state.location.search).toContain(`expanded=${relation.id}`));
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(router.state.location.search).toContain(`expanded=${relation.id}`);
  });

  it('collapses expansion when moving to either adjacent page', async () => {
    const nextRelation = {
      ...relation,
      id: '66666666-6666-4666-8666-666666666666',
      causeEvent: { ...relation.causeEvent, name: '原油供应下降' },
    };
    const nextDetail = { ...detail, ...nextRelation, description: '下一页关系' };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes(`/api/relations/${nextRelation.id}`)) return jsonResponse(nextDetail);
        if (url.includes(`/api/relations/${relation.id}`)) return jsonResponse(detail);
        if (url.includes('page=2')) {
          return jsonResponse({
            items: [nextRelation],
            page: 2,
            pageSize: 50,
            totalItems: 51,
            totalPages: 2,
          });
        }
        return jsonResponse({
          items: [relation],
          page: 1,
          pageSize: 50,
          totalItems: 51,
          totalPages: 2,
        });
      }),
    );
    const router = renderList();

    fireEvent.click(await screen.findByRole('button', { name: '展开' }));
    await screen.findByText('燃油成本传导');
    expect(screen.getByText('共 51 条 · 第 1/2 页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('原油供应下降');
    expect(router.state.location.search).not.toContain('expanded=');

    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    await screen.findByText('下一页关系');
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await screen.findByText('原油价格上涨');
    expect(router.state.location.search).not.toContain('expanded=');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '第 2 页' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }));
    await screen.findByText('原油供应下降');
    const jump = screen.getByRole('spinbutton', { name: '跳转页码' });
    await waitFor(() => expect(jump.hasAttribute('disabled')).toBe(false));
    fireEvent.change(jump, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '跳转' }));
    await screen.findByText('原油价格上涨');
  });

  it('locates and expands a relation that is not on the current page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).includes(`/api/relations/${relation.id}`)
          ? jsonResponse(detail)
          : jsonResponse({
              items: [],
              page: 1,
              pageSize: 50,
              totalItems: 0,
              totalPages: 1,
            }),
      ),
    );
    const router = renderList(`/relations?expanded=${relation.id}`);

    expect(await screen.findByText('燃油成本传导')).toBeTruthy();
    expect(screen.getByText('原油价格上涨')).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(router.state.location.search).toBe(`?expanded=${relation.id}`);
  });

  it('debounces search and requests a relation query', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      const page = url.searchParams.has('q') ? 1 : 2;
      return jsonResponse({
        items: [relation],
        page,
        pageSize: 50,
        totalItems: 51,
        totalPages: 2,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderList('/relations?page=2');
    await screen.findByText('原油价格上涨');
    expect(screen.getByText('共 51 条 · 第 2/2 页')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索因果关系' }), {
      target: { value: '  油价  ' },
    });
    await waitFor(() => expect(router.state.location.search).toBe('?q=%E6%B2%B9%E4%BB%B7'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('q=%E6%B2%B9%E4%BB%B7')),
      ).toBe(true),
    );
  });

  it('permanently deletes a relation while preserving hidden filters', async () => {
    let listRequests = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') return jsonResponse({ deleted: true });
      if (url.includes('/deletion-impact')) {
        return jsonResponse({ canDelete: true, hasEvents: true, hasCases: true });
      }
      listRequests += 1;
      return jsonResponse(
        listRequests === 1
          ? { items: [relation], page: 2, pageSize: 50, totalItems: 51, totalPages: 2 }
          : { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderList(
      `/relations?eventId=${relation.causeEvent.id}&orphan=true&q=%E5%8E%9F%E6%B2%B9&page=2`,
    );

    const row = (await screen.findByText('原油价格上涨')).closest('tr')!;
    const edit = within(row).getByRole('link', { name: '编辑' });
    const remove = within(row).getByRole('button', { name: '删除' });
    expect(edit.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(remove);
    expect(await screen.findByText(/删除只会移除因果关系及其关联/)).toBeTruthy();
    expect(screen.queryByText(detail.recentCases[0]!.content)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
    expect(await screen.findByText('没有找到因果关系')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), 'http://localhost');
        return (
          url.pathname === '/api/relations' &&
          url.searchParams.get('eventId') === relation.causeEvent.id &&
          url.searchParams.get('orphan') === 'true'
        );
      }),
    ).toBe(true);
    await waitFor(() => expect(listRequests).toBeGreaterThanOrEqual(3));
  });

  it('runs enhanced relation search and shows the updating-index notice', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const enhanced = new URL(String(input), 'http://localhost').searchParams.get('searchMode');
      return jsonResponse({
        items: [relation],
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
        semanticIndexNotice: enhanced === 'enhanced' ? 'updating' : null,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderList('/relations?q=%E6%94%BF%E7%AD%96');
    await screen.findByText('原油价格上涨');

    fireEvent.click(screen.getByRole('button', { name: '增强查询' }));

    expect(await screen.findByText('语义索引尚在同步，结果可能暂不包含最新修改')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('searchMode=enhanced')),
    ).toBe(true);
    expect(new URLSearchParams(router.state.location.search).get('searchMode')).toBe('enhanced');
  });
});
