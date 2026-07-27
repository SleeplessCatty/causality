import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppTabs } from './AppTabs';

const tabs = [
  { value: 'events', label: '原子事件' },
  { value: 'cases', label: '具体案例' },
  { value: 'relations', label: '因果关系' },
] as const;

function renderTabs(value: (typeof tabs)[number]['value'] = 'events', onChange = vi.fn()) {
  return render(
    <AppTabs id="import-detail" label="导入数据类型" value={value} tabs={tabs} onChange={onChange}>
      <p>当前标签内容</p>
    </AppTabs>,
  );
}

describe('AppTabs', () => {
  it('connects tablist, selected tab, and active tabpanel semantics', () => {
    renderTabs('cases');

    const tablist = screen.getByRole('tablist', { name: '导入数据类型' });
    const active = screen.getByRole('tab', { name: '具体案例' });
    const inactive = screen.getByRole('tab', { name: '原子事件' });
    const panel = screen.getByRole('tabpanel');

    expect(tablist).toBeTruthy();
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.getAttribute('tabindex')).toBe('0');
    expect(inactive.getAttribute('aria-selected')).toBe('false');
    expect(inactive.getAttribute('tabindex')).toBe('-1');
    expect(active.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(active.id);
    expect(panel.textContent).toContain('当前标签内容');
  });

  it('changes the active value when a tab is clicked', () => {
    const onChange = vi.fn();
    renderTabs('events', onChange);

    fireEvent.click(screen.getByRole('tab', { name: '因果关系' }));

    expect(onChange).toHaveBeenCalledWith('relations');
  });

  it('wraps Left and Right arrow navigation and moves focus', () => {
    const onChange = vi.fn();
    renderTabs('events', onChange);
    const first = screen.getByRole('tab', { name: '原子事件' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('relations');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '因果关系' }));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('events');
    expect(document.activeElement).toBe(first);
  });

  it('moves directly to the first or last tab with Home and End', () => {
    const onChange = vi.fn();
    renderTabs('cases', onChange);
    const middle = screen.getByRole('tab', { name: '具体案例' });
    middle.focus();

    fireEvent.keyDown(middle, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('relations');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '因果关系' }));

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('events');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '原子事件' }));
  });

  it('exposes the shared class hooks used for visible focus styling', () => {
    renderTabs();

    expect(screen.getByRole('tablist').className).toContain('app-tabs__list');
    expect(screen.getByRole('tab', { name: '原子事件' }).className).toContain(
      'app-tabs__tab--active',
    );
  });
});
