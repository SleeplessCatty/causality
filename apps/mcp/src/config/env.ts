import { z } from 'zod';

const mcpEnvSchema = z.object({
  CAUSALITY_API_URL: z.url().default('http://127.0.0.1:3000'),
  CAUSALITY_API_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(35_000),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(8081),
  CAUSALITY_MCP_ALLOWED_ORIGINS: z
    .string()
    .default('http://127.0.0.1:5173,http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  CAUSALITY_MCP_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(64 * 1024 * 1024)
    .default(8 * 1024 * 1024),
});

export type McpEnv = z.infer<typeof mcpEnvSchema>;

export function loadMcpEnv(source: NodeJS.ProcessEnv = process.env): McpEnv {
  return mcpEnvSchema.parse(source);
}
