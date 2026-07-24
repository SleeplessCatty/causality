import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnhancedSearchButton } from './EnhancedSearchButton';

describe('EnhancedSearchButton', () => {
  it('submits repeatedly but disables itself while the current request is running', () => {
    const onClick = vi.fn();
    const { rerender } = render(<EnhancedSearchButton isEnhancing={false} onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: '增强查询' }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<EnhancedSearchButton isEnhancing onClick={onClick} />);
    const pendingButton = screen.getByRole('button', { name: '增强查询中…' });
    expect(pendingButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(pendingButton);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
