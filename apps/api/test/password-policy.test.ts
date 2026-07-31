import { describe, expect, it } from 'vitest';

import { generateInitialPassword, validatePassword } from '../src/features/auth/passwordPolicy.js';
import { argon2idPasswordHasher } from '../src/features/auth/passwordHasher.js';

describe('password policy', () => {
  it('accepts a non-common 12-character passphrase', () => {
    expect(() => validatePassword('GoodPass!123', 'jason')).not.toThrow();
  });

  it('rejects passwords outside the supported length', () => {
    expect(() => validatePassword('short', 'jason')).toThrow();
    expect(() => validatePassword('x'.repeat(129), 'jason')).toThrow();
  });

  it('rejects username-equivalent, repeated-character, and bundled common passwords', () => {
    expect(() => validatePassword('LONGUSERNAME', 'longusername')).toThrow();
    expect(() => validatePassword('aaaaaaaaaaaa', 'jason')).toThrow();
    expect(() => validatePassword('password1234', 'jason')).toThrow();
  });

  it('generates policy-compliant initial passwords with at least 20 random characters', () => {
    const password = generateInitialPassword();

    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(() => validatePassword(password, 'jason')).not.toThrow();
    expect(generateInitialPassword()).not.toBe(password);
  });
});

describe('Argon2id password hashing', () => {
  it('uses a random salt while retaining the required work parameters', async () => {
    const first = await argon2idPasswordHasher.hash('GoodPass!123');
    const second = await argon2idPasswordHasher.hash('GoodPass!123');

    expect(first).not.toBe(second);
    expect(first).toContain('$argon2id$v=19$m=65536,t=3,p=1$');
  });

  it('accepts only the password represented by an encoded hash', async () => {
    const encoded = await argon2idPasswordHasher.hash('GoodPass!123');

    await expect(argon2idPasswordHasher.verify(encoded, 'GoodPass!123')).resolves.toBe(true);
    await expect(argon2idPasswordHasher.verify(encoded, 'WrongPass!123')).resolves.toBe(false);
  });
});
