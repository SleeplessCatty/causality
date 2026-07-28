import { z } from 'zod';

const mcpEnvSchema = z.object({
  CAUSALITY_API_URL: z.url().default('http://127.0.0.1:3000'),
  CAUSALITY_API_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(35_000),
});

export type McpEnv = z.infer<typeof mcpEnvSchema>;

export function loadMcpEnv(source: NodeJS.ProcessEnv = process.env): McpEnv {
  return mcpEnvSchema.parse(source);
}
