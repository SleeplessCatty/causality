import { z } from 'zod';

export const auditActions = [
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.account_locked',
  'auth.password_changed',
  'auth.session_logged_out',
  'auth.sessions_revoked',
  'account.created',
  'account.password_reset',
  'account.enabled',
  'account.disabled',
  'account.unlocked',
  'mcp_token.created',
  'mcp_token.revoked',
  'mcp_token.deleted',
  'mcp_token.auth_failed',
  'event.created',
  'event.updated',
  'event.deleted',
  'relation.created',
  'relation.updated',
  'relation.deleted',
  'case.created',
  'case.updated',
  'case.deleted',
  'data_check.executed',
  'data_check.issue_processed',
  'data_import.committed',
  'data_export.prepared',
  'ai_import.committed',
  'semantic.model_changed',
  'semantic.reindex_started',
  'setting.updated',
  'maintenance.enabled',
  'maintenance.disabled',
] as const;

export const auditActionSchema = z.enum(auditActions);

export const auditTargetTypeSchema = z.enum([
  'user',
  'session',
  'mcp_token',
  'event',
  'relation',
  'case',
  'data_check',
  'data_import',
  'data_export',
  'ai_import',
  'semantic_model',
  'setting',
  'maintenance',
  'system',
]);

export const auditResultSchema = z.enum(['success', 'failure', 'conflict']);

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;
export type AuditResult = z.infer<typeof auditResultSchema>;
