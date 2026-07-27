import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  listPage: 3,
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

function renderRoute(path: string, element: React.ReactNode, state?: Record<string, unknown>) {
  const routePath = path.split('?')[0]!;
  const [initialPathname, initialSearch] = path.replace(':caseId', detail.id).split('?');
  const router = createMemoryRouter(
    [
      { path: routePath, element },
      { path: '/cases', element: <div>案例列表</div> },
      { path: '/cases/:caseId', element: <div>案例详情目标</div> },
      { path: '/maintenance', element: <div>数据维护目标</div> },
    ],
    {
      initialEntries: [
        {
          pathname: initialPathname!,
          search: initialSearch ? `?${initialSearch}` : '',
          state,
        },
      ],
    },
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
      response({ items: [summary], page: 1, pageSize: 50, totalItems: 51, totalPages: 2 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/cases', <CaseListPage />);
    expect(await screen.findByText(detail.content)).toBeTruthy();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getByText('共 51 条 · 第 1/2 页')).toBeTruthy();
  });

  it('keeps disabled pagination visible with the empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 })),
    );
    renderRoute('/cases', <CaseListPage />);

    expect(await screen.findByText('还没有具体案例')).toBeTruthy();
    expect(screen.getByText('共 0 条 · 第 1/1 页')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
  });

  it('describes an empty hidden orphan filter as no matching cases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 })),
    );
    renderRoute('/cases?orphan=true', <CaseListPage />);

    expect(await screen.findByText('没有找到案例')).toBeTruthy();
    expect(screen.queryByText('还没有具体案例')).toBeNull();
  });

  it('restores URL pages, supports every navigation control, and resets page after filters', async () => {
    const relationId = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      const page = Number(url.searchParams.get('page') ?? '1');
      return response({
        items: [listSummary(page)],
        page,
        pageSize: 50,
        totalItems: 101,
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
    const router = renderRoute('/cases/new', <CaseCreatePage />, {
      listReturnPath: '/cases?page=4',
    });
    expect(screen.getByRole('link', { name: '返回案例列表' }).getAttribute('href')).toBe(
      '/cases?page=4',
    );
    expect(screen.getByRole('link', { name: '取消' }).getAttribute('href')).toBe('/cases?page=4');
    fireEvent.change(screen.getByRole('textbox', { name: '案例内容' }), {
      target: { value: detail.content },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建案例' }));
    expect(await screen.findByText('案例详情目标')).toBeTruthy();
    expect(router.state.location.state).toMatchObject({
      notice: '案例已创建',
      listReturnPath: '/cases?page=3',
      listFocusId: detail.id,
    });
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
    expect(screen.getByRole('link', { name: '返回案例列表' }).getAttribute('href')).toBe(
      '/cases?page=3',
    );
    const relationLink = screen.getByRole('link', { name: /测试原因.*测试结果/ });
    expect(relationLink.getAttribute('href')).toBe(`/relations/${linkedRelation.id}`);
    expect(relationLink.querySelectorAll('.overflow-text--single-line')).toHaveLength(2);
  });

  it('loads every remaining relation page in one action and deduplicates relation ids', async () => {
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
    const thirdRelation = {
      id: '88888888-8888-4888-8888-888888888888',
      causeEvent: { id: '99999999-9999-4999-8999-999999999999', name: '第三页原因' },
      effectEvent: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '第三页结果' },
      linkedAt: '2026-07-19T03:00:00.000Z',
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/relations?') && url.includes('cursor=third-page')) {
        return response({ items: [thirdRelation], nextCursor: null, hasMore: false });
      }
      if (url.includes('/relations?') && url.includes('cursor=second-page')) {
        return response({
          items: [firstRelation, secondRelation],
          nextCursor: 'third-page',
          hasMore: true,
        });
      }
      if (url.includes('/relations?')) {
        return response({ items: [firstRelation], nextCursor: 'second-page', hasMore: true });
      }
      return response({ ...detail, relationCount: 3 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/cases/:caseId', <CaseDetailPage />);

    expect(await screen.findByRole('link', { name: /第一页原因.*第一页结果/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /第二页原因.*第二页结果/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByRole('link', { name: /第二页原因.*第二页结果/ })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /第三页原因.*第三页结果/ })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /第一页原因.*第一页结果/ })).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      `/api/cases/${detail.id}/relations?limit=20&cursor=second-page`,
    );
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      `/api/cases/${detail.id}/relations?limit=20&cursor=third-page`,
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

  it('permanently deletes a case while keeping relation and orphan filters', async () => {
    const relationId = '22222222-2222-4222-8222-222222222222';
    let listRequests = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') return response({ deleted: true });
      if (url.includes('/deletion-impact')) {
        return response({ canDelete: true, hasRelations: true });
      }
      listRequests += 1;
      return response(
        listRequests === 1
          ? {
              items: [
                {
                  id: detail.id,
                  content: detail.content,
                  relationCount: 1,
                  updatedAt: detail.updatedAt,
                },
              ],
              page: 1,
              pageSize: 50,
              totalItems: 1,
              totalPages: 1,
            }
          : { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(`/cases?relationId=${relationId}&orphan=true`, <CaseListPage />);

    const row = (await screen.findByText(detail.content)).closest('tr')!;
    const edit = within(row).getByRole('link', { name: '编辑' });
    const remove = within(row).getByRole('button', { name: '删除' });
    expect(edit.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(remove);
    expect(await screen.findByText(/删除只会移除案例及其关联/)).toBeTruthy();
    expect(screen.queryByText('1 条')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    expect(await screen.findByText('没有找到案例')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), 'http://localhost');
        return (
          url.pathname === '/api/cases' &&
          url.searchParams.get('relationId') === relationId &&
          url.searchParams.get('orphan') === 'true'
        );
      }),
    ).toBe(true);
  });

  it('loads and replaces case content before returning to the list', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT'
        ? response({ ...detail, content: '更新后的案例', listPage: 1 })
        : response(detail),
    );
    vi.stubGlobal('fetch', fetchMock);
    const router = renderRoute('/cases/:caseId/edit', <CaseEditPage />, {
      listReturnPath: '/cases?q=%E5%85%B3%E7%A8%8E&page=2',
      listFocusId: detail.id,
    });
    const input = await screen.findByRole('textbox', { name: '案例内容' });
    expect(screen.getByRole('link', { name: '返回案例列表' }).getAttribute('href')).toBe(
      '/cases?q=%E5%85%B3%E7%A8%8E&page=2',
    );
    expect(screen.getByRole('link', { name: '取消' }).getAttribute('href')).toBe(
      '/cases?q=%E5%85%B3%E7%A8%8E&page=2',
    );
    fireEvent.change(input, { target: { value: '更新后的案例' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    expect(await screen.findByText('案例列表')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/cases');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toMatchObject({
      notice: '修改已保存',
      listFocusId: detail.id,
    });
  });

  it('cancels a data-check case edit back to the open issue without rechecking', async () => {
    const issueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(detail)),
    );
    const router = renderRoute('/cases/:caseId/edit', <CaseEditPage />, {
      dataCheckReturnPath: `/maintenance?status=open&issue=${issueId}`,
      dataCheckSnapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      dataCheckIssueId: issueId,
      dataCheckReturnMode: 'cancel',
    });

    await screen.findByRole('textbox', { name: '案例内容' });
    fireEvent.click(screen.getByRole('link', { name: '取消' }));
    expect(await screen.findByText('数据维护目标')).toBeTruthy();
    expect(router.state.location.search).toBe(`?status=open&issue=${issueId}`);
    expect(router.state.location.search).not.toContain('recheck');
  });

  it('keeps enhanced case mode while paging and resets it when the search text changes', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      const page = Number(url.searchParams.get('page') ?? '1');
      return response({
        items: [listSummary(page)],
        page,
        pageSize: 50,
        totalItems: 101,
        totalPages: 3,
        semanticIndexNotice: url.searchParams.get('searchMode') === 'enhanced' ? 'updating' : null,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderRoute('/cases?q=%E5%85%B3%E7%A8%8E', <CaseListPage />);
    await screen.findByText('第 1 页案例');

    fireEvent.click(screen.getByRole('button', { name: '增强查询' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes('searchMode=enhanced')),
      ).toBe(true),
    );
    expect(new URLSearchParams(router.state.location.search).get('searchMode')).toBe('enhanced');
    expect(await screen.findByText('语义索引尚在同步，结果可能暂不包含最新修改')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input), 'http://localhost');
          return (
            url.searchParams.get('searchMode') === 'enhanced' &&
            url.searchParams.get('page') === '2'
          );
        }),
      ).toBe(true),
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索案例' }), {
      target: { value: '新案例' },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input), 'http://localhost');
          return url.searchParams.get('q') === '新案例' && !url.searchParams.has('searchMode');
        }),
      ).toBe(true),
    );
    expect(new URLSearchParams(router.state.location.search).has('searchMode')).toBe(false);
  });
});
