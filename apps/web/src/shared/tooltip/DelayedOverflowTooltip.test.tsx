import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DelayedOverflowTooltip } from './DelayedOverflowTooltip';

describe('DelayedOverflowTooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows all values only after hovering for two seconds', () => {
    vi.useFakeTimers();
    render(
      <DelayedOverflowTooltip values={['油价上涨', '原油上涨', '国际油价上涨', '第四个别名']}>
        <span data-testid="metadata">油价上涨、原油上涨、国际油价上涨</span>
      </DelayedOverflowTooltip>,
    );

    fireEvent.mouseEnter(screen.getByTestId('metadata'));
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip').textContent).toBe(
      '油价上涨、原油上涨、国际油价上涨、第四个别名',
    );
    fireEvent.mouseLeave(screen.getByTestId('metadata'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens immediately on keyboard focus and closes on Escape', () => {
    render(
      <DelayedOverflowTooltip values={['一', '二', '三', '四']}>
        <span data-testid="metadata">一、二、三</span>
      </DelayedOverflowTooltip>,
    );

    fireEvent.focus(screen.getByTestId('metadata'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('activates for every non-empty value list without measuring overflow', () => {
    render(
      <DelayedOverflowTooltip values={['原油', '能源价格']}>
        <span data-testid="metadata">原油、能源价格</span>
      </DelayedOverflowTooltip>,
    );

    const metadata = screen.getByTestId('metadata');
    expect(metadata.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(metadata);
    expect(screen.getByRole('tooltip').textContent).toBe('原油、能源价格');
  });

  it('stays inert only when there are no values', () => {
    render(
      <DelayedOverflowTooltip values={[]}>
        <span data-testid="metadata">—</span>
      </DelayedOverflowTooltip>,
    );

    const metadata = screen.getByTestId('metadata');
    expect(metadata.getAttribute('tabindex')).toBeNull();
    fireEvent.focus(metadata);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('clears a pending hover timer when unmounted', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(
      <DelayedOverflowTooltip values={['一', '二', '三', '四']}>
        <span data-testid="metadata">一、二、三</span>
      </DelayedOverflowTooltip>,
    );

    fireEvent.mouseEnter(screen.getByTestId('metadata'));
    unmount();
    vi.advanceTimersByTime(2_000);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
