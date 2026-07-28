import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  SEMANTIC_WORKER_URL: z.string().url().default('http://127.0.0.1:3100'),
  SEMANTIC_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(10_000),
  AI_CAPTURE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  CAUSALITY_MCP_ENDPOINT: z.string().url().default('http://127.0.0.1:8081/mcp'),
  CAUSALITY_MCP_HEALTH_URL: z.string().url().default('http://127.0.0.1:8081/health'),
  CAUSALITY_MCP_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1_000),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}
