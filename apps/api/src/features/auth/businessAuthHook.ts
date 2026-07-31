import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { McpSettingsService } from '../mcp-settings/mcpSettingsService.js';
import { createAuthHooks } from './authHooks.js';
import type { AuthService } from './authService.js';

export const LEGACY_MCP_TOKEN_HEADER = 'x-causality-mcp-token';
export const INTERNAL_MCP_SECRET_HEADER = 'x-causality-internal-mcp-secret';

export interface BusinessAuthDependencies {
  authService: AuthService;
  mcpSettingsService: McpSettingsService;
  publicOrigin: string;
  internalMcpSecret: string;
}

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function reject(reply: FastifyReply): void {
  void reply.status(401).send({ code: 'AUTH_REQUIRED', message: '需要登录' });
}

export function createBusinessAuthHook(dependencies: BusinessAuthDependencies) {
  const webHooks = createAuthHooks({
    authService: dependencies.authService,
    publicOrigin: dependencies.publicOrigin,
  });

  return async function businessAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (reply.sent) return;
    const mcpToken = header(request, LEGACY_MCP_TOKEN_HEADER);
    const internalSecret = header(request, INTERNAL_MCP_SECRET_HEADER);

    if (mcpToken || internalSecret) {
      // Explicitly temporary: P4-01 Task 3 replaces this global-token bridge with PAT identity.
      const authorized =
        Boolean(mcpToken) &&
        Boolean(internalSecret) &&
        secretsEqual(internalSecret!, dependencies.internalMcpSecret) &&
        (await dependencies.mcpSettingsService.authorize(mcpToken!));
      if (!authorized) {
        reject(reply);
        return;
      }
      request.actor = {
        actorType: 'system',
        actorLabel: 'legacy-mcp',
        channel: 'mcp',
        requestId: request.id,
      };
      return;
    }

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
