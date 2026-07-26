ALTER TABLE "semantic_model_settings"
  DROP CONSTRAINT "semantic_model_settings_download_status_check",
  DROP CONSTRAINT "semantic_model_settings_downloaded_at_check";
--> statement-breakpoint
ALTER TABLE "semantic_index_state"
  DROP CONSTRAINT "semantic_index_state_status_check",
  DROP CONSTRAINT "semantic_index_state_progress_check";
--> statement-breakpoint
ALTER TABLE "semantic_jobs"
  DROP CONSTRAINT "semantic_jobs_job_type_check",
  DROP CONSTRAINT "semantic_jobs_status_check",
  DROP CONSTRAINT "semantic_jobs_entity_target_check",
  DROP CONSTRAINT "semantic_jobs_lease_check",
  DROP CONSTRAINT "semantic_jobs_terminal_timestamp_check";
--> statement-breakpoint
DROP INDEX "semantic_jobs_queue_claim_idx";
--> statement-breakpoint
ALTER TABLE "semantic_model_settings"
  ADD COLUMN "file_status" varchar(20),
  ADD COLUMN "failure_kind" varchar(20),
  ADD COLUMN "failure_code" varchar(100);
--> statement-breakpoint
UPDATE "semantic_model_settings"
SET "file_status" = "download_status",
    "failure_kind" = CASE
      WHEN "download_status" = 'failed' THEN 'manual'
      ELSE NULL
    END,
    "failure_code" = CASE
      WHEN "download_status" = 'failed' THEN 'LEGACY_DOWNLOAD_FAILURE'
      ELSE NULL
    END;
--> statement-breakpoint
ALTER TABLE "semantic_model_settings"
  ALTER COLUMN "file_status" SET DEFAULT 'not_downloaded',
  ALTER COLUMN "file_status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "semantic_index_state"
  ADD COLUMN "failed_items" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "failure_stage" varchar(20),
  ADD COLUMN "failure_kind" varchar(20),
  ADD COLUMN "failure_code" varchar(100);
--> statement-breakpoint
ALTER TABLE "semantic_jobs"
  ADD COLUMN "phase" varchar(20) DEFAULT 'waiting' NOT NULL,
  ADD COLUMN "next_attempt_at" timestamp with time zone,
  ADD COLUMN "failure_kind" varchar(20),
  ADD COLUMN "failure_code" varchar(100);
--> statement-breakpoint
DELETE FROM "semantic_jobs"
WHERE "status" = 'succeeded';
--> statement-breakpoint
DELETE FROM "semantic_jobs" AS "job"
WHERE NOT EXISTS (
  SELECT 1
  FROM "semantic_index_state" AS "state"
  WHERE "state"."singleton_key" = true
    AND "state"."active_model_code" = "job"."model_code"
    AND "state"."state_version" = "job"."state_version"
);
--> statement-breakpoint
WITH "ranked_high_level_failures" AS (
  SELECT
    "job"."id",
    row_number() OVER (
      ORDER BY "job"."completed_at" DESC NULLS LAST,
               "job"."created_at" DESC,
               "job"."id" DESC
    ) AS "failure_rank"
  FROM "semantic_jobs" AS "job"
  JOIN "semantic_index_state" AS "state"
    ON "state"."singleton_key" = true
   AND "state"."active_model_code" = "job"."model_code"
   AND "state"."state_version" = "job"."state_version"
  WHERE "job"."job_type" IN ('download', 'full_index')
    AND "job"."status" = 'failed'
)
DELETE FROM "semantic_jobs" AS "job"
USING "ranked_high_level_failures" AS "ranked"
WHERE "job"."id" = "ranked"."id"
  AND "ranked"."failure_rank" > 1;
--> statement-breakpoint
UPDATE "semantic_jobs"
SET "status" = 'queued',
    "phase" = 'waiting',
    "lease_owner" = NULL,
    "lease_expires_at" = NULL,
    "next_attempt_at" = NULL,
    "failure_kind" = NULL,
    "failure_code" = NULL,
    "error" = NULL,
    "started_at" = NULL,
    "completed_at" = NULL,
    "updated_at" = clock_timestamp()
WHERE "status" = 'running';
--> statement-breakpoint
UPDATE "semantic_jobs"
SET "lease_owner" = NULL,
    "lease_expires_at" = NULL,
    "next_attempt_at" = NULL
