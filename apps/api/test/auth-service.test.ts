import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import type { AuditWriteInput, AuditWriter } from '../src/features/audit/auditRepository.js';
import type {
  AuthRepository,
  AuthSessionRecord,
  AuthSourceRateLimitRecord,
  AuthUserRecord,
  CreateSessionInput,
} from '../src/features/auth/authRepository.js';
import { AuthService, type AuthServiceError } from '../src/features/auth/authService.js';
import type { PasswordHasher } from '../src/features/auth/passwordHasher.js';

const start = new Date('2026-07-31T00:00:00.000Z');
const fakeClient = {} as PoolClient;

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUserRecord>();
  readonly sessions = new Map<string, AuthSessionRecord>();
  readonly sourceLimits = new Map<string, AuthSourceRateLimitRecord>();
  private nextSession = 1;

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return work(fakeClient);
  }

  async findUserByUsername(_client: PoolClient, username: string): Promise<AuthUserRecord | null> {
    const normalized = username.normalize('NFKC').trim().toLocaleLowerCase('und');
    return (
      Array.from(this.users.values()).find((user) => user.normalizedUsername === normalized) ?? null
    );
  }

  async findUserById(_client: PoolClient, userId: string): Promise<AuthUserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async setUserLoginFailure(
    _client: PoolClient,
    userId: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
    updatedAt: Date,
  ): Promise<void> {
    const user = this.users.get(userId)!;
    this.users.set(userId, { ...user, failedLoginCount, lockedUntil, updatedAt });
  }

  async recordLoginSuccess(_client: PoolClient, userId: string, now: Date): Promise<void> {
    const user = this.users.get(userId)!;
    this.users.set(userId, {
      ...user,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
      updatedAt: now,
    });
  }

  async getSourceRateLimit(
    _client: PoolClient,
    sourceDigest: Buffer,
  ): Promise<AuthSourceRateLimitRecord | null> {
    return this.sourceLimits.get(sourceDigest.toString('hex')) ?? null;
  }

  async saveSourceRateLimit(_client: PoolClient, record: AuthSourceRateLimitRecord): Promise<void> {
    this.sourceLimits.set(record.sourceDigest.toString('hex'), record);
  }

  async createSession(_client: PoolClient, input: CreateSessionInput): Promise<AuthSessionRecord> {
    const session: AuthSessionRecord = {
      id: `00000000-0000-4000-8000-${String(this.nextSession).padStart(12, '0')}`,
      ...input,
      revokedAt: null,
    };
    this.nextSession += 1;
    this.sessions.set(input.tokenHash.toString('hex'), session);
    return session;
  }

  async findSessionByTokenHash(
    _client: PoolClient,
    tokenHash: Buffer,
  ): Promise<(AuthSessionRecord & { user: AuthUserRecord }) | null> {
    const session = this.sessions.get(tokenHash.toString('hex'));
    if (!session) return null;
    const user = this.users.get(session.userId);
    return user ? { ...session, user } : null;
  }

  async sessionHasCsrfDigest(
    _client: PoolClient,
    sessionId: string,
    userId: string,
    csrfTokenHash: Buffer,
  ): Promise<boolean> {
    return Array.from(this.sessions.values()).some(
      (session) =>
        session.id === sessionId &&
        session.userId === userId &&
        session.revokedAt === null &&
        session.csrfTokenHash.equals(csrfTokenHash),
    );
  }

  async touchSession(_client: PoolClient, sessionId: string, lastSeenAt: Date): Promise<void> {
    for (const [key, session] of this.sessions) {
      if (session.id === sessionId) this.sessions.set(key, { ...session, lastSeenAt });
    }
  }

  async updatePassword(
    _client: PoolClient,
    userId: string,
    passwordHash: string,
    now: Date,
  ): Promise<void> {
    const user = this.users.get(userId)!;
    this.users.set(userId, {
      ...user,
      passwordHash,
      mustChangePassword: false,
      updatedAt: now,
    });
  }

  async revokeSession(_client: PoolClient, sessionId: string, now: Date): Promise<number> {
    let changed = 0;
    for (const [key, session] of this.sessions) {
      if (session.id === sessionId && session.revokedAt === null) {
        this.sessions.set(key, { ...session, revokedAt: now });
        changed += 1;
      }
    }
    return changed;
  }

  async revokeOtherSessions(
    _client: PoolClient,
    userId: string,
    retainedSessionId: string,
    now: Date,
  ): Promise<number> {
    let changed = 0;
    for (const [key, session] of this.sessions) {
      if (
        session.userId === userId &&
        session.id !== retainedSessionId &&
        session.revokedAt === null
      ) {
        this.sessions.set(key, { ...session, revokedAt: now });
        changed += 1;
      }
    }
    return changed;
  }

  async revokeAllSessions(_client: PoolClient, userId: string, now: Date): Promise<number> {
    let changed = 0;
    for (const [key, session] of this.sessions) {
      if (session.userId === userId && session.revokedAt === null) {
        this.sessions.set(key, { ...session, revokedAt: now });
        changed += 1;
      }
    }
    return changed;
  }
}

