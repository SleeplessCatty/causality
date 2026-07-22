import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { CaseCreatePage } from './CaseCreatePage';
import { CaseDetailPage } from './CaseDetailPage';
import { CaseEditPage } from './CaseEditPage';
import { CaseListPage } from './CaseListPage';

const detail = {
  id: '11111111-1111-4111-8111-111111111111',
  content: '2025年4月美国宣布新一轮关税措施',
  relationCount: 1,
  createdAt: '2026-07-20T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
};

function response(body: unknown, status = 200) {
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
      { path: '/cases', element: <div>案例列表</div> },
      { path: '/cases/:caseId', element: <div>案例详情目标</div> },
    ],
    { initialEntries: [path.replace(':caseId', detail.id)] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('case pages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists cases and keeps relation filters in the request', async () => {
    const summary = {
      id: detail.id,
      content: detail.content,
      relationCount: detail.relationCount,
      updatedAt: detail.updatedAt,
    };
    const fetchMock = vi.fn(() => response({ items: [summary], nextCursor: null, hasMore: false }));
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/cases', <CaseListPage />);
    expect(await screen.findByText(detail.content)).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('creates a case and navigates to its detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(detail, 201)),
    );
    renderRoute('/cases/new', <CaseCreatePage />);
    fireEvent.change(screen.getByRole('textbox', { name: '案例内容' }), {
      target: { value: detail.content },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建案例' }));
    expect(await screen.findByText('案例详情目标')).toBeTruthy();
  });

  it('shows detail relations and edits a case', async () => {
    const linkedRelation = {
      id: '22222222-2222-4222-8222-222222222222',
      causeEvent: { id: '33333333-3333-4333-8333-333333333333', name: '测试原因' },
      effectEvent: { id: '44444444-4444-4444-8444-444444444444', name: '测试结果' },
      linkedAt: '2026-07-21T03:00:00.000Z',
    };
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PUT') return response({ ...detail, content: '更新后的案例' });
      if (String(input).includes('/relations'))
        return response({ items: [linkedRelation], nextCursor: null, hasMore: false });
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/cases/:caseId', <CaseDetailPage />);
    expect(await screen.findByText(detail.content)).toBeTruthy();
    expect(screen.getByRole('link', { name: '编辑案例' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /测试原因.*测试结果/ }).getAttribute('href')).toBe(
      `/relations/${linkedRelation.id}`,
    );
  });

  it('loads and replaces case content before returning to the list', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT' ? response({ ...detail, content: '更新后的案例' }) : response(detail),
    );
    vi.stubGlobal('fetch', fetchMock);
    const router = renderRoute('/cases/:caseId/edit', <CaseEditPage />);
    const input = await screen.findByRole('textbox', { name: '案例内容' });
    expect(screen.getByRole('link', { name: '返回案例列表' }).getAttribute('href')).toBe('/cases');
    expect(screen.getByRole('link', { name: '取消' }).getAttribute('href')).toBe('/cases');
    fireEvent.change(input, { target: { value: '更新后的案例' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    expect(await screen.findByText('案例列表')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/cases');
  });
});
