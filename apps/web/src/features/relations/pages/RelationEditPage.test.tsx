import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { RelationEditPage } from './RelationEditPage';

const relationId = '11111111-1111-4111-8111-111111111111';
const linkedCase = {
  id: '44444444-4444-4444-8444-444444444444',
  content: '2025年4月美国宣布新一轮关税措施',
  relationCount: 1,
  updatedAt: '2026-07-21T03:00:00.000Z',
  linkedAt: '2026-07-21T02:00:00.000Z',
};
const secondLinkedCase = {
  id: '55555555-5555-4555-8555-555555555555',
  content: '2025年5月进口成本继续上升',
  relationCount: 1,
  updatedAt: '2026-07-22T03:00:00.000Z',
  linkedAt: '2026-07-20T02:00:00.000Z',
};
const detail = {
  id: relationId,
  causeEvent: { id: '22222222-2222-4222-8222-222222222222', name: '关税上调' },
  effectEvent: { id: '33333333-3333-4333-8333-333333333333', name: '进口成本上升' },
  confidence: 70,
  caseCount: 2,
  listPage: 3,
  description: null,
  createdAt: '2026-07-20T03:00:00.000Z',
  updatedAt: '2026-07-21T03:00:00.000Z',
  recentCases: [{ id: linkedCase.id, content: linkedCase.content }],
};

function response(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

describe('RelationEditPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preloads and merges every cursor page of linked cases before rendering the form', async () => {
    const requestedCaseUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PUT') return response({ ...detail, listPage: 1 });
        if (url.includes('/pair-check')) {
          return response({ sameDirection: null, reverseDirection: null });
        }
        if (url.startsWith(`/api/relations/${relationId}/cases?`)) {
          requestedCaseUrls.push(url);
          return url.includes('cursor=second-page')
            ? response({ items: [secondLinkedCase], nextCursor: null, hasMore: false })
            : response({ items: [linkedCase], nextCursor: 'second-page', hasMore: true });
        }
        return response(detail);
      }),
    );
    const router = createMemoryRouter(
      [
        { path: '/relations/:relationId/edit', element: <RelationEditPage /> },
        { path: '/relations/:relationId', element: <div>关系详情目标</div> },
        { path: '/relations', element: <div>关系列表</div> },
        { path: '/maintenance', element: <div>数据维护目标</div> },
      ],
      {
        initialEntries: [
          {
            pathname: `/relations/${relationId}/edit`,
            state: {
              listReturnPath: '/relations?q=%E5%85%B3%E7%A8%8E&page=2',
              listFocusId: relationId,
            },
          },
        ],
      },
    );

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    const input = await screen.findByRole('combobox', { name: '具体案例 1' });
    expect((input as HTMLInputElement).value).toBe(linkedCase.content);
    const secondInput = screen.getByRole('combobox', { name: '具体案例 2' });
    expect((secondInput as HTMLInputElement).value).toBe(secondLinkedCase.content);
    expect(requestedCaseUrls).toHaveLength(2);
    expect(requestedCaseUrls[1]).toContain('cursor=second-page');
    expect(screen.getAllByText('已有案例')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '返回关系列表' }).getAttribute('href')).toBe(
      '/relations?q=%E5%85%B3%E7%A8%8E&page=2',
    );
    expect(screen.getByRole('link', { name: '取消' }).getAttribute('href')).toBe(
      '/relations?q=%E5%85%B3%E7%A8%8E&page=2',
    );

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await screen.findByText('关系列表');
    await waitFor(() => expect(router.state.location.pathname).toBe('/relations'));
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toMatchObject({
      notice: '修改已保存',
      listFocusId: relationId,
    });
  });

  it('ignores obsolete maintenance return state and keeps normal relation-list navigation', async () => {
    const issueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PUT') return response(detail);
        if (url.includes('/pair-check')) {
          return response({ sameDirection: null, reverseDirection: null });
        }
        if (url.startsWith(`/api/relations/${relationId}/cases?`)) {
          return response({
            items: [linkedCase, secondLinkedCase],
            nextCursor: null,
            hasMore: false,
          });
        }
        return response(detail);
      }),
    );
    const router = createMemoryRouter(
      [
        { path: '/relations/:relationId/edit', element: <RelationEditPage /> },
        { path: '/relations', element: <div>关系列表</div> },
        { path: '/maintenance', element: <div>数据维护目标</div> },
      ],
      {
        initialEntries: [
          {
            pathname: `/relations/${relationId}/edit`,
            state: {
              listReturnPath: '/relations?q=%E5%85%B3%E7%A8%8E&page=2',
              listFocusId: relationId,
              dataCheckReturnPath: `/maintenance?expanded=${issueId}`,
              dataCheckSnapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              dataCheckIssueId: issueId,
              dataCheckReturnMode: 'saved',
            },
          },
        ],
      },
    );
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await screen.findByRole('combobox', { name: '具体案例 1' });
    expect(screen.getByRole('link', { name: '返回关系列表' }).getAttribute('href')).toBe(
      '/relations?q=%E5%85%B3%E7%A8%8E&page=2',
    );
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('关系列表')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/relations');
    expect(router.state.location.search).toBe('?page=3');
    expect(router.state.location.state).toMatchObject({
      notice: '修改已保存',
      listFocusId: relationId,
    });
    expect(JSON.stringify(router.state.location.state)).not.toContain('dataCheck');
  });
});
