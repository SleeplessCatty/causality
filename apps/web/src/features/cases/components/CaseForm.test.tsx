import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { CaseForm } from './CaseForm';

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const router = createMemoryRouter(
    [
      {
        path: '/cases/new',
        element: <CaseForm mode="create" initialContent="" onSubmit={onSubmit} cancelTo="/cases" />,
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
  it('validates content, shows the character count, and submits trimmed content', async () => {
    const submit = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '创建案例' }));
    expect(await screen.findByText('请输入案例内容')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '案例内容' }), {
      target: { value: '  2025年4月美国宣布新一轮关税措施  ' },
    });
    expect(screen.getByText('18 / 50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创建案例' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ content: '2025年4月美国宣布新一轮关税措施' }),
    );
  });
});
