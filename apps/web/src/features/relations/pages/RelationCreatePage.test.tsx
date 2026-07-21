import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { RelationCreatePage } from './RelationCreatePage';

describe('RelationCreatePage', () => {
  it('starts a new relation with 10% confidence', () => {
    const router = createMemoryRouter(
      [
        { path: '/relations/new', element: <RelationCreatePage /> },
        { path: '/relations', element: <div>关系列表</div> },
      ],
      { initialEntries: ['/relations/new'] },
    );

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    const numberInput = screen.getByRole('spinbutton', { name: '置信度数值' });
    const slider = screen.getByRole('slider', { name: '置信度滑块' });

    expect((numberInput as HTMLInputElement).value).toBe('10');
    expect((slider as HTMLInputElement).value).toBe('10');
    expect(slider.hasAttribute('disabled')).toBe(false);
  });
});
