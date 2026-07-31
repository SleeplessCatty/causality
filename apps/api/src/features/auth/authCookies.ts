import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE_NAME = 'causality_session';
export const CSRF_COOKIE_NAME = 'causality_csrf';

export interface AuthCookieSettings {
  secure: boolean;
}

const sharedCookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
};

export function setAuthCookies(
  reply: FastifyReply,
  settings: AuthCookieSettings,
  sessionToken: string,
  csrfToken: string,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
    ...sharedCookieOptions,
    httpOnly: true,
    secure: settings.secure,
  });
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
    ...sharedCookieOptions,
    httpOnly: false,
    secure: settings.secure,
  });
}

export function clearAuthCookies(reply: FastifyReply, settings: AuthCookieSettings): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    ...sharedCookieOptions,
    httpOnly: true,
    secure: settings.secure,
  });
  reply.clearCookie(CSRF_COOKIE_NAME, {
    ...sharedCookieOptions,
    httpOnly: false,
    secure: settings.secure,
  });
}
