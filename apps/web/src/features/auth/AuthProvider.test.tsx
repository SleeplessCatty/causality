import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './AuthProvider';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="username">{auth.user?.username ?? 'none'}</span>
      <button
        type="button"
        onClick={() => void auth.login({ username: 'jason', password: 'GoodPass!123' })}
      >
        登录
      </button>
      <button type="button" onClick={() => void auth.logout()}>
        退出当前会话
      </button>
      <button type="button" onClick={() => void auth.logoutAll()}>
        退出全部会话
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('bootstraps an authenticated session and exposes the current user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          user: {
            id: '123e4567-e89b-42d3-a456-426614174000',
            username: 'Jason',
            mustChangePassword: false,
          },
          csrfToken: 'csrf-token',
        }),
      ),
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status').textContent).toBe('loading');
    expect(await screen.findByText('Jason')).toBeTruthy();
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
  });

  it('treats an absent session as anonymous and can log in', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ code: 'AUTH_REQUIRED', message: '需要登录' }, 401))
      .mockResolvedValueOnce(
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

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('Jason')).toBeTruthy();
  });

  it('transitions to anonymous when the transport reports an unauthorized response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          user: {
            id: '123e4567-e89b-42d3-a456-426614174000',
            username: 'Jason',
            mustChangePassword: false,
          },
          csrfToken: 'csrf-token',
        }),
      ),
    );
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await screen.findByText('Jason');

    window.dispatchEvent(new Event('causality:unauthorized'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('username').textContent).toBe('none');
  });

  it.each([
    ['退出当前会话', '/api/auth/logout'],
    ['退出全部会话', '/api/auth/logout-all'],
  ])('clears local authentication after %s', async (buttonName, endpoint) => {
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
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await screen.findByText('Jason');

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(endpoint);
  });
});
