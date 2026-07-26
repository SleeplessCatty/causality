ALTER TABLE "semantic_embeddings"
  DROP CONSTRAINT "semantic_embeddings_model_code_check";
--> statement-breakpoint
ALTER TABLE "semantic_embeddings"
  DROP CONSTRAINT "semantic_embeddings_dimension_check";
--> statement-breakpoint
ALTER TABLE "semantic_model_settings"
  DROP CONSTRAINT "semantic_model_settings_model_code_check";
--> statement-breakpoint
INSERT INTO "semantic_model_settings"
  ("model_code", "revision", "threshold")
VALUES
  (
    'bge-small-zh-v1.5',
    '75c43b069aac4d136ba6bc1122f995fedcfd2781',
    62
  ),
  (
    'granite-embedding-97m-multilingual-r2',
    '536a9f241cb3f02a9c5995a1e708c784bd274859',
    60
  )
ON CONFLICT ("model_code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "semantic_model_settings"
  ADD CONSTRAINT "semantic_model_settings_model_code_check"
  CHECK ("model_code" in (
    'bge-small-zh-v1.5',
    'multilingual-e5-small',
    'granite-embedding-97m-multilingual-r2',
    'bge-m3'
  ));
--> statement-breakpoint
ALTER TABLE "semantic_embeddings"
  ADD CONSTRAINT "semantic_embeddings_model_code_check"
  CHECK ("model_code" in (
    'bge-small-zh-v1.5',
    'multilingual-e5-small',
    'granite-embedding-97m-multilingual-r2',
    'bge-m3'
  ));
--> statement-breakpoint
ALTER TABLE "semantic_embeddings"
  ADD CONSTRAINT "semantic_embeddings_dimension_check"
  CHECK (
    ("model_code" = 'bge-small-zh-v1.5' and vector_dims("embedding") = 512)
    or (
      "model_code" in ('multilingual-e5-small', 'granite-embedding-97m-multilingual-r2')
      and vector_dims("embedding") = 384
    )
    or ("model_code" = 'bge-m3' and vector_dims("embedding") = 1024)
  );
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_event_bge_small_zh_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(512)) vector_cosine_ops)
WHERE "model_code" = 'bge-small-zh-v1.5' AND "entity_type" = 'event';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_relation_bge_small_zh_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(512)) vector_cosine_ops)
WHERE "model_code" = 'bge-small-zh-v1.5' AND "entity_type" = 'relation';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_case_bge_small_zh_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(512)) vector_cosine_ops)
WHERE "model_code" = 'bge-small-zh-v1.5' AND "entity_type" = 'case';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_event_granite_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(384)) vector_cosine_ops)
WHERE "model_code" = 'granite-embedding-97m-multilingual-r2' AND "entity_type" = 'event';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_relation_granite_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(384)) vector_cosine_ops)
WHERE "model_code" = 'granite-embedding-97m-multilingual-r2' AND "entity_type" = 'relation';
--> statement-breakpoint
CREATE INDEX "semantic_embeddings_case_granite_hnsw_idx"
ON "semantic_embeddings"
USING hnsw (("embedding"::vector(384)) vector_cosine_ops)
WHERE "model_code" = 'granite-embedding-97m-multilingual-r2' AND "entity_type" = 'case';
