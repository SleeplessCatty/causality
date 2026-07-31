import { randomBytes } from 'node:crypto';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const INITIAL_PASSWORD_BYTES = 24;

const commonPasswords = new Set([
  '123456789012',
  'correcthorsebatterystaple',
  'letmeinletmein',
  'password1234',
  'qwertyuiop12',
]);

export class PasswordPolicyError extends Error {
  readonly code = 'PASSWORD_POLICY_VIOLATION';

  constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

function comparable(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('und');
}

export function validatePassword(password: string, username: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError('密码长度必须为 12 至 128 个字符');
  }

  const normalizedPassword = comparable(password);
  if (normalizedPassword === comparable(username)) {
    throw new PasswordPolicyError('密码不能与用户名相同');
  }
  if (commonPasswords.has(normalizedPassword)) {
    throw new PasswordPolicyError('密码过于常见');
  }

  const characters = Array.from(normalizedPassword);
  if (characters.length > 0 && characters.every((character) => character === characters[0])) {
    throw new PasswordPolicyError('密码不能由重复字符组成');
  }
}

export function generateInitialPassword(): string {
  return randomBytes(INITIAL_PASSWORD_BYTES).toString('base64url');
}
