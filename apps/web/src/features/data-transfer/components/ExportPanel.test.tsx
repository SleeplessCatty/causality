import type { ExportPreparationResponse as ExportConfirmation } from '@causality/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { getEventCandidatePage } from '../../events/api/eventApi';
import { prepareExport, saveExportFile } from '../dataTransferApi';
import { ExportPanel } from './ExportPanel';

vi.mock('../../events/api/eventApi', () => ({ getEventCandidatePage: vi.fn() }));
vi.mock('../dataTransferApi', () => ({
  prepareExport: vi.fn(),
  saveExportFile: vi.fn(),
}));

const events = [
  { id: '11111111-1111-4111-8111-111111111111', name: '原油价格上涨' },
  { id: '22222222-2222-4222-8222-222222222222', name: '原油供应减少' },
  { id: '33333333-3333-4333-8333-333333333333', name: '运输成本上升' },
];

const firstConfirmation: ExportConfirmation = {
  token: 'export-token-1',
  expiresAt: '2026-07-27T08:30:00.000Z',
  counts: { events: 3, relations: 2, cases: 5 },
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前路由">{`${location.pathname}${location.search}`}</output>;
}

function renderPanel() {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={['/data-transfer?tab=export&page=2']}>
        <ExportPanel />
        <LocationProbe />
      </MemoryRouter>
    </AppProviders>,
  );
}

