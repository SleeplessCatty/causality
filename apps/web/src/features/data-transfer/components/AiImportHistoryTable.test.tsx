import type { AiImportBatchListResponse } from '@causality/contracts';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AiImportHistoryTable } from './AiImportHistoryTable';

const data: AiImportBatchListResponse = {
  items: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      planId: '20000000-0000-4000-8000-000000000001',
      topic: '没有产生数据变化的重复采集',
      planVersion: 1,
      clientName: 'Codex',
      completedAt: '2026-07-28T06:00:00.000Z',
      counts: {
        eventCreated: 0,
        eventReused: 2,
        eventUpdated: 0,
        caseCreated: 0,
        caseReused: 1,
        relationCreated: 0,
        relationReused: 1,
        relationCaseCreated: 0,
        confidenceChanged: 0,
      },
    },
  ],
  page: 2,
  pageSize: 50,
  totalItems: 51,
  totalPages: 2,
};

function TableWithLocation() {
  const location = useLocation();
  return (
    <AiImportHistoryTable data={data} fetching={false} location={location} onPageChange={vi.fn()} />
  );
}

describe('AiImportHistoryTable', () => {
  it('shows the approved columns, no-change result, pagination, and detail target', () => {
    render(
      <MemoryRouter initialEntries={['/data-transfer?tab=aiHistory&page=2']}>
        <TableWithLocation />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '完成时间',
      '采集主题',
      '处理结果',
      '数据变化',
      '操作',
    ]);
    expect(screen.getByText('成功·无变化')).toBeTruthy();
    expect(screen.getByText('共 51 条 · 第 2/2 页')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看 AI 导入详情' }).getAttribute('href')).toBe(
      `/data-transfer/ai-imports/${data.items[0]!.id}?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1&confidencePage=1`,
    );
  });
});
