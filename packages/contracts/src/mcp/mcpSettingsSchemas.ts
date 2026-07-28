import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
const accessTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const mcpServiceStatusSchema = z.enum(['running', 'stopped']);

export const mcpClientConfigSchema = z
  .object({
    transport: z.literal('streamable-http'),
    url: z.url(),
    headers: z
      .object({
        Authorization: z.string().regex(/^Bearer [0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();

export const mcpSettingsResponseSchema = z
  .object({
    serviceStatus: mcpServiceStatusSchema,
    endpoint: z.url(),
    maskedToken: z.string().min(4).max(100),
    accessToken: accessTokenSchema,
    tokenVersion: z.number().int().positive(),
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
    if (value.clientConfig.headers.Authorization !== `Bearer ${value.accessToken}`) {
      context.addIssue({
        code: 'custom',
        message: '客户端配置令牌必须与 MCP 访问令牌一致',
        path: ['clientConfig', 'headers', 'Authorization'],
      });
    }
  });

export const mcpTokenRotationResponseSchema = z
  .object({
    settings: mcpSettingsResponseSchema,
  })
  .strict();

export const mcpAuthorizationResponseSchema = z
  .object({
    authorized: z.literal(true),
    tokenVersion: z.number().int().positive(),
  })
  .strict();

export type McpServiceStatus = z.infer<typeof mcpServiceStatusSchema>;
export type McpClientConfig = z.infer<typeof mcpClientConfigSchema>;
export type McpSettingsResponse = z.infer<typeof mcpSettingsResponseSchema>;
export type McpTokenRotationResponse = z.infer<typeof mcpTokenRotationResponseSchema>;
export type McpAuthorizationResponse = z.infer<typeof mcpAuthorizationResponseSchema>;