async function searchCandidates(query = '原油') {
  const input = screen.getByRole('combobox', { name: '搜索起始原子事件' });
  fireEvent.change(input, { target: { value: query } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  return input;
}

async function selectFirstEvent() {
  const input = await searchCandidates();
  await screen.findByRole('option', { name: events[0]!.name });
  fireEvent.keyDown(input, { key: 'Home' });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('ExportPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getEventCandidatePage).mockResolvedValue({
      items: events,
      nextCursor: null,
      hasMore: false,
    });
    vi.mocked(prepareExport).mockResolvedValue(firstConfirmation);
    vi.mocked(saveExportFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('switches full and filtered export with approved buttons and custom ordered selects', () => {
    renderPanel();

    const full = screen.getByRole('button', { name: '完整导出' });
    const filtered = screen.getByRole('button', { name: '筛选导出' });
    expect(full.className).toContain('button--primary');
    expect(filtered.className).toContain('button--secondary');
    expect(screen.getByRole('button', { name: '数据导出' })).toBeTruthy();

    fireEvent.click(filtered);
    expect(filtered.className).toContain('button--primary');
    expect(full.className).toContain('button--secondary');
    expect((screen.getByRole('button', { name: '数据导出' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    const direction = screen.getByRole('button', { name: '遍历方向' });
    expect(direction.textContent).toContain('双向');
    expect(direction.getAttribute('aria-haspopup')).toBe('listbox');
    fireEvent.click(direction);
    expect(
      within(screen.getByRole('listbox', { name: '方向选项' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['双向', '下游', '上游']);

    fireEvent.click(screen.getByRole('button', { name: '遍历深度' }));
    expect(
      within(screen.getByRole('listbox', { name: '深度选项' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(screen.queryByRole('combobox', { name: '遍历方向' })).toBeNull();
    expect(screen.queryByText('导出历史')).toBeNull();
  });

  it('preserves candidate ordering and retry behavior while adding ordered unique removable chips', async () => {
    vi.mocked(getEventCandidatePage)
      .mockResolvedValueOnce({
        items: [events[0]!],
        nextCursor: 'next-page',
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        items: [events[1]!, events[2]!],
        nextCursor: null,
        hasMore: false,
      });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '筛选导出' }));

    const input = await searchCandidates();
    expect(await screen.findByRole('option', { name: events[0]!.name })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '加载未完成，点击重试' }));
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
        events.map((event) => event.name),
      ),
    );

    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await searchCandidates();
    expect(screen.queryByRole('option', { name: events[2]!.name })).toBeNull();
    fireEvent.keyDown(input, { key: 'Home' });
    fireEvent.keyDown(input, { key: 'Enter' });

    const selected = screen.getByRole('list', { name: '已选起始原子事件' });
    expect(
      within(selected)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([`${events[2]!.name}移除`, `${events[0]!.name}移除`]);
    expect(within(selected).getAllByText(events[2]!.name)[0]?.className).toContain('overflow-text');

    await searchCandidates();
    expect(screen.queryByRole('option', { name: events[2]!.name })).toBeNull();
    expect(screen.queryByRole('option', { name: events[0]!.name })).toBeNull();
    expect(screen.getByRole('option', { name: events[1]!.name })).toBeTruthy();

    fireEvent.click(
      within(selected).getByRole('button', { name: `移除起始原子事件：${events[2]!.name}` }),
    );
    expect(
      within(selected)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([`${events[0]!.name}移除`]);
  });

  it('retains a closed confirmation but clears it whenever a filter changes', async () => {
    vi.mocked(prepareExport)
      .mockResolvedValueOnce(firstConfirmation)
      .mockResolvedValueOnce({
        ...firstConfirmation,
        token: 'export-token-2',
        counts: { events: 7, relations: 6, cases: 9 },
      });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '筛选导出' }));
    await selectFirstEvent();

    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    const dialog = await screen.findByRole('dialog', { name: '确认导出' });
    expect(within(dialog).getByText('3')).toBeTruthy();
    expect(within(dialog).getByText('2')).toBeTruthy();
    expect(within(dialog).getByText('5')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getByRole('button', { name: '查看导出确认' }));
    expect(prepareExport).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '确认导出' })).getByRole('button', {
        name: '取消',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '遍历方向' }));
    fireEvent.click(screen.getByRole('option', { name: '下游' }));
    expect(screen.queryByText('3')).toBeNull();
    expect(screen.getByRole('button', { name: '数据导出' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    const nextDialog = await screen.findByRole('dialog', { name: '确认导出' });
    expect(within(nextDialog).getByText('7')).toBeTruthy();
    expect(prepareExport).toHaveBeenLastCalledWith(
      {
        type: 'filtered',
        startEventIds: [events[0]!.id],
        direction: 'downstream',
        depth: 1,
      },
      expect.any(AbortSignal),
    );
  });

  it('discards a confirmation response that arrives after its filters changed', async () => {
    let finishPreparation!: (value: ExportConfirmation) => void;
    vi.mocked(prepareExport).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '筛选导出' }));
    await selectFirstEvent();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    await waitFor(() => expect(prepareExport).toHaveBeenCalledOnce());
    const preparationCall = vi.mocked(prepareExport).mock.calls[0] as unknown as [
      unknown,
      AbortSignal,
    ];

    fireEvent.click(screen.getByRole('button', { name: `移除起始原子事件：${events[0]!.name}` }));
    expect(preparationCall[1]).toBeInstanceOf(AbortSignal);
    expect(preparationCall[1].aborted).toBe(true);
    await act(async () => finishPreparation(firstConfirmation));

    expect(screen.queryByRole('dialog', { name: '确认导出' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看导出确认' })).toBeNull();
    expect((screen.getByRole('button', { name: '数据导出' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('aborts an in-flight preparation when its traversal parameter changes', async () => {
    vi.mocked(prepareExport).mockImplementation(() => new Promise(() => undefined));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '筛选导出' }));
    await selectFirstEvent();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    await waitFor(() => expect(prepareExport).toHaveBeenCalledOnce());
    const preparationCall = vi.mocked(prepareExport).mock.calls[0] as unknown as [
      unknown,
      AbortSignal,
    ];

    fireEvent.click(screen.getByRole('button', { name: '遍历方向' }));
    fireEvent.click(screen.getByRole('option', { name: '下游' }));

    expect(preparationCall[1]).toBeInstanceOf(AbortSignal);
    expect(preparationCall[1].aborted).toBe(true);
  });

  it('aborts an in-flight preparation when the export mode changes', async () => {
    vi.mocked(prepareExport).mockImplementation(() => new Promise(() => undefined));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    await waitFor(() => expect(prepareExport).toHaveBeenCalledOnce());
    const preparationCall = vi.mocked(prepareExport).mock.calls[0] as unknown as [
      unknown,
      AbortSignal,
    ];

    fireEvent.click(screen.getByRole('button', { name: '筛选导出' }));

    expect(preparationCall[1]).toBeInstanceOf(AbortSignal);
    expect(preparationCall[1].aborted).toBe(true);
  });

  it('aborts an in-flight preparation when the panel unmounts', async () => {
    vi.mocked(prepareExport).mockImplementation(() => new Promise(() => undefined));
    const panel = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    await waitFor(() => expect(prepareExport).toHaveBeenCalledOnce());
    const preparationCall = vi.mocked(prepareExport).mock.calls[0] as unknown as [
      unknown,
      AbortSignal,
    ];

    panel.unmount();

    expect(preparationCall[1]).toBeInstanceOf(AbortSignal);
    expect(preparationCall[1].aborted).toBe(true);
  });

  it('locks the confirmation dialog while saving and returns to the export action without a progress notice', async () => {
    let finishSave!: () => void;
    vi.mocked(saveExportFile).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    const dialog = await screen.findByRole('dialog', { name: '确认导出' });

    fireEvent.click(within(dialog).getByRole('button', { name: '导出' }));
    await waitFor(() =>
      expect(saveExportFile).toHaveBeenCalledWith(firstConfirmation.token, expect.any(AbortSignal)),
    );
    expect(
      (within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: '正在导出…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '确认导出' })).toBeTruthy();

    await act(async () => finishSave());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认导出' })).toBeNull());
    expect(screen.queryByText('下载已开始')).toBeNull();
    expect(screen.getByRole('button', { name: '数据导出' })).toBeTruthy();
    expect(screen.getByLabelText('当前路由').textContent).toBe('/data-transfer?tab=export&page=2');
  });

  it('aborts a pending save when a filter changes', async () => {
    vi.mocked(saveExportFile).mockImplementation(() => new Promise(() => undefined));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '筛选导出' }));
    await selectFirstEvent();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    const dialog = await screen.findByRole('dialog', { name: '确认导出' });
    fireEvent.click(within(dialog).getByRole('button', { name: '导出' }));
    await waitFor(() => expect(saveExportFile).toHaveBeenCalledOnce());
    const saveCall = vi.mocked(saveExportFile).mock.calls[0] as unknown as [string, AbortSignal];

    fireEvent.click(screen.getByRole('button', { name: '遍历方向' }));
    fireEvent.click(screen.getByRole('option', { name: '下游' }));

    expect(saveCall[1]).toBeInstanceOf(AbortSignal);
    expect(saveCall[1].aborted).toBe(true);
    expect(screen.queryByRole('dialog', { name: '确认导出' })).toBeNull();
  });

  it('aborts a pending save when the panel unmounts', async () => {
    vi.mocked(saveExportFile).mockImplementation(() => new Promise(() => undefined));
    const panel = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    const dialog = await screen.findByRole('dialog', { name: '确认导出' });
    fireEvent.click(within(dialog).getByRole('button', { name: '导出' }));
    await waitFor(() => expect(saveExportFile).toHaveBeenCalledOnce());
    const saveCall = vi.mocked(saveExportFile).mock.calls[0] as unknown as [string, AbortSignal];

    panel.unmount();

    expect(saveCall[1]).toBeInstanceOf(AbortSignal);
    expect(saveCall[1].aborted).toBe(true);
  });

  it('starts each completed export from a fresh confirmation without showing a success notice', async () => {
    vi.mocked(saveExportFile)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('导出令牌已过期'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '确认导出' })).getByRole('button', {
        name: '导出',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认导出' })).toBeNull());
    expect(screen.queryByText('下载已开始')).toBeNull();
    expect(screen.getByRole('button', { name: '数据导出' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));
    await waitFor(() => expect(prepareExport).toHaveBeenCalledTimes(2));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '确认导出' })).getByRole('button', {
        name: '导出',
      }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      '导出令牌已过期，请重新发起导出',
    );
    expect(screen.queryByText('下载已开始')).toBeNull();
  });

  it('discards an unavailable token, keeps filters, and requires a fresh export', async () => {
    vi.mocked(saveExportFile).mockRejectedValue(new Error('导出令牌已过期'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '筛选导出' }));
    await selectFirstEvent();
    fireEvent.click(screen.getByRole('button', { name: '遍历方向' }));
    fireEvent.click(screen.getByRole('option', { name: '上游' }));
    fireEvent.click(screen.getByRole('button', { name: '遍历深度' }));
    fireEvent.click(screen.getByRole('option', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: '数据导出' }));

    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '确认导出' })).getByRole('button', {
        name: '导出',
      }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      '导出令牌已过期，请重新发起导出',
    );
    expect(screen.getByRole('listitem').textContent).toContain(events[0]!.name);
    expect(screen.getByRole('button', { name: '遍历方向' }).textContent).toContain('上游');
    expect(screen.getByRole('button', { name: '遍历深度' }).textContent).toContain('4');
    expect(screen.getByRole('button', { name: '数据导出' })).toBeTruthy();
    expect(screen.queryByText('导出历史')).toBeNull();
  });
});
