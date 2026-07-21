CREATE TABLE "causal_relation_cases" (
	"causal_relation_id" uuid NOT NULL,
	"concrete_case_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "causal_relation_cases_causal_relation_id_concrete_case_id_pk" PRIMARY KEY("causal_relation_id","concrete_case_id")
);
--> statement-breakpoint
CREATE TABLE "concrete_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concrete_cases_content_check" CHECK ("concrete_cases"."content" = btrim("concrete_cases"."content") and char_length("concrete_cases"."content") between 1 and 50)
);
--> statement-breakpoint
DROP TABLE "concrete_causal_cases" CASCADE;--> statement-breakpoint
ALTER TABLE "causal_relation_cases" ADD CONSTRAINT "causal_relation_cases_causal_relation_id_causal_relations_id_fk" FOREIGN KEY ("causal_relation_id") REFERENCES "public"."causal_relations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_relation_cases" ADD CONSTRAINT "causal_relation_cases_concrete_case_id_concrete_cases_id_fk" FOREIGN KEY ("concrete_case_id") REFERENCES "public"."concrete_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "causal_relation_cases_relation_linked_idx" ON "causal_relation_cases" USING btree ("causal_relation_id","linked_at" DESC NULLS LAST,"concrete_case_id");--> statement-breakpoint
CREATE INDEX "causal_relation_cases_case_linked_idx" ON "causal_relation_cases" USING btree ("concrete_case_id","linked_at" DESC NULLS LAST,"causal_relation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concrete_cases_content_uidx" ON "concrete_cases" USING btree ("content");--> statement-breakpoint
CREATE INDEX "concrete_cases_content_trgm_idx" ON "concrete_cases" USING gin (lower("content") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "concrete_cases_updated_at_id_idx" ON "concrete_cases" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);