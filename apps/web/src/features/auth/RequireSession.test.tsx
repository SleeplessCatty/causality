import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './AuthProvider';
import { RequireSession } from './RequireSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('RequireSession', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('delays the authentication skeleton and honors its minimum visible time', async () => {
    const session = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => session.promise),
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/protected']}>
          <Routes>
            <Route element={<RequireSession />}>
              <Route path="/protected" element={<div>受保护内容</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('受保护内容')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(179));
    expect(screen.queryByRole('status')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('status', { name: '正在准备设置页面' })).toBeTruthy();

    session.resolve(
      response({
        user: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          username: 'Jason',
          mustChangePassword: false,
        },
        csrfToken: 'csrf-token',
      }),
    );
    await act(async () => Promise.resolve());
    expect(screen.queryByText('受保护内容')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(screen.queryByText('受保护内容')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('受保护内容')).toBeTruthy();
  });
});
