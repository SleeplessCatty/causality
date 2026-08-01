import { randomUUID } from 'node:crypto';

import type {
  AuthenticatedUser,
  ChangeInitialPasswordInput,
  ChangePasswordInput,
  LoginInput,
} from '@causality/contracts';

import type { AuditWriter, AuditWriteInput } from '../audit/auditRepository.js';
import type { RequestActor } from './requestActor.js';
import type {
  AuthRepository,
  AuthSourceRateLimitRecord,
  AuthUserRecord,
} from './authRepository.js';
import type { PasswordHasher } from './passwordHasher.js';
import { validatePassword } from './passwordPolicy.js';

const ACCOUNT_FAILURE_LIMIT = 10;
const SOURCE_FAILURE_LIMIT = 20;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthServiceErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'TOO_MANY_ATTEMPTS'
  | 'AUTH_REQUIRED'
  | 'INVALID_CURRENT_PASSWORD'
  | 'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED';

export class AuthServiceError extends Error {
  constructor(
    readonly code: AuthServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export interface LoginResult {
  user: AuthenticatedUser;
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
}

export interface AuthServiceDependencies {
  repository: AuthRepository;
  auditWriter: AuditWriter;
  passwordHasher: PasswordHasher;
  clock: () => Date;
  tokenGenerator: () => string;
  sessionDigest: (token: string) => Buffer;
  sourceDigest: (sourceIp: string) => Buffer;
  requestIdGenerator?: () => string;
}

type LoginDecision =
  { status: 'success'; result: LoginResult } | { status: 'error'; code: AuthServiceErrorCode };

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function isAfterOrEqual(left: Date, right: Date): boolean {
  return left.getTime() >= right.getTime();
}

function authenticatedUser(user: AuthUserRecord): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    mustChangePassword: user.mustChangePassword,
  };
}

export class AuthService {
  private readonly requestIdGenerator: () => string;

  constructor(private readonly dependencies: AuthServiceDependencies) {
    this.requestIdGenerator = dependencies.requestIdGenerator ?? randomUUID;
  }

  async login(input: LoginInput, sourceIp: string): Promise<LoginResult> {
    const now = this.dependencies.clock();
    const sourceDigest = this.dependencies.sourceDigest(sourceIp);
    const requestId = this.requestIdGenerator();

    const decision = await this.dependencies.repository.withTransaction(async (client) => {
      const sourceLimit = await this.dependencies.repository.getSourceRateLimit(
        client,
        sourceDigest,
      );
      if (sourceLimit?.blockedUntil && sourceLimit.blockedUntil.getTime() > now.getTime()) {
        return { status: 'error', code: 'TOO_MANY_ATTEMPTS' } satisfies LoginDecision;
      }

      const user = await this.dependencies.repository.findUserByUsername(client, input.username);
      let passwordMatches = false;
      if (user) {
        passwordMatches = await this.dependencies.passwordHasher.verify(
          user.passwordHash,
          input.password,
        );
      } else {
        await this.dependencies.passwordHasher.hash(input.password);
      }

      if (user?.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
        if (passwordMatches && user.enabled) {
          return { status: 'error', code: 'ACCOUNT_LOCKED' } satisfies LoginDecision;
        }
        await this.recordFailedLogin(
          client,
          sourceDigest,
          sourceLimit,
          user,
          input.username,
          now,
          requestId,
        );
        return { status: 'error', code: 'INVALID_CREDENTIALS' } satisfies LoginDecision;
      }

      if (!user || !user.enabled || !passwordMatches) {
        await this.recordFailedLogin(
          client,
          sourceDigest,
          sourceLimit,
          user,
          input.username,
          now,
          requestId,
        );
        return { status: 'error', code: 'INVALID_CREDENTIALS' } satisfies LoginDecision;
      }

      await this.dependencies.repository.recordLoginSuccess(client, user.id, now);
      const sessionToken = this.dependencies.tokenGenerator();
      const csrfToken = this.dependencies.tokenGenerator();
      const session = await this.dependencies.repository.createSession(client, {
        userId: user.id,
        tokenHash: this.dependencies.sessionDigest(sessionToken),
        csrfTokenHash: this.dependencies.sessionDigest(csrfToken),
        createdAt: now,
        lastSeenAt: now,
        absoluteExpiresAt: addMilliseconds(now, SESSION_ABSOLUTE_MS),
      });
      const actor: RequestActor = {
        actorType: 'user',
        userId: user.id,
        username: user.username,
        channel: 'web',
        requestId,
        sessionId: session.id,
      };
      await this.dependencies.auditWriter.append(client, {
        actor,
        action: 'auth.login_succeeded',
        targetType: 'session',
        targetId: session.id,
        result: 'success',
        occurredAt: now,
      });

      return {
        status: 'success',
        result: {
          user: authenticatedUser(user),
          sessionToken,
          csrfToken,
          sessionId: session.id,
        },
      } satisfies LoginDecision;
    });

    if (decision.status === 'error') throw this.errorFor(decision.code);
    return decision.result;
  }

