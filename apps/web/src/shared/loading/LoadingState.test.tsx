import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('delays the initial skeleton and keeps it for the minimum visible duration', () => {
    const retry = vi.fn();
    const view = render(
      <LoadingState pending fetching hasData={false} error={null} skeleton="list" onRetry={retry}>
        <div>真实内容</div>
      </LoadingState>,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(view.container.querySelector('[data-skeleton-variant="list"]')).toBeTruthy();
    act(() => vi.advanceTimersByTime(179));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status', { name: '正在准备列表页面' })).toBeTruthy();

    view.rerender(
      <LoadingState
        pending={false}
        fetching={false}
        hasData
        error={null}
        skeleton="list"
        onRetry={retry}
      >
        <div>真实内容</div>
      </LoadingState>,
    );
    act(() => vi.advanceTimersByTime(299));
    expect(screen.queryByText('真实内容')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('真实内容')).toBeTruthy();
  });

  it('retains content and delays background refresh feedback for 500ms', () => {
    const view = render(
      <LoadingState
        pending={false}
        fetching
        hasData
        error={null}
        skeleton="detail"
        onRetry={() => undefined}
      >
        <div>已有内容</div>
      </LoadingState>,
    );

    expect(screen.getByText('已有内容')).toBeTruthy();
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status', { name: '正在更新内容' })).toBeTruthy();
    expect(screen.getByText('已有内容')).toBeTruthy();

    view.rerender(
      <LoadingState
        pending={false}
        fetching={false}
        hasData
        error={null}
        skeleton="detail"
        onRetry={() => undefined}
      >
        <div>已有内容</div>
      </LoadingState>,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps existing content when a background refresh fails', () => {
    const retry = vi.fn();
    render(
      <LoadingState
        pending={false}
        fetching={false}
        hasData
        error={new Error('network')}
        skeleton="settings"
        onRetry={retry}
      >
        <div>缓存内容</div>
      </LoadingState>,
    );

    expect(screen.getByText('缓存内容')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('更新失败');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows an in-place error when initial loading fails', () => {
    const retry = vi.fn();
    render(
      <LoadingState
        pending={false}
        fetching={false}
        hasData={false}
        error={new Error('network')}
        skeleton="form"
        onRetry={retry}
      >
        <div>不会出现</div>
      </LoadingState>,
    );

    expect(screen.queryByText('不会出现')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('加载失败');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
