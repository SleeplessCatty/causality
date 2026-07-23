import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ListPagination } from './ListPagination';

describe('ListPagination', () => {
  it('shows every page for fewer than seven pages and marks the current page', () => {
    render(
      <ListPagination page={3} totalPages={5} totalItems={123} onPageChange={() => undefined} />,
    );

    expect(screen.getByText('共 123 条 · 第 3/5 页')).toBeTruthy();
    expect(screen.queryByText('…')).toBeNull();
    expect(screen.getByRole('button', { name: '第 3 页' }).getAttribute('aria-current')).toBe(
      'page',
    );
    for (let page = 1; page <= 5; page += 1) {
      expect(screen.getByRole('button', { name: `第 ${page} 页` })).toBeTruthy();
    }
  });

  it('shows fixed ellipses and disables boundary navigation', () => {
    const { rerender } = render(
      <ListPagination page={1} totalPages={12} totalItems={360} onPageChange={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(false);

    rerender(
      <ListPagination page={6} totalPages={12} totalItems={360} onPageChange={() => undefined} />,
    );
    expect(screen.getAllByText('…')).toHaveLength(2);
    for (const page of [1, 4, 5, 6, 7, 8, 12]) {
      expect(screen.getByRole('button', { name: `第 ${page} 页` })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: '第 3 页' })).toBeNull();

    rerender(
      <ListPagination page={12} totalPages={12} totalItems={360} onPageChange={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
  });

  it('calls onPageChange for adjacent, numbered, and valid jump navigation only', () => {
    const onPageChange = vi.fn();
    render(
      <ListPagination page={4} totalPages={12} totalItems={360} onPageChange={onPageChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }));
    const input = screen.getByRole('spinbutton', { name: '跳转页码' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([3, 5, 2, 9]);

    for (const value of ['', '0', '13', '1.5']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: '跳转' }));
    }
    expect(onPageChange).toHaveBeenCalledTimes(4);
  });

  it('returns the main content area to the top after every valid navigation', () => {
    const main = document.createElement('main');
    main.className = 'product-main';
    const scrollTo = vi.fn();
    Object.defineProperty(main, 'scrollTo', { configurable: true, value: scrollTo });
    document.body.append(main);

    render(
      <ListPagination page={2} totalPages={4} totalItems={200} onPageChange={() => undefined} />,
      { container: main },
    );

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    fireEvent.click(screen.getByRole('button', { name: '第 1 页' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '跳转页码' }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: '跳转' }));

    expect(scrollTo).toHaveBeenCalledTimes(3);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('disables every control while a page request is in flight', () => {
    render(
      <ListPagination
        page={4}
        totalPages={12}
        totalItems={360}
        disabled
        onPageChange={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(
      true,
    );
    expect(screen.getByRole('spinbutton', { name: '跳转页码' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
