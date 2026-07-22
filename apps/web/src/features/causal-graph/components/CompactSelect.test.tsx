import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompactSelect } from './CompactSelect';

const directionOptions = [
  { value: 'both' as const, label: '双向' },
  { value: 'downstream' as const, label: '下游' },
  { value: 'upstream' as const, label: '上游' },
];

describe('CompactSelect', () => {
  it('renders the approved order and selects the highlighted typed value', () => {
    const onChange = vi.fn();
    render(
      <CompactSelect
        label="方向"
        ariaLabel="查询方向"
        value="both"
        options={directionOptions}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: '查询方向' });
    expect(trigger.textContent).toContain('双向');
    fireEvent.click(trigger);
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
      '双向',
      '下游',
      '上游',
    ]);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('upstream');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('supports Space, Home, arrows, Escape, and outside click', () => {
    const onChange = vi.fn();
    render(
      <div>
        <CompactSelect
          label="方向"
          ariaLabel="查询方向"
          value="downstream"
          options={directionOptions}
          onChange={onChange}
        />
        <button type="button">外部</button>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: '查询方向' });

    fireEvent.keyDown(trigger, { key: ' ' });
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'Home' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('downstream');

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps only one compact menu open', () => {
    render(
      <>
        <CompactSelect
          label="方向"
          ariaLabel="查询方向"
          value="both"
          options={directionOptions}
          onChange={vi.fn()}
        />
        <CompactSelect
          label="节点"
          ariaLabel="节点上限"
          value={20}
          options={[
            { value: 20, label: '20' },
            { value: 50, label: '50' },
          ]}
          onChange={vi.fn()}
        />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: '查询方向' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '节点上限' }));
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual(['20', '50']);
  });
});
