ALTER TABLE "ai_import_batches" ADD COLUMN "relation_case_reused" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "ai_import_batches" AS batch
SET "relation_case_reused" = history.reused_count
FROM (
  SELECT "batch_id", count(*)::integer AS reused_count
  FROM "ai_import_records"
  WHERE "record_type" = 'relation_case'
    AND "action" = 'reused'
  GROUP BY "batch_id"
) AS history
WHERE history."batch_id" = batch."id";--> statement-breakpoint
ALTER TABLE "ai_import_batches" ALTER COLUMN "relation_case_reused" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai_import_batches" DROP CONSTRAINT "ai_import_batches_counts_check";--> statement-breakpoint
ALTER TABLE "ai_import_batches" ADD CONSTRAINT "ai_import_batches_counts_check" CHECK ("ai_import_batches"."event_created" >= 0
        and "ai_import_batches"."event_reused" >= 0
        and "ai_import_batches"."event_updated" >= 0
        and "ai_import_batches"."case_created" >= 0
        and "ai_import_batches"."case_reused" >= 0
        and "ai_import_batches"."relation_created" >= 0
        and "ai_import_batches"."relation_reused" >= 0
        and "ai_import_batches"."relation_case_created" >= 0
        and "ai_import_batches"."relation_case_reused" >= 0
        and "ai_import_batches"."confidence_changed" >= 0);--> statement-breakpoint
UPDATE "ai_import_plans" AS plan
SET "result_payload" = jsonb_set(
  plan."result_payload",
  '{counts,relationCaseReused}',
  to_jsonb(batch."relation_case_reused"),
  true
)
FROM "ai_import_batches" AS batch
WHERE batch."plan_id" = plan."id"
  AND plan."result_payload" IS NOT NULL;
