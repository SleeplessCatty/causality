import { fireEvent, render, screen } from '@testing-library/react';
import { createContext, useContext } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthProvider';
import { CurrentUserMenu } from './CurrentUserMenu';

const SidebarCollapsedContext = createContext(false);

function CurrentUserMenuHarness() {
  return <CurrentUserMenu collapsed={useContext(SidebarCollapsedContext)} />;
}

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
      { path: '/events', element: <CurrentUserMenuHarness /> },
      { path: '/change-initial-password', element: <div>密码修改页面</div> },
      { path: '/login', element: <div>登录页面</div> },
    ],
    { initialEntries: ['/events?page=2'] },
  );
  const view = render(
    <SidebarCollapsedContext.Provider value={collapsed}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </SidebarCollapsedContext.Provider>,
  );
  return {
    fetchMock,
    router,
    rerenderMenu(nextCollapsed: boolean) {
      view.rerender(
        <SidebarCollapsedContext.Provider value={nextCollapsed}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </SidebarCollapsedContext.Provider>,
      );
    },
  };
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

  it('renders a non-interactive current-user identity when the sidebar is collapsed', async () => {
    renderMenu(true);

    const identity = await screen.findByLabelText('当前用户 Jason');
    expect(identity.getAttribute('title')).toBe('Jason');
    expect(screen.queryByText('Jason')).toBeNull();
    expect(screen.queryByRole('button', { name: /用户菜单/ })).toBeNull();
  });

  it('closes an open user menu when the sidebar collapses', async () => {
    const { rerenderMenu } = renderMenu();
    await screen.findByText('Jason');
    fireEvent.click(screen.getByRole('button', { name: '打开当前用户菜单' }));
    expect(screen.getByRole('menu', { name: '当前用户操作' })).toBeTruthy();

    rerenderMenu(true);

    expect(screen.queryByRole('menu', { name: '当前用户操作' })).toBeNull();
    expect(await screen.findByLabelText('当前用户 Jason')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /用户菜单/ })).toBeNull();
  });
});
