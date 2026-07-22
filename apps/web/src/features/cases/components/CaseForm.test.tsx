import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { CaseForm } from './CaseForm';

function renderForm(
  onSubmit = vi.fn().mockResolvedValue(undefined),
  mode: 'create' | 'edit' = 'create',
) {
  const router = createMemoryRouter(
    [
      {
        path: '/cases/new',
        element: <CaseForm mode={mode} initialContent="" onSubmit={onSubmit} cancelTo="/cases" />,
      },
      { path: '/cases', element: <div>案例列表</div> },
    ],
    { initialEntries: ['/cases/new'] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return onSubmit;
}

describe('CaseForm', () => {
  afterEach(() => vi.useRealTimers());

  it('validates content, shows the character count, and submits trimmed content', async () => {
    const submit = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '创建案例' }));
    expect(await screen.findByText('请输入案例内容')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '案例内容' }), {
      target: { value: '  2025年4月美国宣布新一轮关税措施  ' },
    });
    expect(screen.getByText('18 / 100')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创建案例' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ content: '2025年4月美国宣布新一轮关税措施' }),
    );
  });

  it.each([
    ['create', '创建案例'],
    ['edit', '保存修改'],
  ] as const)(
    'dismisses a %s validation error and restarts it on resubmit',
    async (mode, buttonName) => {
      vi.useFakeTimers();
      renderForm(undefined, mode);

      const submit = screen.getByRole('button', { name: buttonName });
      fireEvent.click(submit);
      expect(screen.getByText('请输入案例内容')).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(3_000));
      expect(screen.queryByText('请输入案例内容')).toBeNull();
      fireEvent.click(submit);
      expect(screen.getByText('请输入案例内容')).toBeTruthy();
    },
  );
});