WHERE "status" <> 'running';
--> statement-breakpoint
UPDATE "semantic_jobs"
SET "phase" = CASE
      WHEN "status" = 'queued' THEN 'waiting'
      WHEN "job_type" = 'download' THEN 'downloading'
      ELSE 'indexing'
    END,
    "failure_kind" = CASE
      WHEN "status" = 'failed' THEN 'manual'
      ELSE NULL
    END,
    "failure_code" = CASE
      WHEN "status" <> 'failed' THEN NULL
      WHEN "job_type" = 'download' THEN 'LEGACY_DOWNLOAD_FAILURE'
      WHEN "job_type" = 'full_index' THEN 'LEGACY_FULL_INDEX_FAILURE'
      ELSE 'LEGACY_INCREMENTAL_FAILURE'
    END;
--> statement-breakpoint
UPDATE "semantic_index_state" AS "state"
SET "pending_items" = (
      SELECT count(*)::int
      FROM "semantic_jobs" AS "pending"
      WHERE "pending"."job_type" = 'incremental'
        AND "pending"."status" IN ('queued', 'running', 'retry_wait')
        AND "pending"."model_code" = "state"."active_model_code"
        AND "pending"."state_version" = "state"."state_version"
    ),
    "failed_items" = (
      SELECT count(*)::int
      FROM "semantic_jobs" AS "failed"
      WHERE "failed"."job_type" = 'incremental'
        AND "failed"."status" = 'failed'
        AND "failed"."model_code" = "state"."active_model_code"
        AND "failed"."state_version" = "state"."state_version"
    ),
    "status" = CASE
      WHEN EXISTS (
        SELECT 1
        FROM "semantic_jobs" AS "high_failure"
        WHERE "high_failure"."job_type" IN ('download', 'full_index')
          AND "high_failure"."status" = 'failed'
          AND "high_failure"."model_code" = "state"."active_model_code"
          AND "high_failure"."state_version" = "state"."state_version"
      ) THEN 'failed'
      WHEN "state"."status" IN ('ready', 'updating')
        AND EXISTS (
          SELECT 1
          FROM "semantic_jobs" AS "incremental_failure"
          WHERE "incremental_failure"."job_type" = 'incremental'
            AND "incremental_failure"."status" = 'failed'
            AND "incremental_failure"."model_code" = "state"."active_model_code"
            AND "incremental_failure"."state_version" = "state"."state_version"
        ) THEN 'incomplete'
      ELSE "state"."status"
    END,
    "failure_stage" = CASE
      WHEN EXISTS (
        SELECT 1
        FROM "semantic_jobs" AS "download_failure"
        WHERE "download_failure"."job_type" = 'download'
          AND "download_failure"."status" = 'failed'
          AND "download_failure"."model_code" = "state"."active_model_code"
          AND "download_failure"."state_version" = "state"."state_version"
      ) THEN 'download'
      WHEN EXISTS (
        SELECT 1
        FROM "semantic_jobs" AS "full_failure"
        WHERE "full_failure"."job_type" = 'full_index'
          AND "full_failure"."status" = 'failed'
          AND "full_failure"."model_code" = "state"."active_model_code"
          AND "full_failure"."state_version" = "state"."state_version"
      ) THEN 'full_index'
      WHEN EXISTS (
        SELECT 1
        FROM "semantic_jobs" AS "incremental_failure"
        WHERE "incremental_failure"."job_type" = 'incremental'
          AND "incremental_failure"."status" = 'failed'
          AND "incremental_failure"."model_code" = "state"."active_model_code"
          AND "incremental_failure"."state_version" = "state"."state_version"
      ) THEN 'incremental'
      WHEN "state"."status" = 'failed' THEN 'full_index'
      ELSE NULL
    END,
    "failure_kind" = CASE
      WHEN "state"."status" = 'failed'
        OR EXISTS (
          SELECT 1
          FROM "semantic_jobs" AS "failure"
          WHERE "failure"."status" = 'failed'
            AND "failure"."model_code" = "state"."active_model_code"
            AND "failure"."state_version" = "state"."state_version"
        ) THEN 'manual'
      ELSE NULL
    END,
    "failure_code" = CASE
      WHEN EXISTS (
        SELECT 1
        FROM "semantic_jobs" AS "download_failure"
        WHERE "download_failure"."job_type" = 'download'
          AND "download_failure"."status" = 'failed'
          AND "download_failure"."model_code" = "state"."active_model_code"
          AND "download_failure"."state_version" = "state"."state_version"
      ) THEN 'LEGACY_DOWNLOAD_FAILURE'
      WHEN EXISTS (
        SELECT 1
        FROM "semantic_jobs" AS "full_failure"
        WHERE "full_failure"."job_type" = 'full_index'
          AND "full_failure"."status" = 'failed'
          AND "full_failure"."model_code" = "state"."active_model_code"
          AND "full_failure"."state_version" = "state"."state_version"
      ) THEN 'LEGACY_FULL_INDEX_FAILURE'
      WHEN EXISTS (
        SELECT 1
        FROM "semantic_jobs" AS "incremental_failure"
        WHERE "incremental_failure"."job_type" = 'incremental'
          AND "incremental_failure"."status" = 'failed'
          AND "incremental_failure"."model_code" = "state"."active_model_code"
          AND "incremental_failure"."state_version" = "state"."state_version"
      ) THEN 'LEGACY_INCREMENTAL_FAILURE'
      WHEN "state"."status" = 'failed' THEN 'LEGACY_INDEX_FAILURE'
      ELSE NULL
    END,
    "error" = CASE
      WHEN "state"."status" IN ('ready', 'updating')
        AND EXISTS (
          SELECT 1
          FROM "semantic_jobs" AS "incremental_failure"
          WHERE "incremental_failure"."job_type" = 'incremental'
            AND "incremental_failure"."status" = 'failed'
            AND "incremental_failure"."model_code" = "state"."active_model_code"
            AND "incremental_failure"."state_version" = "state"."state_version"
        )
      THEN (
        SELECT "incremental_failure"."error"
        FROM "semantic_jobs" AS "incremental_failure"
        WHERE "incremental_failure"."job_type" = 'incremental'
          AND "incremental_failure"."status" = 'failed'
          AND "incremental_failure"."model_code" = "state"."active_model_code"
          AND "incremental_failure"."state_version" = "state"."state_version"
        ORDER BY "incremental_failure"."completed_at" DESC NULLS LAST,
                 "incremental_failure"."created_at" DESC,
                 "incremental_failure"."id" DESC
        LIMIT 1
      )
      ELSE "state"."error"
    END,
    "updated_at" = clock_timestamp()
