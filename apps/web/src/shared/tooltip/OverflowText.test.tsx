import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverflowText } from './OverflowText';

function markAsOverflowing(element: HTMLElement): void {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 180 },
    clientHeight: { configurable: true, value: 20 },
    scrollHeight: { configurable: true, value: 20 },
  });
  fireEvent(window, new Event('resize'));
}

describe('OverflowText', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('only enables an overflow-mode tooltip after rendered text is truncated', () => {
    const { rerender } = render(
      <OverflowText content="连续英文名称" delay={0}>
        <span data-testid="text">连续英文名称</span>
      </OverflowText>,
    );

    const text = screen.getByTestId('text');
    fireEvent.mouseEnter(text);
    expect(screen.queryByRole('tooltip')).toBeNull();

    markAsOverflowing(text);
    fireEvent.mouseEnter(text);
    expect(screen.getByRole('tooltip').textContent).toBe('连续英文名称');

    rerender(
      <OverflowText content="连续英文名称" delay={0}>
        <span data-testid="text">连续英文名称</span>
      </OverflowText>,
    );
    expect(screen.getByTestId('text').className).toContain('overflow-text--single-line');
  });

  it('supports always mode for event aliases that must expose every non-empty value', () => {
    render(
      <OverflowText content="原油、能源价格" mode="always">
        <span data-testid="metadata">原油、能源价格</span>
      </OverflowText>,
    );

    fireEvent.focus(screen.getByTestId('metadata'));
    expect(screen.getByRole('tooltip').textContent).toBe('原油、能源价格');
  });

  it('opens after two seconds, renders through a portal, and stays open over the tooltip', () => {
    vi.useFakeTimers();
    render(
      <OverflowText content="完整内容" mode="always">
        <span data-testid="trigger">省略内容</span>
      </OverflowText>,
    );

    const trigger = screen.getByTestId('trigger');
    fireEvent.mouseEnter(trigger);
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.parentElement).toBe(document.body);
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tooltip);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('tooltip')).toBe(tooltip);
  });

  it('opens on focus, closes on Escape or blur, and describes the trigger', () => {
    vi.useFakeTimers();
    render(
      <OverflowText content="完整内容" mode="always">
        <span data-testid="trigger">省略内容</span>
      </OverflowText>,
    );

    const trigger = screen.getByTestId('trigger');
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    act(() => vi.advanceTimersByTime(60));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps editable inputs tooltip-free while focused', () => {
    render(
      <OverflowText content="VeryLongSelectedEventName" mode="always" disableWhenFocused>
        <input aria-label="事件" value="VeryLongSelectedEventName" readOnly />
      </OverflowText>,
    );

    const input = screen.getByRole('textbox', { name: '事件' });
    fireEvent.focus(input);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('flips above the trigger, shifts inside the viewport, and closes on outside scroll', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('role') === 'tooltip') {
        return {
          top: 0,
          right: 360,
          bottom: 240,
          left: 0,
          width: 360,
          height: 240,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return {
        top: 270,
        right: 390,
        bottom: 290,
        left: 380,
        width: 10,
        height: 20,
        x: 380,
        y: 270,
        toJSON: () => ({}),
      };
    });
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 400 },
      innerHeight: { configurable: true, value: 300 },
    });
    render(
      <OverflowText content="完整内容" mode="always" delay={0}>
        <span data-testid="trigger">省略内容</span>
      </OverflowText>,
    );

    fireEvent.mouseEnter(screen.getByTestId('trigger'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.left).toBe('24px');
    expect(tooltip.style.top).toBe('22px');

    fireEvent.scroll(tooltip);
    expect(screen.getByRole('tooltip')).toBe(tooltip);
    fireEvent.scroll(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('remeasures observed content and disconnects its observer on unmount', () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const { unmount } = render(
      <OverflowText content="完整内容" delay={0}>
        <span data-testid="observed">完整内容</span>
      </OverflowText>,
    );
    const observed = screen.getByTestId('observed');
    expect(observe).toHaveBeenCalledWith(observed);

    Object.defineProperties(observed, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 180 },
    });
    act(() => resizeCallback?.([], {} as ResizeObserver));
    fireEvent.mouseEnter(observed);
    expect(screen.getByRole('tooltip').textContent).toBe('完整内容');

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('clears delayed work and global listeners when unmounted while active', () => {
    vi.useFakeTimers();
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(
      <OverflowText content="完整内容" mode="always">
        <span data-testid="cleanup-trigger">省略内容</span>
      </OverflowText>,
    );

    fireEvent.mouseEnter(screen.getByTestId('cleanup-trigger'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('tooltip')).toBeTruthy();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(windowRemove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(documentRemove).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(documentRemove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  });
});
