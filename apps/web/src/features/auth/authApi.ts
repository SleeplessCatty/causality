import {
  authSessionResponseSchema,
  logoutResultSchema,
  type AuthSessionResponse,
  type ChangePasswordInput,
  type LoginInput,
} from '@causality/contracts';

import { requestJson } from '../../shared/api/httpClient';

export async function getAuthSession(): Promise<AuthSessionResponse> {
  return authSessionResponseSchema.parse(await requestJson('/api/auth/session'));
}

export async function login(input: LoginInput): Promise<AuthSessionResponse> {
  return authSessionResponseSchema.parse(
    await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  logoutResultSchema.parse(
    await requestJson('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function logout(): Promise<void> {
  logoutResultSchema.parse(await requestJson('/api/auth/logout', { method: 'POST' }));
}

export async function logoutAll(): Promise<void> {
  logoutResultSchema.parse(await requestJson('/api/auth/logout-all', { method: 'POST' }));
}
