import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEventCandidatePage } from '../../features/events/api/eventApi';
import { EventCandidateCombobox } from './EventCandidateCombobox';

vi.mock('../../features/events/api/eventApi', () => ({ getEventCandidatePage: vi.fn() }));

const candidates = [
  { id: '11111111-1111-4111-8111-111111111111', name: '原油价格上涨' },
  { id: '22222222-2222-4222-8222-222222222222', name: '原油供应减少' },
  { id: '33333333-3333-4333-8333-333333333333', name: '运输成本上升' },
];

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function Harness({
  onSelect = vi.fn(),
  excludedIds,
}: {
  onSelect?: (candidate: (typeof candidates)[number]) => void;
  excludedIds?: ReadonlySet<string>;
}) {
  const [value, setValue] = useState('');
  return (
    <EventCandidateCombobox
      label="选择事件"
      ariaLabel="事件搜索"
      value={value}
      {...(excludedIds ? { excludedIds } : {})}
      placeholder="搜索原子事件"
      onInputChange={setValue}
      onSelect={onSelect}
    />
  );
}

describe('EventCandidateCombobox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getEventCandidatePage).mockResolvedValue({
      items: candidates,
      nextCursor: null,
      hasMore: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('debounces input and exhaustively loads candidate pages of 100', async () => {
    vi.mocked(getEventCandidatePage)
      .mockResolvedValueOnce({
        items: [candidates[0]!],
        nextCursor: 'next-page',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [candidates[1]!, candidates[2]!],
        nextCursor: null,
        hasMore: false,
      });
    render(<Harness />, { wrapper: createWrapper() });
    const input = screen.getByRole('combobox', { name: '事件搜索' });

    fireEvent.change(input, { target: { value: ' 原油 ' } });
    expect(getEventCandidatePage).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(250));

    expect(await screen.findByRole('option', { name: '运输成本上升' })).toBeTruthy();
    expect(vi.mocked(getEventCandidatePage).mock.calls[0]?.[0]).toBe('原油');
    expect(vi.mocked(getEventCandidatePage).mock.calls[0]?.[1]).toEqual({ limit: 100 });
    expect(vi.mocked(getEventCandidatePage).mock.calls[1]?.[1]).toEqual({
      limit: 100,
      cursor: 'next-page',
    });
  });

  it('filters excluded IDs without changing candidate order', async () => {
    render(<Harness excludedIds={new Set([candidates[1]!.id])} />, {
      wrapper: createWrapper(),
    });
    const input = screen.getByRole('combobox', { name: '事件搜索' });
    fireEvent.change(input, { target: { value: '原油' } });
    await act(() => vi.advanceTimersByTimeAsync(250));

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['原油价格上涨', '运输成本上升']);
  });

  it('supports Arrow keys, Home, End, Enter selection, and Escape close', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />, { wrapper: createWrapper() });
    const input = screen.getByRole('combobox', { name: '事件搜索' });
    fireEvent.change(input, { target: { value: '原油' } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    await screen.findByRole('option', { name: '原油价格上涨' });

    fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toContain('option-2');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.getAttribute('aria-activedescendant')).toContain('option-0');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(candidates[2]);
    expect((input as HTMLInputElement).value).toBe('运输成本上升');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a failed later page retryable while preserving loaded options', async () => {
    vi.mocked(getEventCandidatePage)
      .mockResolvedValueOnce({
        items: [candidates[0]!],
        nextCursor: 'next-page',
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        items: [candidates[1]!],
        nextCursor: null,
        hasMore: false,
      });
    render(<Harness />, { wrapper: createWrapper() });
    fireEvent.change(screen.getByRole('combobox', { name: '事件搜索' }), {
      target: { value: '原油' },
    });
    await act(() => vi.advanceTimersByTimeAsync(250));

    expect(await screen.findByRole('option', { name: '原油价格上涨' })).toBeTruthy();
    const retry = await screen.findByRole('button', { name: '加载未完成，点击重试' });
    fireEvent.click(retry);

    expect(await screen.findByRole('option', { name: '原油供应减少' })).toBeTruthy();
  });

  it('shows the initial error and does not search an empty draft', async () => {
    vi.mocked(getEventCandidatePage).mockRejectedValueOnce(new Error('network'));
    render(<Harness />, { wrapper: createWrapper() });
    const input = screen.getByRole('combobox', { name: '事件搜索' });

    fireEvent.focus(input);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(getEventCandidatePage).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '原油' } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect((await screen.findByRole('alert')).textContent).toBe('无法搜索事件');
  });

  it('selects a candidate by mouse and closes the list', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />, { wrapper: createWrapper() });
    const input = screen.getByRole('combobox', { name: '事件搜索' });
    fireEvent.change(input, { target: { value: '原油' } });
    await act(() => vi.advanceTimersByTimeAsync(250));

    fireEvent.click(await screen.findByRole('option', { name: '原油供应减少' }));

    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'));
    expect(onSelect).toHaveBeenCalledWith(candidates[1]);
    expect((input as HTMLInputElement).value).toBe('原油供应减少');
  });
});
