import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PercentageControl } from './PercentageControl';

describe('PercentageControl', () => {
  it('renders synchronized range and numeric percentage inputs', () => {
    const onChange = vi.fn();
    render(
      <PercentageControl
        id="semantic-threshold"
        label="相似度门槛"
        value={70}
        sliderLabel="相似度门槛滑块"
        numberLabel="相似度门槛数值"
        onChange={onChange}
      />,
    );

    expect((screen.getByRole('slider', { name: '相似度门槛滑块' }) as HTMLInputElement).value).toBe(
      '70',
    );
    expect(
      (screen.getByRole('spinbutton', { name: '相似度门槛数值' }) as HTMLInputElement)
        .valueAsNumber,
    ).toBe(70);

    fireEvent.change(screen.getByRole('slider', { name: '相似度门槛滑块' }), {
      target: { value: '65' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '相似度门槛数值' }), {
      target: { value: '' },
    });

    expect(onChange).toHaveBeenNthCalledWith(1, 65);
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });

  it('applies a custom decimal step to both percentage inputs', () => {
    render(
      <PercentageControl
        id="relation-confidence"
        label="置信度"
        value={65.4}
        step={0.1}
        sliderLabel="置信度滑块"
        numberLabel="置信度数值"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('slider', { name: '置信度滑块' }).getAttribute('step')).toBe('0.1');
    expect(screen.getByRole('spinbutton', { name: '置信度数值' }).getAttribute('step')).toBe('0.1');
  });

  it('keeps the relation form help and error presentation reusable', () => {
    render(
      <PercentageControl
        id="relation-confidence"
        label="置信度"
        value={null}
        required
        sliderLabel="置信度滑块"
        numberLabel="置信度数值"
        help="由人工判断并填写 0–100 的整数。"
        error="请输入 0 到 100 的整数"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('由人工判断并填写 0–100 的整数。')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('请输入 0 到 100 的整数');
    expect((screen.getByRole('slider', { name: '置信度滑块' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      screen.getByRole('spinbutton', { name: '置信度数值' }).getAttribute('aria-invalid'),
    ).toBe('true');
  });
});
