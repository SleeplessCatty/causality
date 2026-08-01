import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AppSidebar } from './AppSidebar';

const navigationLabels = [
  '原子事件',
  '因果关系',
  '具体案例',
  '因果图',
  '数据维护',
  '导入导出',
  '参数配置',
  '系统状态',
];

function renderSidebar(collapsed = false, forced = false, onToggle = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/graph']}>
      <AppSidebar collapsed={collapsed} forced={forced} onToggle={onToggle} />
    </MemoryRouter>,
  );
  return onToggle;
}

describe('AppSidebar', () => {
  it('renders the shared Causality brand mark', () => {
    renderSidebar();

    expect(document.querySelector('[data-brand-mark="causality"]')).toBeTruthy();
  });

  it('renders the complete expanded navigation and marks the active route', () => {
    renderSidebar();

    for (const label of navigationLabels) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    const links = screen.getAllByRole('link');
    expect(links.indexOf(screen.getByRole('link', { name: '数据维护' }))).toBeLessThan(
      links.indexOf(screen.getByRole('link', { name: '导入导出' })),
    );
    expect(links.indexOf(screen.getByRole('link', { name: '导入导出' }))).toBeLessThan(
      links.indexOf(screen.getByRole('link', { name: '参数配置' })),
    );
    expect(links.indexOf(screen.getByRole('link', { name: '参数配置' }))).toBeLessThan(
      links.indexOf(screen.getByRole('link', { name: '系统状态' })),
    );
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
