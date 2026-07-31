import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { argon2idPasswordHasher } from '../src/features/auth/passwordHasher.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const cloudOrigin = 'https://causality.example.com';
const sessionKey = '11'.repeat(32);
const sourceKey = '22'.repeat(32);
const internalMcpSecret = '33'.repeat(32);

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie'];
  if (Array.isArray(header)) return header.map(String);
  return header ? [String(header)] : [];
}

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

describe.sequential('authentication routes', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let cloudApp: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_auth_routes_test');
    const passwordHash = await argon2idPasswordHasher.hash('GoodPass!123');
    await context.pool.query(
      `insert into users (username, password_hash, must_change_password)
       values ('Jason', $1, false)`,
      [passwordHash],
    );
    cloudApp = buildApp({
      logger: false,
      databasePool: context.pool,
      corsOrigin: cloudOrigin,
      publicOrigin: cloudOrigin,
      cookieSecure: true,
      sessionHmacKey: sessionKey,
      authIpHashKey: sourceKey,
      internalMcpSecret,
    });
    await cloudApp.ready();
  });

  it('protects business routes and keeps legacy MCP compatibility explicitly temporary', async () => {
    const anonymous = await cloudApp.inject({ method: 'GET', url: '/api/events' });
    expect(anonymous.statusCode).toBe(401);

    const tokenResult = await context.pool.query<{ access_token: string }>(
      'select access_token from mcp_settings where singleton_key = true',
    );
    const token = tokenResult.rows[0]!.access_token;
    const tokenOnly = await cloudApp.inject({
      method: 'GET',
      url: '/api/events',
      headers: { 'x-causality-mcp-token': token },
    });
    expect(tokenOnly.statusCode).toBe(401);

    const compatible = await cloudApp.inject({
      method: 'GET',
      url: '/api/events',
      headers: {
        'x-causality-mcp-token': token,
        'x-causality-internal-mcp-secret': internalMcpSecret,
      },
    });
    expect(compatible.statusCode).toBe(200);
  });

  afterAll(async () => {
    await cloudApp.close();
    await context.close();
  });

  it('sets secure session and CSRF cookies and returns the authenticated user', async () => {
    const response = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: cloudOrigin },
      payload: { username: 'jason', password: 'GoodPass!123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { username: 'Jason', mustChangePassword: false },
      csrfToken: expect.any(String),
    });
    const cookies = cookiesFrom(response);
    expect(cookies).toHaveLength(2);
    const sessionCookie = cookies.find((cookie) => cookie.startsWith('causality_session='))!;
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('SameSite=Lax');
    const csrfCookie = cookies.find((cookie) => cookie.startsWith('causality_csrf='))!;
    expect(csrfCookie).toContain('Path=/');
    expect(csrfCookie).not.toContain('HttpOnly');
    expect(csrfCookie).toContain('Secure');
    expect(csrfCookie).toContain('SameSite=Lax');
  });

  it('authenticates GET requests without CSRF and protects state changes with CSRF and Origin', async () => {
    const login = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: cloudOrigin },
      payload: { username: 'jason', password: 'GoodPass!123' },
    });
    const cookies = cookiesFrom(login);
    const cookie = cookieHeader(cookies);
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;

    const session = await cloudApp.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);

    const missingCsrf = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: cloudOrigin },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const wrongOrigin = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie,
        origin: 'https://attacker.example',
        'x-csrf-token': csrfToken,
      },
    });
    expect(wrongOrigin.statusCode).toBe(403);

    const forgedCsrfCookie = cookie.replace(/causality_csrf=[^;]+/, 'causality_csrf=forged-token');
    const forgedCsrf = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: forgedCsrfCookie,
        origin: cloudOrigin,
        'x-csrf-token': 'forged-token',
      },
    });
    expect(forgedCsrf.statusCode).toBe(403);

    const logout = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: cloudOrigin, 'x-csrf-token': csrfToken },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ success: true });
  });

  it('returns a validation error when a replacement password violates the strong-password policy', async () => {
    const login = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: cloudOrigin },
      payload: { username: 'jason', password: 'GoodPass!123' },
    });
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
    const response = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: {
        cookie: cookieHeader(cookiesFrom(login)),
        origin: cloudOrigin,
        'x-csrf-token': csrfToken,
      },
      payload: { currentPassword: 'GoodPass!123', newPassword: 'aaaaaaaaaaaa' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'PASSWORD_POLICY_VIOLATION' });
  });

  it('allows an initial-password session to change its password but blocks business data until then', async () => {
    const initialPassword = 'Initial!Pass123';
    const passwordHash = await argon2idPasswordHasher.hash(initialPassword);
    await context.pool.query(
      `insert into users (username, password_hash, must_change_password)
       values ('FirstUser', $1, true)`,
      [passwordHash],
    );
    const login = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: cloudOrigin },
      payload: { username: 'firstuser', password: initialPassword },
    });
    const cookie = cookieHeader(cookiesFrom(login));
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;

    const blocked = await cloudApp.inject({
      method: 'GET',
      url: '/api/events',
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });

    const changed = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie, origin: cloudOrigin, 'x-csrf-token': csrfToken },
      payload: { currentPassword: initialPassword, newPassword: 'Changed!Pass123' },
    });
    expect(changed.statusCode).toBe(200);
    expect(
      (await cloudApp.inject({ method: 'GET', url: '/api/events', headers: { cookie } }))
        .statusCode,
    ).toBe(200);
  });

  it('returns generic authentication errors and exposes lock and source throttling statuses only when applicable', async () => {
    const invalid = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: cloudOrigin },
      payload: { username: 'jason', password: 'WrongPass!123' },
      remoteAddress: '198.51.100.1',
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });

    for (let attempt = 2; attempt <= 10; attempt += 1) {
      await cloudApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: cloudOrigin },
        payload: { username: 'jason', password: 'WrongPass!123' },
        remoteAddress: `198.51.100.${attempt}`,
      });
    }
    const locked = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: cloudOrigin },
      payload: { username: 'jason', password: 'GoodPass!123' },
      remoteAddress: '198.51.100.20',
    });
    expect(locked.statusCode).toBe(423);

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await cloudApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: cloudOrigin },
        payload: { username: `missing-${attempt}`, password: 'WrongPass!123' },
        remoteAddress: '203.0.113.20',
      });
    }
    const throttled = await cloudApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: cloudOrigin },
      payload: { username: 'still-missing', password: 'WrongPass!123' },
      remoteAddress: '203.0.113.20',
    });
    expect(throttled.statusCode).toBe(429);
  });

  it('serializes first-time failures from the same source without returning an internal error', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        cloudApp.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin: cloudOrigin },
          payload: { username: `parallel-missing-${index}`, password: 'WrongPass!123' },
          remoteAddress: '192.0.2.90',
        }),
      ),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401, 401]);
    const persisted = await context.pool.query<{ failure_count: number }>(
      `select failure_count from auth_rate_limits
       where source_digest = hmac('192.0.2.90', decode($1, 'hex'), 'sha256')`,
      [sourceKey],
    );
    expect(persisted.rows[0]?.failure_count).toBe(5);
  });

  it('omits Secure only for an explicitly configured loopback origin', async () => {
    const localApp = buildApp({
      logger: false,
      databasePool: context.pool,
      corsOrigin: 'http://127.0.0.1:5173',
      publicOrigin: 'http://127.0.0.1:5173',
      cookieSecure: false,
      sessionHmacKey: sessionKey,
      authIpHashKey: sourceKey,
    });
    await localApp.ready();
    try {
      await context.pool.query(
        `update users set failed_login_count = 0, locked_until = null where username = 'Jason'`,
      );
      const response = await localApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'http://127.0.0.1:5173' },
        payload: { username: 'jason', password: 'GoodPass!123' },
      });
      expect(response.statusCode).toBe(200);
      expect(cookiesFrom(response).every((cookie) => !cookie.includes('Secure'))).toBe(true);
    } finally {
      await localApp.close();
    }
  });
});
