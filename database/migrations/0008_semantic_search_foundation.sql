CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "semantic_embeddings" (
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"model_code" varchar(64) NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"embedding" vector NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semantic_embeddings_entity_pk" PRIMARY KEY("entity_type","entity_id"),
	CONSTRAINT "semantic_embeddings_entity_type_check" CHECK ("semantic_embeddings"."entity_type" in ('event', 'relation', 'case')),
	CONSTRAINT "semantic_embeddings_model_code_check" CHECK ("semantic_embeddings"."model_code" in ('multilingual-e5-small', 'bge-m3')),
	CONSTRAINT "semantic_embeddings_source_hash_check" CHECK ("semantic_embeddings"."source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "semantic_embeddings_dimension_check" CHECK (("semantic_embeddings"."model_code" = 'multilingual-e5-small' and vector_dims("semantic_embeddings"."embedding") = 384)
        or ("semantic_embeddings"."model_code" = 'bge-m3' and vector_dims("semantic_embeddings"."embedding") = 1024))
);
--> statement-breakpoint
CREATE TABLE "semantic_index_state" (
	"singleton_key" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"active_model_code" varchar(64),
	"status" varchar(20) DEFAULT 'empty' NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"pending_items" integer DEFAULT 0 NOT NULL,
	"error" text,
	"last_ready_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semantic_index_state_singleton_check" CHECK ("semantic_index_state"."singleton_key" = true),
	CONSTRAINT "semantic_index_state_status_check" CHECK ("semantic_index_state"."status" in (
        'empty',
        'waiting_model',
        'loading',
        'building',
        'updating',
        'ready',
        'failed'
      )),
	CONSTRAINT "semantic_index_state_progress_check" CHECK ("semantic_index_state"."state_version" >= 0
        and "semantic_index_state"."processed_items" >= 0
        and "semantic_index_state"."total_items" >= 0
        and "semantic_index_state"."pending_items" >= 0
        and "semantic_index_state"."processed_items" <= "semantic_index_state"."total_items"),
	CONSTRAINT "semantic_index_state_active_model_check" CHECK (("semantic_index_state"."active_model_code" is null and "semantic_index_state"."status" = 'empty')
        or "semantic_index_state"."active_model_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "semantic_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(20) NOT NULL,
	"model_code" varchar(64) NOT NULL,
	"entity_type" varchar(20),
	"entity_id" uuid,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"state_version" integer NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"downloaded_bytes" integer DEFAULT 0 NOT NULL,
	"total_bytes" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(100),
	"lease_expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "semantic_jobs_job_type_check" CHECK ("semantic_jobs"."job_type" in ('download', 'full_index', 'incremental')),
	CONSTRAINT "semantic_jobs_entity_type_check" CHECK ("semantic_jobs"."entity_type" is null or "semantic_jobs"."entity_type" in ('event', 'relation', 'case')),
	CONSTRAINT "semantic_jobs_status_check" CHECK ("semantic_jobs"."status" in ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "semantic_jobs_entity_target_check" CHECK (("semantic_jobs"."job_type" = 'incremental'
          and "semantic_jobs"."entity_type" is not null
          and "semantic_jobs"."entity_id" is not null)
        or ("semantic_jobs"."job_type" in ('download', 'full_index')
          and "semantic_jobs"."entity_type" is null
          and "semantic_jobs"."entity_id" is null)),
	CONSTRAINT "semantic_jobs_progress_check" CHECK ("semantic_jobs"."state_version" >= 0
        and "semantic_jobs"."processed_items" >= 0
        and "semantic_jobs"."total_items" >= 0
        and "semantic_jobs"."processed_items" <= "semantic_jobs"."total_items"
        and "semantic_jobs"."downloaded_bytes" >= 0
        and "semantic_jobs"."total_bytes" >= 0
        and "semantic_jobs"."downloaded_bytes" <= "semantic_jobs"."total_bytes"
        and "semantic_jobs"."attempts" >= 0),
	CONSTRAINT "semantic_jobs_lease_check" CHECK (("semantic_jobs"."status" = 'running'
          and "semantic_jobs"."lease_owner" is not null
          and "semantic_jobs"."lease_expires_at" is not null)
        or ("semantic_jobs"."status" <> 'running')),
	CONSTRAINT "semantic_jobs_terminal_timestamp_check" CHECK (("semantic_jobs"."status" = 'queued'
          and "semantic_jobs"."started_at" is null
          and "semantic_jobs"."completed_at" is null)
        or ("semantic_jobs"."status" = 'running'
          and "semantic_jobs"."started_at" is not null
          and "semantic_jobs"."completed_at" is null)
        or ("semantic_jobs"."status" in ('succeeded', 'failed')
          and "semantic_jobs"."started_at" is not null
          and "semantic_jobs"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "semantic_model_settings" (
	"model_code" varchar(64) PRIMARY KEY NOT NULL,
	"revision" varchar(64) NOT NULL,
	"threshold" smallint NOT NULL,
	"download_status" varchar(20) DEFAULT 'not_downloaded' NOT NULL,
	"downloaded_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semantic_model_settings_model_code_check" CHECK ("semantic_model_settings"."model_code" in ('multilingual-e5-small', 'bge-m3')),
	CONSTRAINT "semantic_model_settings_threshold_check" CHECK ("semantic_model_settings"."threshold" between 0 and 100),
	CONSTRAINT "semantic_model_settings_download_status_check" CHECK ("semantic_model_settings"."download_status" in (
        'not_downloaded',
        'downloading',
        'verifying',
        'downloaded',
        'failed'
      )),
	CONSTRAINT "semantic_model_settings_downloaded_at_check" CHECK (("semantic_model_settings"."download_status" = 'downloaded' and "semantic_model_settings"."downloaded_at" is not null)
        or ("semantic_model_settings"."download_status" <> 'downloaded' and "semantic_model_settings"."downloaded_at" is null))
);
--> statement-breakpoint
ALTER TABLE "semantic_embeddings" ADD CONSTRAINT "semantic_embeddings_model_code_semantic_model_settings_model_code_fk" FOREIGN KEY ("model_code") REFERENCES "public"."semantic_model_settings"("model_code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_index_state" ADD CONSTRAINT "semantic_index_state_active_model_code_semantic_model_settings_model_code_fk" FOREIGN KEY ("active_model_code") REFERENCES "public"."semantic_model_settings"("model_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_jobs" ADD CONSTRAINT "semantic_jobs_model_code_semantic_model_settings_model_code_fk" FOREIGN KEY ("model_code") REFERENCES "public"."semantic_model_settings"("model_code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "semantic_jobs_incremental_queued_uidx" ON "semantic_jobs" USING btree ("entity_type","entity_id") WHERE "semantic_jobs"."job_type" = 'incremental' and "semantic_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "semantic_jobs_queue_claim_idx" ON "semantic_jobs" USING btree ("status","created_at","id") WHERE "semantic_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "semantic_jobs_model_status_idx" ON "semantic_jobs" USING btree ("model_code","status","created_at");
--> statement-breakpoint
INSERT INTO "semantic_model_settings"
  ("model_code", "revision", "threshold")
VALUES
  (
    'multilingual-e5-small',
    '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    70
  ),
  (
    'bge-m3',
    '25b9af8e87a38eb120cfe87125383677b9cd309e',
    55
  )
ON CONFLICT ("model_code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "semantic_index_state" ("singleton_key")
VALUES (true)
ON CONFLICT ("singleton_key") DO NOTHING;
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_event_e5_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(384)) vector_cosine_ops)
WHERE "model_code" = 'multilingual-e5-small' AND "entity_type" = 'event';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_relation_e5_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(384)) vector_cosine_ops)
WHERE "model_code" = 'multilingual-e5-small' AND "entity_type" = 'relation';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_case_e5_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(384)) vector_cosine_ops)
WHERE "model_code" = 'multilingual-e5-small' AND "entity_type" = 'case';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_event_bge_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(1024)) vector_cosine_ops)
WHERE "model_code" = 'bge-m3' AND "entity_type" = 'event';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_relation_bge_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(1024)) vector_cosine_ops)
WHERE "model_code" = 'bge-m3' AND "entity_type" = 'relation';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_case_bge_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(1024)) vector_cosine_ops)
WHERE "model_code" = 'bge-m3' AND "entity_type" = 'case';
