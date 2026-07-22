import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEventCandidatePage } from '../../events/api/eventApi';
import { GraphEventSelector } from './GraphEventSelector';

vi.mock('../../events/api/eventApi', () => ({ getEventCandidatePage: vi.fn() }));

const candidates = [
  { id: '11111111-1111-4111-8111-111111111111', name: '原油价格上涨' },
  { id: '22222222-2222-4222-8222-222222222222', name: '原油供应减少' },
];

function Wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('GraphEventSelector', () => {
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

  it('debounces non-empty searches and requests candidate pages of 100', async () => {
    render(<GraphEventSelector value={null} onSelect={vi.fn()} />, { wrapper: Wrapper });
    const input = screen.getByRole('combobox', { name: '中心事件' });

    fireEvent.change(input, { target: { value: ' 原油 ' } });
    expect(getEventCandidatePage).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(250));

    await waitFor(() => expect(getEventCandidatePage).toHaveBeenCalled());
    expect(vi.mocked(getEventCandidatePage).mock.calls[0]?.[0]).toBe('原油');
    expect(vi.mocked(getEventCandidatePage).mock.calls[0]?.[1]).toEqual({ limit: 100 });
    expect(await screen.findByRole('option', { name: '原油价格上涨' })).toBeTruthy();
  });

  it('does not search an empty draft', async () => {
    render(<GraphEventSelector value={null} onSelect={vi.fn()} />, { wrapper: Wrapper });
    fireEvent.focus(screen.getByRole('combobox', { name: '中心事件' }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(getEventCandidatePage).not.toHaveBeenCalled();
  });

  it('automatically loads and selects an event from a later candidate page', async () => {
    vi.mocked(getEventCandidatePage)
      .mockResolvedValueOnce({ items: [candidates[0]!], nextCursor: 'next', hasMore: true })
      .mockResolvedValueOnce({ items: [candidates[1]!], nextCursor: null, hasMore: false });
    const onSelect = vi.fn();
    render(<GraphEventSelector value={null} onSelect={onSelect} />, { wrapper: Wrapper });
    const input = screen.getByRole('combobox', { name: '中心事件' });
    fireEvent.change(input, { target: { value: '原油' } });
    await act(() => vi.advanceTimersByTimeAsync(250));

    fireEvent.click(await screen.findByRole('option', { name: '原油供应减少' }));
    expect(onSelect).toHaveBeenCalledWith(candidates[1]);
    expect(vi.mocked(getEventCandidatePage).mock.calls[1]?.[1]).toEqual({
      limit: 100,
      cursor: 'next',
    });
  });

  it('supports arrow keys, Enter selection, and Escape close', async () => {
    const onSelect = vi.fn();
    render(<GraphEventSelector value={null} onSelect={onSelect} />, { wrapper: Wrapper });
    const input = screen.getByRole('combobox', { name: '中心事件' });
    fireEvent.change(input, { target: { value: '原油' } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    await screen.findByRole('option', { name: '原油价格上涨' });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(candidates[1]);
    expect((input as HTMLInputElement).value).toBe('原油供应减少');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a compact candidate loading error', async () => {
    vi.mocked(getEventCandidatePage).mockRejectedValueOnce(new Error('network'));
    render(<GraphEventSelector value={null} onSelect={vi.fn()} />, { wrapper: Wrapper });
    fireEvent.change(screen.getByRole('combobox', { name: '中心事件' }), {
      target: { value: '原油' },
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(await screen.findByText('无法搜索事件')).toBeTruthy();
  });
});
