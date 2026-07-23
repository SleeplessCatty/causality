import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AppSidebar } from './AppSidebar';

const navigationLabels = ['原子事件', '因果关系', '具体案例', '因果图', '系统状态'];

function renderSidebar(collapsed = false, forced = false, onToggle = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/graph']}>
      <AppSidebar collapsed={collapsed} forced={forced} onToggle={onToggle} />
    </MemoryRouter>,
  );
  return onToggle;
}

describe('AppSidebar', () => {
  it('renders the complete expanded navigation and marks the active route', () => {
    renderSidebar();

    for (const label of navigationLabels) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: '因果图' }).getAttribute('aria-current')).toBe('page');
  });

  it('keeps accessible link names and compact tooltips when collapsed', () => {
    const onToggle = renderSidebar(true);

    for (const label of navigationLabels) {
      const link = screen.getByRole('link', { name: label });
      expect(link.getAttribute('data-tooltip')).toBe(label);
    }
    fireEvent.click(screen.getByRole('button', { name: '展开导航栏' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('disables expansion when the workspace is constrained', () => {
    renderSidebar(true, true);

    const toggle = screen.getByRole('button', { name: '当前窗口空间不足' });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });
});
