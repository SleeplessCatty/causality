import {
  authSessionResponseSchema,
  authErrorSchema,
  changePasswordInputSchema,
  loginInputSchema,
  logoutResultSchema,
  type ChangePasswordInput,
  type LoginInput,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { clearAuthCookies, setAuthCookies, type AuthCookieSettings } from './authCookies.js';
import { createAuthHooks } from './authHooks.js';
import { AuthServiceError, type AuthService } from './authService.js';
import { PasswordPolicyError } from './passwordPolicy.js';

export interface AuthRouteOptions extends AuthCookieSettings {
  publicOrigin: string;
}

function sendAuthError(reply: FastifyReply, error: unknown): void {
  if (error instanceof PasswordPolicyError) {
    void reply.status(400).send({ code: error.code, message: error.message });
    return;
  }
  if (!(error instanceof AuthServiceError)) throw error;
  const status =
    error.code === 'INVALID_CREDENTIALS' || error.code === 'INVALID_CURRENT_PASSWORD'
      ? 401
      : error.code === 'ACCOUNT_LOCKED'
        ? 423
        : error.code === 'TOO_MANY_ATTEMPTS'
          ? 429
          : 401;
  void reply.status(status).send({ code: error.code, message: error.message });
}

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  options: AuthRouteOptions,
): void {
  const hooks = createAuthHooks({ authService, publicOrigin: options.publicOrigin });

  app.post<{ Body: LoginInput }>(
    '/api/auth/login',
    {
      config: { routeAccess: 'public' },
      preHandler: hooks.verifyOrigin,
      schema: { body: loginInputSchema, response: { 200: authSessionResponseSchema } },
    },
    async (request, reply) => {
      try {
        const result = await authService.login(request.body, request.ip);
        setAuthCookies(reply, options, result.sessionToken, result.csrfToken);
        return { user: result.user, csrfToken: result.csrfToken };
      } catch (error) {
        sendAuthError(reply, error);
      }
    },
  );

  app.get(
    '/api/auth/session',
    {
      config: { routeAccess: 'business' },
      preHandler: hooks.authenticate,
      schema: { response: { 200: authSessionResponseSchema, 401: authErrorSchema } },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const user = await authService.getAuthenticatedUser(actor);
      const csrfToken = request.cookies.causality_csrf;
      if (!user || !csrfToken) {
        clearAuthCookies(reply, options);
        void reply.status(401).send({ code: 'AUTH_REQUIRED', message: '需要登录' });
        return;
      }
      return { user, csrfToken };
    },
  );

  app.post<{ Body: ChangePasswordInput }>(
    '/api/auth/change-password',
    {
      config: { routeAccess: 'business' },
      preHandler: hooks.verifyAuthenticatedMutation,
      schema: {
        body: changePasswordInputSchema,
        response: { 200: logoutResultSchema, 400: authErrorSchema, 401: authErrorSchema },
      },
    },
    async (request, reply) => {
      try {
        await authService.changePassword(request.actor!, request.body);
        return { success: true as const };
      } catch (error) {
        sendAuthError(reply, error);
      }
    },
  );

  app.post(
    '/api/auth/logout',
    {
      config: { routeAccess: 'business' },
      preHandler: hooks.verifyAuthenticatedMutation,
      schema: { response: { 200: logoutResultSchema } },
    },
    async (request, reply) => {
      await authService.logout(request.actor!);
      clearAuthCookies(reply, options);
      return { success: true as const };
    },
  );

  app.post(
    '/api/auth/logout-all',
    {
      config: { routeAccess: 'business' },
      preHandler: hooks.verifyAuthenticatedMutation,
      schema: { response: { 200: logoutResultSchema } },
    },
    async (request, reply) => {
      await authService.logoutAll(request.actor!);
      clearAuthCookies(reply, options);
      return { success: true as const };
    },
  );
}
