import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GraphFilterPopover } from './GraphFilterPopover';

describe('GraphFilterPopover', () => {
  it('edits a draft and applies only after explicit submission', () => {
    const onApply = vi.fn();
    render(
      <GraphFilterPopover
        open
        values={{ minConfidence: 20, minCaseCount: 1 }}
        onApply={onApply}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const confidence = screen.getByRole('textbox', { name: '最低置信度' });
    const cases = screen.getByRole('textbox', { name: '最少案例数' });
    expect(confidence).toHaveProperty('value', '20');
    expect(document.activeElement).toBe(confidence);

    fireEvent.change(confidence, { target: { value: '60' } });
    fireEvent.change(cases, { target: { value: '2' } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(onApply).toHaveBeenCalledWith({ minConfidence: 60, minCaseCount: 2 });
  });

  it('shows field errors and does not apply invalid drafts', () => {
    const onApply = vi.fn();
    render(
      <GraphFilterPopover
        open
        values={{ minConfidence: 0, minCaseCount: 0 }}
        onApply={onApply}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '最低置信度' }), {
      target: { value: '101' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '最少案例数' }), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(screen.getByText('请输入 0 到 100 的整数')).toBeTruthy();
    expect(screen.getByText('请输入大于等于 0 的整数')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('resets immediately and discards drafts when dismissed', () => {
    const onReset = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <GraphFilterPopover
        open
        values={{ minConfidence: 30, minCaseCount: 2 }}
        onApply={vi.fn()}
        onReset={onReset}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(onReset).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByRole('textbox', { name: '最低置信度' }), {
      target: { value: '70' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <GraphFilterPopover
        open={false}
        values={{ minConfidence: 30, minCaseCount: 2 }}
        onApply={vi.fn()}
        onReset={onReset}
        onClose={onClose}
      />,
    );
    rerender(
      <GraphFilterPopover
        open
        values={{ minConfidence: 30, minCaseCount: 2 }}
        onApply={vi.fn()}
        onReset={onReset}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('textbox', { name: '最低置信度' })).toHaveProperty('value', '30');
  });

  it('closes on an outside pointer action', () => {
    const onClose = vi.fn();
    render(
      <GraphFilterPopover
        open
        values={{ minConfidence: 0, minCaseCount: 0 }}
        onApply={vi.fn()}
        onReset={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
