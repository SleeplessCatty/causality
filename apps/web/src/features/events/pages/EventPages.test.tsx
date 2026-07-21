import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderRoute(path: string, element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '/events/:eventId', element: <div>已进入事件详情</div> },
      { path: '/events', element: <div>事件列表</div> },
    ],
    { initialEntries: [path.replace(':eventId', eventDetail.id)] },
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
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(eventDetail, 201);
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/events/new', <EventCreatePage />);

    fireEvent.change(screen.getByRole('textbox', { name: '标准名称' }), {
      target: { value: eventDetail.name },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建事件' }));

    expect(await screen.findByText('已进入事件详情')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
  });

  it('shows full event detail and its edit link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(eventDetail)),
    );
    renderRoute('/events/:eventId', <EventDetailPage />);

    expect(await screen.findByRole('heading', { name: eventDetail.name })).toBeTruthy();
    expect(screen.getByText(eventDetail.description)).toBeTruthy();
    expect(screen.getByText('油价上涨')).toBeTruthy();
    expect(screen.getByRole('link', { name: '编辑事件' }).getAttribute('href')).toBe(
      `/events/${eventDetail.id}/edit`,
    );
  });

  it('loads and replaces an event before returning to detail', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT'
        ? jsonResponse({ ...eventDetail, name: '原油价格快速上涨' })
        : jsonResponse(eventDetail),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/events/:eventId/edit', <EventEditPage />);

    const nameInput = await screen.findByRole('textbox', { name: '标准名称' });
    fireEvent.change(nameInput, { target: { value: '原油价格快速上涨' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    expect(await screen.findByText('已进入事件详情')).toBeTruthy();
  });
});
