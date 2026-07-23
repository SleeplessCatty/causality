import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RelationDetailPage } from './RelationDetailPage';

const detail = {
  id: '11111111-1111-4111-8111-111111111111',
  causeEvent: { id: '22222222-2222-4222-8222-222222222222', name: '原油价格上涨' },
  effectEvent: { id: '33333333-3333-4333-8333-333333333333', name: '航空成本上升' },
  confidence: 82,
  caseCount: 2,
  description: '燃油成本传导',
  createdAt: '2026-07-20T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
  recentCases: [],
};

const caseOne = {
  id: '44444444-4444-4444-8444-444444444444',
  content: '案例一',
  relationCount: 1,
  updatedAt: '2026-07-21T03:00:00.000Z',
};
const caseTwo = {
  id: '55555555-5555-4555-8555-555555555555',
  content: '案例二',
  relationCount: 1,
  updatedAt: '2026-07-21T04:00:00.000Z',
};
const caseThree = {
  id: '66666666-6666-4666-8666-666666666666',
  content: '案例三',
  relationCount: 1,
  updatedAt: '2026-07-21T05:00:00.000Z',
};

function response(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderDetail() {
  const router = createMemoryRouter(
    [
      { path: '/relations/:relationId', element: <RelationDetailPage /> },
      { path: '/relations', element: <div>关系列表</div> },
      { path: '/relations/:relationId/edit', element: <div>编辑关系</div> },
      { path: '/events/:eventId', element: <div>事件详情</div> },
      { path: '/cases/:caseId', element: <div>案例详情</div> },
    ],
    { initialEntries: [`/relations/${detail.id}`] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

describe('RelationDetailPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads 20 linked cases initially and every remaining page in one action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith(`/api/relations/${detail.id}/cases?`)) {
          if (url.includes('cursor=third-page')) {
            return response({ items: [caseThree], nextCursor: null, hasMore: false });
          }
          if (url.includes('cursor=second-page')) {
            return response({ items: [caseTwo], nextCursor: 'third-page', hasMore: true });
          }
          return response({ items: [caseOne], nextCursor: 'second-page', hasMore: true });
        }
        return response(detail);
      }),
    );
    renderDetail();

    expect(await screen.findByRole('heading', { name: /原油价格上涨.*航空成本上升/ })).toBeTruthy();
    const causeLink = screen.getByRole('link', { name: '原油价格上涨' });
    expect(causeLink.getAttribute('href')).toBe(`/events/${detail.causeEvent.id}`);
    expect(causeLink.className).toContain('overflow-text--multi-line');
    expect(screen.getByRole('link', { name: '编辑因果关系' }).getAttribute('href')).toBe(
      `/relations/${detail.id}/edit`,
    );
    expect((await screen.findByRole('link', { name: '案例一' })).className).toContain(
      'overflow-text--multi-line',
    );
    expect(screen.queryByRole('link', { name: '案例二' })).toBeNull();
    expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([input]) =>
          String(input).startsWith(`/api/relations/${detail.id}/cases?`),
        ),
    ).toHaveLength(1);
    expect(
      String(
        vi
          .mocked(fetch)
          .mock.calls.find(([input]) =>
            String(input).startsWith(`/api/relations/${detail.id}/cases?`),
          )?.[0],
      ),
    ).toContain('limit=20');
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByRole('link', { name: '案例二' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: '案例三' })).toBeTruthy();
    expect(screen.getByText('燃油成本传导')).toBeTruthy();
    expect(screen.getByText('82%')).toBeTruthy();
  });

  it('shows an empty linked-case state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ ...detail, caseCount: 0 })),
    );
    renderDetail();

    expect(await screen.findByText('尚未关联具体案例')).toBeTruthy();
    expect(screen.queryByText('加载具体案例…')).toBeNull();
  });

  it('hides cached linked-case state after the relation case count becomes zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).startsWith(`/api/relations/${detail.id}/cases?`)
          ? response({ items: [caseOne], nextCursor: null, hasMore: false })
          : response(detail),
      ),
    );
    const { queryClient } = renderDetail();
    expect(await screen.findByRole('link', { name: '案例一' })).toBeTruthy();

    act(() => {
      queryClient.setQueryData(['relations', 'detail', detail.id], { ...detail, caseCount: 0 });
    });

    expect(await screen.findByText('尚未关联具体案例')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '案例一' })).toBeNull();
    expect(screen.queryByText('加载具体案例…')).toBeNull();
  });

  it('preserves the first case page and retries only a failed later page', async () => {
    let secondPageAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (!url.startsWith(`/api/relations/${detail.id}/cases?`)) return response(detail);
        if (!url.includes('cursor=next-page')) {
          return response({ items: [caseOne], nextCursor: 'next-page', hasMore: true });
        }
        secondPageAttempts += 1;
        return secondPageAttempts === 1
          ? response({ code: 'INTERNAL_ERROR', message: '服务暂时不可用' }, 500)
          : response({ items: [caseTwo], nextCursor: null, hasMore: false });
      }),
    );
    renderDetail();

    expect(await screen.findByRole('link', { name: '案例一' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByRole('button', { name: '重试加载其余案例' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '重试加载其余案例' }));
    expect(await screen.findByRole('link', { name: '案例二' })).toBeTruthy();
    expect(secondPageAttempts).toBe(2);
  });

  it('shows an error state when the relation is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ code: 'NOT_FOUND', message: '因果关系不存在' }, 404)),
    );
    renderDetail();

    expect((await screen.findByRole('alert')).textContent).toContain('无法读取因果关系');
    await waitFor(() => expect(screen.getByRole('link', { name: '返回关系列表' })).toBeTruthy());
  });
});
