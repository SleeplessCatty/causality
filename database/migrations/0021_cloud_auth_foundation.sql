CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" varchar(10) NOT NULL,
	"actor_user_id" uuid,
	"actor_username" varchar(50),
	"actor_label" varchar(50),
	"actor_channel" varchar(10) NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"session_id" uuid,
	"mcp_token_id" uuid,
	"action" varchar(50) NOT NULL,
	"target_type" varchar(30) NOT NULL,
	"target_id" varchar(100),
	"result" varchar(10) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_type_check" CHECK ("audit_logs"."actor_type" in ('user', 'system', 'anonymous')),
	CONSTRAINT "audit_logs_actor_channel_check" CHECK ("audit_logs"."actor_channel" in ('web', 'mcp', 'cli')),
	CONSTRAINT "audit_logs_actor_shape_check" CHECK ((
          "audit_logs"."actor_type" = 'user'
          and "audit_logs"."actor_user_id" is not null
          and "audit_logs"."actor_username" is not null
          and "audit_logs"."actor_label" is null
          and "audit_logs"."actor_channel" in ('web', 'mcp')
        ) or (
          "audit_logs"."actor_type" = 'system'
          and "audit_logs"."actor_user_id" is null
          and "audit_logs"."actor_username" is null
          and "audit_logs"."actor_label" = 'server-cli'
          and "audit_logs"."actor_channel" = 'cli'
        ) or (
          "audit_logs"."actor_type" = 'anonymous'
          and "audit_logs"."actor_user_id" is null
          and "audit_logs"."actor_username" is not null
          and "audit_logs"."actor_label" is null
          and "audit_logs"."actor_channel" = 'web'
        )),
	CONSTRAINT "audit_logs_action_check" CHECK ("audit_logs"."action" in (
        'auth.login_succeeded', 'auth.login_failed', 'auth.account_locked',
        'auth.password_changed', 'auth.session_logged_out', 'auth.sessions_revoked',
        'account.created', 'account.password_reset', 'account.enabled', 'account.disabled',
        'account.unlocked', 'mcp_token.created', 'mcp_token.revoked', 'mcp_token.auth_failed',
        'event.created', 'event.updated', 'event.deleted', 'relation.created', 'relation.updated',
        'relation.deleted', 'case.created', 'case.updated', 'case.deleted',
        'data_check.executed', 'data_check.issue_processed', 'data_import.committed',
        'data_export.prepared', 'ai_import.committed', 'semantic.model_changed',
        'semantic.reindex_started', 'setting.updated', 'maintenance.enabled',
        'maintenance.disabled'
      )),
	CONSTRAINT "audit_logs_target_type_check" CHECK ("audit_logs"."target_type" in (
        'user', 'session', 'mcp_token', 'event', 'relation', 'case', 'data_check',
        'data_import', 'data_export', 'ai_import', 'semantic_model', 'setting',
        'maintenance', 'system'
      )),
	CONSTRAINT "audit_logs_result_check" CHECK ("audit_logs"."result" in ('success', 'failure', 'conflict'))
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_digest" "bytea" NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limits_source_digest_length_check" CHECK (octet_length("auth_rate_limits"."source_digest") = 32),
	CONSTRAINT "auth_rate_limits_failure_count_check" CHECK ("auth_rate_limits"."failure_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(50) NOT NULL,
	"normalized_username" varchar(50) GENERATED ALWAYS AS (lower(btrim(username))) STORED NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_length_check" CHECK (char_length(btrim("users"."username")) between 3 and 50),
	CONSTRAINT "users_username_format_check" CHECK ("users"."username" ~ '^[[:alnum:]_.-]+$'),
	CONSTRAINT "users_password_hash_check" CHECK (char_length("users"."password_hash") between 1 and 255),
	CONSTRAINT "users_failed_login_count_check" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "web_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"csrf_token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "web_sessions_token_hash_length_check" CHECK (octet_length("web_sessions"."token_hash") = 32),
	CONSTRAINT "web_sessions_csrf_token_hash_length_check" CHECK (octet_length("web_sessions"."csrf_token_hash") = 32),
	CONSTRAINT "web_sessions_absolute_expiry_check" CHECK ("web_sessions"."absolute_expires_at" > "web_sessions"."created_at"),
	CONSTRAINT "web_sessions_last_seen_check" CHECK ("web_sessions"."last_seen_at" >= "web_sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_id_idx" ON "audit_logs" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_occurred_idx" ON "audit_logs" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_source_digest_uidx" ON "auth_rate_limits" USING btree ("source_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "users_normalized_username_uidx" ON "users" USING btree ("normalized_username");--> statement-breakpoint
CREATE UNIQUE INDEX "web_sessions_token_hash_uidx" ON "web_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "web_sessions_user_active_idx" ON "web_sessions" USING btree ("user_id","revoked_at");
