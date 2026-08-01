import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { usernameSchema, type AuditAction } from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';
import { Pool as PostgresPool } from 'pg';

import { parseEnv } from '../config/env.js';
import { PostgresAuditWriter } from '../features/audit/auditRepository.js';
import { argon2idPasswordHasher, type PasswordHasher } from '../features/auth/passwordHasher.js';
import { generateInitialPassword, validatePassword } from '../features/auth/passwordPolicy.js';
import type { RequestActor } from '../features/auth/requestActor.js';

export type UserAdminCommand =
  'create' | 'list' | 'reset-password' | 'disable' | 'enable' | 'unlock';

export interface UserAdminIo {
  prompt(message: string): Promise<string>;
  write(message: string): void;
}

export interface RunUserAdminCommandOptions {
  command: UserAdminCommand;
  pool: Pool;
  io: UserAdminIo;
  passwordHasher: PasswordHasher;
  initialPasswordGenerator: () => string;
  clock: () => Date;
  requestIdGenerator: () => string;
}

export class UserAdminCommandError extends Error {
  constructor(
    readonly code: 'INVALID_USERNAME' | 'USERNAME_EXISTS' | 'USER_NOT_FOUND' | 'INVALID_COMMAND',
    message: string,
  ) {
    super(message);
    this.name = 'UserAdminCommandError';
  }
}

type UserRow = { id: string; username: string; enabled: boolean; locked_until: Date | null };

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function parseUsername(input: string): string {
  const result = usernameSchema.safeParse(input);
  if (!result.success) {
    throw new UserAdminCommandError('INVALID_USERNAME', '用户名格式不合法');
  }
  return result.data;
}

async function promptUsername(io: UserAdminIo): Promise<string> {
  return parseUsername(await io.prompt('用户名：'));
}

function cliActor(requestId: string): RequestActor {
  return {
    actorType: 'system',
    actorLabel: 'server-cli',
    channel: 'cli',
    requestId,
  };
}

async function findUser(client: PoolClient, username: string): Promise<UserRow> {
  const result = await client.query<UserRow>(
    `select id, username, enabled, locked_until
     from users where normalized_username = lower(btrim($1)) for update`,
    [username],
  );
  if (!result.rows[0]) throw new UserAdminCommandError('USER_NOT_FOUND', '用户不存在');
  return result.rows[0];
}

async function appendAccountAudit(
  client: PoolClient,
  actor: RequestActor,
  action: Extract<AuditAction, `account.${string}`>,
  userId: string,
  occurredAt: Date,
): Promise<void> {
  await new PostgresAuditWriter().append(client, {
    actor,
    action,
    targetType: 'user',
    targetId: userId,
    result: 'success',
    occurredAt,
  });
}

