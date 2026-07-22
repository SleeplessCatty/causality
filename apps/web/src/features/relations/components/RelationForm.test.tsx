import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../../app/AppProviders';
import { RelationForm } from './RelationForm';

const cause = { id: '11111111-1111-4111-8111-111111111111', name: '原油价格上涨' };
const effect = { id: '22222222-2222-4222-8222-222222222222', name: '航空成本上升' };
const reverse = {
  id: '33333333-3333-4333-8333-333333333333',
  causeEvent: effect,
  effectEvent: cause,
};

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const router = createMemoryRouter(
    [
      {
        path: '/relations/new',
        element: (
          <RelationForm
            mode="create"
            initialValue={{
              causeEvent: null,
              effectEvent: null,
              confidence: null,
              description: null,
              caseSelections: [],
            }}
            onSubmit={onSubmit}
            cancelTo="/relations"
          />
        ),
      },
      { path: '/relations', element: <div>关系列表</div> },
    ],
    { initialEntries: ['/relations/new'] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return onSubmit;
}

async function selectEvent(label: string, candidate: typeof cause) {
  fireEvent.change(screen.getByRole('combobox', { name: label }), {
    target: { value: candidate.name },
  });
  fireEvent.click(await screen.findByRole('option', { name: candidate.name }));
}

describe('RelationForm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requires two existing events and an integer confidence', async () => {
    const submit = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '创建关系' }));
    expect(await screen.findByText('请选择原因事件')).toBeTruthy();
    expect(screen.getByText('请选择结果事件')).toBeTruthy();
    expect(screen.getByText('请输入 0 到 100 的整数')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('loads candidate pages until a later-page event is selectable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        return url.includes('cursor=next-page')
          ? jsonResponse({ items: [effect], nextCursor: null, hasMore: false })
          : jsonResponse({ items: [cause], nextCursor: 'next-page', hasMore: true });
      }),
    );
    renderForm();

    const input = screen.getByRole('combobox', { name: '原因事件' });
    fireEvent.change(input, { target: { value: '能源' } });
    fireEvent.click(await screen.findByRole('option', { name: effect.name }));

    expect((input as HTMLInputElement).value).toBe(effect.name);
  });

  it('shows a reverse warning with a detail link and still submits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/pair-check')) {
          return jsonResponse({ sameDirection: null, reverseDirection: reverse });
        }
        return jsonResponse({
          items: url.includes(encodeURIComponent(effect.name)) ? [effect] : [cause],
          nextCursor: null,
          hasMore: false,
        });
      }),
    );
    const submit = renderForm();
    await selectEvent('原因事件', cause);
    await selectEvent('结果事件', effect);
    fireEvent.change(screen.getByRole('spinbutton', { name: '置信度数值' }), {
      target: { value: '80' },
    });

    expect(await screen.findByText('反向关系已存在')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看反向关系' }).getAttribute('href')).toBe(
      `/relations?expanded=${reverse.id}`,
    );
    fireEvent.click(screen.getByRole('button', { name: '创建关系' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        causeEventId: cause.id,
        effectEventId: effect.id,
        confidence: 80,
        description: null,
        caseSelections: [],
      }),
    );
  });

  it('blocks a same-direction duplicate before submission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/pair-check')) {
          return jsonResponse({ sameDirection: reverse, reverseDirection: null });
        }
        return jsonResponse({
          items: url.includes(encodeURIComponent(effect.name)) ? [effect] : [cause],
          nextCursor: null,
          hasMore: false,
        });
      }),
    );
    const submit = renderForm();
    await selectEvent('原因事件', cause);
    await selectEvent('结果事件', effect);
    fireEvent.change(screen.getByRole('spinbutton', { name: '置信度数值' }), {
      target: { value: '80' },
    });
    expect(await screen.findByText('该方向的因果关系已存在')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建关系' }).hasAttribute('disabled')).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });
});
