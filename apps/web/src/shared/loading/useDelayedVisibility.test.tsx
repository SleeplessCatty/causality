import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDelayedVisibility } from './useDelayedVisibility';

function VisibilityHarness({
  active,
  delayMs = 180,
  minimumVisibleMs = 300,
}: {
  active: boolean;
  delayMs?: number;
  minimumVisibleMs?: number;
}) {
  const visible = useDelayedVisibility(active, { delayMs, minimumVisibleMs });
  return <span>{visible ? 'visible' : 'hidden'}</span>;
}

describe('useDelayedVisibility', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('waits for the delay and then honors the minimum visible duration', () => {
    const view = render(<VisibilityHarness active />);

    expect(screen.getByText('hidden')).toBeTruthy();
    act(() => vi.advanceTimersByTime(179));
    expect(screen.getByText('hidden')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('visible')).toBeTruthy();

    view.rerender(<VisibilityHarness active={false} />);
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByText('visible')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('hidden')).toBeTruthy();
  });

  it('cancels a pending show when activity finishes inside the delay', () => {
    const view = render(<VisibilityHarness active />);

    act(() => vi.advanceTimersByTime(100));
    view.rerender(<VisibilityHarness active={false} />);
    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByText('hidden')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides immediately when no minimum duration is configured', () => {
    const view = render(<VisibilityHarness active delayMs={0} minimumVisibleMs={0} />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText('visible')).toBeTruthy();

    view.rerender(<VisibilityHarness active={false} delayMs={0} minimumVisibleMs={0} />);
    expect(screen.getByText('hidden')).toBeTruthy();
  });

  it('cleans up pending timers when unmounted', () => {
    const view = render(<VisibilityHarness active />);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
