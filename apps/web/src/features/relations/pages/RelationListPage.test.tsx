import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('renders directed rows and expands detail without leaving the list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).includes(`/api/relations/${relation.id}`)
          ? jsonResponse(detail)
          : jsonResponse({ items: [relation], nextCursor: null, hasMore: false }),
      ),
    );
    const router = renderList();

    expect(await screen.findByText('原油价格上涨')).toBeTruthy();
    expect(screen.getByText('→')).toBeTruthy();
    expect(screen.getByText('82%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(await screen.findByText('燃油成本传导')).toBeTruthy();
    expect(screen.getByText('2025年4月美国宣布新一轮关税措施')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看全部 6 条' }).getAttribute('href')).toBe(
      `/cases?relationId=${relation.id}`,
    );
    expect(screen.getByRole('link', { name: '编辑关系' }).getAttribute('href')).toBe(
      `/relations/${relation.id}/edit`,
    );
    await waitFor(() => expect(router.state.location.search).toContain(`expanded=${relation.id}`));
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(router.state.location.search).toContain(`expanded=${relation.id}`);
  });

  it('locates and expands a relation that is not on the current page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).includes(`/api/relations/${relation.id}`)
          ? jsonResponse(detail)
          : jsonResponse({ items: [], nextCursor: null, hasMore: false }),
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
      void input;
      return jsonResponse({ items: [relation], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderList();
    await screen.findByText('原油价格上涨');
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
});
