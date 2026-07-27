import type { ImportBatchListResponse, ImportBatchSummary } from '@causality/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app/AppProviders';
import { getImportHistory, uploadImport } from './dataTransferApi';
import { DataTransferPage } from './DataTransferPage';

vi.mock('./dataTransferApi', () => ({
  uploadImport: vi.fn(),
  getImportHistory: vi.fn(),
  getImportBatch: vi.fn(),
  getImportRecords: vi.fn(),
}));

const batch: ImportBatchSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  filename: '跨领域因果资料.csv',
  completedAt: '2026-07-27T06:00:00.000Z',
  recordTypes: ['event', 'case', 'relation', 'relation_case'],
  counts: {
    event: { created: 2, reused: 1 },
    case: { created: 3, reused: 2 },
    relation: { created: 1, reused: 1 },
    relationCase: { created: 2, reused: 3 },
  },
};

function historyPage(
  items: ImportBatchSummary[] = [batch],
  page = 1,
  totalPages = 1,
): ImportBatchListResponse {
  return {
    items,
    page,
    pageSize: 50,
    totalItems: totalPages === 1 ? items.length : 51,
    totalPages,
  };
}

function TestLayout() {
  return (
    <>
      <Link to="/events">离开导入页</Link>
      <Outlet />
    </>
  );
}

function renderPage(initialEntry = '/data-transfer?tab=import&page=1') {
  const router = createMemoryRouter(
    [
      {
        element: <TestLayout />,
        children: [
          { path: '/data-transfer', element: <DataTransferPage /> },
          { path: '/events', element: <div>已离开导入页</div> },
          {
            path: '/data-transfer/imports/:batchId',
            element: <div>导入详情占位</div>,
          },
        ],
      },
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

function chooseFile(name = 'mixed.csv', size = 1_572_864): File {
  const file = new File([new Uint8Array(size)], name, { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('选择 CSV 文件'), {
    target: { files: [file] },
  });
  return file;
}

describe('DataTransferPage', () => {
  beforeEach(() => {
    vi.mocked(getImportHistory).mockResolvedValue(historyPage());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps the import tab and history page in the URL and renders the approved history table', async () => {
    vi.mocked(getImportHistory).mockResolvedValue(historyPage([batch], 2, 2));
    const router = renderPage('/data-transfer?tab=import&page=2');

    expect(await screen.findByText(batch.filename)).toBeTruthy();
    expect(router.state.location.search).toBe('?tab=import&page=2');
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '完成时间',
      '文件名',
      '原子事件',
      '具体案例',
      '因果关系',
      '案例关联',
      '查看详情',
    ]);
    expect(screen.getByText('新增 2 / 复用 1')).toBeTruthy();
    expect(screen.getByText('新增 3 / 复用 2')).toBeTruthy();
    expect(screen.getByText('新增 1 / 复用 1')).toBeTruthy();
    expect(screen.getByText('新增 2 / 复用 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看导入详情' }).getAttribute('href')).toBe(
      `/data-transfer/imports/${batch.id}?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1`,
    );
    expect(screen.getByText('共 51 条 · 第 2/2 页')).toBeTruthy();
  });

  it('shows the selected filename and size in MB', async () => {
    vi.mocked(getImportHistory).mockResolvedValue(historyPage([]));
    renderPage();
    await screen.findByText('还没有导入记录');

    chooseFile('跨领域数据.csv');

    expect(screen.getByText('跨领域数据.csv')).toBeTruthy();
    expect(screen.getByText('1.50 MB')).toBeTruthy();
    expect((screen.getByRole('button', { name: '开始导入' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('locks repeated submission and navigates directly to the completed batch', async () => {
    let resolveUpload!: (value: ImportBatchSummary) => void;
    vi.mocked(uploadImport).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const router = renderPage('/data-transfer?tab=import&page=2');
    await screen.findByText(batch.filename);
    chooseFile();

    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));

    const pendingButton = screen.getByRole('button', { name: '正在导入…' });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pendingButton);
    await waitFor(() => expect(typeof resolveUpload).toBe('function'));
    await act(async () => resolveUpload(batch));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/data-transfer/imports/${batch.id}`),
    );
    expect(router.state.location.search).toBe(
      '?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1',
    );
  });

  it('preserves the selected file and dismisses a retryable error after three seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(uploadImport).mockRejectedValue(new Error('导入处理失败'));
    renderPage();
    await screen.findByText(batch.filename);
    chooseFile('可重试.csv');

    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));

    expect((await screen.findByRole('alert')).textContent).toContain('导入处理失败');
    expect(screen.getByText('可重试.csv')).toBeTruthy();
    expect((screen.getByRole('button', { name: '开始导入' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks before leaving during upload, keeps the request on cancel, and aborts on confirmation', async () => {
    let uploadSignal: AbortSignal | undefined;
    vi.mocked(uploadImport).mockImplementation(
      (_file, signal) =>
        new Promise((_resolve, reject) => {
          uploadSignal = signal;
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const router = renderPage();
    await screen.findByText(batch.filename);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
    await waitFor(() => expect(uploadSignal).toBeTruthy());

    fireEvent.click(screen.getByRole('link', { name: '离开导入页' }));

    const dialog = await screen.findByRole('dialog', { name: '离开导入页面' });
    expect(within(dialog).getByText('离开将取消本次导入')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '继续导入' }));
    expect(router.state.location.pathname).toBe('/data-transfer');
    expect(uploadSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: '离开导入页' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '离开导入页面' })).getByRole('button', {
        name: '确认离开',
      }),
    );

    await screen.findByText('已离开导入页');
    expect(uploadSignal?.aborted).toBe(true);
  });
});
