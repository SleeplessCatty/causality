import type { AuditAction, AuditResult, AuditTargetType } from '@causality/contracts';
import type { PoolClient } from 'pg';

import type { RequestActor } from '../auth/requestActor.js';

export interface AuditEventInput {
  actor: RequestActor;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  result: AuditResult;
  occurredAt: Date;
}

export interface UnauthenticatedAuditEventInput {
  actor: {
    actorType: 'anonymous';
    attemptedUsername: string;
    channel: 'web';
    requestId: string;
  };
  action: 'auth.login_failed' | 'auth.account_locked';
  targetType: 'user';
  targetId: string | null;
  result: 'failure';
  occurredAt: Date;
}

export type AuditWriteInput = AuditEventInput | UnauthenticatedAuditEventInput;

export interface AuditWriter {
  append(client: PoolClient, input: AuditWriteInput): Promise<void>;
}

export class PostgresAuditWriter implements AuditWriter {
  async append(client: PoolClient, input: AuditWriteInput): Promise<void> {
    if (input.actor.actorType === 'anonymous') {
      await client.query(
        `insert into audit_logs (
           actor_type, actor_username, actor_channel, request_id,
           action, target_type, target_id, result, occurred_at
         ) values ('anonymous', $1, 'web', $2, $3, $4, $5, $6, $7)`,
        [
          input.actor.attemptedUsername,
          input.actor.requestId,
          input.action,
          input.targetType,
          input.targetId,
          input.result,
          input.occurredAt,
        ],
      );
      return;
    }

    const actor = input.actor;
    await client.query(
      `insert into audit_logs (
         actor_type, actor_user_id, actor_username, actor_label, actor_channel,
         request_id, session_id, mcp_token_id, action, target_type, target_id,
         result, occurred_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        actor.actorType,
        actor.actorType === 'user' ? actor.userId : null,
        actor.actorType === 'user' ? actor.username : null,
        actor.actorType === 'system' ? actor.actorLabel : null,
        actor.channel,
        actor.requestId,
        actor.actorType === 'user' ? (actor.sessionId ?? null) : null,
        actor.actorType === 'user' ? (actor.mcpTokenId ?? null) : null,
        input.action,
        input.targetType,
        input.targetId,
        input.result,
        input.occurredAt,
      ],
    );
  }
}
