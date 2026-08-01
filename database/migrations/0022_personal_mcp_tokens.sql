CREATE TABLE "mcp_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_digest" "bytea" NOT NULL,
	"device_name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_client_name" varchar(120),
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_access_tokens_digest_length_check" CHECK (octet_length("mcp_access_tokens"."token_digest") = 32),
	CONSTRAINT "mcp_access_tokens_device_name_length_check" CHECK (char_length(btrim("mcp_access_tokens"."device_name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_access_tokens_digest_uidx" ON "mcp_access_tokens" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "mcp_access_tokens_user_active_idx" ON "mcp_access_tokens" USING btree ("user_id","revoked_at");