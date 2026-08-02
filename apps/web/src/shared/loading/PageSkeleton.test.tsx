import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageSkeleton, type SkeletonVariant } from './PageSkeleton';

const expectations: Array<[SkeletonVariant, string]> = [
  ['list', '正在准备列表页面'],
  ['detail', '正在准备详情页面'],
  ['form', '正在准备表单页面'],
  ['settings', '正在准备设置页面'],
  ['canvas', '正在准备画布页面'],
];

describe('PageSkeleton', () => {
  it.each(expectations)('renders the %s skeleton with stable semantics', (variant, label) => {
    render(<PageSkeleton variant={variant} />);

    const status = screen.getByRole('status', { name: label });
    expect(status.getAttribute('data-skeleton-variant')).toBe(variant);
    expect(status.getAttribute('aria-hidden')).toBeNull();
  });

  it('keeps an invisible skeleton out of the accessibility tree', () => {
    const view = render(<PageSkeleton variant="list" visible={false} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(view.container.querySelector('[data-skeleton-variant="list"]')).toBeTruthy();
  });
});
