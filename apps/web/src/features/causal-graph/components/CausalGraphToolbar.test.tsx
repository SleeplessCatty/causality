import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { CausalGraphToolbar } from './CausalGraphToolbar';

describe('CausalGraphToolbar', () => {
  const baseProps = {
    selectedEvent: null,
    direction: 'both' as const,
    limit: 20 as const,
    minConfidence: 30,
    minCaseCount: 2,
    zoom: 1,
    onEventSelect: vi.fn(),
    onDirectionChange: vi.fn(),
    onLimitChange: vi.fn(),
    onMinConfidenceChange: vi.fn(),
    onMinCaseCountChange: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFit: vi.fn(),
  };

  it('changes discrete query options and sends viewport commands', () => {
    const onDirectionChange = vi.fn();
    const onLimitChange = vi.fn();
    const onMinConfidenceChange = vi.fn();
    const onMinCaseCountChange = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFit = vi.fn();
    render(
      <AppProviders>
        <CausalGraphToolbar
          {...baseProps}
          onDirectionChange={onDirectionChange}
          onLimitChange={onLimitChange}
          onMinConfidenceChange={onMinConfidenceChange}
          onMinCaseCountChange={onMinCaseCountChange}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFit={onFit}
        />
      </AppProviders>,
    );

    expect(screen.getByRole('combobox', { name: '查询方向' })).toHaveProperty('value', 'both');
    expect(screen.getByRole('combobox', { name: '节点上限' })).toHaveProperty('value', '20');
    expect(screen.getByRole('combobox', { name: '最低置信度' })).toHaveProperty('value', '30');
    expect(screen.getByRole('combobox', { name: '最少案例数' })).toHaveProperty('value', '2');

    fireEvent.change(screen.getByRole('combobox', { name: '查询方向' }), {
      target: { value: 'upstream' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '节点上限' }), {
      target: { value: '50' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '最低置信度' }), {
      target: { value: '70' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '最少案例数' }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: '缩小因果图' }));
    fireEvent.click(screen.getByRole('button', { name: '放大因果图' }));
    fireEvent.click(screen.getByRole('button', { name: '适应画布' }));

    expect(onDirectionChange).toHaveBeenCalledWith('upstream');
    expect(onLimitChange).toHaveBeenCalledWith(50);
    expect(onMinConfidenceChange).toHaveBeenCalledWith(70);
    expect(onMinCaseCountChange).toHaveBeenCalledWith(4);
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
    expect(screen.getByRole('status', { name: '当前缩放比例' }).textContent).toBe('100%');
  });

  it('disables zoom controls at the approved boundaries', () => {
    const { rerender } = render(
      <AppProviders>
        <CausalGraphToolbar {...baseProps} zoom={0.25} />
      </AppProviders>,
    );
    expect((screen.getByRole('button', { name: '缩小因果图' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    rerender(
      <AppProviders>
        <CausalGraphToolbar {...baseProps} zoom={2} />
      </AppProviders>,
    );
    expect((screen.getByRole('button', { name: '放大因果图' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
