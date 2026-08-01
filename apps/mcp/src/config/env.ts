import { z } from 'zod';

const developmentInternalMcpSecret = 'ef'.repeat(32);
const secretSchema = z.string().regex(/^[0-9a-f]{64}$/);
const personalTokenSchema = z.string().regex(/^cau_pat_[A-Za-z0-9_-]{43}$/);

const mcpEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    CAUSALITY_API_URL: z.url().default('http://127.0.0.1:3000'),
    CAUSALITY_API_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(35_000),
    CAUSALITY_INTERNAL_MCP_SECRET: secretSchema.default(developmentInternalMcpSecret),
    CAUSALITY_MCP_TOKEN: personalTokenSchema.optional(),
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
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production' &&
      (value.CAUSALITY_INTERNAL_MCP_SECRET === developmentInternalMcpSecret ||
        new Set(value.CAUSALITY_INTERNAL_MCP_SECRET).size === 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CAUSALITY_INTERNAL_MCP_SECRET'],
        message: 'Production secret required',
      });
    }
  });

export type McpEnv = z.infer<typeof mcpEnvSchema>;

export function loadMcpEnv(source: NodeJS.ProcessEnv = process.env): McpEnv {
  return mcpEnvSchema.parse(source);
}
