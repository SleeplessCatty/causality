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
  const routePath = path.split('?')[0]!;
  const router = createMemoryRouter(
    [
      { path: routePath, element },
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

function listSummary(page: number) {
  return {
    id: `00000000-0000-4000-8000-${String(page).padStart(12, '0')}`,
    content: `第 ${page} 页案例`,
    relationCount: page,
    updatedAt: detail.updatedAt,
  };
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
    const fetchMock = vi.fn(() =>
      response({ items: [summary], page: 1, pageSize: 30, totalItems: 31, totalPages: 2 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/cases', <CaseListPage />);
    expect(await screen.findByText(detail.content)).toBeTruthy();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getByText('共 31 条 · 第 1/2 页')).toBeTruthy();
  });

  it('keeps disabled pagination visible with the empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ items: [], page: 1, pageSize: 30, totalItems: 0, totalPages: 1 })),
    );
    renderRoute('/cases', <CaseListPage />);

    expect(await screen.findByText('还没有具体案例')).toBeTruthy();
    expect(screen.getByText('共 0 条 · 第 1/1 页')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
  });

  it('restores URL pages, supports every navigation control, and resets page after filters', async () => {
    const relationId = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      const page = Number(url.searchParams.get('page') ?? '1');
      return response({
        items: [listSummary(page)],
        page,
        pageSize: 30,
        totalItems: 61,
        totalPages: 3,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderRoute(`/cases?relationId=${relationId}&page=2`, <CaseListPage />);

    expect(await screen.findByText('第 2 页案例')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(await screen.findByText('第 1 页案例')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByText('第 2 页案例')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '第 3 页' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '第 3 页' }));
    expect(await screen.findByText('第 3 页案例')).toBeTruthy();
    const jump = screen.getByRole('spinbutton', { name: '跳转页码' });
    await waitFor(() => expect(jump.hasAttribute('disabled')).toBe(false));
    fireEvent.change(jump, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '跳转' }));
    expect(await screen.findByText('第 1 页案例')).toBeTruthy();

    await router.navigate(`/cases?relationId=${relationId}&page=3`);
    await screen.findByText('第 3 页案例');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索案例' }), {
      target: { value: ' 新查询 ' },
    });
    await waitFor(() => {
      const parameters = new URLSearchParams(router.state.location.search);
      expect(parameters.get('q')).toBe('新查询');
      expect(parameters.get('relationId')).toBe(relationId);
      expect(parameters.has('page')).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    await waitFor(() => {
      const parameters = new URLSearchParams(router.state.location.search);
      expect(parameters.get('q')).toBe('新查询');
      expect(parameters.has('relationId')).toBe(false);
      expect(parameters.has('page')).toBe(false);
    });
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
    const title = await screen.findByRole('heading', { name: detail.content });
    const heading = title.closest('.detail-heading');
    expect(heading?.querySelector('.detail-label')?.textContent).toBe('案例内容');
    const editLink = screen.getByRole('link', { name: '编辑案例' });
    expect(editLink.parentElement).toBe(heading);
    const relationLink = screen.getByRole('link', { name: /测试原因.*测试结果/ });
    expect(relationLink.getAttribute('href')).toBe(`/relations/${linkedRelation.id}`);
    expect(relationLink.querySelectorAll('.overflow-text--single-line')).toHaveLength(2);
  });

  it('loads the next relation page and deduplicates relation ids', async () => {
    const firstRelation = {
      id: '22222222-2222-4222-8222-222222222222',
      causeEvent: { id: '33333333-3333-4333-8333-333333333333', name: '第一页原因' },
      effectEvent: { id: '44444444-4444-4444-8444-444444444444', name: '第一页结果' },
      linkedAt: '2026-07-21T03:00:00.000Z',
    };
    const secondRelation = {
      id: '55555555-5555-4555-8555-555555555555',
      causeEvent: { id: '66666666-6666-4666-8666-666666666666', name: '第二页原因' },
      effectEvent: { id: '77777777-7777-4777-8777-777777777777', name: '第二页结果' },
      linkedAt: '2026-07-20T03:00:00.000Z',
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/relations?') && url.includes('cursor=next-page')) {
        return response({
          items: [firstRelation, secondRelation],
          nextCursor: null,
          hasMore: false,
        });
      }
      if (url.includes('/relations?')) {
        return response({ items: [firstRelation], nextCursor: 'next-page', hasMore: true });
      }
      return response({ ...detail, relationCount: 2 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/cases/:caseId', <CaseDetailPage />);

    expect(await screen.findByRole('link', { name: /第一页原因.*第一页结果/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /第二页原因.*第二页结果/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByRole('link', { name: /第二页原因.*第二页结果/ })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /第一页原因.*第一页结果/ })).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      `/api/cases/${detail.id}/relations?limit=30&cursor=next-page`,
    );
  });

  it('keeps loaded relations while retrying a failed next page', async () => {
    const firstRelation = {
      id: '88888888-8888-4888-8888-888888888888',
      causeEvent: { id: '99999999-9999-4999-8999-999999999999', name: '保留原因' },
      effectEvent: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '保留结果' },
      linkedAt: '2026-07-21T03:00:00.000Z',
    };
    const secondRelation = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      causeEvent: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '重试原因' },
      effectEvent: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: '重试结果' },
      linkedAt: '2026-07-20T03:00:00.000Z',
    };
    let relationRequests = 0;
    let resolveRetry: (value: Response | PromiseLike<Response>) => void = () => {};
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (!String(input).includes('/relations?')) return response({ ...detail, relationCount: 2 });
      relationRequests += 1;
      if (relationRequests === 1) {
        return response({ items: [firstRelation], nextCursor: 'retry-page', hasMore: true });
      }
      if (relationRequests === 2) {
        return response({ code: 'INTERNAL_ERROR', message: '加载失败' }, 500);
      }
      return retryResponse;
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/cases/:caseId', <CaseDetailPage />);

    expect(await screen.findByRole('link', { name: /保留原因.*保留结果/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByRole('button', { name: '重试加载其余关联关系' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /保留原因.*保留结果/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试加载其余关联关系' }));
    const loadingButton = await screen.findByRole('button', { name: '加载中…' });
    expect(loadingButton.hasAttribute('disabled')).toBe(true);

    resolveRetry(response({ items: [secondRelation], nextCursor: null, hasMore: false }));
    expect(await screen.findByRole('link', { name: /重试原因.*重试结果/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /保留原因.*保留结果/ })).toBeTruthy();
  });

  it('keeps a 100-character case complete behind the three-line detail clamp', async () => {
    const longContent = 'C'.repeat(100);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).includes('/relations')
          ? response({ items: [], nextCursor: null, hasMore: false })
          : response({ ...detail, content: longContent, relationCount: 0 }),
      ),
    );
    renderRoute('/cases/:caseId', <CaseDetailPage />);

    const heading = await screen.findByRole('heading', { name: longContent });
    expect(heading.textContent).toBe(longContent);
    expect(heading.className).toContain('overflow-text--multi-line');
    expect(heading.style.getPropertyValue('--overflow-text-lines')).toBe('3');
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
