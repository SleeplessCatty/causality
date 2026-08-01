import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[\p{L}\p{N}._-]+$/u);

export const passwordSchema = z.string().min(12).max(128);

export const loginInputSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
  })
  .strict();

export const changePasswordInputSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .strict();

export const changeInitialPasswordInputSchema = z
  .object({
    newPassword: passwordSchema,
  })
  .strict();

export const authenticatedUserSchema = z
  .object({
    id: z.uuid(),
    username: usernameSchema,
    mustChangePassword: z.boolean(),
  })
  .strict();

export const authSessionResponseSchema = z
  .object({
    user: authenticatedUserSchema,
    csrfToken: z.string().min(1),
  })
  .strict();

export const authErrorCodeSchema = z.enum([
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'TOO_MANY_ATTEMPTS',
  'AUTH_REQUIRED',
  'INVALID_CURRENT_PASSWORD',
  'INITIAL_PASSWORD_CHANGE_NOT_ALLOWED',
  'PASSWORD_CHANGE_REQUIRED',
  'PASSWORD_POLICY_VIOLATION',
  'CSRF_INVALID',
  'ORIGIN_INVALID',
]);

export const authErrorSchema = z
  .object({
    code: authErrorCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const logoutResultSchema = z.object({ success: z.literal(true) }).strict();

export type Username = z.infer<typeof usernameSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
export type ChangeInitialPasswordInput = z.infer<typeof changeInitialPasswordInputSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
export type AuthError = z.infer<typeof authErrorSchema>;
export type LogoutResult = z.infer<typeof logoutResultSchema>;
