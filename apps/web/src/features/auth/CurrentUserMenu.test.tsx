import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthProvider';
import { CurrentUserMenu } from './CurrentUserMenu';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function sessionResponse() {
  return response({
    user: {
      id: '123e4567-e89b-42d3-a456-426614174000',
      username: 'Jason',
      mustChangePassword: false,
    },
    csrfToken: 'csrf-token',
  });
}

function renderMenu(collapsed = false) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(sessionResponse());
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(
    [
      { path: '/events', element: <CurrentUserMenu collapsed={collapsed} /> },
      { path: '/change-initial-password', element: <div>密码修改页面</div> },
      { path: '/login', element: <div>登录页面</div> },
    ],
    { initialEntries: ['/events?page=2'] },
  );
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { fetchMock, router };
}

describe('CurrentUserMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows only the current username and the three account operations', async () => {
    renderMenu();

    await screen.findByText('Jason');
    fireEvent.click(screen.getByRole('button', { name: '打开当前用户菜单' }));

    expect(screen.getByRole('menuitem', { name: '修改密码' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '退出当前会话' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '退出全部会话' })).toBeTruthy();
    expect(screen.queryByText(/管理员|普通用户|其他用户/)).toBeNull();
  });

  it('opens password change while preserving the current business URL', async () => {
    const { router } = renderMenu();
    await screen.findByText('Jason');
    fireEvent.click(screen.getByRole('button', { name: '打开当前用户菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '修改密码' }));

    expect(await screen.findByText('密码修改页面')).toBeTruthy();
    expect(router.state.location.state).toEqual({ returnTo: '/events?page=2' });
  });

  it.each([
    ['退出当前会话', '/api/auth/logout'],
    ['退出全部会话', '/api/auth/logout-all'],
  ])('executes %s and returns to login', async (operation, endpoint) => {
    const { fetchMock } = renderMenu();
    fetchMock.mockResolvedValueOnce(response({ success: true }));
    await screen.findByText('Jason');
    fireEvent.click(screen.getByRole('button', { name: '打开当前用户菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: operation }));

    expect(await screen.findByText('登录页面')).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(endpoint);
  });

  it('retains an accessible tooltip when the sidebar is collapsed', async () => {
    renderMenu(true);

    const trigger = await screen.findByRole('button', { name: '打开 Jason 的用户菜单' });
    expect(trigger.getAttribute('title')).toBe('Jason');
    expect(screen.queryByText('Jason')).toBeNull();
  });
});
