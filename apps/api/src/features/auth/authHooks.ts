import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from './authCookies.js';
import type { AuthService } from './authService.js';

export interface AuthHookDependencies {
  authService: AuthService;
  publicOrigin: string;
  clock?: () => Date;
}

function equalTokens(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function forbidden(reply: FastifyReply, code: 'ORIGIN_INVALID' | 'CSRF_INVALID'): void {
  void reply.status(403).send({
    code,
    message: code === 'ORIGIN_INVALID' ? '请求来源不合法' : 'CSRF 校验失败',
  });
}

export function createAuthHooks(dependencies: AuthHookDependencies) {
  const clock = dependencies.clock ?? (() => new Date());

  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    const actor = rawToken
      ? await dependencies.authService.authenticateSession(rawToken, clock())
      : null;
    if (!actor) {
      void reply.status(401).send({ code: 'AUTH_REQUIRED', message: '需要登录' });
      return;
    }
    request.actor = actor;
  }

  async function verifyOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.headers.origin !== dependencies.publicOrigin) forbidden(reply, 'ORIGIN_INVALID');
  }

  async function verifyAuthenticatedMutation(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await authenticate(request, reply);
    if (reply.sent) return;
    await verifyOrigin(request, reply);
    if (reply.sent) return;

    const cookieToken = request.cookies[CSRF_COOKIE_NAME];
    const headerValue = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!cookieToken || !headerToken || !equalTokens(cookieToken, headerToken)) {
      forbidden(reply, 'CSRF_INVALID');
      return;
    }
    if (!(await dependencies.authService.verifySessionCsrf(request.actor!, cookieToken))) {
      forbidden(reply, 'CSRF_INVALID');
    }
  }

  return { authenticate, verifyOrigin, verifyAuthenticatedMutation };
}
