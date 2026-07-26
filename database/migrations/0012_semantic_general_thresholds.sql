UPDATE "semantic_model_settings"
SET "threshold" = 90,
    "updated_at" = clock_timestamp()
WHERE "model_code" = 'multilingual-e5-small'
  AND "threshold" = 80;
--> statement-breakpoint
UPDATE "semantic_model_settings"
SET "threshold" = 80,
    "updated_at" = clock_timestamp()
WHERE "model_code" = 'granite-embedding-97m-multilingual-r2'
  AND "threshold" = 60;