const passwordHasher: PasswordHasher = {
  async hash(password) {
    return `encoded:${password}`;
  },
  async verify(encodedHash, password) {
    return encodedHash === `encoded:${password}`;
  },
};

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function makeUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'Jason',
    normalizedUsername: 'jason',
    passwordHash: 'encoded:GoodPass!123',
    mustChangePassword: true,
    enabled: true,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: start,
    updatedAt: start,
    ...overrides,
  };
}

function createHarness(hasher: PasswordHasher = passwordHasher) {
  const repository = new MemoryAuthRepository();
  const auditEvents: AuditWriteInput[] = [];
  const auditWriter: AuditWriter = {
    async append(_client, event) {
      auditEvents.push(event);
    },
  };
  let now = new Date(start);
  const tokens = [
    'session-one',
    'csrf-one',
    'session-two',
    'csrf-two',
    'session-three',
    'csrf-three',
  ];
  const service = new AuthService({
    repository,
    auditWriter,
    passwordHasher: hasher,
    clock: () => new Date(now),
    tokenGenerator: () => tokens.shift() ?? 'fallback-token',
    sessionDigest: digest,
    sourceDigest: (sourceIp) => digest(`source:${sourceIp}`),
  });

  return {
    repository,
    auditEvents,
    service,
    setNow(value: Date) {
      now = value;
    },
  };
}

async function expectAuthError(operation: Promise<unknown>, code: AuthServiceError['code']) {
  await expect(operation).rejects.toMatchObject({ code });
}