async function createUser(options: RunUserAdminCommandOptions): Promise<void> {
  const username = await promptUsername(options.io);
  const initialPassword = options.initialPasswordGenerator();
  validatePassword(initialPassword, username);
  const passwordHash = await options.passwordHasher.hash(initialPassword);
  const now = options.clock();
  const actor = cliActor(options.requestIdGenerator());
  try {
    await transaction(options.pool, async (client) => {
      const created = await client.query<{ id: string }>(
        `insert into users (username, password_hash, must_change_password, created_at, updated_at)
         values ($1, $2, true, $3, $3) returning id`,
        [username, passwordHash, now],
      );
      await appendAccountAudit(client, actor, 'account.created', created.rows[0]!.id, now);
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new UserAdminCommandError('USERNAME_EXISTS', '用户名已存在');
    }
    throw error;
  }
  options.io.write(`账号已创建：${username}`);
  options.io.write(`初始密码：${initialPassword}`);
  options.io.write('该密码仅显示一次，用户首次登录后必须修改。');
}

async function resetPassword(options: RunUserAdminCommandOptions): Promise<void> {
  const username = await promptUsername(options.io);
  const initialPassword = options.initialPasswordGenerator();
  validatePassword(initialPassword, username);
  const passwordHash = await options.passwordHasher.hash(initialPassword);
  const now = options.clock();
  const actor = cliActor(options.requestIdGenerator());
  const canonicalUsername = await transaction(options.pool, async (client) => {
    const user = await findUser(client, username);
    await client.query(
      `update users
       set password_hash = $2, must_change_password = true,
           failed_login_count = 0, locked_until = null, updated_at = $3
       where id = $1`,
      [user.id, passwordHash, now],
    );
    await client.query(
      `update web_sessions set revoked_at = $2 where user_id = $1 and revoked_at is null`,
      [user.id, now],
    );
    await appendAccountAudit(client, actor, 'account.password_reset', user.id, now);
    return user.username;
  });
  options.io.write(`密码已重置：${canonicalUsername}`);
  options.io.write(`初始密码：${initialPassword}`);
  options.io.write('该密码仅显示一次，用户下次登录后必须修改。');
}

async function mutateAccount(
  options: RunUserAdminCommandOptions,
  action: 'disable' | 'enable' | 'unlock',
): Promise<void> {
  const username = await promptUsername(options.io);
  const now = options.clock();
  const actor = cliActor(options.requestIdGenerator());
  const canonicalUsername = await transaction(options.pool, async (client) => {
    const user = await findUser(client, username);
    if (action === 'disable') {
      await client.query(`update users set enabled = false, updated_at = $2 where id = $1`, [
        user.id,
        now,
      ]);
      await client.query(
        `update web_sessions set revoked_at = $2 where user_id = $1 and revoked_at is null`,
        [user.id, now],
      );
      await client.query(
        `update mcp_access_tokens set revoked_at = $2 where user_id = $1 and revoked_at is null`,
        [user.id, now],
      );
      await appendAccountAudit(client, actor, 'account.disabled', user.id, now);
    } else if (action === 'enable') {
      await client.query(`update users set enabled = true, updated_at = $2 where id = $1`, [
        user.id,
        now,
      ]);
      await appendAccountAudit(client, actor, 'account.enabled', user.id, now);
    } else {
      await client.query(
        `update users
         set failed_login_count = 0, locked_until = null, updated_at = $2 where id = $1`,
        [user.id, now],
      );
      await appendAccountAudit(client, actor, 'account.unlocked', user.id, now);
    }
    return user.username;
  });
  const label = action === 'disable' ? '已停用' : action === 'enable' ? '已启用' : '已解除锁定';
  options.io.write(`${label}：${canonicalUsername}`);
}

async function listUsers(options: RunUserAdminCommandOptions): Promise<void> {
  const result = await options.pool.query<{
    username: string;
    enabled: boolean;
    must_change_password: boolean;
    locked_until: Date | null;
  }>(
    `select username, enabled, must_change_password, locked_until
     from users order by normalized_username`,
  );
  if (result.rows.length === 0) {
    options.io.write('当前没有用户。');
    return;
  }
  for (const user of result.rows) {
    options.io.write(
      `${user.username}\t${user.enabled ? '已启用' : '已停用'}\t${
        user.must_change_password ? '需修改初始密码' : '密码已设置'
      }\t${user.locked_until ? `锁定至 ${user.locked_until.toISOString()}` : '未锁定'}`,
    );
  }
}

export async function runUserAdminCommand(options: RunUserAdminCommandOptions): Promise<void> {
  if (options.command === 'create') return createUser(options);
  if (options.command === 'list') return listUsers(options);
  if (options.command === 'reset-password') return resetPassword(options);
  if (
    options.command === 'disable' ||
    options.command === 'enable' ||
    options.command === 'unlock'
  ) {
    return mutateAccount(options, options.command);
  }
  throw new UserAdminCommandError('INVALID_COMMAND', '不支持的账号管理命令');
}

function isUserAdminCommand(value: string | undefined): value is UserAdminCommand {
  return ['create', 'list', 'reset-password', 'disable', 'enable', 'unlock'].includes(value ?? '');
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!isUserAdminCommand(command) || process.argv.length !== 3) {
    throw new UserAdminCommandError(
      'INVALID_COMMAND',
      '用法：userAdmin <create|list|reset-password|disable|enable|unlock>',
    );
  }
  const env = parseEnv(process.env);
  const pool = new PostgresPool({ connectionString: env.DATABASE_URL });
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runUserAdminCommand({
      command,
      pool,
      io: {
        prompt: (message) => readline.question(message),
        write: (message) => process.stdout.write(`${message}\n`),
      },
      passwordHasher: argon2idPasswordHasher,
      initialPasswordGenerator: generateInitialPassword,
      clock: () => new Date(),
      requestIdGenerator: randomUUID,
    });
  } finally {
    readline.close();
    await pool.end();
  }
}

const executedFile = process.argv[1]
  ? fileURLToPath(new URL(`file://${process.argv[1]}`))
  : undefined;
if (executedFile === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
