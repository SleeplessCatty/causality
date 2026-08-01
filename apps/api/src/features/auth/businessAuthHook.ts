import type { FastifyReply, FastifyRequest } from 'fastify';

import { createAuthHooks } from './authHooks.js';
import type { AuthService } from './authService.js';

export const INTERNAL_MCP_SECRET_HEADER = 'x-causality-internal-mcp-secret';

export interface BusinessAuthDependencies {
  authService: AuthService;
  publicOrigin: string;
}

export function createBusinessAuthHook(dependencies: BusinessAuthDependencies) {
  const webHooks = createAuthHooks({
    authService: dependencies.authService,
    publicOrigin: dependencies.publicOrigin,
  });

  return async function businessAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (reply.sent) return;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation) await webHooks.verifyAuthenticatedMutation(request, reply);
    else await webHooks.authenticate(request, reply);
    if (reply.sent) return;

    const user = await dependencies.authService.getAuthenticatedUser(request.actor!);
    if (user?.mustChangePassword) {
      void reply.status(403).send({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: '首次登录后必须先修改密码',
      });
    }
  };
}