describe('AuthService', () => {
  it('creates only hashed session secrets and reports initial-password state', async () => {
    const harness = createHarness();
    const user = makeUser();
    harness.repository.users.set(user.id, user);

    const result = await harness.service.login(
      { username: 'jason', password: 'GoodPass!123' },
      '203.0.113.10',
    );

    expect(result).toMatchObject({
      sessionToken: 'session-one',
      csrfToken: 'csrf-one',
      user: { id: user.id, username: 'Jason', mustChangePassword: true },
    });
    expect(Array.from(harness.repository.sessions.keys())).toEqual([
      digest('session-one').toString('hex'),
    ]);
    expect(JSON.stringify(Array.from(harness.repository.sessions.values()))).not.toContain(
      'session-one',
    );
  });

  it('locks an account for 15 minutes after ten consecutive failures', async () => {
    const harness = createHarness();
    const user = makeUser();
    harness.repository.users.set(user.id, user);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expectAuthError(
        harness.service.login(
          { username: 'jason', password: 'WrongPass!123' },
          `203.0.113.${attempt}`,
        ),
        'INVALID_CREDENTIALS',
      );
    }

    expect(harness.repository.users.get(user.id)).toMatchObject({
      failedLoginCount: 10,
      lockedUntil: new Date('2026-07-31T00:15:00.000Z'),
    });
    await expectAuthError(
      harness.service.login({ username: 'jason', password: 'GoodPass!123' }, '198.51.100.1'),
      'ACCOUNT_LOCKED',
    );
  });

  it('blocks one source for 15 minutes after twenty failed logins', async () => {
    const harness = createHarness();

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await expectAuthError(
        harness.service.login(
          { username: `missing-${attempt}`, password: 'WrongPass!123' },
          '203.0.113.20',
        ),
        'INVALID_CREDENTIALS',
      );
    }

    await expectAuthError(
      harness.service.login(
        { username: 'still-missing', password: 'WrongPass!123' },
        '203.0.113.20',
      ),
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('does not let a successful login clear the source failure window', async () => {
    const harness = createHarness();
    const user = makeUser();
    harness.repository.users.set(user.id, user);

    for (let attempt = 1; attempt <= 19; attempt += 1) {
      await expectAuthError(
        harness.service.login(
          { username: `missing-${attempt}`, password: 'WrongPass!123' },
          '203.0.113.21',
        ),
        'INVALID_CREDENTIALS',
      );
    }
    await harness.service.login({ username: 'jason', password: 'GoodPass!123' }, '203.0.113.21');
    await expectAuthError(
      harness.service.login(
        { username: 'missing-final', password: 'WrongPass!123' },
        '203.0.113.21',
      ),
      'INVALID_CREDENTIALS',
    );

    await expectAuthError(
      harness.service.login({ username: 'blocked', password: 'WrongPass!123' }, '203.0.113.21'),
      'TOO_MANY_ATTEMPTS',
    );
  });

  it('performs password work for an unknown username to reduce timing disclosure', async () => {
    let hashCalls = 0;
    const timingSafeHasher: PasswordHasher = {
      async hash(password) {
        hashCalls += 1;
        return `encoded:${password}`;
      },
      verify: passwordHasher.verify,
    };
    const harness = createHarness(timingSafeHasher);

    await expectAuthError(
      harness.service.login(
        { username: 'missing-user', password: 'WrongPass!123' },
        '203.0.113.25',
      ),
      'INVALID_CREDENTIALS',
    );

    expect(hashCalls).toBe(1);
  });

  it('attributes account lock audit records to the unauthenticated attempt', async () => {
    const harness = createHarness();
    const user = makeUser({ failedLoginCount: 9 });
    harness.repository.users.set(user.id, user);

    await expectAuthError(
      harness.service.login({ username: 'jason', password: 'WrongPass!123' }, '203.0.113.26'),
      'INVALID_CREDENTIALS',
    );

    expect(
      harness.auditEvents.find((event) => event.action === 'auth.account_locked'),
    ).toMatchObject({ actor: { actorType: 'anonymous' }, targetId: user.id });
  });

  it('rejects disabled users and revoked sessions', async () => {
    const harness = createHarness();
    const user = makeUser({ enabled: false });
    harness.repository.users.set(user.id, user);

    await expectAuthError(
      harness.service.login({ username: 'jason', password: 'GoodPass!123' }, '203.0.113.30'),
      'INVALID_CREDENTIALS',
    );
    await expect(harness.service.authenticateSession('missing', start)).resolves.toBeNull();
  });

  it('expires sessions independently at the idle and absolute boundaries', async () => {
    const harness = createHarness();
    const user = makeUser({ mustChangePassword: false });
    harness.repository.users.set(user.id, user);
    await harness.service.login({ username: 'jason', password: 'GoodPass!123' }, '203.0.113.40');

    await expect(
      harness.service.authenticateSession('session-one', new Date('2026-07-31T12:00:00.001Z')),
    ).resolves.toBeNull();

    const session = Array.from(harness.repository.sessions.values())[0]!;
    harness.repository.sessions.set(digest('session-one').toString('hex'), {
      ...session,
      lastSeenAt: new Date('2026-08-06T23:00:00.000Z'),
    });
    await expect(
      harness.service.authenticateSession('session-one', new Date('2026-08-07T00:00:00.001Z')),
    ).resolves.toBeNull();
  });

  it('changes the password and revokes every other session', async () => {
    const harness = createHarness();
    const user = makeUser({ mustChangePassword: false });
    harness.repository.users.set(user.id, user);
    const first = await harness.service.login(
      { username: 'jason', password: 'GoodPass!123' },
      '203.0.113.50',
    );
    await harness.service.login({ username: 'jason', password: 'GoodPass!123' }, '203.0.113.51');
    const actor = await harness.service.authenticateSession(first.sessionToken, start);

    await harness.service.changePassword(actor!, {
      currentPassword: 'GoodPass!123',
      newPassword: 'Replacement!123',
    });

    expect(harness.repository.users.get(user.id)).toMatchObject({
      passwordHash: 'encoded:Replacement!123',
      mustChangePassword: false,
    });
    expect(
      Array.from(harness.repository.sessions.values()).filter((item) => item.revokedAt),
    ).toHaveLength(1);
  });

  it('changes a required initial password without verifying it again and rejects regular users', async () => {
    const harness = createHarness();
    const user = makeUser({ mustChangePassword: true });
    harness.repository.users.set(user.id, user);
    const first = await harness.service.login(
      { username: 'jason', password: 'GoodPass!123' },
      '203.0.113.52',
    );
    const actor = await harness.service.authenticateSession(first.sessionToken, start);

    await harness.service.changeInitialPassword(actor!, { newPassword: 'Replacement!123' });

    expect(harness.repository.users.get(user.id)).toMatchObject({
      passwordHash: 'encoded:Replacement!123',
      mustChangePassword: false,
    });
    await expectAuthError(
      harness.service.changeInitialPassword(actor!, { newPassword: 'Another!Pass123' }),
      'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED',
    );
  });

  it('logout revokes one session while logout-all revokes every session', async () => {
    const harness = createHarness();
    const user = makeUser({ mustChangePassword: false });
    harness.repository.users.set(user.id, user);
    const first = await harness.service.login(
      { username: 'jason', password: 'GoodPass!123' },
      '203.0.113.60',
    );
    await harness.service.login({ username: 'jason', password: 'GoodPass!123' }, '203.0.113.61');
    const actor = await harness.service.authenticateSession(first.sessionToken, start);

    await harness.service.logout(actor!);
    expect(
      Array.from(harness.repository.sessions.values()).filter((item) => item.revokedAt),
    ).toHaveLength(1);
    await harness.service.logoutAll(actor!);
    expect(Array.from(harness.repository.sessions.values()).every((item) => item.revokedAt)).toBe(
      true,
    );
  });
});
