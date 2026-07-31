import { z } from 'zod';

const developmentSessionKey = 'ca'.repeat(32);
const developmentSourceKey = 'db'.repeat(32);

const booleanEnvironmentValue = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
  .default(false);

const secretSchema = z.string().regex(/^[0-9a-f]{64}$/);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
    SEMANTIC_WORKER_URL: z.string().url().default('http://127.0.0.1:3100'),
    SEMANTIC_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(10_000),
    AI_CAPTURE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    CAUSALITY_MCP_ENDPOINT: z.string().url().default('http://127.0.0.1:8081/mcp'),
    CAUSALITY_MCP_HEALTH_URL: z.string().url().default('http://127.0.0.1:8081/health'),
    CAUSALITY_MCP_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1_000),
    CAUSALITY_PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
    CAUSALITY_SESSION_HMAC_KEY: secretSchema.default(developmentSessionKey),
    CAUSALITY_AUTH_IP_HASH_KEY: secretSchema.default(developmentSourceKey),
    CAUSALITY_COOKIE_SECURE: booleanEnvironmentValue,
  })
  .superRefine((value, context) => {
    const publicOrigin = new URL(value.CAUSALITY_PUBLIC_ORIGIN);
    const isLoopback =
      publicOrigin.hostname === '127.0.0.1' || publicOrigin.hostname === 'localhost';
    if (!isLoopback && publicOrigin.protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['CAUSALITY_PUBLIC_ORIGIN'],
        message: 'HTTPS required',
      });
    }
    if (!value.CAUSALITY_COOKIE_SECURE && !isLoopback) {
      context.addIssue({
        code: 'custom',
        path: ['CAUSALITY_COOKIE_SECURE'],
        message: 'Insecure cookies require loopback origin',
      });
    }
    if (value.CAUSALITY_SESSION_HMAC_KEY === value.CAUSALITY_AUTH_IP_HASH_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['CAUSALITY_AUTH_IP_HASH_KEY'],
        message: 'Secrets differ',
      });
    }
    if (value.NODE_ENV === 'production') {
      for (const [key, secret, developmentValue] of [
        ['CAUSALITY_SESSION_HMAC_KEY', value.CAUSALITY_SESSION_HMAC_KEY, developmentSessionKey],
        ['CAUSALITY_AUTH_IP_HASH_KEY', value.CAUSALITY_AUTH_IP_HASH_KEY, developmentSourceKey],
      ] as const) {
        if (secret === developmentValue || new Set(secret).size === 1) {
          context.addIssue({ code: 'custom', path: [key], message: 'Production secret required' });
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}