WHERE "state"."singleton_key" = true;
--> statement-breakpoint
ALTER TABLE "semantic_model_settings"
  DROP COLUMN "download_status";
--> statement-breakpoint
CREATE INDEX "semantic_jobs_queue_claim_idx"
ON "semantic_jobs" ("status", "next_attempt_at", "created_at", "id")
WHERE "status" IN ('queued', 'running', 'retry_wait');
--> statement-breakpoint
ALTER TABLE "semantic_model_settings"
  ADD CONSTRAINT "semantic_model_settings_file_status_check"
  CHECK ("file_status" IN (
    'not_downloaded',
    'download_queued',
    'downloading',
    'verifying',
    'downloaded',
    'invalid',
    'failed'
  )) NOT VALID,
  ADD CONSTRAINT "semantic_model_settings_downloaded_at_check"
  CHECK (
    ("file_status" = 'downloaded' AND "downloaded_at" IS NOT NULL)
    OR ("file_status" <> 'downloaded' AND "downloaded_at" IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT "semantic_model_settings_failure_kind_check"
  CHECK ("failure_kind" IS NULL OR "failure_kind" IN ('retryable', 'manual')) NOT VALID,
  ADD CONSTRAINT "semantic_model_settings_failure_metadata_check"
  CHECK (
    ("failure_kind" IS NULL AND "failure_code" IS NULL)
    OR ("failure_kind" IS NOT NULL AND "failure_code" IS NOT NULL)
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "semantic_index_state"
  ADD CONSTRAINT "semantic_index_state_status_check"
  CHECK ("status" IN (
    'empty',
    'waiting_model',
    'loading',
    'index_queued',
    'building',
    'ready',
    'updating',
    'incomplete',
    'failed'
  )) NOT VALID,
  ADD CONSTRAINT "semantic_index_state_progress_check"
  CHECK (
    "state_version" >= 0
    AND "processed_items" >= 0
    AND "total_items" >= 0
    AND "pending_items" >= 0
    AND "failed_items" >= 0
    AND "processed_items" <= "total_items"
  ) NOT VALID,
  ADD CONSTRAINT "semantic_index_state_failure_stage_check"
  CHECK (
    "failure_stage" IS NULL
    OR "failure_stage" IN ('download', 'verify', 'load', 'full_index', 'incremental')
  ) NOT VALID,
  ADD CONSTRAINT "semantic_index_state_failure_kind_check"
  CHECK ("failure_kind" IS NULL OR "failure_kind" IN ('retryable', 'manual')) NOT VALID,
  ADD CONSTRAINT "semantic_index_state_failure_metadata_check"
  CHECK (
    ("failure_stage" IS NULL AND "failure_kind" IS NULL AND "failure_code" IS NULL)
    OR ("failure_stage" IS NOT NULL AND "failure_kind" IS NOT NULL AND "failure_code" IS NOT NULL)
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "semantic_jobs"
  ADD CONSTRAINT "semantic_jobs_job_type_check"
  CHECK ("job_type" IN ('download', 'load', 'full_index', 'incremental')) NOT VALID,
  ADD CONSTRAINT "semantic_jobs_status_check"
  CHECK ("status" IN ('queued', 'running', 'retry_wait', 'failed')) NOT VALID,
  ADD CONSTRAINT "semantic_jobs_phase_check"
  CHECK ("phase" IN ('waiting', 'downloading', 'verifying', 'loading', 'indexing')) NOT VALID,
  ADD CONSTRAINT "semantic_jobs_entity_target_check"
  CHECK (
    ("job_type" = 'incremental' AND "entity_type" IS NOT NULL AND "entity_id" IS NOT NULL)
    OR ("job_type" IN ('download', 'load', 'full_index') AND "entity_type" IS NULL AND "entity_id" IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT "semantic_jobs_lease_check"
  CHECK (
    ("status" = 'running' AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'running' AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT "semantic_jobs_terminal_timestamp_check"
  CHECK (
    ("status" = 'queued' AND "started_at" IS NULL AND "completed_at" IS NULL AND "next_attempt_at" IS NULL)
    OR ("status" = 'running' AND "started_at" IS NOT NULL AND "completed_at" IS NULL AND "next_attempt_at" IS NULL)
    OR ("status" = 'retry_wait' AND "started_at" IS NOT NULL AND "completed_at" IS NULL AND "next_attempt_at" IS NOT NULL)
    OR ("status" = 'failed' AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "next_attempt_at" IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT "semantic_jobs_failure_kind_check"
  CHECK ("failure_kind" IS NULL OR "failure_kind" IN ('retryable', 'manual')) NOT VALID,
  ADD CONSTRAINT "semantic_jobs_failure_metadata_check"
  CHECK (
    ("failure_kind" IS NULL AND "failure_code" IS NULL)
    OR ("failure_kind" IS NOT NULL AND "failure_code" IS NOT NULL)
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "semantic_model_settings"
  VALIDATE CONSTRAINT "semantic_model_settings_file_status_check",
  VALIDATE CONSTRAINT "semantic_model_settings_downloaded_at_check",
  VALIDATE CONSTRAINT "semantic_model_settings_failure_kind_check",
  VALIDATE CONSTRAINT "semantic_model_settings_failure_metadata_check";
--> statement-breakpoint
ALTER TABLE "semantic_index_state"
  VALIDATE CONSTRAINT "semantic_index_state_status_check",
  VALIDATE CONSTRAINT "semantic_index_state_progress_check",
  VALIDATE CONSTRAINT "semantic_index_state_failure_stage_check",
  VALIDATE CONSTRAINT "semantic_index_state_failure_kind_check",
  VALIDATE CONSTRAINT "semantic_index_state_failure_metadata_check";
--> statement-breakpoint
ALTER TABLE "semantic_jobs"
  VALIDATE CONSTRAINT "semantic_jobs_job_type_check",
  VALIDATE CONSTRAINT "semantic_jobs_status_check",
  VALIDATE CONSTRAINT "semantic_jobs_phase_check",
  VALIDATE CONSTRAINT "semantic_jobs_entity_target_check",
  VALIDATE CONSTRAINT "semantic_jobs_lease_check",
  VALIDATE CONSTRAINT "semantic_jobs_terminal_timestamp_check",
  VALIDATE CONSTRAINT "semantic_jobs_failure_kind_check",
  VALIDATE CONSTRAINT "semantic_jobs_failure_metadata_check";
