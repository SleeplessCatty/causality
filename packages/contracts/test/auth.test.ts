import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  authErrorSchema,
  authSessionResponseSchema,
  changeInitialPasswordInputSchema,
  changePasswordInputSchema,
  loginInputSchema,
} from '../src/index.js';

describe('authentication contracts', () => {
  it('accepts strict login credentials at the supported boundaries', () => {
    expect(loginInputSchema.parse({ username: 'jason', password: 'a long passphrase' })).toEqual({
      username: 'jason',
      password: 'a long passphrase',
    });
    expect(loginInputSchema.safeParse({ username: 'abc', password: 'x'.repeat(12) }).success).toBe(
      true,
    );
    expect(
      loginInputSchema.safeParse({ username: '用'.repeat(50), password: 'x'.repeat(128) }).success,
    ).toBe(true);
  });

  it('rejects invalid lengths, unsupported username characters, and unknown login fields', () => {
    for (const input of [
      { username: 'ab', password: 'x'.repeat(12) },
      { username: 'x'.repeat(51), password: 'x'.repeat(12) },
      { username: 'space name', password: 'x'.repeat(12) },
      { username: 'jason', password: 'x'.repeat(11) },
      { username: 'jason', password: 'x'.repeat(129) },
      { username: 'jason', password: 'x'.repeat(12), role: 'admin' },
    ]) {
      expect(loginInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it('accepts a strict authenticated session response with a UUID user ID', () => {
    const response = {
      user: {
        id: '123e4567-e89b-42d3-a456-426614174000',
        username: 'jason',
        mustChangePassword: false,
      },
      csrfToken: 'base64url-token',
    };

    expect(authSessionResponseSchema.parse(response)).toEqual(response);
    expect(
      authSessionResponseSchema.safeParse({ ...response, user: { ...response.user, id: '1' } })
        .success,
    ).toBe(false);
    expect(authSessionResponseSchema.safeParse({ ...response, role: 'admin' }).success).toBe(false);
  });

  it('requires both current and replacement passwords when changing a password', () => {
    expect(
      changePasswordInputSchema.parse({
        currentPassword: 'current-passphrase',
        newPassword: 'replacement-passphrase',
      }),
    ).toEqual({
      currentPassword: 'current-passphrase',
      newPassword: 'replacement-passphrase',
    });
    expect(
      changePasswordInputSchema.safeParse({
        currentPassword: 'current-passphrase',
        newPassword: 'short',
      }).success,
    ).toBe(false);
  });

  it('accepts only the replacement password for a required initial-password change', () => {
    expect(
      changeInitialPasswordInputSchema.parse({ newPassword: 'replacement-passphrase' }),
    ).toEqual({ newPassword: 'replacement-passphrase' });
    expect(
      changeInitialPasswordInputSchema.safeParse({
        currentPassword: 'temporary-passphrase',
        newPassword: 'replacement-passphrase',
      }).success,
    ).toBe(false);
  });

  it('represents an invalid current password without exposing submitted credentials', () => {
    expect(
      authErrorSchema.parse({
        code: 'INVALID_CURRENT_PASSWORD',
        message: '当前密码错误',
      }),
    ).toEqual({ code: 'INVALID_CURRENT_PASSWORD', message: '当前密码错误' });
  });

  it('allows the common API client to parse authentication failures', () => {
    expect(apiErrorSchema.parse({ code: 'AUTH_REQUIRED', message: '需要登录' })).toEqual({
      code: 'AUTH_REQUIRED',
      message: '需要登录',
    });
  });
});
