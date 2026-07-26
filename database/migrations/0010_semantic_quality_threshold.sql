UPDATE "semantic_model_settings"
SET "threshold" = 80,
    "updated_at" = clock_timestamp()
WHERE "model_code" = 'multilingual-e5-small'
  AND "threshold" = 70;
