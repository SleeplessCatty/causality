import type {
  ImportBatchSummary,
  ImportRecordItem,
  ImportRecordListResponse,
  ImportRecordType,
} from '@causality/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { getImportBatch, getImportRecords } from '../dataTransferApi';
import { ImportDetailPage } from './ImportDetailPage';

vi.mock('../dataTransferApi', () => ({
  getImportBatch: vi.fn(),
  getImportRecords: vi.fn(),
}));

const batch: ImportBatchSummary = {
  id: '10000000-0000-4000-8000-000000000001',
  filename: '一个非常长的跨领域因果数据导入文件名称.csv',
  completedAt: '2026-07-27T06:00:00.000Z',
  recordTypes: ['event', 'case', 'relation', 'relation_case'],
  counts: {
    event: { created: 2, reused: 1 },
    case: { created: 3, reused: 2 },
    relation: { created: 1, reused: 1 },
    relationCase: { created: 2, reused: 3 },
  },
};

const importedEventName = '国际物流运输时间显著增加并影响企业交付计划';
const importedCaseContent = '2026年第二季度某工业园区企业因物流延误调整生产排期';

const recordsByType: Record<ImportRecordType, ImportRecordItem> = {
  event: {
    id: '20000000-0000-4000-8000-000000000001',
    sequence: 1,
    outcome: 'created',
    text: { type: 'event', eventName: importedEventName },
  },
  case: {
    id: '20000000-0000-4000-8000-000000000002',
    sequence: 2,
    outcome: 'reused',
    text: {
      type: 'case',
      caseContent: importedCaseContent,
    },
  },
  relation: {
    id: '20000000-0000-4000-8000-000000000003',
    sequence: 3,
    outcome: 'created',
    text: {
      type: 'relation',
      causeEventName: '国际物流运输时间增加',
      effectEventName: '企业交付压力上升',
    },
  },
  relation_case: {
    id: '20000000-0000-4000-8000-000000000004',
    sequence: 4,
    outcome: 'reused',
    text: {
      type: 'relation_case',
      causeEventName: '国际物流运输时间增加',
      effectEventName: '企业交付压力上升',
      caseContent: importedCaseContent,
    },
  },
};

function recordPage(
  type: ImportRecordType,
  page: number,
  totalPages = Math.max(page, 1),
): ImportRecordListResponse {
  return {
    items: [recordsByType[type]],
    page,
    pageSize: 50,
    totalItems: totalPages > 1 ? 101 : 1,
    totalPages,
  };
}

function renderDetail(
  entry:
    | string
    | {
        pathname: string;
        search: string;
        state?: unknown;
      } = `/data-transfer/imports/${batch.id}?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1`,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/data-transfer/imports/:batchId',
        element: <ImportDetailPage />,
      },
      {
        path: '/data-transfer',
        element: <div>导入历史页</div>,
      },
    ],
    { initialEntries: [entry] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('ImportDetailPage', () => {
  beforeEach(() => {
    vi.mocked(getImportBatch).mockResolvedValue(batch);
    vi.mocked(getImportRecords).mockImplementation((_batchId, type, page) =>
      Promise.resolve(recordPage(type, page)),
    );
  });

  afterEach(() => vi.clearAllMocks());

  it('shows the batch summary and keeps four independent detail pages while switching tabs', async () => {
    const router = renderDetail(
      `/data-transfer/imports/${batch.id}?tab=events&eventPage=2&casePage=3&relationPage=4&relationCasePage=5`,
    );

    expect(await screen.findByText(batch.filename)).toBeTruthy();
    expect(screen.getByRole('region', { name: batch.filename }).className).toContain(
      'event-detail-page',
    );
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '原子事件',
      '具体案例',
      '因果关系',
      '案例关联',
    ]);
    expect(screen.getByText(importedEventName)).toBeTruthy();
    expect(screen.getByText('新增 2 / 复用 1')).toBeTruthy();
    expect(screen.getByText('新增 3 / 复用 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '具体案例' }));
    expect(await screen.findByText(importedCaseContent)).toBeTruthy();
    expect(router.state.location.search).toBe(
      '?tab=cases&eventPage=2&casePage=3&relationPage=4&relationCasePage=5',
    );

    fireEvent.click(screen.getByRole('tab', { name: '因果关系' }));
    expect(await screen.findByText('国际物流运输时间增加 → 企业交付压力上升')).toBeTruthy();
    expect(router.state.location.search).toContain('relationPage=4');

    fireEvent.click(screen.getByRole('tab', { name: '案例关联' }));
    expect(
      await screen.findByText(
        '国际物流运输时间增加 → 企业交付压力上升 + 2026年第二季度某工业园区企业因物流延误调整生产排期',
      ),
    ).toBeTruthy();
    expect(router.state.location.search).toContain('relationCasePage=5');
  });

  it('uses overflow treatment for the filename and every imported text shape', async () => {
    renderDetail();
    const filename = await screen.findByText(batch.filename);
    const eventText = screen.getByText(importedEventName);

    expect(filename.classList.contains('overflow-text')).toBe(true);
    expect(eventText.classList.contains('overflow-text')).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: '具体案例' }));
    expect((await screen.findByText(importedCaseContent)).classList.contains('overflow-text')).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('tab', { name: '因果关系' }));
    expect(
      (await screen.findByText('国际物流运输时间增加 → 企业交付压力上升')).classList.contains(
        'overflow-text',
      ),
    ).toBe(true);
  });

  it('changes only the active tab page and corrects an out-of-range server page in the URL', async () => {
    vi.mocked(getImportRecords).mockImplementation((_batchId, type, page) =>
      Promise.resolve(
        type === 'event' && page === 99 ? recordPage(type, 2, 2) : recordPage(type, page),
      ),
    );
    const router = renderDetail(
      `/data-transfer/imports/${batch.id}?tab=events&eventPage=99&casePage=3&relationPage=4&relationCasePage=5`,
    );

    await screen.findByText(importedEventName);
    await waitFor(() => expect(router.state.location.search).toContain('eventPage=2'));
    expect(router.state.location.search).toContain('casePage=3');
    expect(router.state.location.search).toContain('relationPage=4');
    expect(router.state.location.search).toContain('relationCasePage=5');

    const firstPageButton = screen.getByRole('button', { name: '第 1 页' });
    await waitFor(() => expect((firstPageButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(firstPageButton);
    await waitFor(() => expect(router.state.location.search).toContain('eventPage=1'));
    expect(router.state.location.search).toContain('casePage=3');
  });

  it('returns to the exact history page and keeps the imported batch as the focus target', async () => {
    const router = renderDetail({
      pathname: `/data-transfer/imports/${batch.id}`,
      search: '?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1',
      state: {
        listReturnPath: '/data-transfer?tab=import&page=4',
        listFocusId: batch.id,
      },
    });

    await screen.findByRole('link', { name: '返回导入历史' });
    fireEvent.click(screen.getByRole('tab', { name: '具体案例' }));
    await screen.findByText(importedCaseContent);

    const backLink = screen.getByRole('link', { name: '返回导入历史' });
    expect(backLink.getAttribute('href')).toBe('/data-transfer?tab=import&page=4');
    fireEvent.click(backLink);

    await screen.findByText('导入历史页');
    expect(router.state.location.state).toEqual({ listFocusId: batch.id });
  });
});
