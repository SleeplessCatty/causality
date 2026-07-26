import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MODEL_DIRECTORY: z.string().min(1).default('/var/lib/causality/models'),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  SHUTDOWN_DRAIN_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function parseWorkerEnv(input: Record<string, unknown>): WorkerEnv {
  const result = envSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid semantic worker environment configuration');
  return result.data;
}
