import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sidebarStorageKey, useAppSidebar } from './useAppSidebar';

function stubMatchMedia(matches = false) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    }),
  );
  return listeners;
}

describe('useAppSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults ordinary pages to expanded and persists a manual collapse', () => {
    const { result } = renderHook(() => useAppSidebar(false));

    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());

    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(sidebarStorageKey)).toBe('collapsed');
  });

  it('starts each graph entry collapsed without overwriting the ordinary preference', () => {
    localStorage.setItem(sidebarStorageKey, 'expanded');
    const { result, rerender } = renderHook(({ graph }) => useAppSidebar(graph), {
      initialProps: { graph: false },
    });

    rerender({ graph: true });
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);

    rerender({ graph: false });
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(sidebarStorageKey)).toBe('expanded');

    rerender({ graph: true });
    expect(result.current.collapsed).toBe(true);
  });

  it('forces the sidebar closed when the desktop workspace is constrained', () => {
    vi.unstubAllGlobals();
    localStorage.clear();
    stubMatchMedia(true);

    const { result } = renderHook(() => useAppSidebar(false));

    expect(result.current.forced).toBe(true);
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(sidebarStorageKey)).toBeNull();
  });
});
