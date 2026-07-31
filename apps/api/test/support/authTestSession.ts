import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';

import { argon2idPasswordHasher } from '../../src/features/auth/passwordHasher.js';

const testOrigin = 'http://localhost:5173';
const testUsername = 'integration-user';
const testPassword = 'IntegrationPass!123';

function cookiesFrom(response: LightMyRequestResponse): string[] {
  const header = response.headers['set-cookie'];
  if (Array.isArray(header)) return header.map(String);
  return header ? [String(header)] : [];
}

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

function mutation(method: string | undefined): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes((method ?? 'GET').toUpperCase());
}

export interface AuthenticatedTestSession {
  cookie: string;
  csrfToken: string;
  inject(options: InjectOptions | string): Promise<LightMyRequestResponse>;
}

export async function createAuthenticatedTestSession(
  app: FastifyInstance,
  pool: Pool,
): Promise<AuthenticatedTestSession> {
  const rawInject = app.inject.bind(app);
  const passwordHash = await argon2idPasswordHasher.hash(testPassword);
  await pool.query(
    `insert into users (username, password_hash, must_change_password)
     values ($1, $2, false)
     on conflict (normalized_username) do nothing`,
    [testUsername, passwordHash],
  );
  const login = await rawInject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: testOrigin },
    payload: { username: testUsername, password: testPassword },
  });
  if (login.statusCode !== 200) {
    throw new Error(`Unable to create authenticated integration session (${login.statusCode})`);
  }
  const cookie = cookieHeader(cookiesFrom(login));
  const csrfToken = login.json<{ csrfToken: string }>().csrfToken;

  return {
    cookie,
    csrfToken,
    inject(options) {
      if (typeof options === 'string') {
        return rawInject({ method: 'GET', url: options, headers: { cookie } });
      }
      return rawInject({
        ...options,
        headers: {
          ...options.headers,
          cookie,
          ...(mutation(options.method) ? { origin: testOrigin, 'x-csrf-token': csrfToken } : {}),
        },
      });
    },
  };
}
