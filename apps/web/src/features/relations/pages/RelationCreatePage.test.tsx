import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { RelationCreatePage } from './RelationCreatePage';

describe('RelationCreatePage', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('navigates a created relation to its detail page', async () => {
    const cause = { id: '22222222-2222-4222-8222-222222222222', name: '测试原因' };
    const effect = { id: '33333333-3333-4333-8333-333333333333', name: '测试结果' };
    const relation = {
      id: '11111111-1111-4111-8111-111111111111',
      causeEvent: cause,
      effectEvent: effect,
      confidence: 10,
      caseCount: 0,
      description: null,
      createdAt: '2026-07-20T03:00:00.000Z',
      updatedAt: '2026-07-20T03:00:00.000Z',
      recentCases: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          return Promise.resolve({ ok: true, json: async () => relation } as Response);
        }
        if (url.includes('/pair-check')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ sameDirection: null, reverseDirection: null }),
          } as Response);
        }
        const candidate = url.includes(encodeURIComponent(effect.name)) ? effect : cause;
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [candidate], nextCursor: null, hasMore: false }),
        } as Response);
      }),
    );
    const router = createMemoryRouter(
      [
        { path: '/relations/new', element: <RelationCreatePage /> },
        { path: '/relations/:relationId', element: <div>关系详情目标</div> },
        { path: '/relations', element: <div>关系列表</div> },
      ],
      { initialEntries: ['/relations/new'] },
    );
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    for (const [label, candidate] of [
      ['原因事件', cause],
      ['结果事件', effect],
    ] as const) {
      fireEvent.change(screen.getByRole('combobox', { name: label }), {
        target: { value: candidate.name },
      });
      fireEvent.click(await screen.findByRole('option', { name: candidate.name }));
    }
    fireEvent.click(screen.getByRole('button', { name: '创建关系' }));

    await screen.findByText('关系详情目标');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/relations/${relation.id}`));
  });
});
