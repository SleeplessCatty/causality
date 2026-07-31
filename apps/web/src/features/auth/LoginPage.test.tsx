import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthProvider';
import { LoginPage } from './LoginPage';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderLogin(
  loginResponse: Response,
  initialEntry: string | { pathname: string; state: unknown } = '/login',
) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ code: 'AUTH_REQUIRED', message: '需要登录' }, 401))
    .mockResolvedValueOnce(loginResponse);
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/events', element: <div>原子事件页面</div> },
      { path: '/relations', element: <div>因果关系列表</div> },
      { path: '/change-initial-password', element: <div>修改初始密码页面</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { fetchMock, router };
}

async function submitLogin() {
  await screen.findByRole('button', { name: '登录' });
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'jason' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'GoodPass!123' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
}

describe('LoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns to the preserved business URL after a successful login', async () => {
    renderLogin(
      response({
        user: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          username: 'Jason',
          mustChangePassword: false,
        },
        csrfToken: 'csrf-token',
      }),
      { pathname: '/login', state: { returnTo: '/relations?page=2' } },
    );

    await submitLogin();

    expect(await screen.findByText('因果关系列表')).toBeTruthy();
  });

  it('redirects an initial-password user to the required password page', async () => {
    renderLogin(
      response({
        user: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          username: 'Jason',
          mustChangePassword: true,
        },
        csrfToken: 'csrf-token',
      }),
    );

    await submitLogin();

    expect(await screen.findByText('修改初始密码页面')).toBeTruthy();
  });

  it.each([
    ['ACCOUNT_LOCKED', '账号已临时锁定，请稍后再试'],
    ['TOO_MANY_ATTEMPTS', '登录尝试过于频繁，请稍后再试'],
  ])('shows specific copy for %s', async (code, expectedMessage) => {
    renderLogin(
      response({ code, message: 'server message' }, code === 'ACCOUNT_LOCKED' ? 423 : 429),
    );

    await submitLogin();

    expect((await screen.findByRole('alert')).textContent).toContain(expectedMessage);
  });

  it('contains only the local username and password login flow', async () => {
    renderLogin(response({ code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }, 401));

    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeTruthy());
    expect(screen.getByLabelText('用户名')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
    expect(screen.queryByText(/注册|找回密码|OAuth|TOTP|移动端/)).toBeNull();
  });
});
