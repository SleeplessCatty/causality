import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthProvider';
import { InitialPasswordPage } from './InitialPasswordPage';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('InitialPasswordPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('changes an initial password without asking the user to re-enter the temporary password', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          user: {
            id: '123e4567-e89b-42d3-a456-426614174000',
            username: 'Jason',
            mustChangePassword: true,
          },
          csrfToken: 'csrf-token',
        }),
      )
      .mockResolvedValueOnce(response({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    const router = createMemoryRouter(
      [
        { path: '/change-initial-password', element: <InitialPasswordPage /> },
        { path: '/events', element: <div>原子事件页面</div> },
      ],
      { initialEntries: ['/change-initial-password'] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await screen.findByRole('heading', { name: '设置新密码' });
    expect(screen.queryByLabelText('初始密码')).toBeNull();
    fireEvent.change(screen.getByLabelText('新密码', { exact: true }), {
      target: { value: 'Changed!Pass123' },
    });
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'Changed!Pass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));

    expect(await screen.findByText('原子事件页面')).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/change-initial-password');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      newPassword: 'Changed!Pass123',
    });
  });

  it('still requires the current password for a user-initiated password change', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          user: {
            id: '123e4567-e89b-42d3-a456-426614174000',
            username: 'Jason',
            mustChangePassword: false,
          },
          csrfToken: 'csrf-token',
        }),
      )
      .mockResolvedValueOnce(response({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    const router = createMemoryRouter(
      [
        { path: '/change-initial-password', element: <InitialPasswordPage /> },
        { path: '/events', element: <div>原子事件页面</div> },
      ],
      { initialEntries: ['/change-initial-password'] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await screen.findByRole('heading', { name: '修改密码' });
    fireEvent.change(screen.getByLabelText('当前密码'), {
      target: { value: 'Current!Pass123' },
    });
    fireEvent.change(screen.getByLabelText('新密码', { exact: true }), {
      target: { value: 'Changed!Pass123' },
    });
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'Changed!Pass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/change-password');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      currentPassword: 'Current!Pass123',
      newPassword: 'Changed!Pass123',
    });
  });

  it('lets each password field be shown independently', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        user: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          username: 'Jason',
          mustChangePassword: false,
        },
        csrfToken: 'csrf-token',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const router = createMemoryRouter(
      [{ path: '/change-initial-password', element: <InitialPasswordPage /> }],
      { initialEntries: ['/change-initial-password'] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    const currentPassword = await screen.findByLabelText('当前密码');
    const newPassword = screen.getByLabelText('新密码', { exact: true });
    const confirmation = screen.getByLabelText('确认新密码');
    expect(currentPassword.getAttribute('type')).toBe('password');
    expect(newPassword.getAttribute('type')).toBe('password');
    expect(confirmation.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: '显示当前密码' }));
    expect(currentPassword.getAttribute('type')).toBe('text');
    expect(newPassword.getAttribute('type')).toBe('password');
    expect(confirmation.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: '显示新密码' }));
    expect(currentPassword.getAttribute('type')).toBe('text');
    expect(newPassword.getAttribute('type')).toBe('text');
    expect(confirmation.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: '显示确认新密码' }));
    expect(currentPassword.getAttribute('type')).toBe('text');
    expect(newPassword.getAttribute('type')).toBe('text');
    expect(confirmation.getAttribute('type')).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: '隐藏新密码' }));
    expect(currentPassword.getAttribute('type')).toBe('text');
    expect(newPassword.getAttribute('type')).toBe('password');
    expect(confirmation.getAttribute('type')).toBe('text');
  });

  it('replaces the password page in history when a user cancels without logging out', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        user: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          username: 'Jason',
          mustChangePassword: false,
        },
        csrfToken: 'csrf-token',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const router = createMemoryRouter(
      [
        { path: '/events', element: <div>原子事件页面</div> },
        { path: '/change-initial-password', element: <InitialPasswordPage /> },
        { path: '/relations', element: <div>关系页面</div> },
      ],
      {
        initialEntries: [
          '/events',
          { pathname: '/change-initial-password', state: { returnTo: '/relations?tab=all' } },
        ],
        initialIndex: 1,
      },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await screen.findByRole('heading', { name: '修改密码' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByText('关系页面')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/relations');
    expect(router.state.location.search).toBe('?tab=all');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText('原子事件页面')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '修改密码' })).toBeNull();
  });

  it('does not offer cancellation while an initial password must be changed', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        user: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          username: 'Jason',
          mustChangePassword: true,
        },
        csrfToken: 'csrf-token',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const router = createMemoryRouter(
      [{ path: '/change-initial-password', element: <InitialPasswordPage /> }],
      { initialEntries: ['/change-initial-password'] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await screen.findByRole('heading', { name: '设置新密码' });
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
  });
});
