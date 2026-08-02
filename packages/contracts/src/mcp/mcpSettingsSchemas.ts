import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
export const mcpPersonalAccessTokenSchema = z.string().regex(/^cau_pat_[A-Za-z0-9_-]{43}$/);
export const mcpMaskedTokenSchema = z
  .string()
  .regex(/^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$/);

export const mcpServiceStatusSchema = z.enum(['running', 'stopped']);

export const mcpClientConfigSchema = z
  .object({
    transport: z.literal('streamable-http'),
    url: z.url(),
  })
  .strict();

export const mcpSettingsResponseSchema = z
  .object({
    serviceStatus: mcpServiceStatusSchema,
    endpoint: z.url(),
    updatedAt: timestampSchema,
    clientConfig: mcpClientConfigSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.clientConfig.url !== value.endpoint) {
      context.addIssue({
        code: 'custom',
        message: '客户端配置地址必须与 MCP 端点一致',
        path: ['clientConfig', 'url'],
      });
    }
  });

export const mcpTokenSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    maskedToken: mcpMaskedTokenSchema,
    createdAt: timestampSchema,
    lastUsedAt: timestampSchema.nullable(),
  })
  .strict();

export const createMcpTokenInputSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

export const createMcpTokenResponseSchema = z.object({ summary: mcpTokenSummarySchema }).strict();

export const mcpTokenSecretResponseSchema = z
  .object({ token: mcpPersonalAccessTokenSchema })
  .strict();

export const deleteMcpTokenResponseSchema = z.object({ deleted: z.literal(true) }).strict();

export const mcpAuthorizationResponseSchema = z
  .object({
    authorized: z.literal(true),
    userId: z.uuid(),
    username: z.string().min(1).max(50),
    tokenId: z.uuid(),
  })
  .strict();

export type McpServiceStatus = z.infer<typeof mcpServiceStatusSchema>;
export type McpClientConfig = z.infer<typeof mcpClientConfigSchema>;
export type McpSettingsResponse = z.infer<typeof mcpSettingsResponseSchema>;
export type McpTokenSummary = z.infer<typeof mcpTokenSummarySchema>;
export type CreateMcpTokenInput = z.infer<typeof createMcpTokenInputSchema>;
export type CreateMcpTokenResponse = z.infer<typeof createMcpTokenResponseSchema>;
export type McpTokenSecretResponse = z.infer<typeof mcpTokenSecretResponseSchema>;
export type DeleteMcpTokenResponse = z.infer<typeof deleteMcpTokenResponseSchema>;
export type McpAuthorizationResponse = z.infer<typeof mcpAuthorizationResponseSchema>;
