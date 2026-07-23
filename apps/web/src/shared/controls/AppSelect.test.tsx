import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppSelect } from './AppSelect';

describe('AppSelect', () => {
  it('supports mouse and keyboard selection without a native select', () => {
    const onChange = vi.fn();
    render(
      <AppSelect
        label="严重程度"
        ariaLabel="严重程度"
        value=""
        options={[
          { value: '', label: '全部' },
          { value: 'error', label: '错误' },
          { value: 'warning', label: '警告' },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole('combobox')).toBeNull();
    const trigger = screen.getByRole('button', { name: '严重程度' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('warning');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
