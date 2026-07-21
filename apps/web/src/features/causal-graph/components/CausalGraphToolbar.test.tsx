import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { CausalGraphToolbar } from './CausalGraphToolbar';

describe('CausalGraphToolbar', () => {
  it('changes direction and sends viewport commands', () => {
    const onDirectionChange = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFit = vi.fn();
    render(
      <AppProviders>
        <CausalGraphToolbar
          selectedEvent={null}
          direction="both"
          zoom={1}
          onEventSelect={vi.fn()}
          onDirectionChange={onDirectionChange}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFit={onFit}
        />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('radio', { name: '只看上游' }));
    fireEvent.click(screen.getByRole('button', { name: '缩小因果图' }));
    fireEvent.click(screen.getByRole('button', { name: '放大因果图' }));
    fireEvent.click(screen.getByRole('button', { name: '适应画布' }));

    expect(onDirectionChange).toHaveBeenCalledWith('upstream');
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('disables zoom controls at the approved boundaries', () => {
    const props = {
      selectedEvent: null,
      direction: 'both' as const,
      onEventSelect: vi.fn(),
      onDirectionChange: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onFit: vi.fn(),
    };
    const { rerender } = render(
      <AppProviders>
        <CausalGraphToolbar {...props} zoom={0.25} />
      </AppProviders>,
    );
    expect((screen.getByRole('button', { name: '缩小因果图' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    rerender(
      <AppProviders>
        <CausalGraphToolbar {...props} zoom={2} />
      </AppProviders>,
    );
    expect((screen.getByRole('button', { name: '放大因果图' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
