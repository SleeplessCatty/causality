DELETE FROM "mcp_access_tokens";
--> statement-breakpoint
DROP INDEX "mcp_access_tokens_user_active_idx";
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" RENAME COLUMN "device_name" TO "name";
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" DROP COLUMN "revoked_at";
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD COLUMN "masked_token" varchar(25) NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD COLUMN "token_ciphertext" bytea NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD COLUMN "token_iv" bytea NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD COLUMN "token_auth_tag" bytea NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" DROP CONSTRAINT "mcp_access_tokens_device_name_length_check";
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_name_length_check"
  CHECK ("mcp_access_tokens"."name" = btrim("mcp_access_tokens"."name") AND char_length("mcp_access_tokens"."name") BETWEEN 1 AND 80);
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_mask_check"
  CHECK ("mcp_access_tokens"."masked_token" ~ '^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$');
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_iv_length_check"
  CHECK (octet_length("mcp_access_tokens"."token_iv") = 12);
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_auth_tag_length_check"
  CHECK (octet_length("mcp_access_tokens"."token_auth_tag") = 16);
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_ciphertext_length_check"
  CHECK (octet_length("mcp_access_tokens"."token_ciphertext") > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_access_tokens_user_name_uidx"
  ON "mcp_access_tokens" USING btree ("user_id", lower(btrim("name")));
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check";
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_check" CHECK ("audit_logs"."action" in (
  'auth.login_succeeded', 'auth.login_failed', 'auth.account_locked',
  'auth.password_changed', 'auth.session_logged_out', 'auth.sessions_revoked',
  'account.created', 'account.password_reset', 'account.enabled', 'account.disabled',
  'account.unlocked', 'mcp_token.created', 'mcp_token.revoked', 'mcp_token.deleted',
  'mcp_token.auth_failed', 'event.created', 'event.updated', 'event.deleted',
  'relation.created', 'relation.updated', 'relation.deleted', 'case.created',
  'case.updated', 'case.deleted', 'data_check.executed', 'data_check.issue_processed',
  'data_import.committed', 'data_export.prepared', 'ai_import.committed',
  'semantic.model_changed', 'semantic.reindex_started', 'setting.updated',
  'maintenance.enabled', 'maintenance.disabled'
));
