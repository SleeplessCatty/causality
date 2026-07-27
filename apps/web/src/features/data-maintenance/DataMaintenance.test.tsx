import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DataCheckActionContext,
  DataCheckActionOption,
  DataCheckActionRecord,
  DataCheckIssue,
  DataCheckIssueListResponse,
  DataCheckLatestResponse,
} from '@causality/contracts';
import { AppProviders } from '../../app/AppProviders';
import { DataMaintenance } from './DataMaintenance';

const snapshotId = 'a1000000-0000-4000-8000-000000000001';

const neverRun: DataCheckLatestResponse = {
  task: { status: 'never_run', startedAt: null, finishedAt: null },
  snapshot: null,
  latestFailure: null,
};

const succeeded: DataCheckLatestResponse = {
  task: {
    status: 'succeeded',
    startedAt: '2026-07-23T09:00:00.000Z',
    finishedAt: '2026-07-23T09:00:01.000Z',
  },
  snapshot: {
    snapshotId,
    checkedAt: '2026-07-23T09:00:01.000Z',
    orphanEventCount: 2,
    orphanRelationCount: 3,
    orphanCaseCount: 4,
    errorCount: 5,
    warningCount: 6,
    openCount: 7,
    handledCount: 8,
    semanticStatus: 'skipped',
    semanticReason: 'not_recorded',
  },
  latestFailure: null,
};

const issue = (
  id: string,
  actionMode: DataCheckIssue['actionMode'],
  status: DataCheckIssue['status'] = 'open',
): DataCheckIssue => ({
  id,
  snapshotId,
  severity: actionMode === 'auto' ? 'error' : 'warning',
  issueType: actionMode === 'auto' ? 'delete_missing_alias' : 'cross_event_shared_alias',
  description: actionMode === 'auto' ? '事件别名引用不存在的事件' : '多个事件使用相同别名',
  suggestion: actionMode === 'auto' ? '删除失效别名' : '比较事件并手动处理',
  actionMode,
  status,
  targetType: actionMode === 'auto' ? 'alias' : 'event',
  targetId:
    actionMode === 'auto'
      ? '41000000-0000-4000-8000-000000000001'
      : '11000000-0000-4000-8000-000000000001',
  relatedId: '11000000-0000-4000-8000-000000000002',
  handledAt: status === 'handled' ? '2026-07-23T09:10:00.000Z' : null,
});

function issuePage(items: DataCheckIssue[], page = 1, totalPages = 1): DataCheckIssueListResponse {
  return {
    items,
    page,
    pageSize: 50,
    totalItems: totalPages === 1 ? items.length : 51,
    totalPages,
  };
}

function renderMaintenance() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <DataMaintenance />
      </AppProviders>
    </MemoryRouter>,
  );
}

