import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
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

describe('DataMaintenance', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it('updates auto and manual action cells to handled without refreshing resource lists', async () => {
    const autoIssue = issue('b1000000-0000-4000-8000-000000000001', 'auto');
    const manualIssue = issue('b1000000-0000-4000-8000-000000000002', 'manual');
    const fetchMock = vi.fn((input: string | URL | Request, options?: RequestInit) => {
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
      if (url.endsWith('/auto-handle') && options?.method === 'POST') {
        return jsonResponse({
          ...autoIssue,
          status: 'handled',
          handledAt: '2026-07-23T09:10:00.000Z',
        });
      }
      if (url.endsWith('/manual-handle') && options?.method === 'POST') {
        return jsonResponse({
          ...manualIssue,
          status: 'handled',
          handledAt: '2026-07-23T09:10:00.000Z',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMaintenance();

    const autoRow = (await screen.findByText(autoIssue.description)).closest('tr')!;
    fireEvent.click(within(autoRow).getByRole('button', { name: '自动处理' }));
    await waitFor(() => expect(within(autoRow).getByText('已处理')).toBeTruthy());

    const manualRow = screen.getByText(manualIssue.description).closest('tr')!;
    fireEvent.click(within(manualRow).getByRole('button', { name: '手动处理' }));
    await waitFor(() => expect(within(manualRow).getByText('已处理')).toBeTruthy());

    expect(
      fetchMock.mock.calls.some(([input]) =>
        /^\/api\/(events|relations|cases)/.test(String(input)),
      ),
    ).toBe(false);
  });
});
