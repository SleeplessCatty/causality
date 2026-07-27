import type { EventCandidate } from '@causality/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { getEventCandidatePage } from '../../events/api/eventApi';
import { ExportEventSelector } from './ExportEventSelector';

vi.mock('../../events/api/eventApi', () => ({ getEventCandidatePage: vi.fn() }));

function numberedEvent(index: number): EventCandidate {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `起始原子事件 ${index}`,
  };
}

async function selectCandidate(candidate: EventCandidate): Promise<void> {
  vi.mocked(getEventCandidatePage).mockResolvedValue({
    items: [candidate],
    nextCursor: null,
    hasMore: false,
  });
  const input = screen.getByRole('combobox', { name: '搜索起始原子事件' });
  fireEvent.change(input, { target: { value: candidate.name } });
  await act(() => vi.advanceTimersByTimeAsync(250));
  fireEvent.click(await screen.findByRole('option', { name: candidate.name }));
}

describe('ExportEventSelector', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('allows the 100th selected event', async () => {
    const selected = Array.from({ length: 99 }, (_, index) => numberedEvent(index + 1));
    const hundredth = numberedEvent(100);
    const onChange = vi.fn();
    render(
      <AppProviders>
        <ExportEventSelector selected={selected} onChange={onChange} />
      </AppProviders>,
    );

    await selectCandidate(hundredth);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toHaveLength(100);
  });

  it('blocks the 101st selected event with concise limit feedback', async () => {
    const selected = Array.from({ length: 100 }, (_, index) => numberedEvent(index + 1));
    const hundredAndFirst = numberedEvent(101);
    const onChange = vi.fn();
    render(
      <AppProviders>
        <ExportEventSelector selected={selected} onChange={onChange} />
      </AppProviders>,
    );

    await selectCandidate(hundredAndFirst);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('最多选择 100 个起始原子事件');
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
  });
});
