import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  DataCheckActionContext,
  DataCheckActionImpact,
  DataCheckActionOption,
  DataCheckIssueListItem,
  DataCheckIssueListResponse,
  DataCheckIssueSource,
  DataCheckLatestResponse,
} from '@causality/contracts';
import { AppProviders } from '../../app/AppProviders';
import { DataMaintenance } from './DataMaintenance';

const snapshotId = 'a1000000-0000-4000-8000-000000000001';
const eventAId = '11000000-0000-4000-8000-000000000001';
const eventBId = '11000000-0000-4000-8000-000000000002';
const caseAId = '21000000-0000-4000-8000-000000000001';
const relationAId = '31000000-0000-4000-8000-000000000001';
const issueAId = 'b1000000-0000-4000-8000-000000000001';
const issueBId = 'b1000000-0000-4000-8000-000000000002';
const actionKey = 'a'.repeat(64);

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

function source(
  displayKind: DataCheckIssueSource['displayKind'],
  items: DataCheckIssueSource['items'],
  overrides: Partial<DataCheckIssueSource> = {},
): DataCheckIssueSource {
  return {
    displayKind,
    items,
    relationDetailPaths: [],
    auxiliaryText: null,
    ...overrides,
  };
}

function issue(
  id: string,
  currentSource: DataCheckIssueSource,
  overrides: Partial<DataCheckIssueListItem> = {},
): DataCheckIssueListItem {
  return {
    id,
    snapshotId,
    severity: 'warning',
    issueType: 'cross_event_shared_alias',
    description: '多个事件使用相同别名',
    suggestion: '比较相关事件并决定是否合并',
    status: 'open',
    targetType: 'event',
    targetId: eventAId,
    relatedId: eventBId,
    handledAt: null,
    source: currentSource,
    ...overrides,
  };
}

const singleIssue = issue(
  issueAId,
  source('single', [
    {
      type: 'event',
      role: 'target',
      label: '供应中断',
      detailPath: `/events/${eventAId}`,
    },
  ]),
  { issueType: 'invalid_event_name', severity: 'error' },
);

const pairIssue = issue(
  issueBId,
  source('pair', [
    {
      type: 'event',
      role: 'target',
      label: '库存下降',
      detailPath: `/events/${eventAId}`,
    },
    {
      type: 'event',
      role: 'related',
      label: '存货减少',
      detailPath: `/events/${eventBId}`,
    },
  ]),
  { issueType: 'duplicate_event_name', severity: 'error' },
);

const relationIssue = issue(
  'b1000000-0000-4000-8000-000000000003',
  source(
    'relation',
    [
      {
        type: 'event',
        role: 'cause',
        label: '原材料供应减少',
        detailPath: `/events/${eventAId}`,
      },
      {
        type: 'event',
        role: 'effect',
        label: '生产成本上升',
        detailPath: `/events/${eventBId}`,
      },
    ],
    { relationDetailPaths: [`/relations/${relationAId}`] },
  ),
  { issueType: 'relation_self_loop', severity: 'error', targetType: 'relation' },
);

const ownedValueIssue = issue(
  'b1000000-0000-4000-8000-000000000004',
  source('owned_value', [
    {
      type: 'event',
      role: 'owner',
      label: '消费需求下降',
      detailPath: `/events/${eventAId}`,
    },
    {
      type: 'alias',
      role: 'value',
      label: '需求走弱',
      detailPath: null,
    },
  ]),
  { issueType: 'invalid_alias_text', severity: 'error', targetType: 'alias' },
);

const brokenReferenceIssue = issue(
  'b1000000-0000-4000-8000-000000000005',
  source(
    'broken_reference',
    [
      {
        type: 'case',
        role: 'target',
        label: '某工厂因洪水停产三日',
        detailPath: `/cases/${caseAId}`,
      },
      {
        type: 'missing',
        role: 'related',
        label: '关联因果关系已不存在',
        detailPath: null,
      },
    ],
    { auxiliaryText: '失效的关系—案例关联' },
  ),
  {
    issueType: 'delete_missing_relation_case',
    severity: 'error',
    targetType: 'relation_case',
  },
);

