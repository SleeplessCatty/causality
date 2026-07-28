CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TABLE "ai_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"topic" varchar(200) NOT NULL,
	"plan_version" integer NOT NULL,
	"client_name" varchar(100) NOT NULL,
	"completed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"event_created" integer NOT NULL,
	"event_reused" integer NOT NULL,
	"event_updated" integer NOT NULL,
	"case_created" integer NOT NULL,
	"case_reused" integer NOT NULL,
	"relation_created" integer NOT NULL,
	"relation_reused" integer NOT NULL,
	"relation_case_created" integer NOT NULL,
	"confidence_changed" integer NOT NULL,
	CONSTRAINT "ai_import_batches_plan_version_check" CHECK ("ai_import_batches"."plan_version" > 0),
	CONSTRAINT "ai_import_batches_topic_check" CHECK (char_length(btrim("ai_import_batches"."topic")) between 1 and 200),
	CONSTRAINT "ai_import_batches_client_name_check" CHECK (char_length(btrim("ai_import_batches"."client_name")) between 1 and 100),
	CONSTRAINT "ai_import_batches_counts_check" CHECK ("ai_import_batches"."event_created" >= 0
        and "ai_import_batches"."event_reused" >= 0
        and "ai_import_batches"."event_updated" >= 0
        and "ai_import_batches"."case_created" >= 0
        and "ai_import_batches"."case_reused" >= 0
        and "ai_import_batches"."relation_created" >= 0
        and "ai_import_batches"."relation_reused" >= 0
        and "ai_import_batches"."relation_case_created" >= 0
        and "ai_import_batches"."confidence_changed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_import_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"replaces_plan_id" uuid,
	"status" varchar(20) NOT NULL,
	"topic" varchar(200) NOT NULL,
	"client_name" varchar(100) NOT NULL,
	"candidate_payload" jsonb NOT NULL,
	"plan_payload" jsonb NOT NULL,
	"result_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ai_import_plans_version_check" CHECK ("ai_import_plans"."version" > 0),
	CONSTRAINT "ai_import_plans_status_check" CHECK ("ai_import_plans"."status" in (
        'pending',
        'replaced',
        'invalidated',
        'expired',
        'submitting',
        'committed',
        'data_failed',
        'system_failed'
      )),
	CONSTRAINT "ai_import_plans_topic_check" CHECK (char_length(btrim("ai_import_plans"."topic")) between 1 and 200),
	CONSTRAINT "ai_import_plans_client_name_check" CHECK (char_length(btrim("ai_import_plans"."client_name")) between 1 and 100),
	CONSTRAINT "ai_import_plans_candidate_payload_check" CHECK (jsonb_typeof("ai_import_plans"."candidate_payload") = 'object'),
	CONSTRAINT "ai_import_plans_plan_payload_check" CHECK (jsonb_typeof("ai_import_plans"."plan_payload") = 'object'),
	CONSTRAINT "ai_import_plans_result_payload_check" CHECK ("ai_import_plans"."result_payload" is null or jsonb_typeof("ai_import_plans"."result_payload") = 'object'),
	CONSTRAINT "ai_import_plans_expiry_check" CHECK ("ai_import_plans"."expires_at" > "ai_import_plans"."created_at")
);
--> statement-breakpoint
CREATE TABLE "ai_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"record_type" varchar(20) NOT NULL,
	"action" varchar(10) NOT NULL,
	"primary_record_id" uuid NOT NULL,
	"related_record_id" uuid,
	"detail" jsonb NOT NULL,
	CONSTRAINT "ai_import_records_sequence_check" CHECK ("ai_import_records"."sequence" > 0),
	CONSTRAINT "ai_import_records_record_type_check" CHECK ("ai_import_records"."record_type" in ('event', 'case', 'relation', 'relation_case', 'confidence')),
	CONSTRAINT "ai_import_records_action_check" CHECK ("ai_import_records"."action" in ('created', 'reused', 'updated', 'changed')),
	CONSTRAINT "ai_import_records_detail_check" CHECK (jsonb_typeof("ai_import_records"."detail") = 'object')
);
--> statement-breakpoint
CREATE TABLE "mcp_settings" (
	"singleton_key" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"access_token" char(64) NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "mcp_settings_singleton_check" CHECK ("mcp_settings"."singleton_key" = true),
	CONSTRAINT "mcp_settings_access_token_check" CHECK ("mcp_settings"."access_token" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mcp_settings_token_version_check" CHECK ("mcp_settings"."token_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_import_batches" ADD CONSTRAINT "ai_import_batches_plan_id_ai_import_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."ai_import_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_import_plans" ADD CONSTRAINT "ai_import_plans_replaces_plan_id_ai_import_plans_id_fk" FOREIGN KEY ("replaces_plan_id") REFERENCES "public"."ai_import_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_import_records" ADD CONSTRAINT "ai_import_records_batch_id_ai_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ai_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_import_batches_plan_id_uidx" ON "ai_import_batches" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "ai_import_batches_completed_id_idx" ON "ai_import_batches" USING btree ("completed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_import_plans_replaces_plan_id_uidx" ON "ai_import_plans" USING btree ("replaces_plan_id");--> statement-breakpoint
CREATE INDEX "ai_import_plans_status_expires_idx" ON "ai_import_plans" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_import_records_batch_sequence_uidx" ON "ai_import_records" USING btree ("batch_id","sequence");--> statement-breakpoint
CREATE INDEX "ai_import_records_batch_type_sequence_idx" ON "ai_import_records" USING btree ("batch_id","record_type","sequence");--> statement-breakpoint
CREATE FUNCTION "validate_ai_import_batch_plan_committed"()
RETURNS trigger
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_import_plans" AS plan
    WHERE plan."id" = NEW."plan_id"
      AND plan."status" = 'committed'
  ) THEN
    RAISE EXCEPTION 'AI import batch requires a committed plan'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ai_import_batches_committed_plan_check"
AFTER INSERT OR UPDATE OF "plan_id" ON "ai_import_batches"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_ai_import_batch_plan_committed"();--> statement-breakpoint
CREATE FUNCTION "validate_ai_import_plan_history_status"()
RETURNS trigger
AS $$
BEGIN
  IF NEW."status" <> 'committed'
    AND EXISTS (
      SELECT 1
      FROM "ai_import_batches" AS batch
      WHERE batch."plan_id" = NEW."id"
    )
  THEN
    RAISE EXCEPTION 'AI import history requires its plan to remain committed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ai_import_plans_history_status_check"
AFTER UPDATE OF "status" ON "ai_import_plans"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_ai_import_plan_history_status"();--> statement-breakpoint
INSERT INTO "mcp_settings" ("singleton_key", "access_token", "token_version")
VALUES (true, encode(gen_random_bytes(32), 'hex'), 1);
