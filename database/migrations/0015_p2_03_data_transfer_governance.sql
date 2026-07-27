CREATE TABLE "export_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"export_type" varchar(10) NOT NULL,
	"start_event_ids" uuid[] DEFAULT '{}' NOT NULL,
	"direction" varchar(10),
	"depth" smallint,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "export_requests_token_hash_check" CHECK ("export_requests"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "export_requests_type_check" CHECK ("export_requests"."export_type" in ('full', 'filtered')),
	CONSTRAINT "export_requests_direction_check" CHECK ("export_requests"."direction" is null or "export_requests"."direction" in ('upstream', 'downstream', 'both')),
	CONSTRAINT "export_requests_scope_check" CHECK ((
          "export_requests"."export_type" = 'full'
          and cardinality("export_requests"."start_event_ids") = 0
          and "export_requests"."direction" is null
          and "export_requests"."depth" is null
        ) or (
          "export_requests"."export_type" = 'filtered'
          and cardinality("export_requests"."start_event_ids") between 1 and 100
          and "export_requests"."direction" is not null
          and "export_requests"."depth" between 1 and 10
        )),
	CONSTRAINT "export_requests_expiry_check" CHECK ("export_requests"."expires_at" > "export_requests"."created_at")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" varchar(255) NOT NULL,
	"completed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"record_types" varchar(20)[] NOT NULL,
	"event_created" integer NOT NULL,
	"event_reused" integer NOT NULL,
	"case_created" integer NOT NULL,
	"case_reused" integer NOT NULL,
	"relation_created" integer NOT NULL,
	"relation_reused" integer NOT NULL,
	"relation_case_created" integer NOT NULL,
	"relation_case_reused" integer NOT NULL,
	CONSTRAINT "import_batches_filename_check" CHECK (char_length(btrim("import_batches"."filename")) between 1 and 255
        and "import_batches"."filename" !~ '[[:cntrl:]]'),
	CONSTRAINT "import_batches_record_types_check" CHECK (cardinality("import_batches"."record_types") between 1 and 4
        and "import_batches"."record_types" <@ array['event', 'case', 'relation', 'relation_case']::varchar[]),
	CONSTRAINT "import_batches_counts_check" CHECK ("import_batches"."event_created" >= 0
        and "import_batches"."event_reused" >= 0
        and "import_batches"."case_created" >= 0
        and "import_batches"."case_reused" >= 0
        and "import_batches"."relation_created" >= 0
        and "import_batches"."relation_reused" >= 0
        and "import_batches"."relation_case_created" >= 0
        and "import_batches"."relation_case_reused" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_sequence" integer NOT NULL,
	"item_sequence" integer NOT NULL,
	"record_type" varchar(20) NOT NULL,
	"outcome" varchar(10) NOT NULL,
	"primary_record_id" uuid NOT NULL,
	"related_record_id" uuid,
	"text_snapshot" jsonb NOT NULL,
	CONSTRAINT "import_records_sequence_check" CHECK ("import_records"."source_sequence" > 0 and "import_records"."item_sequence" > 0),
	CONSTRAINT "import_records_record_type_check" CHECK ("import_records"."record_type" in ('event', 'case', 'relation', 'relation_case')),
	CONSTRAINT "import_records_outcome_check" CHECK ("import_records"."outcome" in ('created', 'reused')),
	CONSTRAINT "import_records_related_record_check" CHECK (("import_records"."record_type" = 'relation_case' and "import_records"."related_record_id" is not null)
        or ("import_records"."record_type" <> 'relation_case' and "import_records"."related_record_id" is null)),
	CONSTRAINT "import_records_text_snapshot_check" CHECK (jsonb_typeof("import_records"."text_snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "data_check_state" ADD COLUMN "semantic_status" varchar(20);--> statement-breakpoint
ALTER TABLE "data_check_state" ADD COLUMN "semantic_reason" varchar(30);--> statement-breakpoint
ALTER TABLE "semantic_model_settings" ADD COLUMN "dedupe_threshold" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "export_requests_token_hash_uidx" ON "export_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "export_requests_expires_at_idx" ON "export_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "import_batches_completed_id_idx" ON "import_batches" USING btree ("completed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "import_records_batch_source_item_sequence_uidx" ON "import_records" USING btree ("batch_id","source_sequence","item_sequence");--> statement-breakpoint
CREATE INDEX "import_records_batch_type_sequence_idx" ON "import_records" USING btree ("batch_id","record_type","source_sequence","item_sequence");--> statement-breakpoint
UPDATE "data_check_state"
SET
  "semantic_status" = 'skipped',
  "semantic_reason" = 'not_recorded'
WHERE "last_snapshot_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "data_check_state" ADD CONSTRAINT "data_check_state_semantic_snapshot_check" CHECK ((
          "data_check_state"."last_snapshot_id" is null
          and "data_check_state"."semantic_status" is null
          and "data_check_state"."semantic_reason" is null
        ) or (
          "data_check_state"."last_snapshot_id" is not null
          and "data_check_state"."semantic_status" is not null
          and (
            ("data_check_state"."semantic_status" = 'completed' and "data_check_state"."semantic_reason" is null)
            or (
              "data_check_state"."semantic_status" = 'truncated'
              and "data_check_state"."semantic_reason" = 'candidate_limit'
            )
            or (
              "data_check_state"."semantic_status" = 'failed'
              and "data_check_state"."semantic_reason" = 'internal_failure'
            )
            or (
              "data_check_state"."semantic_status" = 'skipped'
              and "data_check_state"."semantic_reason" in (
                'not_recorded',
                'no_active_model',
                'worker_unreachable',
                'index_not_ready',
                'no_embeddings'
              )
            )
          )
        ));--> statement-breakpoint
ALTER TABLE "semantic_model_settings" ADD CONSTRAINT "semantic_model_settings_dedupe_threshold_check" CHECK ("semantic_model_settings"."dedupe_threshold" between 0 and 100);