function issuePage(
  items: DataCheckIssueListItem[],
  page = 1,
  totalPages = 1,
): DataCheckIssueListResponse {
  return {
    items,
    page,
    pageSize: 50,
    totalItems: totalPages === 1 ? items.length : 51,
    totalPages,
  };
}

const zeroImpact: DataCheckActionImpact = {
  relationsMoved: 0,
  relationsDeleted: 0,
  relationCaseLinksMoved: 0,
  relationCaseLinksDeleted: 0,
  recordsDeleted: 0,
  recordsUpdated: 0,
};

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
    actionKey: type === 'ignore' ? null : actionKey,
    impact: zeroImpact,
    ...overrides,
  };
}

function actionContext(
  currentIssue: DataCheckIssueListItem,
  panelKind: DataCheckActionContext['panelKind'] = 'manual',
  overrides: Partial<DataCheckActionContext> = {},
): DataCheckActionContext {
  return {
    snapshotId,
    issueId: currentIssue.id,
    issueType: currentIssue.issueType,
    status: currentIssue.status,
    panelKind,
    records: [
      {
        id: currentIssue.targetId,
        targetType: currentIssue.targetType,
        title: '记录 A',
        primaryText: currentIssue.source.items[0]?.label ?? '记录 A',
        secondaryText: [],
        detailPath: currentIssue.source.items[0]?.detailPath ?? null,
        relationCount: 2,
        caseCount: 1,
      },
    ],
    actions: [action('ignore', '忽略此问题')],
    message: null,
    ...overrides,
  };
}

const mergeContext = actionContext(pairIssue, 'merge', {
  records: [
    {
      id: eventAId,
      targetType: 'event',
      title: '记录 A',
      primaryText: '库存下降',
      secondaryText: ['别名：库存减少'],
      detailPath: `/events/${eventAId}`,
      relationCount: 2,
      caseCount: 0,
    },
    {
      id: eventBId,
      targetType: 'event',
      title: '记录 B',
      primaryText: '存货减少',
      secondaryText: ['别名：库存走低'],
      detailPath: `/events/${eventBId}`,
      relationCount: 1,
      caseCount: 0,
    },
  ],
  actions: [
    action('merge', '将记录 B 合并到记录 A', {
      keepId: eventAId,
      mergeId: eventBId,
      impact: { ...zeroImpact, relationsMoved: 1, recordsDeleted: 1 },
    }),
    action('merge', '将记录 A 合并到记录 B', {
      keepId: eventBId,
      mergeId: eventAId,
      impact: { ...zeroImpact, relationsMoved: 2, recordsDeleted: 1 },
    }),
    action('ignore', '忽略此问题'),
  ],
});

const cleanupContext = actionContext(brokenReferenceIssue, 'cleanup', {
  actions: [
    action('cleanup', '清理此问题', {
      impact: { ...zeroImpact, relationCaseLinksDeleted: 1 },
    }),
    action('ignore', '忽略此问题'),
  ],
});

const deleteRelationContext = actionContext(relationIssue, 'delete_relation', {
  actions: [
    action('delete_relation', '删除此因果关系', {
      impact: {
        ...zeroImpact,
        relationsDeleted: 1,
        relationCaseLinksDeleted: 2,
        recordsDeleted: 1,
      },
    }),
    action('ignore', '忽略此问题'),
  ],
});

const timestampIssue = issue(
  'b1000000-0000-4000-8000-000000000006',
  source('single', [
    {
      type: 'event',
      role: 'target',
      label: '运输成本上升',
      detailPath: `/events/${eventAId}`,
    },
  ]),
  { issueType: 'invalid_event_timestamp_order', severity: 'error' },
);

