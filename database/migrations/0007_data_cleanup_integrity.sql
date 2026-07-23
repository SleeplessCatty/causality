CREATE TABLE "data_check_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"severity" varchar(10) NOT NULL,
	"issue_type" varchar(80) NOT NULL,
	"description" varchar(300) NOT NULL,
	"suggestion" varchar(300) NOT NULL,
	"action_mode" varchar(10) NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" varchar(100) NOT NULL,
	"related_id" varchar(100),
	"handled_at" timestamp with time zone,
	CONSTRAINT "data_check_issues_severity_check" CHECK ("data_check_issues"."severity" in ('error', 'warning')),
	CONSTRAINT "data_check_issues_action_mode_check" CHECK ("data_check_issues"."action_mode" in ('auto', 'manual')),
	CONSTRAINT "data_check_issues_status_check" CHECK ("data_check_issues"."status" in ('open', 'handled')),
	CONSTRAINT "data_check_issues_target_type_check" CHECK ("data_check_issues"."target_type" in ('event', 'relation', 'case', 'alias', 'keyword', 'relation_case')),
	CONSTRAINT "data_check_issues_issue_type_check" CHECK (char_length(btrim("data_check_issues"."issue_type")) between 1 and 80),
	CONSTRAINT "data_check_issues_description_check" CHECK (char_length(btrim("data_check_issues"."description")) between 1 and 300),
	CONSTRAINT "data_check_issues_suggestion_check" CHECK (char_length(btrim("data_check_issues"."suggestion")) between 1 and 300),
	CONSTRAINT "data_check_issues_target_id_check" CHECK (char_length(btrim("data_check_issues"."target_id")) between 1 and 100),
	CONSTRAINT "data_check_issues_related_id_check" CHECK ("data_check_issues"."related_id" is null
        or char_length(btrim("data_check_issues"."related_id")) between 1 and 100),
	CONSTRAINT "data_check_issues_handled_at_check" CHECK (("data_check_issues"."status" = 'open' and "data_check_issues"."handled_at" is null)
        or ("data_check_issues"."status" = 'handled' and "data_check_issues"."handled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "data_check_state" (
	"singleton_key" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"status" varchar(20) DEFAULT 'never_run' NOT NULL,
	"attempt_started_at" timestamp with time zone,
	"attempt_finished_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_message" varchar(500),
	"last_snapshot_id" uuid,
	"last_success_at" timestamp with time zone,
	"orphan_event_count" integer DEFAULT 0 NOT NULL,
	"orphan_relation_count" integer DEFAULT 0 NOT NULL,
	"orphan_case_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"handled_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "data_check_state_singleton_check" CHECK ("data_check_state"."singleton_key" = true),
	CONSTRAINT "data_check_state_status_check" CHECK ("data_check_state"."status" in ('never_run', 'running', 'succeeded', 'failed')),
	CONSTRAINT "data_check_state_counts_check" CHECK ("data_check_state"."orphan_event_count" >= 0
        and "data_check_state"."orphan_relation_count" >= 0
        and "data_check_state"."orphan_case_count" >= 0
        and "data_check_state"."error_count" >= 0
        and "data_check_state"."warning_count" >= 0
        and "data_check_state"."open_count" >= 0
        and "data_check_state"."handled_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "data_check_issues_snapshot_filter_idx" ON "data_check_issues" USING btree ("snapshot_id","severity","issue_type","status","id");--> statement-breakpoint
CREATE INDEX "data_check_issues_snapshot_status_idx" ON "data_check_issues" USING btree ("snapshot_id","status","id");--> statement-breakpoint
INSERT INTO "data_check_state" ("singleton_key")
VALUES (true)
ON CONFLICT ("singleton_key") DO NOTHING;
