import type {
  AiImportBatchDetail,
  AiImportRecordListResponse,
  AiImportRecordType,
} from '@causality/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { getAiImportBatch, getAiImportRecords } from '../dataTransferApi';
import { AiImportDetailPage } from './AiImportDetailPage';

vi.mock('../dataTransferApi', () => ({
  getAiImportBatch: vi.fn(),
  getAiImportRecords: vi.fn(),
}));

const batch: AiImportBatchDetail = {
  id: '10000000-0000-4000-8000-000000000001',
  planId: '20000000-0000-4000-8000-000000000001',
  topic: '能源价格变化的产业传导',
  planVersion: 3,
  clientName: 'Claude Desktop',
  completedAt: '2026-07-28T06:00:00.000Z',
  counts: {
    eventCreated: 2,
    eventReused: 3,
    eventUpdated: 1,
    caseCreated: 4,
    caseReused: 2,
    relationCreated: 2,
    relationReused: 1,
    relationCaseCreated: 5,
    confidenceChanged: 2,
  },
};

const recordTypeDetails: Record<AiImportRecordType, Record<string, unknown>> = {
  event: { ref: 'event-1', name: '能源价格上升' },
  case: { ref: 'case-1', content: '2026年某地区能源现货价格持续上涨。' },
  relation: {
    ref: 'relation-1',
    causeEventName: '能源价格上升',
    effectEventName: '生产成本上升',
    description: '能源成本传导至生产成本',
  },
  relation_case: {
    relationRef: 'relation-1',
    caseRef: 'case-1',
    causeEventName: '能源价格上升',
    effectEventName: '生产成本上升',
    relationDescription: '能源成本传导至生产成本',
    caseContent: '2026年某地区能源现货价格持续上涨。',
  },
  confidence: {
    relationRef: 'relation-1',
    causeEventName: '能源价格上升',
    effectEventName: '生产成本上升',
    relationDescription: '能源成本传导至生产成本',
    oldConfidence: 10,
    newConfidence: 19,
    oldCaseCount: 0,
    newCaseCount: 1,
  },
};

function recordPage(type: AiImportRecordType, page: number): AiImportRecordListResponse {
  return {
    items: [
      {
        id: `30000000-0000-4000-8000-00000000000${page}`,
        sequence: page,
        recordType: type,
        action: type === 'confidence' ? 'changed' : 'created',
        primaryRecordId: '40000000-0000-4000-8000-000000000001',
        relatedRecordId: null,
        detail: recordTypeDetails[type],
      },
    ],
    page,
    pageSize: 50,
    totalItems: 51,
    totalPages: 2,
  };
}

function renderPage(
  initialEntry:
    | string
    | {
        pathname: string;
        search: string;
        state: Record<string, unknown>;
      } = `/data-transfer/ai-imports/${batch.id}?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1&confidencePage=1`,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/data-transfer/ai-imports/:batchId',
        element: <AiImportDetailPage />,
      },
      { path: '/data-transfer', element: <div>AI 导入历史占位</div> },
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

describe('AiImportDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAiImportBatch).mockResolvedValue(batch);
    vi.mocked(getAiImportRecords).mockImplementation((_id, type, page) =>
      Promise.resolve(recordPage(type, page)),
    );
  });

  it('renders the read-only batch summary and all five record tabs', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: batch.topic })).toBeTruthy();
    expect(screen.getByText('版本 3')).toBeTruthy();
    expect(screen.getByText(batch.clientName)).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '原子事件',
      '具体案例',
      '因果关系',
      '案例关联',
      '置信度变化',
    ]);
    expect(screen.getByText('能源价格上升')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /重新执行|编辑/ })).toBeNull();
  });

  it('keeps independent category pages while switching tabs', async () => {
    const router = renderPage(
      `/data-transfer/ai-imports/${batch.id}?tab=confidence&eventPage=2&casePage=1&relationPage=1&relationCasePage=1&confidencePage=2`,
    );

    expect(
      await screen.findByText(
        '能源价格上升 → 生产成本上升；能源成本传导至生产成本：10% → 19%（案例 0 → 1）',
      ),
    ).toBeTruthy();
    expect(getAiImportRecords).toHaveBeenLastCalledWith(
      batch.id,
      'confidence',
      2,
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole('tab', { name: '原子事件' }));
    await waitFor(() =>
      expect(getAiImportRecords).toHaveBeenLastCalledWith(
        batch.id,
        'event',
        2,
        expect.any(AbortSignal),
      ),
    );
    expect(router.state.location.search).toContain('eventPage=2');
    expect(router.state.location.search).toContain('confidencePage=2');
  });

  it('renders relations, case links, and confidence changes as readable business text', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: '因果关系' }));
    expect(
      await screen.findByText('能源价格上升 → 生产成本上升；能源成本传导至生产成本'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '案例关联' }));
    expect(
      await screen.findByText(
        '能源价格上升 → 生产成本上升；能源成本传导至生产成本 + 2026年某地区能源现货价格持续上涨。',
      ),
    ).toBeTruthy();

    expect(screen.queryByText(/relation-1|case-1|40000000-0000/)).toBeNull();
  });

  it('keeps an updated event name together with its readable changes', async () => {
    vi.mocked(getAiImportRecords).mockResolvedValueOnce({
      ...recordPage('event', 1),
      items: [
        {
          ...recordPage('event', 1).items[0]!,
          action: 'updated',
          detail: {
            ref: 'event-1',
            name: '能源价格上升',
            appendAliases: ['能源涨价'],
            appendKeywords: ['成本'],
            oldDescription: '旧说明',
            newDescription: '能源单位价格持续上升',
          },
        },
      ],
    });
    renderPage();

    expect(
      await screen.findByText(
        '能源价格上升；新增别名：能源涨价；新增关键词：成本；说明：能源单位价格持续上升',
      ),
    ).toBeTruthy();
  });

  it('returns to the original AI history page and restores the focused batch', async () => {
    const router = renderPage({
      pathname: `/data-transfer/ai-imports/${batch.id}`,
      search:
        '?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1&confidencePage=1',
      state: {
        listReturnPath: '/data-transfer?tab=aiHistory&page=4',
        listFocusId: batch.id,
      },
    });

    const backLink = await screen.findByRole('link', { name: '返回 AI 导入历史' });
    expect(backLink.getAttribute('href')).toBe('/data-transfer?tab=aiHistory&page=4');
    fireEvent.click(backLink);
    await screen.findByText('AI 导入历史占位');
    expect(router.state.location.state).toEqual({ listFocusId: batch.id });
  });
});
