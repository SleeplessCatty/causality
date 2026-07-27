import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { EventCreatePage } from './EventCreatePage';
import { EventDetailPage } from './EventDetailPage';
import { EventEditPage } from './EventEditPage';

const eventDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '原油价格上涨',
  description: '国际原油价格持续上行',
  aliases: ['油价上涨'],
  keywords: ['原油', '能源价格'],
  relationCount: 2,
  listPage: 3,
  createdAt: '2026-07-20T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function renderRoute(path: string, element: React.ReactNode, state?: Record<string, unknown>) {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '/events/:eventId', element: <div>已进入事件详情</div> },
      { path: '/events', element: <div>事件列表</div> },
      { path: '/maintenance', element: <div>数据维护目标</div> },
    ],
    { initialEntries: [{ pathname: path.replace(':eventId', eventDetail.id), state }] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('event route pages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an event and navigates to its detail route', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(eventDetail, 201);
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderRoute('/events/new', <EventCreatePage />, {
      listReturnPath: '/events?page=4',
    });

    expect(screen.getByRole('link', { name: '返回事件列表' }).getAttribute('href')).toBe(
      '/events?page=4',
    );
    expect(screen.getByRole('link', { name: '取消' }).getAttribute('href')).toBe('/events?page=4');
    fireEvent.change(screen.getByRole('textbox', { name: '标准名称' }), {
      target: { value: eventDetail.name },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建事件' }));

    expect(await screen.findByText('已进入事件详情')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    expect(router.state.location.state).toMatchObject({
      notice: '事件已创建',
      listReturnPath: '/events?page=3',
      listFocusId: eventDetail.id,
    });
  });

  it('shows full event detail and its edit link', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input).includes('/relations?')
        ? jsonResponse({ items: [], nextCursor: null, hasMore: false })
        : jsonResponse({ ...eventDetail, relationCount: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/events/:eventId', <EventDetailPage />);

    const title = await screen.findByRole('heading', { name: eventDetail.name });
    const heading = title.closest('.detail-heading');
    expect(heading?.querySelector('.detail-label')?.textContent).toBe('原子事件');
    expect(heading?.firstElementChild?.tagName).toBe('DIV');
    expect(screen.getByText(eventDetail.description)).toBeTruthy();
    expect(screen.getByText('油价上涨')).toBeTruthy();
    const editLink = screen.getByRole('link', { name: '编辑事件' });
    expect(editLink.getAttribute('href')).toBe(`/events/${eventDetail.id}/edit`);
    expect(editLink.parentElement).toBe(heading);
    expect(screen.getByRole('link', { name: '返回事件列表' }).getAttribute('href')).toBe(
      '/events?page=3',
    );
    expect(screen.getByRole('heading', { name: '关联的因果关系' })).toBeTruthy();
    expect(await screen.findByText('当前原子事件尚未关联因果关系')).toBeTruthy();
  });

  it('shows the complete direction of upstream and downstream relations and loads all remaining', async () => {
    const upstreamId = '22222222-2222-4222-8222-222222222222';
    const downstreamId = '33333333-3333-4333-8333-333333333333';
    const upstreamRelationId = '44444444-4444-4444-8444-444444444444';
    const downstreamRelationId = '55555555-5555-4555-8555-555555555555';
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes('/relations?')) return jsonResponse(eventDetail);
      if (url.includes('cursor=next-page')) {
        return jsonResponse({
          items: [
            {
              id: downstreamRelationId,
              causeEvent: { id: eventDetail.id, name: eventDetail.name },
              effectEvent: { id: downstreamId, name: '航空公司成本上升' },
              linkedAt: '2026-07-22T04:30:00.000Z',
            },
          ],
          nextCursor: null,
          hasMore: false,
        });
      }
      return jsonResponse({
        items: [
          {
            id: upstreamRelationId,
            causeEvent: { id: upstreamId, name: '全球原油供应收缩' },
            effectEvent: { id: eventDetail.id, name: eventDetail.name },
            linkedAt: '2026-07-23T04:30:00.000Z',
          },
        ],
        nextCursor: 'next-page',
        hasMore: true,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/events/:eventId', <EventDetailPage />);

    await screen.findByRole('heading', { name: eventDetail.name });
    const upstreamLink = (await screen.findByText('全球原油供应收缩')).closest('a')!;
    expect(upstreamLink.getAttribute('href')).toBe(`/relations/${upstreamRelationId}`);
    expect(upstreamLink.textContent).toBe(`全球原油供应收缩→${eventDetail.name}`);
    expect(screen.queryByText('航空公司成本上升')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    const downstreamLink = (await screen.findByText('航空公司成本上升')).closest('a')!;
    expect(downstreamLink.getAttribute('href')).toBe(`/relations/${downstreamRelationId}`);
    expect(downstreamLink.textContent).toBe(`${eventDetail.name}→航空公司成本上升`);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(`/api/events/${eventDetail.id}/relations?limit=20&cursor=next-page`),
      ),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('retries the initial relation request without refreshing the event detail', async () => {
    let relationAttempts = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (!String(input).includes('/relations?')) {
        return jsonResponse({ ...eventDetail, relationCount: 1 });
      }
      relationAttempts += 1;
      return relationAttempts === 1
        ? jsonResponse({ code: 'INTERNAL_ERROR', message: '暂时无法访问' }, 500)
        : jsonResponse({ items: [], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/events/:eventId', <EventDetailPage />);

    expect(await screen.findByText('无法读取关联关系')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

    expect(await screen.findByText('当前原子事件尚未关联因果关系')).toBeTruthy();
    expect(relationAttempts).toBe(2);
    expect(
      fetchMock.mock.calls.filter(([input]) => !String(input).includes('/relations?')),
    ).toHaveLength(1);
  });

  it('loads and replaces an event before returning to the list', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT'
        ? jsonResponse({ ...eventDetail, name: '原油价格快速上涨' })
        : jsonResponse(eventDetail),
    );
    vi.stubGlobal('fetch', fetchMock);
    const router = renderRoute('/events/:eventId/edit', <EventEditPage />, {
      listReturnPath: '/events?q=%E5%8E%9F%E6%B2%B9&page=2',
      listFocusId: eventDetail.id,
    });

    const nameInput = await screen.findByRole('textbox', { name: '标准名称' });
    expect(screen.getByRole('link', { name: '返回事件列表' }).getAttribute('href')).toBe(
      '/events?q=%E5%8E%9F%E6%B2%B9&page=2',
    );
    expect(screen.getByRole('link', { name: '取消' }).getAttribute('href')).toBe(
      '/events?q=%E5%8E%9F%E6%B2%B9&page=2',
    );
    fireEvent.change(nameInput, { target: { value: '原油价格快速上涨' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    expect(await screen.findByText('事件列表')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/events');
    expect(router.state.location.state).toMatchObject({
      notice: '修改已保存',
      listFocusId: eventDetail.id,
    });
  });

  it('returns a data-check edit to its issue without recheck on cancel and with one marker on save', async () => {
    const issueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const snapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const returnPath = `/maintenance?severity=warning&issue=${issueId}`;
    const state = {
      dataCheckReturnPath: returnPath,
      dataCheckSnapshotId: snapshotId,
      dataCheckIssueId: issueId,
      dataCheckReturnMode: 'cancel',
    };
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT'
        ? jsonResponse({ ...eventDetail, name: '修正事件' })
        : jsonResponse(eventDetail),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cancelRouter = renderRoute('/events/:eventId/edit', <EventEditPage />, state);
    await screen.findByRole('textbox', { name: '标准名称' });
    fireEvent.click(screen.getByRole('link', { name: '取消' }));
    expect(await screen.findByText('数据维护目标')).toBeTruthy();
    expect(cancelRouter.state.location.search).toBe(`?severity=warning&issue=${issueId}`);
    expect(cancelRouter.state.location.state).toMatchObject({ dataCheckReturnMode: 'cancel' });

    cleanup();
    const saveRouter = renderRoute('/events/:eventId/edit', <EventEditPage />, state);
    fireEvent.change(await screen.findByRole('textbox', { name: '标准名称' }), {
      target: { value: '修正事件' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('数据维护目标')).toBeTruthy();
    expect(saveRouter.state.location.search).toBe(`?severity=warning&issue=${issueId}&recheck=1`);
    expect(saveRouter.state.location.state).toMatchObject({ dataCheckReturnMode: 'saved' });
  });
});
