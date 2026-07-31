import type { FastifyRequest } from 'fastify';

export type RequestActor =
  | {
      actorType: 'user';
      userId: string;
      username: string;
      channel: 'web' | 'mcp';
      requestId: string;
      sessionId?: string;
      mcpTokenId?: string;
    }
  | {
      actorType: 'system';
      actorLabel: 'server-cli';
      channel: 'cli';
      requestId: string;
    };

declare module 'fastify' {
  interface FastifyRequest {
    actor?: RequestActor;
  }
}

export function getRequestActor(request: FastifyRequest): RequestActor | null {
  return request.actor ?? null;
}
