CREATE TABLE "abstract_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"normalized_name" varchar(120) GENERATED ALWAYS AS (lower(btrim(name))) STORED NOT NULL,
	"description" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abstract_events_name_length_check" CHECK (char_length(btrim("abstract_events"."name")) between 1 and 120),
	CONSTRAINT "abstract_events_description_check" CHECK ("abstract_events"."description" is null or char_length(btrim("abstract_events"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "causal_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cause_event_id" uuid NOT NULL,
	"effect_event_id" uuid NOT NULL,
	"confidence" smallint NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "causal_relations_no_self_loop_check" CHECK ("causal_relations"."cause_event_id" <> "causal_relations"."effect_event_id"),
	CONSTRAINT "causal_relations_confidence_check" CHECK ("causal_relations"."confidence" between 0 and 100),
	CONSTRAINT "causal_relations_description_check" CHECK ("causal_relations"."description" is null or char_length(btrim("causal_relations"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "concrete_causal_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"causal_relation_id" uuid NOT NULL,
	"cause_event" text NOT NULL,
	"effect_event" text NOT NULL,
	"cause_occurred_at" timestamp with time zone NOT NULL,
	"effect_occurred_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concrete_cases_time_order_check" CHECK ("concrete_causal_cases"."effect_occurred_at" >= "concrete_causal_cases"."cause_occurred_at"),
	CONSTRAINT "concrete_cases_cause_event_check" CHECK (char_length(btrim("concrete_causal_cases"."cause_event")) > 0),
	CONSTRAINT "concrete_cases_effect_event_check" CHECK (char_length(btrim("concrete_causal_cases"."effect_event")) > 0),
	CONSTRAINT "concrete_cases_description_check" CHECK (char_length(btrim("concrete_causal_cases"."description")) > 0),
	CONSTRAINT "concrete_cases_source_check" CHECK (char_length(btrim("concrete_causal_cases"."source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "event_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"alias" varchar(120) NOT NULL,
	"normalized_alias" varchar(120) GENERATED ALWAYS AS (lower(btrim(alias))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_aliases_alias_length_check" CHECK (char_length(btrim("event_aliases"."alias")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "causal_relations" ADD CONSTRAINT "causal_relations_cause_event_id_abstract_events_id_fk" FOREIGN KEY ("cause_event_id") REFERENCES "public"."abstract_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_relations" ADD CONSTRAINT "causal_relations_effect_event_id_abstract_events_id_fk" FOREIGN KEY ("effect_event_id") REFERENCES "public"."abstract_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concrete_causal_cases" ADD CONSTRAINT "concrete_causal_cases_causal_relation_id_causal_relations_id_fk" FOREIGN KEY ("causal_relation_id") REFERENCES "public"."causal_relations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_aliases" ADD CONSTRAINT "event_aliases_event_id_abstract_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."abstract_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "abstract_events_normalized_name_uidx" ON "abstract_events" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "causal_relations_direction_uidx" ON "causal_relations" USING btree ("cause_event_id","effect_event_id");--> statement-breakpoint
CREATE INDEX "causal_relations_cause_event_id_idx" ON "causal_relations" USING btree ("cause_event_id");--> statement-breakpoint
CREATE INDEX "causal_relations_effect_event_id_idx" ON "causal_relations" USING btree ("effect_event_id");--> statement-breakpoint
CREATE INDEX "concrete_cases_relation_effect_time_idx" ON "concrete_causal_cases" USING btree ("causal_relation_id","effect_occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "event_aliases_event_normalized_uidx" ON "event_aliases" USING btree ("event_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "event_aliases_event_id_idx" ON "event_aliases" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_aliases_normalized_alias_idx" ON "event_aliases" USING btree ("normalized_alias");