  async authenticateSession(rawToken: string, now: Date): Promise<RequestActor | null> {
    if (!rawToken) return null;
    return this.dependencies.repository.withTransaction(async (client) => {
      const session = await this.dependencies.repository.findSessionByTokenHash(
        client,
        this.dependencies.sessionDigest(rawToken),
      );
      if (!session || session.revokedAt || !session.user.enabled) return null;

      const idleExpiresAt = addMilliseconds(session.lastSeenAt, SESSION_IDLE_MS);
      if (isAfterOrEqual(now, idleExpiresAt) || isAfterOrEqual(now, session.absoluteExpiresAt)) {
        await this.dependencies.repository.revokeSession(client, session.id, now);
        return null;
      }

      if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
        await this.dependencies.repository.touchSession(client, session.id, now);
      }

      return {
        actorType: 'user',
        userId: session.user.id,
        username: session.user.username,
        channel: 'web',
        requestId: this.requestIdGenerator(),
        sessionId: session.id,
      };
    });
  }

  async getAuthenticatedUser(actor: RequestActor): Promise<AuthenticatedUser | null> {
    if (actor.actorType !== 'user') return null;
    return this.dependencies.repository.withTransaction(async (client) => {
      const user = await this.dependencies.repository.findUserById(client, actor.userId);
      return user?.enabled ? authenticatedUser(user) : null;
    });
  }

  async verifySessionCsrf(actor: RequestActor, rawCsrfToken: string): Promise<boolean> {
    if (actor.actorType !== 'user' || actor.channel !== 'web' || !actor.sessionId) return false;
    return this.dependencies.repository.withTransaction((client) =>
      this.dependencies.repository.sessionHasCsrfDigest(
        client,
        actor.sessionId!,
        actor.userId,
        this.dependencies.sessionDigest(rawCsrfToken),
      ),
    );
  }

  async changePassword(actor: RequestActor, input: ChangePasswordInput): Promise<void> {
    if (actor.actorType !== 'user' || actor.channel !== 'web' || !actor.sessionId) {
      throw this.errorFor('AUTH_REQUIRED');
    }
    const now = this.dependencies.clock();
    const outcome = await this.dependencies.repository.withTransaction(async (client) => {
      const user = await this.dependencies.repository.findUserById(client, actor.userId);
      if (!user || !user.enabled) return false;
      if (
        !(await this.dependencies.passwordHasher.verify(user.passwordHash, input.currentPassword))
      ) {
        return false;
      }
      validatePassword(input.newPassword, user.username);
      const passwordHash = await this.dependencies.passwordHasher.hash(input.newPassword);
      await this.dependencies.repository.updatePassword(client, user.id, passwordHash, now);
      await this.dependencies.repository.revokeOtherSessions(
        client,
        user.id,
        actor.sessionId!,
        now,
      );
      await this.dependencies.auditWriter.append(client, {
        actor,
        action: 'auth.password_changed',
        targetType: 'user',
        targetId: user.id,
        result: 'success',
        occurredAt: now,
      });
      return true;
    });
    if (!outcome) throw this.errorFor('INVALID_CURRENT_PASSWORD');
  }

  async changeInitialPassword(
    actor: RequestActor,
    input: ChangeInitialPasswordInput,
  ): Promise<void> {
    if (actor.actorType !== 'user' || actor.channel !== 'web' || !actor.sessionId) {
      throw this.errorFor('AUTH_REQUIRED');
    }
    const now = this.dependencies.clock();
    const outcome = await this.dependencies.repository.withTransaction(async (client) => {
      const user = await this.dependencies.repository.findUserById(client, actor.userId);
      if (!user?.enabled || !user.mustChangePassword) return false;
      validatePassword(input.newPassword, user.username);
      const passwordHash = await this.dependencies.passwordHasher.hash(input.newPassword);
      await this.dependencies.repository.updatePassword(client, user.id, passwordHash, now);
      await this.dependencies.repository.revokeOtherSessions(
        client,
        user.id,
        actor.sessionId!,
        now,
      );
      await this.dependencies.auditWriter.append(client, {
        actor,
        action: 'auth.password_changed',
        targetType: 'user',
        targetId: user.id,
        result: 'success',
        occurredAt: now,
      });
      return true;
    });
    if (!outcome) throw this.errorFor('INITIAL_PASSWORD_CHANGE_NOT_ALLOWED');
  }

  async logout(actor: RequestActor): Promise<void> {
    if (actor.actorType !== 'user' || !actor.sessionId) throw this.errorFor('AUTH_REQUIRED');
    const now = this.dependencies.clock();
    await this.dependencies.repository.withTransaction(async (client) => {
      await this.dependencies.repository.revokeSession(client, actor.sessionId!, now);
      await this.dependencies.auditWriter.append(client, {
        actor,
        action: 'auth.session_logged_out',
        targetType: 'session',
        targetId: actor.sessionId!,
        result: 'success',
        occurredAt: now,
      });
    });
  }

  async logoutAll(actor: RequestActor): Promise<void> {
    if (actor.actorType !== 'user') throw this.errorFor('AUTH_REQUIRED');
    const now = this.dependencies.clock();
    await this.dependencies.repository.withTransaction(async (client) => {
      await this.dependencies.repository.revokeAllSessions(client, actor.userId, now);
      await this.dependencies.auditWriter.append(client, {
        actor,
        action: 'auth.sessions_revoked',
        targetType: 'user',
        targetId: actor.userId,
        result: 'success',
        occurredAt: now,
      });
    });
  }

  private async recordFailedLogin(
    client: Parameters<AuditWriter['append']>[0],
    sourceDigest: Buffer,
    existingSourceLimit: AuthSourceRateLimitRecord | null,
    user: AuthUserRecord | null,
    attemptedUsername: string,
    now: Date,
    requestId: string,
  ): Promise<void> {
    const windowExpired =
      !existingSourceLimit ||
      now.getTime() - existingSourceLimit.windowStartedAt.getTime() >= FAILURE_WINDOW_MS;
    const failureCount = windowExpired ? 1 : existingSourceLimit.failureCount + 1;
    const sourceRecord: AuthSourceRateLimitRecord = {
      sourceDigest,
      failureCount,
      windowStartedAt: windowExpired ? now : existingSourceLimit.windowStartedAt,
      blockedUntil:
        failureCount >= SOURCE_FAILURE_LIMIT ? addMilliseconds(now, FAILURE_WINDOW_MS) : null,
      updatedAt: now,
    };
    await this.dependencies.repository.saveSourceRateLimit(client, sourceRecord);

    let accountLocked = false;
    if (user?.enabled) {
      const previousFailures =
        user.lockedUntil && user.lockedUntil.getTime() <= now.getTime() ? 0 : user.failedLoginCount;
      const accountFailures = previousFailures + 1;
      const lockedUntil =
        accountFailures >= ACCOUNT_FAILURE_LIMIT ? addMilliseconds(now, ACCOUNT_LOCK_MS) : null;
      accountLocked = lockedUntil !== null;
      await this.dependencies.repository.setUserLoginFailure(
        client,
        user.id,
        accountFailures,
        lockedUntil,
        now,
      );
    }

    const anonymousActor = {
      actorType: 'anonymous' as const,
      attemptedUsername: attemptedUsername.slice(0, 50),
      channel: 'web' as const,
      requestId,
    };
    const failedEvent: AuditWriteInput = {
      actor: anonymousActor,
      action: 'auth.login_failed',
      targetType: 'user',
      targetId: user?.id ?? null,
      result: 'failure',
      occurredAt: now,
    };
    await this.dependencies.auditWriter.append(client, failedEvent);

    if (accountLocked && user) {
      await this.dependencies.auditWriter.append(client, {
        actor: anonymousActor,
        action: 'auth.account_locked',
        targetType: 'user',
        targetId: user.id,
        result: 'failure',
        occurredAt: now,
      });
    }
  }

  private errorFor(code: AuthServiceErrorCode): AuthServiceError {
    const message =
      code === 'INVALID_CREDENTIALS'
        ? '用户名或密码错误'
        : code === 'ACCOUNT_LOCKED'
          ? '账号已临时锁定'
          : code === 'TOO_MANY_ATTEMPTS'
            ? '登录尝试过于频繁'
            : code === 'INVALID_CURRENT_PASSWORD'
              ? '当前密码错误'
              : code === 'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED'
                ? '当前账号不需要修改初始密码'
                : '需要登录';
    return new AuthServiceError(code, message);
  }
}
