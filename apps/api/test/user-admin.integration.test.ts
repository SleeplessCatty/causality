import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  runUserAdminCommand,
  UserAdminCommandError,
  type UserAdminIo,
} from '../src/commands/userAdmin.js';
import { argon2idPasswordHasher } from '../src/features/auth/passwordHasher.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('server user administration CLI', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let prompts: string[];
  let output: string[];
  let answers: string[];
  let generatedPasswords: string[];
  let io: UserAdminIo;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_user_admin_test', {
      createAuthenticatedSession: false,
    });
  });

  afterAll(async () => {
    await context.close();
  });

  function resetHarness(nextAnswers: string[], nextPasswords: string[]) {
    prompts = [];
    output = [];
    answers = [...nextAnswers];
    generatedPasswords = [...nextPasswords];
    io = {
      async prompt(message) {
        prompts.push(message);
        return answers.shift() ?? '';
      },
      write(message) {
        output.push(message);
      },
    };
  }

  async function run(command: Parameters<typeof runUserAdminCommand>[0]['command']) {
    return runUserAdminCommand({
      command,
      pool: context.pool,
      io,
      passwordHasher: argon2idPasswordHasher,
      initialPasswordGenerator: () => generatedPasswords.shift() ?? 'Fallback!Passphrase123',
      clock: () => new Date('2026-07-31T02:00:00.000Z'),
      requestIdGenerator: () => `cli-${command}`,
    });
  }

  it('creates the first user with a hash and prints the generated password exactly once', async () => {
    resetHarness(['Friend'], ['Initial!Passphrase123']);

    await run('create');

    expect(prompts).toEqual(['用户名：']);
    expect(output.join('\n').match(/Initial!Passphrase123/g)).toHaveLength(1);
    const stored = await context.pool.query<{
      username: string;
      password_hash: string;
      must_change_password: boolean;
    }>(`select username, password_hash, must_change_password from users`);
    expect(stored.rows[0]).toMatchObject({ username: 'Friend', must_change_password: true });
    expect(stored.rows[0]!.password_hash).not.toContain('Initial!Passphrase123');
    await expect(
      argon2idPasswordHasher.verify(stored.rows[0]!.password_hash, 'Initial!Passphrase123'),
    ).resolves.toBe(true);
  });

  it('rejects a case-insensitive duplicate without printing a password', async () => {
    resetHarness(['FRIEND'], ['Unused!Passphrase123']);

    await expect(run('create')).rejects.toBeInstanceOf(UserAdminCommandError);
    expect(output.join('\n')).not.toContain('Unused!Passphrase123');
  });

  it('resets a password, revokes sessions, and changes account state without accepting secrets as input', async () => {
    const user = await context.pool.query<{ id: string }>(
      `select id from users where normalized_username = 'friend'`,
    );
    const userId = user.rows[0]!.id;
    await context.pool.query(
      `insert into web_sessions (
         user_id, token_hash, csrf_token_hash, created_at, last_seen_at, absolute_expires_at
       ) values ($1, $2, $3, now(), now(), now() + interval '7 days')`,
      [
        userId,
        createHash('sha256').update('session').digest(),
        createHash('sha256').update('csrf').digest(),
      ],
    );

    resetHarness(['friend'], ['Reset!Passphrase123']);
    await run('reset-password');
    expect(output.join('\n').match(/Reset!Passphrase123/g)).toHaveLength(1);
    const state = await context.pool.query<{
      must_change_password: boolean;
      revoked_at: Date | null;
    }>(
      `select u.must_change_password, s.revoked_at
       from users u join web_sessions s on s.user_id = u.id where u.id = $1`,
      [userId],
    );
    expect(state.rows[0]!.must_change_password).toBe(true);
    expect(state.rows[0]!.revoked_at).toBeInstanceOf(Date);

    resetHarness(['friend'], []);
    await run('disable');
    resetHarness(['friend'], []);
    await run('enable');
    await context.pool.query(
      `update users set failed_login_count = 10, locked_until = now() + interval '15 minutes'
       where id = $1`,
      [userId],
    );
    resetHarness(['friend'], []);
    await run('unlock');
    const account = await context.pool.query<{
      enabled: boolean;
      failed_login_count: number;
      locked_until: Date | null;
    }>(`select enabled, failed_login_count, locked_until from users where id = $1`, [userId]);
    expect(account.rows[0]).toEqual({ enabled: true, failed_login_count: 0, locked_until: null });
  });

  it('lists account state without exposing password hashes', async () => {
    resetHarness([], []);

    await run('list');

    expect(output.join('\n')).toContain('Friend');
    expect(output.join('\n')).not.toContain('$argon2');
    const audited = await context.pool.query<{ action: string }>(
      `select action from audit_logs where actor_type = 'system' order by occurred_at, id`,
    );
    expect(audited.rows).toHaveLength(5);
    expect(audited.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'account.created',
        'account.password_reset',
        'account.disabled',
        'account.enabled',
        'account.unlocked',
      ]),
    );
  });
});