const timestampContext = actionContext(timestampIssue, 'repair_timestamp', {
  actions: [
    action('repair_timestamp', '修复时间顺序', {
      impact: { ...zeroImpact, recordsUpdated: 1 },
    }),
    action('ignore', '忽略此问题'),
  ],
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function baseFetch(
  latest: DataCheckLatestResponse = neverRun,
  items: DataCheckIssueListItem[] = [],
  contexts: ReadonlyMap<string, DataCheckActionContext> = new Map(),
) {
  return vi.fn((input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/health')) {
      return jsonResponse({ status: 'ok', service: 'causality-api' });
    }
    if (url.endsWith('/api/ready')) {
      return jsonResponse({ status: 'ready', database: 'available' });
    }
    if (url.includes('/api/data-checks/latest/issues')) {
      const requestUrl = new URL(url, 'http://localhost');
      const page = Number(requestUrl.searchParams.get('page') ?? 1);
      return jsonResponse(issuePage(items, page));
    }
    const actionContextMatch = url.match(/\/api\/data-checks\/issues\/([^/]+)\/action-context/);
    if (actionContextMatch) {
      const issueId = actionContextMatch[1]!;
      const currentIssue = items.find((candidate) => candidate.id === issueId);
      const context =
        contexts.get(issueId) ?? (currentIssue ? actionContext(currentIssue) : undefined);
      if (context) return jsonResponse(context);
    }
    if (url.endsWith('/api/data-checks/latest')) return jsonResponse(latest);
    if (url.endsWith('/api/data-checks') && options?.method === 'POST') {
      return jsonResponse({
        ...latest,
        task: {
          status: 'running',
          startedAt: '2026-07-23T09:00:00.000Z',
          finishedAt: null,
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
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

function renderMaintenanceRoute(initialEntry = '/maintenance') {
  const router = createMemoryRouter(
    [
      { path: '/maintenance', element: <DataMaintenance /> },
      { path: '/events/:eventId', element: <div>事件详情页</div> },
      { path: '/cases/:caseId', element: <div>案例详情页</div> },
      { path: '/relations/:relationId', element: <div>关系详情页</div> },
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

describe('DataMaintenance', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the maintenance heading and the compact check controls', async () => {
    vi.stubGlobal('fetch', baseFetch());
    renderMaintenance();

    const title = screen.getByRole('heading', { level: 1, name: '数据维护' });
    const subtitle = screen.getByText('检查数据质量问题并建议处理方案');
    const pageHeading = title.closest('.page-heading');
    expect(pageHeading?.contains(subtitle)).toBe(true);

    const panel = await screen.findByRole('region', { name: '数据检查' });
    await screen.findByText('尚未执行数据检查');
    const actions = panel.querySelector('.data-check-heading-actions');
    expect(actions?.firstElementChild).toBe(screen.getByRole('button', { name: '检查数据' }));
    expect(actions?.lastElementChild).toBe(screen.getByText('等待检查'));
  });

  it('renders exactly the four approved issue columns', async () => {
    vi.stubGlobal('fetch', baseFetch(succeeded));
    renderMaintenance();
    await screen.findByText('最近成功检查');

    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      '严重程度',
      '问题类型',
      '问题来源',
      '处理入口',
    ]);
    expect(screen.queryByRole('columnheader', { name: '问题描述' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '处理建议' })).toBeNull();
  });

  it('renders all five readable source layouts without leaking record identifiers', async () => {
    const items = [singleIssue, pairIssue, relationIssue, ownedValueIssue, brokenReferenceIssue];
    vi.stubGlobal('fetch', baseFetch(succeeded, items));
    renderMaintenanceRoute();

    const table = screen.getByRole('table');
    await within(table).findByRole('link', { name: '供应中断' });
    expect(within(table).getByRole('link', { name: '供应中断' }).getAttribute('href')).toBe(
      `/events/${eventAId}`,
    );
    expect(within(table).getByRole('link', { name: '库存下降' })).toBeTruthy();
    expect(within(table).getByRole('link', { name: '存货减少' })).toBeTruthy();
    expect(within(table).getByRole('link', { name: '查看因果关系详情' }).getAttribute('href')).toBe(
      `/relations/${relationAId}`,
    );
    expect(within(table).getByRole('link', { name: '消费需求下降' })).toBeTruthy();
    expect(within(table).getByText('需求走弱')).toBeTruthy();
    expect(
      within(table).getByRole('link', { name: '某工厂因洪水停产三日' }).getAttribute('href'),
    ).toBe(`/cases/${caseAId}`);
    expect(within(table).getByText('关联因果关系已不存在')).toBeTruthy();
    expect(within(table).getByText('失效的关系—案例关联')).toBeTruthy();
    expect(within(table).queryByText(eventAId)).toBeNull();
    expect(within(table).queryByText(eventBId)).toBeNull();
    expect(
      table.querySelectorAll('.data-check-source .overflow-text').length,
    ).toBeGreaterThanOrEqual(11);
  });

  it('stores one expanded issue in the URL and switches rows in place', async () => {
    vi.stubGlobal('fetch', baseFetch(succeeded, [singleIssue, pairIssue]));
    const router = renderMaintenanceRoute();

    const expandButtons = await screen.findAllByRole('button', { name: '展开' });
    fireEvent.click(expandButtons[0]!);
    await waitFor(() =>
      expect(router.state.location.search).toContain(`expanded=${singleIssue.id}`),
    );
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId(`expanded-${singleIssue.id}`)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '展开' }));
    await waitFor(() => expect(router.state.location.search).toContain(`expanded=${pairIssue.id}`));
    expect(screen.queryByTestId(`expanded-${singleIssue.id}`)).toBeNull();
    expect(screen.getByTestId(`expanded-${pairIssue.id}`)).toBeTruthy();
  });

  it('clears expanded state when a filter or page changes', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/health'))
        return jsonResponse({ status: 'ok', service: 'causality-api' });
      if (url.endsWith('/api/ready'))
        return jsonResponse({ status: 'ready', database: 'available' });
      if (url.endsWith('/api/data-checks/latest')) return jsonResponse(succeeded);
      if (url.includes('/api/data-checks/latest/issues')) {
        const requestUrl = new URL(url, 'http://localhost');
        return jsonResponse(
          issuePage([singleIssue], Number(requestUrl.searchParams.get('page') ?? 1), 2),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = renderMaintenanceRoute(`/maintenance?expanded=${singleIssue.id}`);

    expect(await screen.findByTestId(`expanded-${singleIssue.id}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '严重程度' }));
    fireEvent.click(screen.getByRole('option', { name: '错误' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?severity=error');
    });

    fireEvent.click(await screen.findByRole('button', { name: '展开' }));
    await waitFor(() =>
      expect(router.state.location.search).toContain(`expanded=${singleIssue.id}`),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?severity=error&page=2');
    });
  });

  it('keeps handled rows passive and non-expandable', async () => {
    const handled = {
      ...pairIssue,
      id: 'b1000000-0000-4000-8000-000000000020',
      status: 'handled' as const,
      handledAt: '2026-07-23T09:10:00.000Z',
    };
    vi.stubGlobal('fetch', baseFetch(succeeded, [singleIssue, handled]));
    renderMaintenanceRoute();

    const handledSource = await screen.findByRole('link', { name: '库存下降' });
    expect(screen.getAllByRole('button', { name: '展开' })).toHaveLength(1);
    const handledRow = handledSource.closest('tr')!;
    expect(within(handledRow).getByText('已处理')).toBeTruthy();
    expect(within(handledRow).queryByRole('button')).toBeNull();
  });

  it('normalizes invalid URL values and preserves filters on snapshot reset', async () => {
    vi.stubGlobal('fetch', baseFetch(succeeded, [singleIssue]));
    const router = renderMaintenanceRoute(
      '/maintenance?page=wat&severity=critical&issueType=unknown&status=stale&expanded=bad',
    );
    await waitFor(() => expect(router.state.location.search).toBe(''));

    fireEvent.click(screen.getByRole('button', { name: '严重程度' }));
    fireEvent.click(screen.getByRole('option', { name: '警告' }));
    await waitFor(() => expect(router.state.location.search).toBe('?severity=warning'));
  });

  it('renders the five approved inline panel variants without a close action', async () => {
    const variants = [
      { currentIssue: pairIssue, context: mergeContext, confirm: true, radios: 2 },
      {
        currentIssue: brokenReferenceIssue,
        context: cleanupContext,
        confirm: true,
        radios: 0,
      },
      {
        currentIssue: relationIssue,
        context: deleteRelationContext,
        confirm: true,
        radios: 0,
      },
      {
        currentIssue: timestampIssue,
        context: timestampContext,
        confirm: true,
        radios: 0,
      },
      {
        currentIssue: singleIssue,
        context: actionContext(singleIssue),
        confirm: false,
        radios: 0,
      },
    ] as const;

    for (const variant of variants) {
      const contexts = new Map([[variant.currentIssue.id, variant.context]]);
      vi.stubGlobal('fetch', baseFetch(succeeded, [variant.currentIssue], contexts));
      renderMaintenanceRoute(`/maintenance?expanded=${variant.currentIssue.id}`);
      const panel = await screen.findByTestId(`expanded-${variant.currentIssue.id}`);
      await within(panel).findByRole('button', { name: '忽略此问题' });

      expect(within(panel).getByRole('heading', { name: '问题描述' })).toBeTruthy();
      expect(within(panel).getByRole('heading', { name: '处理建议' })).toBeTruthy();
      expect(within(panel).queryByText('问题来源详情')).toBeNull();
      expect(within(panel).queryByText('处理方式')).toBeNull();
      expect(within(panel).queryAllByRole('radio')).toHaveLength(variant.radios);
      expect(within(panel).queryByRole('button', { name: '关闭' })).toBeNull();
      expect(within(panel).getByRole('button', { name: '忽略此问题' })).toBeTruthy();

      const confirm = within(panel).queryByRole('button', { name: '确认处理' });
      if (variant.confirm) {
        expect(confirm).toBeTruthy();
        expect((confirm as HTMLButtonElement).disabled).toBe(variant.context.panelKind === 'merge');
      } else {
        expect(confirm).toBeNull();
      }
      cleanup();
    }
  });

  it('loads inline context before enabling operations', async () => {
    let resolveContext!: (value: Response) => void;
    const contextResponse = new Promise<Response>((resolve) => {
      resolveContext = resolve;
    });
    const fetchMock = baseFetch(succeeded, [singleIssue]);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        if (String(input).includes('/action-context')) return contextResponse;
        return fetchMock(input, options);
      }),
    );
    renderMaintenanceRoute(`/maintenance?expanded=${singleIssue.id}`);

    const panel = await screen.findByTestId(`expanded-${singleIssue.id}`);
    expect(within(panel).getByText('正在加载处理方案…')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: '忽略此问题' })).toBeNull();

    resolveContext((await jsonResponse(actionContext(singleIssue))) as unknown as Response);
    expect(await within(panel).findByRole('button', { name: '忽略此问题' })).toBeTruthy();
  });

  it('selects a merge direction, shows its impact, and orders confirm before ignore', async () => {
    vi.stubGlobal(
      'fetch',
      baseFetch(succeeded, [pairIssue], new Map([[pairIssue.id, mergeContext]])),
    );
    renderMaintenanceRoute(`/maintenance?expanded=${pairIssue.id}`);

    const panel = await screen.findByTestId(`expanded-${pairIssue.id}`);
    const confirm = await within(panel).findByRole('button', { name: '确认处理' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(panel).getByRole('radio', { name: '将记录 B 合并到记录 A' }));

    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(within(panel).getByText('移动关系 1 条')).toBeTruthy();
    const ignore = within(panel).getByRole('button', { name: '忽略此问题' });
    expect(confirm.nextElementSibling).toBe(ignore);
  });

  it('locks the expanded row while applying and keeps a failed merge selection', async () => {
    let rejectAction!: (reason: unknown) => void;
    const actionResponse = new Promise<Response>((_, reject) => {
      rejectAction = reject;
    });
    const fetchMock = baseFetch(succeeded, [pairIssue], new Map([[pairIssue.id, mergeContext]]));
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(`/api/data-checks/issues/${pairIssue.id}/actions`)) {
          return actionResponse;
        }
        return fetchMock(input, options);
      }),
    );
    renderMaintenanceRoute(`/maintenance?expanded=${pairIssue.id}`);

    const panel = await screen.findByTestId(`expanded-${pairIssue.id}`);
    const selected = await within(panel).findByRole('radio', {
      name: '将记录 B 合并到记录 A',
    });
    fireEvent.click(selected);
    fireEvent.click(within(panel).getByRole('button', { name: '确认处理' }));

    await waitFor(() => {
      expect(
        (within(panel).getByRole('button', { name: '处理中…' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect((screen.getByRole('button', { name: '收起' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
    rejectAction(new Error('网络连接已中断'));

    expect((await within(panel).findByRole('alert')).textContent).toContain('网络连接已中断');
    expect((selected as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId(`expanded-${pairIssue.id}`)).toBeTruthy();
  });

  it('disables stale actions and directs the user to run a full check', async () => {
    const fetchMock = baseFetch(
      succeeded,
      [brokenReferenceIssue],
      new Map([[brokenReferenceIssue.id, cleanupContext]]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, options?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(`/api/data-checks/issues/${brokenReferenceIssue.id}/actions`)) {
          return jsonResponse(
            { code: 'DATA_CHECK_ACTION_CONFLICT', message: '数据已变化，请重新加载处理方案' },
            409,
          );
        }
        return fetchMock(input, options);
      }),
    );
    renderMaintenanceRoute(`/maintenance?expanded=${brokenReferenceIssue.id}`);

    const panel = await screen.findByTestId(`expanded-${brokenReferenceIssue.id}`);
    fireEvent.click(await within(panel).findByRole('button', { name: '确认处理' }));

    expect(await within(panel).findByText(/请使用页面顶部的“检查数据”/)).toBeTruthy();
    expect(
      (within(panel).getByRole('button', { name: '确认处理' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(panel).getByRole('button', { name: '忽略此问题' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each([
    {
      label: '未处理筛选',
      initialEntry: `/maintenance?status=open&expanded=${brokenReferenceIssue.id}`,
      expectVisible: false,
    },
    {
      label: '全部筛选',
      initialEntry: `/maintenance?expanded=${brokenReferenceIssue.id}`,
      expectVisible: true,
    },
  ])(
    'refreshes the issue row after a successful action under $label',
    async ({ initialEntry, expectVisible }) => {
      let applied = false;
      let submittedBody: unknown = null;
      const handledIssue = {
        ...brokenReferenceIssue,
        status: 'handled' as const,
        handledAt: '2026-07-23T09:20:00.000Z',
      };
      const handledIssueResponse = {
        id: handledIssue.id,
        snapshotId: handledIssue.snapshotId,
        severity: handledIssue.severity,
        issueType: handledIssue.issueType,
        description: handledIssue.description,
        suggestion: handledIssue.suggestion,
        status: handledIssue.status,
        targetType: handledIssue.targetType,
        targetId: handledIssue.targetId,
        relatedId: handledIssue.relatedId,
        handledAt: handledIssue.handledAt,
      };
      const fetchMock = baseFetch(
        succeeded,
        [brokenReferenceIssue],
        new Map([[brokenReferenceIssue.id, cleanupContext]]),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL | Request, options?: RequestInit) => {
          const url = String(input);
          if (url.endsWith(`/api/data-checks/issues/${brokenReferenceIssue.id}/actions`)) {
            applied = true;
            submittedBody = JSON.parse(String(options?.body));
            return jsonResponse({
              issue: handledIssueResponse,
              affectedEventIds: [],
              affectedCaseIds: [caseAId],
              affectedRelationIds: [],
            });
          }
          if (url.includes('/api/data-checks/latest/issues') && applied) {
            const requestUrl = new URL(url, 'http://localhost');
            const items = requestUrl.searchParams.get('status') === 'open' ? [] : [handledIssue];
            return jsonResponse(issuePage(items));
          }
          return fetchMock(input, options);
        }),
      );
      const router = renderMaintenanceRoute(initialEntry);

      const panel = await screen.findByTestId(`expanded-${brokenReferenceIssue.id}`);
      fireEvent.click(await within(panel).findByRole('button', { name: '确认处理' }));
      await waitFor(() => expect(router.state.location.search).not.toContain('expanded='));

      expect(submittedBody).toEqual({
        type: 'cleanup',
        snapshotId,
        actionKey,
      });
      if (expectVisible) {
        const sourceLink = await screen.findByRole('link', { name: '某工厂因洪水停产三日' });
        expect(within(sourceLink.closest('tr')!).getByText('已处理')).toBeTruthy();
      } else {
        await waitFor(() =>
          expect(screen.queryByRole('link', { name: '某工厂因洪水停产三日' })).toBeNull(),
        );
      }
      cleanup();
    },
  );
});