function renderMaintenanceRoute(
  initialEntry = '/maintenance',
  state?: Record<string, unknown>,
  queryClient?: QueryClient,
) {
  const [pathname, search = ''] = initialEntry.split('?');
  const router = createMemoryRouter(
    [
      { path: '/maintenance', element: <DataMaintenance /> },
      { path: '/events/:eventId/edit', element: <div>事件编辑页</div> },
      { path: '/cases/:caseId/edit', element: <div>案例编辑页</div> },
      { path: '/relations/:relationId/edit', element: <div>关系编辑页</div> },
    ],
    {
      initialEntries: [{ pathname: pathname!, search: search ? `?${search}` : '', state }],
    },
  );
  render(
    queryClient ? (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ) : (
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    ),
  );
  return router;
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function baseFetch(latest: DataCheckLatestResponse = neverRun) {
  return vi.fn((input: string | URL | Request, _options?: RequestInit) => {
    void _options;
    const url = String(input);
    if (url.endsWith('/api/health')) {
      return jsonResponse({ status: 'ok', service: 'causality-api' });
    }
    if (url.endsWith('/api/ready')) {
      return jsonResponse({ status: 'ready', database: 'available' });
    }
    if (url.includes('/api/data-checks/latest/issues')) {
      return jsonResponse(issuePage([]));
    }
    if (url.endsWith('/api/data-checks/latest')) return jsonResponse(latest);
    throw new Error(`Unexpected request: ${url}`);
  });
}

const firstRecordId = '11000000-0000-4000-8000-000000000001';
const secondRecordId = '11000000-0000-4000-8000-000000000002';

function action(
  type: DataCheckActionOption['type'],
  label: string,
  overrides: Partial<DataCheckActionOption> = {},
): DataCheckActionOption {
  return {
    type,
    label,
    keepId: null,
    mergeId: null,
    editPath: null,
    impact: {
      relationsMoved: 0,
      relationsDeleted: 0,
      relationCaseLinksMoved: 0,
      relationCaseLinksDeleted: 0,
      recordsDeleted: 0,
    },
    ...overrides,
  };
}

function record(
  id: string,
  title: string,
  overrides: Partial<DataCheckActionRecord> = {},
): DataCheckActionRecord {
  return {
    id,
    targetType: 'event',
    title,
    primaryText: `${title}主要内容`,
    secondaryText: [`${title}补充内容`],
    detailPath: `/events/${id}`,
    relationCount: 2,
    caseCount: 3,
    ...overrides,
  };
}

function context(
  issueId: string,
  overrides: Partial<DataCheckActionContext> = {},
): DataCheckActionContext {
  return {
    snapshotId,
    issueId,
    issueType: 'duplicate_event_name',
    status: 'open',
    dialogKind: 'merge',
    records: [record(firstRecordId, '记录 A'), record(secondRecordId, '记录 B')],
    actions: [
      action('merge', '保留 A，合并 B', {
        keepId: firstRecordId,
        mergeId: secondRecordId,
        impact: {
          relationsMoved: 4,
          relationsDeleted: 1,
          relationCaseLinksMoved: 2,
          relationCaseLinksDeleted: 3,
          recordsDeleted: 1,
        },
      }),
      action('merge', '保留 B，合并 A', {
        keepId: secondRecordId,
        mergeId: firstRecordId,
        impact: {
          relationsMoved: 7,
          relationsDeleted: 6,
          relationCaseLinksMoved: 5,
          relationCaseLinksDeleted: 4,
          recordsDeleted: 1,
        },
      }),
      action('ignore', '忽略此问题'),
    ],
    message: null,
    ...overrides,
  };
}

describe('DataMaintenance', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the maintenance title and data-check subtitle outside the panel', async () => {
    vi.stubGlobal('fetch', baseFetch());

    renderMaintenance();

    const title = screen.getByRole('heading', { level: 1, name: '数据维护' });
    const subtitle = screen.getByText('检查数据质量问题并建议处理方案');
    const pageHeading = title.closest('.page-heading');
    expect(pageHeading).toBeTruthy();
    expect(pageHeading?.contains(subtitle)).toBe(true);

    const panel = await screen.findByRole('region', { name: '数据检查' });
    expect(within(panel).queryByRole('heading', { name: '数据检查' })).toBeNull();

    const actions = panel.querySelector('.data-check-heading-actions');
    const checkButton = actions?.querySelector('.data-check-run-button');
    const checkStatus = within(panel).getByText('等待检查');
    expect(actions?.firstElementChild).toBe(checkButton);
    expect(actions?.lastElementChild).toBe(checkStatus);
  });

  it('shows the unified action, first-run state, and exactly three issue columns', async () => {
    const fetchMock = baseFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderMaintenance();

    expect(
      ((await screen.findByRole('button', { name: '检查数据' })) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(await screen.findByText('尚未执行数据检查')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      '问题描述',
      '处理建议',
      '执行入口',
    ]);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '严重程度' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '问题类型' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '处理状态' })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('disables the data check action while database readiness is pending', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );

    renderMaintenance();

    expect((screen.getByRole('button', { name: '检查中…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows the latest data check request failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    renderMaintenance();

    expect(await screen.findByText('network down')).toBeTruthy();
  });

  it('shows unavailable when initial PostgreSQL readiness returns 503', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'not_ready', database: 'unavailable' }, 503);
      }
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(neverRun);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMaintenance();

    expect(await screen.findByText('数据库不可用，无法执行检查')).toBeTruthy();
  });

  it('starts a data check only after refreshed readiness is ready', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(neverRun);
      if (url.endsWith('/api/data-checks') && options?.method === 'POST') {
        return jsonResponse({
          ...neverRun,
          task: {
            status: 'running',
            startedAt: '2026-07-23T09:00:00.000Z',
            finishedAt: null,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenance();
    await screen.findByText('尚未执行数据检查');

    fireEvent.click(screen.getByRole('button', { name: '检查数据' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, options]) =>
            String(input).endsWith('/api/data-checks') && options?.method === 'POST',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('数据检查进行中')).toBeTruthy();
  });

  it('does not start a data check when refreshed readiness is unavailable', async () => {
    let readinessCalls = 0;
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        readinessCalls += 1;
        return readinessCalls === 1
          ? jsonResponse({ status: 'ready', database: 'available' })
          : jsonResponse({ status: 'not_ready', database: 'unavailable' }, 503);
      }
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(neverRun);
      if (url.endsWith('/api/data-checks') && options?.method === 'POST') {
        throw new Error('Data check must not start');
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenance();
    await screen.findByText('尚未执行数据检查');

    fireEvent.click(screen.getByRole('button', { name: '检查数据' }));

    expect(await screen.findByText('数据库不可用，无法执行检查')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, options]) =>
          String(input).endsWith('/api/data-checks') && options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('polls latest state while running and stops after success', async () => {
    let latestCalls = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/data-checks/latest')) {
        latestCalls += 1;
        return jsonResponse(
          latestCalls === 1
            ? {
                ...neverRun,
                task: {
                  status: 'running',
                  startedAt: '2026-07-23T09:00:00.000Z',
                  finishedAt: null,
                },
              }
            : succeeded,
        );
      }
      if (url.includes('/api/data-checks/latest/issues')) return jsonResponse(issuePage([]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMaintenance();

    expect(await screen.findByText('数据检查进行中')).toBeTruthy();
    expect(await screen.findByText('最近成功检查')).toBeTruthy();
    expect(latestCalls).toBe(2);
  });

  it('shows an older success snapshot with failure details and three orphan links', async () => {
    const latest: DataCheckLatestResponse = {
      ...succeeded,
      task: {
        status: 'failed',
        startedAt: '2026-07-23T10:00:00.000Z',
        finishedAt: '2026-07-23T10:00:01.000Z',
      },
      latestFailure: {
        failedAt: '2026-07-23T10:00:01.000Z',
        message: '规则执行失败',
      },
    };
    vi.stubGlobal('fetch', baseFetch(latest));

    renderMaintenance();

    expect(await screen.findByText('最近成功检查')).toBeTruthy();
    expect(screen.getByText('规则执行失败')).toBeTruthy();
    expect(screen.getByRole('link', { name: /孤立原子事件/ }).getAttribute('href')).toBe(
      '/events?orphan=true',
    );
    expect(screen.getByRole('link', { name: /无案例因果关系/ }).getAttribute('href')).toBe(
      '/relations?orphan=true',
    );
    expect(screen.getByRole('link', { name: /孤立具体案例/ }).getAttribute('href')).toBe(
      '/cases?orphan=true',
    );
    expect(screen.queryByText(/过期|陈旧|stale/i)).toBeNull();
  });

  it('requests fixed pages and resets to page one when filters change', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/api/data-checks/latest/issues')) {
        const requestUrl = new URL(url, 'http://localhost');
        const page = Number(requestUrl.searchParams.get('page') ?? 1);
        return jsonResponse(
          issuePage([issue(`b${page}000000-0000-4000-8000-000000000001`, 'manual')], page, 2),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenance();
    await screen.findByText('多个事件使用相同别名');

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/api/data-checks/latest/issues?page=2'),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: '严重程度' }));
    fireEvent.click(screen.getByRole('option', { name: '警告' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = String(input);
          return url.includes('page=1') && url.includes('severity=warning');
        }),
      ).toBe(true),
    );
  });

  it('replaces an out-of-range numeric page with the server-clamped page', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([], 3, 3));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderMaintenanceRoute('/maintenance?page=999&severity=warning');

    await waitFor(() =>
      expect(router.state.location.search).toBe('?page=3&severity=warning'),
    );
  });

  it('shows issue identifiers without deriving record navigation from issue metadata', async () => {
    const invalidAlias: DataCheckIssue = {
      ...issue('b1000000-0000-4000-8000-000000000010', 'manual'),
      issueType: 'invalid_alias_text',
      targetType: 'alias',
      targetId: '41000000-0000-4000-8000-000000000010',
      relatedId: '11000000-0000-4000-8000-000000000010',
      description: '事件别名内容异常',
    };
    const missingAlias: DataCheckIssue = {
      ...invalidAlias,
      id: 'b1000000-0000-4000-8000-000000000011',
      issueType: 'delete_missing_alias',
      targetId: '41000000-0000-4000-8000-000000000011',
      relatedId: '11000000-0000-4000-8000-000000000011',
      description: '事件别名引用的原子事件不存在',
    };
    const duplicateKeyword: DataCheckIssue = {
      ...invalidAlias,
      id: 'b1000000-0000-4000-8000-000000000012',
      issueType: 'delete_duplicate_keyword',
      targetType: 'keyword',
      targetId: '51000000-0000-4000-8000-000000000012',
      relatedId: '51000000-0000-4000-8000-000000000013',
      description: '同一原子事件存在重复关键词',
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/api/data-checks/latest/issues')) {
        return jsonResponse(issuePage([invalidAlias, missingAlias, duplicateKeyword]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenance();

    await screen.findByText(invalidAlias.description);
    const table = screen.getByRole('table');
    expect(within(table).queryAllByRole('link')).toHaveLength(0);
    expect(within(table).getByText('11000000-0000-4000-8000-000000000010')).toBeTruthy();
    expect(within(table).getByText('11000000-0000-4000-8000-000000000011')).toBeTruthy();
    expect(within(table).getByText('51000000-0000-4000-8000-000000000013')).toBeTruthy();
  });

  it('stops using legacy auto/manual action mode copy and endpoints', async () => {
    const autoIssue = issue('b1000000-0000-4000-8000-000000000001', 'auto');
    const manualIssue = issue('b1000000-0000-4000-8000-000000000002', 'manual');
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/api/data-checks/latest/issues')) {
        return jsonResponse(issuePage([autoIssue, manualIssue]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenance();

    expect(await screen.findAllByRole('button', { name: '操作' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '自动处理' })).toBeNull();
    expect(screen.queryByRole('button', { name: '手动处理' })).toBeNull();
    expect(
      fetchMock.mock.calls.some(([input]) => /auto-handle|manual-handle/.test(String(input))),
    ).toBe(false);
  });

  it('keeps the open filter URL-owned while offering the typed operation entry', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000003', 'manual');
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      }
      if (url.endsWith('/api/ready')) {
        return jsonResponse({ status: 'ready', database: 'available' });
      }
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/api/data-checks/latest/issues')) {
        const requestUrl = new URL(url, 'http://localhost');
        const openOnly = requestUrl.searchParams.get('status') === 'open';
        return jsonResponse(issuePage(openOnly ? [current] : [current]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenance();
    await screen.findByText(current.description);

    fireEvent.click(screen.getByRole('button', { name: '处理状态' }));
    fireEvent.click(screen.getByRole('option', { name: '未处理' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('status=open'))).toBe(
        true,
      ),
    );
    await screen.findByText(current.description);

    expect(screen.getByRole('button', { name: '操作' })).toBeTruthy();
  });

  it('derives page, filters, and issue modal from the URL and restores them with history', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000020', 'manual');
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/action-context')) return jsonResponse(context(current.id));
      if (url.includes('/api/data-checks/latest/issues')) {
        const requestUrl = new URL(url, 'http://localhost');
        return jsonResponse(issuePage([current], Number(requestUrl.searchParams.get('page')), 2));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderMaintenanceRoute(
      `/maintenance?page=2&severity=warning&issueType=cross_event_shared_alias&status=open&issue=${current.id}`,
    );

    expect(await screen.findByRole('dialog', { name: '处理检查问题' })).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = String(input);
        return (
          url.includes('/latest/issues?page=2') &&
          url.includes('severity=warning') &&
          url.includes('issueType=cross_event_shared_alias') &&
          url.includes('status=open')
        );
      }),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(router.state.location.search).not.toContain('issue='));
    await router.navigate(-1);
    expect(await screen.findByRole('dialog', { name: '处理检查问题' })).toBeTruthy();
    expect(router.state.location.search).toContain('page=2');
    expect(router.state.location.search).toContain('severity=warning');
    await router.navigate(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toContain('page=2');
  });

  it('scrolls the current issue row into view after returning from edit', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000022', 'manual');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context')) return jsonResponse(context(current.id));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute(`/maintenance?issue=${current.id}`);

    await screen.findByText(current.description);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
  });

  it('normalizes invalid URL values and resets page when a filter changes', async () => {
    vi.stubGlobal('fetch', baseFetch(succeeded));
    const router = renderMaintenanceRoute(
      '/maintenance?page=wat&severity=critical&issueType=unknown&status=stale&issue=bad',
    );

    await waitFor(() => expect(router.state.location.search).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: '严重程度' }));
    fireEvent.click(screen.getByRole('option', { name: '警告' }));
    await waitFor(() => expect(router.state.location.search).toBe('?severity=warning'));
  });

  it('resets page and closes the old issue when a new snapshot arrives while retaining filters', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000021', 'manual');
    let latestCalls = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) {
        latestCalls += 1;
        return jsonResponse(
          latestCalls === 1
            ? { ...succeeded, task: { ...succeeded.task, status: 'running' } }
            : {
                ...succeeded,
                snapshot: {
                  ...succeeded.snapshot!,
                  snapshotId: 'a1000000-0000-4000-8000-000000000099',
                },
              },
        );
      }
      if (url.includes('/action-context')) return jsonResponse(context(current.id));
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current], 2, 2));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderMaintenanceRoute(
      `/maintenance?page=2&severity=warning&issue=${current.id}`,
    );

    await screen.findByText('最近成功检查');
    await waitFor(() => {
      expect(router.state.location.search).toBe('?severity=warning');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the same secondary 操作 button for every open row and keeps handled rows passive', async () => {
    const autoIssue = issue('b1000000-0000-4000-8000-000000000030', 'auto');
    const manualIssue = issue('b1000000-0000-4000-8000-000000000031', 'manual');
    const handledIssue = issue('b1000000-0000-4000-8000-000000000032', 'manual', 'handled');
    const fetchMock = baseFetch(succeeded);
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues'))
        return jsonResponse(issuePage([autoIssue, manualIssue, handledIssue]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute();

    const buttons = await screen.findAllByRole('button', { name: '操作' });
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.className === 'button button--secondary')).toBe(true);
    const handledRow = screen.getAllByText(handledIssue.description).at(-1)!.closest('tr')!;
    expect(within(handledRow).getByText('已处理')).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });

  it('loads merge context, starts without a direction, and shows only selected server impact', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000040', 'manual');
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context'))
        return jsonResponse(
          context(current.id, {
            actions: [
              ...context(current.id).actions,
              action('open_edit', '编辑记录 A', {
                editPath: `/events/${firstRecordId}/edit`,
              }),
            ],
          }),
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute();
    fireEvent.click(await screen.findByRole('button', { name: '操作' }));

    const dialog = await screen.findByRole('dialog', { name: '处理检查问题' });
    expect((await within(dialog).findAllByText('记录 A')).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('记录 B').length).toBeGreaterThan(0);
    expect(dialog.querySelectorAll('.overflow-text')).not.toHaveLength(0);
    expect(within(dialog).getAllByText('2 条关系 · 3 个案例')).toHaveLength(2);
    expect(
      within(dialog)
        .getAllByRole('radio')
        .every((radio) => !(radio as HTMLInputElement).checked),
    ).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: '确认处理' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(within(dialog).getByRole('radio', { name: '保留 A，合并 B' }));
    expect(within(dialog).getByText(/移动关系 4 条/)).toBeTruthy();
    expect(within(dialog).queryByText(/移动关系 7 条/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: '保留 B，合并 A' }));
    expect(within(dialog).getByText(/移动关系 7 条/)).toBeTruthy();
    expect(within(dialog).queryByText(/移动关系 4 条/)).toBeNull();
    expect(
      (within(dialog).getByRole('button', { name: '确认处理' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      within(dialog)
        .getByRole('button', { name: '忽略此问题' })
        .closest('.data-check-dialog__ignore'),
    ).toBeTruthy();
    expect(document.activeElement).not.toBe(
      within(dialog).getByRole('button', { name: '忽略此问题' }),
    );
    expect(within(dialog).getByRole('button', { name: '编辑记录 A' })).toBeTruthy();
  });

  it.each([
    [
      'cleanup',
      action('cleanup', '清理失效数据'),
      '清理失效数据',
      '确认清理检查发现的失效或重复数据。',
    ],
    [
      'delete_relation',
      action('delete_relation', '删除异常关系'),
      '删除异常关系',
      '此操作会删除异常因果关系，请确认后继续。',
    ],
    [
      'repair_timestamp',
      action('repair_timestamp', '修复时间字段'),
      '修复时间字段',
      '将依据服务器提供的修复方案校正时间字段。',
    ],
    [
      'edit',
      action('open_edit', '打开详情编辑', { editPath: `/events/${firstRecordId}/edit` }),
      '打开详情编辑',
      '请打开详情编辑并保存更正，返回后会重新检查此问题。',
    ],
    [
      'ignore_only',
      action('open_edit', '仍可安全编辑', { editPath: `/events/${firstRecordId}/edit` }),
      '仍可安全编辑',
      '当前问题没有自动修复方案，可忽略或使用服务器提供的安全入口。',
    ],
  ] as const)(
    'renders server actions for %s contexts, including safe edit in ignore_only',
    async (dialogKind, currentAction, label, expectedCopy) => {
      const current = issue('b1000000-0000-4000-8000-000000000041', 'manual');
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/health'))
          return jsonResponse({ status: 'ok', service: 'causality-api' });
        if (url.endsWith('/api/ready'))
          return jsonResponse({ status: 'ready', database: 'available' });
        if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
        if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
        if (url.includes('/action-context'))
          return jsonResponse(
            context(current.id, {
              dialogKind,
              records: [record(firstRecordId, '当前记录')],
              actions: [currentAction, action('ignore', '忽略此问题')],
            }),
          );
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      renderMaintenanceRoute();
      fireEvent.click(await screen.findByRole('button', { name: '操作' }));

      expect(await screen.findByRole('button', { name: label })).toBeTruthy();
      expect(screen.getByText(expectedCopy)).toBeTruthy();
    },
  );

  it('never initially focuses ignore when it is the only server action', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000045', 'manual');
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context'))
        return jsonResponse(
          context(current.id, {
            dialogKind: 'ignore_only',
            records: [record(firstRecordId, '当前记录')],
            actions: [action('ignore', '忽略此问题')],
          }),
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute();
    fireEvent.click(await screen.findByRole('button', { name: '操作' }));

    const ignore = await screen.findByRole('button', { name: '忽略此问题' });
    expect(ignore.closest('.data-check-dialog__ignore')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' })),
    );
  });

  it('opens only the server-provided edit path with a maintenance return state', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000046', 'manual');
    const editPath = `/events/${firstRecordId}/edit`;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context'))
        return jsonResponse(
          context(current.id, {
            dialogKind: 'ignore_only',
            records: [record(firstRecordId, '当前记录')],
            actions: [action('open_edit', '打开详情编辑', { editPath })],
          }),
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderMaintenanceRoute('/maintenance?severity=warning');
    fireEvent.click(await screen.findByRole('button', { name: '操作' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开详情编辑' }));

    expect(await screen.findByText('事件编辑页')).toBeTruthy();
    expect(router.state.location.pathname).toBe(editPath);
    expect(router.state.location.state).toEqual({
      dataCheckReturnPath: `/maintenance?severity=warning&issue=${current.id}`,
      dataCheckSnapshotId: snapshotId,
      dataCheckIssueId: current.id,
      dataCheckReturnMode: 'cancel',
    });
  });

  it('shows a stale server message with reload and never fabricates an edit action', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000042', 'manual');
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context'))
        return jsonResponse(
          context(current.id, {
            dialogKind: 'edit',
            records: [record(firstRecordId, '损坏记录')],
            actions: [],
            message: '当前记录不符合严格详情页加载约束，暂时无法打开编辑页',
          }),
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute();
    fireEvent.click(await screen.findByRole('button', { name: '操作' }));

    expect(
      await screen.findByText('当前记录不符合严格详情页加载约束，暂时无法打开编辑页'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull();
  });

  it('locks Escape and backdrop while an action is pending, then invalidates affected data', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000043', 'manual');
    let resolveAction!: (value: Response) => void;
    const actionResponse = new Promise<Response>((resolve) => {
      resolveAction = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context'))
        return jsonResponse(
          context(current.id, {
            dialogKind: 'cleanup',
            records: [record(firstRecordId, '失效数据')],
            actions: [action('cleanup', '清理失效数据')],
          }),
        );
      if (url.includes('/actions') && options?.method === 'POST') return actionResponse;
      if (/^\/api\/(events|cases|relations)/.test(url)) return jsonResponse({});
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute();
    fireEvent.click(await screen.findByRole('button', { name: '操作' }));
    fireEvent.click(await screen.findByRole('button', { name: '清理失效数据' }));
    await screen.findByRole('button', { name: '处理中…' });

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('.delete-dialog-backdrop')!);
    expect(screen.getByRole('dialog')).toBeTruthy();

    resolveAction(
      await jsonResponse({
        issue: { ...current, status: 'handled', handledAt: '2026-07-23T09:10:00.000Z' },
        affectedEventIds: [firstRecordId],
        affectedCaseIds: ['21000000-0000-4000-8000-000000000001'],
        affectedRelationIds: ['31000000-0000-4000-8000-000000000001'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/latest/issues'))).toBe(
      true,
    );
  });

  it('invalidates both detail and edit relation-association cache keys after success', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000047', 'manual');
    const relationId = '31000000-0000-4000-8000-000000000047';
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    queryClient.setQueryData(['cases', 'relation-associations', relationId], { detail: true });
    queryClient.setQueryData(['cases', 'relation-associations', 'edit', relationId], {
      edit: true,
    });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context'))
        return jsonResponse(
          context(current.id, {
            dialogKind: 'cleanup',
            records: [record(firstRecordId, '失效数据')],
            actions: [action('cleanup', '清理失效数据')],
          }),
        );
      if (url.includes('/actions') && options?.method === 'POST')
        return jsonResponse({
          issue: { ...current, status: 'handled', handledAt: '2026-07-23T09:10:00.000Z' },
          affectedEventIds: [],
          affectedCaseIds: [],
          affectedRelationIds: [relationId],
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute('/maintenance', undefined, queryClient);
    fireEvent.click(await screen.findByRole('button', { name: '操作' }));
    fireEvent.click(await screen.findByRole('button', { name: '清理失效数据' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      queryClient.getQueryState(['cases', 'relation-associations', relationId])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(['cases', 'relation-associations', 'edit', relationId])
        ?.isInvalidated,
    ).toBe(true);
  });

  it('locks Close, Escape, and backdrop while an edit-return recheck is pending', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000048', 'manual');
    let resolveRecheck!: (value: Response) => void;
    const pendingRecheck = new Promise<Response>((resolve) => {
      resolveRecheck = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/action-context')) return jsonResponse(context(current.id));
      if (url.includes('/recheck') && options?.method === 'POST') return pendingRecheck;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenanceRoute(`/maintenance?issue=${current.id}&recheck=1`, {
      dataCheckReturnPath: `/maintenance?issue=${current.id}`,
      dataCheckSnapshotId: snapshotId,
      dataCheckIssueId: current.id,
      dataCheckReturnMode: 'saved',
    });

    const dialog = await screen.findByRole('dialog');
    const close = within(dialog).getByRole('button', { name: '关闭' });
    await waitFor(() => expect((close as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('.delete-dialog-backdrop')!);
    expect(screen.getByRole('dialog')).toBeTruthy();

    resolveRecheck(
      await jsonResponse({ status: 'open', issue: current, context: context(current.id) }),
    );
    await waitFor(() => expect((close as HTMLButtonElement).disabled).toBe(false));
  });

  it('consumes a saved edit recheck marker once with replace and keeps the issue open', async () => {
    const current = issue('b1000000-0000-4000-8000-000000000044', 'manual');
    let rechecks = 0;
    const routerRef: { current?: ReturnType<typeof createMemoryRouter> } = {};
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/latest/issues')) return jsonResponse(issuePage([current]));
      if (url.includes('/recheck') && options?.method === 'POST') {
        expect(routerRef.current?.state.location.search).not.toContain('recheck');
        rechecks += 1;
        return jsonResponse({ status: 'open', issue: current, context: context(current.id) });
      }
      if (url.includes('/action-context')) return jsonResponse(context(current.id));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderMaintenanceRoute(
      `/maintenance?severity=warning&issue=${current.id}&recheck=1`,
      {
        dataCheckReturnPath: `/maintenance?severity=warning&issue=${current.id}`,
        dataCheckSnapshotId: snapshotId,
        dataCheckIssueId: current.id,
        dataCheckReturnMode: 'saved',
      },
    );
    routerRef.current = router;

    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(rechecks).toBe(1));
    expect(router.state.location.search).toBe(`?severity=warning&issue=${current.id}`);
    const currentEntry = `${router.state.location.pathname}${router.state.location.search}`;
    const currentState = router.state.location.state as Record<string, unknown>;
    cleanup();
    renderMaintenanceRoute(currentEntry, currentState);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(rechecks).toBe(1);
  });

  it.each(['cancel', 'saved'] as const)(
    'does not reopen an issue from a %s return when the latest snapshot changed before mount',
    async (returnMode) => {
      const current = issue('b1000000-0000-4000-8000-000000000049', 'manual');
      const latestSnapshotId = 'a1000000-0000-4000-8000-000000000099';
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/health'))
          return jsonResponse({ status: 'ok', service: 'causality-api' });
        if (url.endsWith('/api/ready'))
          return jsonResponse({ status: 'ready', database: 'available' });
        if (url.endsWith('/api/data-checks/latest'))
          return jsonResponse({
            ...succeeded,
            snapshot: { ...succeeded.snapshot!, snapshotId: latestSnapshotId },
          });
        if (url.includes('/latest/issues')) return jsonResponse(issuePage([]));
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const marker = returnMode === 'saved' ? '&recheck=1' : '';
      const router = renderMaintenanceRoute(
        `/maintenance?page=4&severity=warning&issue=${current.id}${marker}`,
        {
          dataCheckReturnPath: `/maintenance?page=4&severity=warning&issue=${current.id}`,
          dataCheckSnapshotId: snapshotId,
          dataCheckIssueId: current.id,
          dataCheckReturnMode: returnMode,
        },
      );

      await waitFor(() => expect(router.state.location.search).toBe('?severity=warning'));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(
        fetchMock.mock.calls.some(([input]) => /action-context|recheck/.test(String(input))),
      ).toBe(false);
    },
  );
});
