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

  it('uses custom controls in the approved order and emits typed query values', () => {
    const onDirectionChange = vi.fn();
    const onLimitChange = vi.fn();
    const onMinConfidenceChange = vi.fn();
    const onMinCaseCountChange = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFit = vi.fn();
    const { container } = render(
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

    expect(container.querySelectorAll('select')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '查询方向' }));
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
      '双向',
      '下游',
      '上游',
    ]);
    fireEvent.click(screen.getByRole('option', { name: '上游' }));
    fireEvent.click(screen.getByRole('button', { name: '节点上限' }));
    fireEvent.click(screen.getByRole('option', { name: '50' }));
    fireEvent.click(screen.getByRole('button', { name: '最低置信度' }));
    fireEvent.click(screen.getByRole('option', { name: '70%' }));
    fireEvent.click(screen.getByRole('button', { name: '最少案例数' }));
    fireEvent.click(screen.getByRole('option', { name: '4' }));
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
        <CausalGraphToolbar {...baseProps} zoom={0.1} />
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
