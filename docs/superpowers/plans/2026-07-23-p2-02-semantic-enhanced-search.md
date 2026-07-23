# P2-02 Semantic Enhanced Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-triggered local semantic search to the event, relation, and case lists, backed by two pinned local embedding models, a dedicated TypeScript worker, and PostgreSQL pgvector.

**Architecture:** Existing list endpoints keep ownership of filters, pagination, and response rows. A new semantic API module owns model configuration and vector retrieval, while a dedicated `@causality/semantic-worker` process owns pinned model downloads, Transformers.js inference, and persistent indexing jobs. PostgreSQL stores one active model's vectors, task leases, model state, and partial HNSW indexes; normal search never depends on worker availability.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, TypeScript 6.0.2, React 19.2.7, TanStack Query 5.101.3, Fastify 5.10.0, Zod 4.4.3, PostgreSQL 18, pgvector 0.8.2, pgvector-node 0.3.0, Transformers.js 4.2.0, Drizzle ORM 0.45.2, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- The approved design is `docs/stages/phase-2/P2-02-semantic-enhanced-search-design.md`.
- Keep existing normal search behavior, filters, page size 50, detail navigation, and list-return focus behavior unchanged.
- Semantic search runs only after the user clicks “增强查询”.
- Add enhanced search only to the event, relation, and case list pages.
- Fetch at most 100 semantic candidates, merge on the server, deduplicate by business ID, and rank every normal match before semantic-only rows.
- Do not show match reasons, similarity scores, search source labels, model internals, or search logs.
- Changing the search text immediately returns the page to normal search; refreshing the page never restores enhanced mode.
- Use only the two pinned ONNX INT8 models in `@causality/semantic-core`; do not accept arbitrary model names, revisions, files, or URLs.
- Do not add a semantic enable/disable switch.
- The enhanced-search button always remains clickable; unavailable states return stable reason codes and preserve the current normal results.
- First model download is manual. A completed download automatically loads the model and starts full indexing.
- Model switches require UI confirmation, immediately invalidate old vectors, retain every downloaded model file, and automatically download/load/index the target model.
- Store only the active model's business vectors.
- Each model has its own user-adjustable similarity threshold, rendered with the same control as relation confidence.
- Business writes never wait for inference. Incremental work is transactionally queued and stale vectors are invalidated immediately.
- Worker failure, model download, and full rebuilding must never make normal API readiness fail.
- Keep implementation commits local. Do not push GitHub during P2.
- Do not implement P2-03 import APIs, candidate-dropdown semantics, graph semantics, external AI, rerankers, or multi-model vector retention.

---

## File Map

### Shared contracts and semantic core

- Create `packages/contracts/src/semantic/semanticSchemas.ts` — public model/config/job schemas and enhanced search query mode.
- Create `packages/contracts/test/semantic.test.ts`.
- Modify `packages/contracts/src/{events,relations,cases}/*Schemas.ts` — add `searchMode`.
- Modify `packages/contracts/src/events/eventSchemas.ts` — add semantic error codes.
- Modify `packages/contracts/src/index.ts`.
- Create `packages/semantic-core/package.json`.
- Create `packages/semantic-core/tsconfig.json`.
- Create `packages/semantic-core/tsconfig.build.json`.
- Create `packages/semantic-core/src/modelCatalog.ts` — pinned model manifests and adapter settings.
- Create `packages/semantic-core/src/content.ts` — deterministic event/relation/case document builders and SHA-256.
- Create `packages/semantic-core/src/resultMerge.ts` — normal-first deduplication helper used by unit tests and SQL fixtures.
- Create `packages/semantic-core/src/index.ts`.
- Create `packages/semantic-core/test/{modelCatalog,content,resultMerge}.test.ts`.

### Database and semantic API

- Create `apps/api/src/database/schema/{semanticModelSettings,semanticIndexState,semanticEmbeddings,semanticJobs}.ts`.
- Modify `apps/api/package.json` — add `pgvector` 0.3.0.
- Modify `apps/api/src/database/schema/index.ts`.
- Create `database/migrations/0008_semantic_search_foundation.sql` and generated migration metadata.
- Create `database/migrations/0009_semantic_sync_triggers.sql` and generated migration metadata.
- Modify `apps/api/test/support/{integrationGlobalSetup,postgresTestContext}.ts`.
- Modify `apps/api/test/core-model.integration.test.ts`.
- Modify `apps/api/src/database/{readiness,verify}.ts`.
- Create `apps/api/src/features/semantic/semanticTypes.ts`.
- Create `apps/api/src/features/semantic/semanticRepository.ts`.
- Create `apps/api/src/features/semantic/semanticService.ts`.
- Create `apps/api/src/features/semantic/semanticRoutes.ts`.
- Create `apps/api/src/features/semantic/semanticWorkerClient.ts`.
- Create `apps/api/src/features/semantic/semanticSearchRepository.ts`.
- Create `apps/api/test/{semantic-service,semantic-worker-client}.test.ts`.
- Create `apps/api/test/semantic.integration.test.ts`.
- Modify `apps/api/src/{app,server}.ts` and `apps/api/src/config/env.ts`.
- Modify event, relation, and case repositories/services/routes and their tests.

### Semantic worker

- Create `apps/semantic-worker/package.json`.
- Create `apps/semantic-worker/tsconfig.json`.
- Create `apps/semantic-worker/tsconfig.build.json`.
- Create `apps/semantic-worker/src/config/env.ts`.
- Create `apps/semantic-worker/src/database.ts`.
- Create `apps/semantic-worker/src/model/{modelDownloader,modelRuntime,transformersRuntime}.ts`.
- Create `apps/semantic-worker/src/jobs/{jobRepository,jobRunner,indexBuilder}.ts`.
- Create `apps/semantic-worker/src/internalServer.ts`.
- Create `apps/semantic-worker/src/server.ts`.
- Create unit tests mirroring every worker module.
- Create `apps/semantic-worker/src/realModelSmoke.ts`.
- Create `apps/semantic-worker/test/fixtures/semantic-quality-cases.json`.
- Create `apps/semantic-worker/src/qualityBenchmark.ts`.

### Web

- Create `apps/web/src/shared/controls/PercentageControl.tsx` and test.
- Modify `apps/web/src/features/relations/components/RelationForm.tsx` and test to reuse it.
- Create `apps/web/src/features/parameter-settings/ParameterSettings.tsx`.
- Create `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`.
- Create `apps/web/src/features/parameter-settings/ModelSwitchDialog.tsx`.
- Create `apps/web/src/features/parameter-settings/ParameterSettings.test.tsx`.
- Modify `apps/web/src/app/{AppSidebar,router}.tsx` and sidebar tests.
- Create `apps/web/src/shared/search/{EnhancedSearchButton,useEnhancedListSearch}.tsx` and tests.
- Modify the three list API adapters, list pages, and page tests.
- Modify `apps/web/src/styles/{global,events}.css`.
- Create `tests/e2e/semantic-settings.spec.ts`.
- Create `tests/e2e/semantic-search.spec.ts`.

### Container, verification, and documentation

- Create `apps/semantic-worker/Dockerfile`.
- Modify `compose.yaml`, root `package.json`, `pnpm-lock.yaml`, production contract tests, and smoke tests.
- Create `apps/api/src/database/benchmark/semanticSearchBenchmark.ts`.
- Create `apps/api/test/semantic-search-benchmark.test.ts`.
- Modify `README.md`.
- Update the P2-02 design and roadmap statuses only after acceptance.

---

### Task 1: Shared semantic contracts and deterministic core

**Files:**

- Create: `packages/contracts/src/semantic/semanticSchemas.ts`
- Create: `packages/contracts/test/semantic.test.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/src/cases/caseSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/semantic-core/package.json`
- Create: `packages/semantic-core/tsconfig.json`
- Create: `packages/semantic-core/tsconfig.build.json`
- Create: `packages/semantic-core/src/modelCatalog.ts`
- Create: `packages/semantic-core/src/content.ts`
- Create: `packages/semantic-core/src/resultMerge.ts`
- Create: `packages/semantic-core/src/index.ts`
- Create: `packages/semantic-core/test/modelCatalog.test.ts`
- Create: `packages/semantic-core/test/content.test.ts`
- Create: `packages/semantic-core/test/resultMerge.test.ts`

**Interfaces:**

- Produces:

```ts
type SearchMode = 'standard' | 'enhanced';
type SemanticModelCode = 'multilingual-e5-small' | 'bge-m3';
type SemanticEntityType = 'event' | 'relation' | 'case';
type SemanticTaskType = 'download' | 'full_index' | 'incremental';
type SemanticTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';
type SemanticDownloadStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'failed';
type SemanticIndexStatus =
  | 'empty'
  | 'waiting_model'
  | 'loading'
  | 'building'
  | 'updating'
  | 'ready'
  | 'failed';

interface SemanticModelFile {
  remotePath: string;
  localPath: string;
  bytes: number;
  sha256: string;
}

interface SemanticModelDefinition {
  code: SemanticModelCode;
  label: '轻量快速' | '质量优先';
  repository: string;
  revision: string;
  dimensions: 384 | 1024;
  dtype: 'q8';
  pooling: 'mean' | 'cls';
  queryPrefix: string;
  documentPrefix: string;
  maxTokens: number;
  defaultThreshold: number;
  files: readonly SemanticModelFile[];
}

type SemanticDocumentInput =
  | {
      type: 'event';
      name: string;
      aliases: readonly string[];
      keywords: readonly string[];
      description: string | null;
    }
  | {
      type: 'relation';
      causeEventName: string;
      effectEventName: string;
      description: string | null;
    }
  | { type: 'case'; content: string };

function buildSemanticDocument(input: SemanticDocumentInput): string;
function hashSemanticDocument(document: string): string;
function mergeNormalFirst<T extends { id: string }>(
  normal: readonly T[],
  semantic: readonly T[],
): T[];
```

- Every list query contract gains `searchMode`, defaulting to `standard`.
- Every list response gains `semanticIndexUpdating: boolean`, defaulting to `false`; it is
  `true` only for a successful enhanced query served while incremental jobs remain.
- New API codes:

```ts
'SEMANTIC_QUERY_EMPTY'
'SEMANTIC_MODEL_UNAVAILABLE'
'SEMANTIC_MODEL_DOWNLOADING'
'SEMANTIC_INDEX_BUILDING'
'SEMANTIC_INDEX_FAILED'
'SEMANTIC_WORKER_UNAVAILABLE'
'SEMANTIC_SWITCH_CONFLICT'
```

- [ ] **Step 1: Write failing contract tests**

Add exact parsing expectations:

```ts
expect(eventListQuerySchema.parse({ q: '利率', searchMode: 'enhanced' }).searchMode).toBe(
  'enhanced',
);
expect(relationListQuerySchema.parse({}).searchMode).toBe('standard');
expect(caseListQuerySchema.safeParse({ searchMode: 'other' }).success).toBe(false);

expect(
  semanticThresholdInputSchema.parse({
    threshold: 65,
  }),
).toEqual({ threshold: 65 });

expect(
  semanticSettingsResponseSchema.parse({
    activeModelCode: null,
    index: {
      status: 'empty',
      processedItems: 0,
      totalItems: 0,
      pendingItems: 0,
      updatedAt: null,
      error: null,
    },
    models: MODEL_RESPONSE_FIXTURES,
    activeTask: null,
  }),
).toMatchObject({ activeModelCode: null });
```

- [ ] **Step 2: Run contract tests and verify failure**

Run:

```bash
pnpm --filter @causality/contracts test -- semantic.test.ts
```

Expected: FAIL because the semantic schemas and `searchMode` fields do not exist.

- [ ] **Step 3: Implement strict semantic contracts**

Use strict Zod objects and integer percentages:

```ts
export const searchModeSchema = z.enum(['standard', 'enhanced']).default('standard');
export const semanticModelCodeSchema = z.enum(['multilingual-e5-small', 'bge-m3']);
export const semanticEntityTypeSchema = z.enum(['event', 'relation', 'case']);
export const semanticThresholdInputSchema = z
  .object({ threshold: z.number().int().min(0).max(100) })
  .strict();

export const semanticUseModelResponseSchema = z
  .object({
    accepted: z.literal(true),
    taskId: z.uuid(),
    activeModelCode: semanticModelCodeSchema,
  })
  .strict();
```

Define the complete settings response using the status unions in **Interfaces**. Model rows include label, description, dimensions, expected download bytes, threshold, download status, `downloadedAt`, `isActive`, and error. Task rows include type, status, processed/total items, downloaded/total bytes, timestamps, and error.

Extend the three list response schemas with:

```ts
semanticIndexUpdating: z.boolean().default(false),
```

Existing standard responses therefore parse as `false` without changing their request behavior.

- [ ] **Step 4: Add `searchMode` to all three list contracts and exports**

Add this field before the shared page shape:

```ts
searchMode: searchModeSchema,
```

Export every semantic schema and type from `packages/contracts/src/index.ts`. Extend the shared API error enum with the seven semantic codes.

- [ ] **Step 5: Run contract tests**

Run:

```bash
pnpm --filter @causality/contracts test
```

Expected: PASS.

- [ ] **Step 6: Write failing semantic-core tests**

Use fixtures that prove field order and normal-first deduplication:

```ts
expect(
  buildSemanticDocument({
    type: 'event',
    name: '政策利率上调',
    aliases: ['加息', '提高政策利率'],
    keywords: ['利率', '货币政策'],
    description: '中央银行提高基准政策利率',
  }),
).toBe(
  '事件名称：政策利率上调\n别名：加息、提高政策利率\n关键词：利率、货币政策\n说明：中央银行提高基准政策利率',
);

expect(
  buildSemanticDocument({
    type: 'relation',
    causeEventName: '政策利率上调',
    effectEventName: '融资成本上升',
    description: null,
  }),
).toBe('原因事件：政策利率上调\n结果事件：融资成本上升');

expect(
  mergeNormalFirst(
    [{ id: 'normal-1' }, { id: 'shared' }],
    [{ id: 'shared' }, { id: 'semantic-1' }],
  ).map((item) => item.id),
).toEqual(['normal-1', 'shared', 'semantic-1']);
```

Also assert alias sorting, keyword position preservation, empty-field omission, stable SHA-256, and model manifests.

- [ ] **Step 7: Run semantic-core tests and verify failure**

Run:

```bash
pnpm --filter @causality/semantic-core test
```

Expected: FAIL because the package and functions do not exist.

- [ ] **Step 8: Implement the pinned model catalog**

Define these immutable entries:

```ts
export const MODEL_CATALOG = {
  'multilingual-e5-small': {
    code: 'multilingual-e5-small',
    label: '轻量快速',
    repository: 'Xenova/multilingual-e5-small',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    dimensions: 384,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    maxTokens: 512,
    defaultThreshold: 70,
  },
  'bge-m3': {
    code: 'bge-m3',
    label: '质量优先',
    repository: 'onnx-community/bge-m3-ONNX',
    revision: '25b9af8e87a38eb120cfe87125383677b9cd309e',
    dimensions: 1024,
    dtype: 'q8',
    pooling: 'cls',
    queryPrefix: '',
    documentPrefix: '',
    maxTokens: 1024,
    defaultThreshold: 55,
  },
} as const satisfies Record<SemanticModelCode, SemanticModelDefinition>;
```

Pin these exact file manifests:

```ts
const e5Files = [
  ['config.json', 658, 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1'],
  ['tokenizer.json', 17_082_730, '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'],
  ['tokenizer_config.json', 443, 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b'],
  ['special_tokens_map.json', 167, 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7'],
  ['quant_config.json', 674, '59d175f15264115f18c698d76e443b5d49fc6c8c599911c421405ef4f236e87d'],
  ['onnx/model_quantized.onnx', 118_308_185, 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'],
] as const;

const bgeFiles = [
  ['config.json', 658, '70dae5884ced999af00244f776ac9eaa71538d68497d3d6a6091e0318cd32905'],
  ['tokenizer.json', 17_082_799, '249df0778f236f6ece390de0de746838ef25b9d6954b68c2ee71249e0a9d8fd4'],
  ['tokenizer_config.json', 1_203, 'b87c8703482b0300d3da30e201519aa641f6a450f5eb5bf1e624afbf70c74d80'],
  ['special_tokens_map.json', 964, '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835'],
  ['onnx/model_quantized.onnx', 568_479_395, '2237f770aad5c71bbc1fc2d361a57f9a37400574cc9eff32626f0cdb49234730'],
] as const;
```

- [ ] **Step 9: Implement content builders, hashes, and merge helper**

Use Node `createHash('sha256')`, deterministic labels from the approved design, aliases sorted with `localeCompare('zh-CN')`, keywords in database position order, and no blank lines for null fields. Do not include relation cases.

- [ ] **Step 10: Run core tests and workspace checks**

Run:

```bash
pnpm --filter @causality/semantic-core test
pnpm --filter @causality/semantic-core typecheck
pnpm --filter @causality/contracts test
pnpm format:check
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add packages/contracts packages/semantic-core pnpm-workspace.yaml
git commit -m "feat: add semantic search contracts and core"
```

Reviewer gate: confirm all public names and model constants before database work starts.

---

### Task 2: pgvector schema, indexes, and transactional sync queue

**Files:**

- Create: `apps/api/src/database/schema/semanticModelSettings.ts`
- Create: `apps/api/src/database/schema/semanticIndexState.ts`
- Create: `apps/api/src/database/schema/semanticEmbeddings.ts`
- Create: `apps/api/src/database/schema/semanticJobs.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Create: `database/migrations/0008_semantic_search_foundation.sql`
- Create: `database/migrations/meta/0008_snapshot.json`
- Modify: `database/migrations/meta/_journal.json`
- Create: `database/migrations/0009_semantic_sync_triggers.sql`
- Create: `database/migrations/meta/0009_snapshot.json`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/test/support/integrationGlobalSetup.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`
- Modify: `apps/api/test/core-model.integration.test.ts`
- Modify: `apps/api/test/database-tools.integration.test.ts`
- Modify: `apps/api/src/database/readiness.ts`
- Modify: `apps/api/src/database/verify.ts`

**Interfaces:**

- Produces these tables:

```text
semantic_model_settings(model_code PK, revision, threshold, download_status, downloaded_at, error, updated_at)
semantic_index_state(singleton_key PK, active_model_code, status, state_version, processed_items,
                     total_items, pending_items, error, last_ready_at, updated_at)
semantic_embeddings(entity_type, entity_id, model_code, source_hash, embedding, generated_at)
semantic_jobs(id PK, job_type, model_code, entity_type, entity_id, status, progress fields,
              attempts, lease_owner, lease_expires_at, error, timestamps)
```

- Produces SQL functions:

```sql
semantic_enqueue_incremental(entity_type varchar, entity_id uuid)
semantic_invalidate(entity_type varchar, entity_id uuid)
```

- [ ] **Step 1: Add the pinned Node pgvector adapter**

Run:

```bash
pnpm --filter @causality/api add pgvector@0.3.0
```

Expected: `apps/api/package.json` and `pnpm-lock.yaml` contain exactly `pgvector` 0.3.0.

- [ ] **Step 2: Switch integration tests to the pinned pgvector image**

Change only the Testcontainers image:

```ts
new GenericContainer('pgvector/pgvector:0.8.2-pg18')
```

Add `causality_semantic_test` to the allowed database set.

- [ ] **Step 3: Write failing migration assertions**

Assert:

```ts
expect(extensionNames).toContain('vector');
expect(tableNames).toEqual(
  expect.arrayContaining([
    'semantic_model_settings',
    'semantic_index_state',
    'semantic_embeddings',
    'semantic_jobs',
  ]),
);
expect(modelRows).toEqual([
  expect.objectContaining({ model_code: 'bge-m3', threshold: 55 }),
  expect.objectContaining({ model_code: 'multilingual-e5-small', threshold: 70 }),
]);
expect(indexState).toMatchObject({
  singleton_key: true,
  active_model_code: null,
  status: 'empty',
  state_version: 0,
});
```

Also inspect `pg_indexes` for six partial HNSW indexes: three entity types for each supported dimension.

- [ ] **Step 4: Run integration test and verify failure**

Run:

```bash
pnpm --filter @causality/api test:integration -- core-model.integration.test.ts
```

Expected: FAIL because semantic tables do not exist.

- [ ] **Step 5: Add Drizzle schema**

Use enum-like check constraints rather than PostgreSQL enums so later migrations remain simple. Represent the unbounded database vector through a Drizzle `customType`:

```ts
export const semanticVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector';
  },
  toDriver(value) {
    return pgvector.toSql(value);
  },
});
```

Set the unique key on `(entity_type, entity_id)`, because only one active model's vector is retained. Add checks for percentages, non-negative progress, valid statuses, and consistent terminal timestamps.

- [ ] **Step 6: Generate and inspect migration 0008**

Run:

```bash
pnpm --filter @causality/api exec drizzle-kit generate \
  --config drizzle.config.ts \
  --name semantic_search_foundation
```

Normalize the generated filename to `0008_semantic_search_foundation.sql` if Drizzle uses that sequence. Add:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Create partial HNSW cosine indexes using casts:

```sql
CREATE INDEX semantic_embeddings_event_e5_hnsw_idx
ON semantic_embeddings
USING hnsw ((embedding::vector(384)) vector_cosine_ops)
WHERE model_code = 'multilingual-e5-small' AND entity_type = 'event';
```

Repeat for relation/case and for `bge-m3` with `vector(1024)`.

- [ ] **Step 7: Generate migration 0009 and add transactional invalidation triggers**

Run:

```bash
pnpm --filter @causality/api exec drizzle-kit generate \
  --config drizzle.config.ts \
  --custom \
  --name semantic_sync_triggers
```

Create trigger functions that:

- upsert one queued incremental job per entity;
- delete the current vector immediately on update/delete;
- enqueue every relation referencing an event when the event name changes;
- enqueue events when aliases or keywords change;
- enqueue new cases created through relation forms;
- do nothing when `semantic_index_state.active_model_code` is null;
- keep the newest `state_version` on conflict.

Use exact upsert behavior:

```sql
INSERT INTO semantic_jobs (
  job_type, model_code, entity_type, entity_id, status, state_version
)
SELECT 'incremental', active_model_code, target_type, target_id, 'queued', state_version
FROM semantic_index_state
WHERE singleton_key = true AND active_model_code IS NOT NULL
ON CONFLICT (entity_type, entity_id)
WHERE job_type = 'incremental' AND status = 'queued'
DO UPDATE SET
  model_code = EXCLUDED.model_code,
  state_version = EXCLUDED.state_version,
  attempts = 0,
  error = NULL,
  updated_at = clock_timestamp();
```

- [ ] **Step 8: Test trigger behavior**

Assert in `core-model.integration.test.ts`:

```ts
await useModel(pool, 'multilingual-e5-small');
const eventId = await insertEvent(pool, '政策收紧');
expect(await queuedJobs(pool, 'event', eventId)).toHaveLength(1);

await renameEvent(pool, eventId, '货币政策收紧');
expect(await queuedJobs(pool, 'event', eventId)).toHaveLength(1);
expect(await queuedRelationJobsForEvent(pool, eventId)).not.toHaveLength(0);
```

Also prove delete removes the vector and pending job in the same transaction.

- [ ] **Step 9: Extend readiness and database verification**

Database readiness must require the `vector` extension and semantic tables but must not require a ready model or Worker. `db:verify` reports semantic extension/table integrity and invalid vector dimension/model combinations without treating “no downloaded model” as an error.

- [ ] **Step 10: Run integration and verification tests**

Run:

```bash
pnpm --filter @causality/api test:integration -- \
  core-model.integration.test.ts database-tools.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit Task 2**

```bash
git add apps/api/src/database apps/api/test database/migrations pnpm-lock.yaml
git commit -m "feat: add pgvector semantic storage"
```

Reviewer gate: inspect migration safety, HNSW predicates, and trigger scope before API work.

---

### Task 3: Semantic configuration repository and public API

**Files:**

- Create: `apps/api/src/features/semantic/semanticTypes.ts`
- Create: `apps/api/src/features/semantic/semanticRepository.ts`
- Create: `apps/api/src/features/semantic/semanticService.ts`
- Create: `apps/api/src/features/semantic/semanticRoutes.ts`
- Create: `apps/api/test/semantic-service.test.ts`
- Create: `apps/api/test/semantic.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/test/semantic.test.ts`

**Interfaces:**

- Produces:

```ts
interface SemanticRepository {
  getSettings(): Promise<SemanticSettingsResponse>;
  setThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void>;
  requestUseModel(modelCode: SemanticModelCode): Promise<SemanticUseModelResponse>;
  retryLatestFailure(): Promise<SemanticUseModelResponse>;
}

class SemanticService {
  settings(): Promise<SemanticSettingsResponse>;
  updateThreshold(modelCode: SemanticModelCode, threshold: number): Promise<SemanticSettingsResponse>;
  useModel(modelCode: SemanticModelCode): Promise<SemanticUseModelResponse>;
  retry(): Promise<SemanticUseModelResponse>;
}
```

- Public routes:

```text
GET   /api/semantic/settings
PATCH /api/semantic/models/:modelCode/threshold
POST  /api/semantic/models/:modelCode/use
POST  /api/semantic/retry
```

- [ ] **Step 1: Write failing service tests**

Test:

```ts
await expect(service.useModel('multilingual-e5-small')).resolves.toMatchObject({
  accepted: true,
  activeModelCode: 'multilingual-e5-small',
});
await expect(service.useModel('bge-m3')).rejects.toMatchObject({
  code: 'SEMANTIC_SWITCH_CONFLICT',
});
await expect(service.updateThreshold('bge-m3', 60)).resolves.toMatchObject({
  models: expect.arrayContaining([expect.objectContaining({ code: 'bge-m3', threshold: 60 })]),
});
```

The conflict fixture has a running download/full-index job.

- [ ] **Step 2: Add the semantic-core workspace dependency**

Run:

```bash
pnpm --filter @causality/api add '@causality/semantic-core@workspace:*'
```

Expected: the API package has one workspace dependency on semantic-core.

- [ ] **Step 3: Run unit test and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- semantic-service.test.ts
```

Expected: FAIL because the semantic service does not exist.

- [ ] **Step 4: Implement repository transactions**

`requestUseModel()` must lock `semantic_index_state FOR UPDATE`, reject active high-level jobs, increment `state_version`, set the new active model, delete all `semantic_embeddings`, cancel stale queued incremental jobs, and enqueue exactly one `download` or `full_index` job:

```ts
const nextTaskType =
  target.downloadStatus === 'downloaded' ? 'full_index' : 'download';
```

The first model request and a later switch use the same transaction. The API never downloads files itself.

- [ ] **Step 5: Implement service errors and routes**

Use route schemas from contracts. Map busy state to HTTP 409 with `SEMANTIC_SWITCH_CONFLICT`. Return HTTP 202 for accepted model-use and retry requests. A threshold update is allowed during normal querying and does not enqueue work.

- [ ] **Step 6: Register semantic routes**

Add optional repository injection to `buildApp()` following existing resource modules:

```ts
if (options.databasePool) {
  registerSemanticRoutes(app, options.databasePool);
}
```

- [ ] **Step 7: Write integration tests**

Verify:

```ts
expect((await app.inject({ method: 'GET', url: '/api/semantic/settings' })).statusCode).toBe(200);
expect(
  (await app.inject({ method: 'POST', url: '/api/semantic/models/multilingual-e5-small/use' }))
    .statusCode,
).toBe(202);
expect(await countRows(pool, 'semantic_embeddings')).toBe(0);
expect(await activeJob(pool)).toMatchObject({ job_type: 'download' });
```

Repeat with a downloaded model and expect `full_index`. Prove a second use request returns 409.

- [ ] **Step 8: Run Task 3 checks**

Run:

```bash
pnpm --filter @causality/api test -- semantic-service.test.ts
pnpm --filter @causality/api test:integration -- semantic.integration.test.ts
pnpm --filter @causality/contracts test
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add apps/api/src/features/semantic apps/api/src/app.ts apps/api/test packages/contracts
git commit -m "feat: add semantic configuration API"
```

Reviewer gate: exercise endpoints with `app.inject()` output before Worker implementation.

---

### Task 4: Semantic Worker, pinned downloads, and query inference

**Files:**

- Create: `apps/semantic-worker/package.json`
- Create: `apps/semantic-worker/tsconfig.json`
- Create: `apps/semantic-worker/tsconfig.build.json`
- Create: `apps/semantic-worker/src/config/env.ts`
- Create: `apps/semantic-worker/src/database.ts`
- Create: `apps/semantic-worker/src/model/modelDownloader.ts`
- Create: `apps/semantic-worker/src/model/modelRuntime.ts`
- Create: `apps/semantic-worker/src/model/transformersRuntime.ts`
- Create: `apps/semantic-worker/src/jobs/jobRepository.ts`
- Create: `apps/semantic-worker/src/jobs/jobRunner.ts`
- Create: `apps/semantic-worker/src/internalServer.ts`
- Create: `apps/semantic-worker/src/server.ts`
- Create: `apps/semantic-worker/test/modelDownloader.test.ts`
- Create: `apps/semantic-worker/test/modelRuntime.test.ts`
- Create: `apps/semantic-worker/test/jobRunner.test.ts`
- Create: `apps/semantic-worker/test/internalServer.test.ts`
- Create: `apps/semantic-worker/src/realModelSmoke.ts`
- Modify: root `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces:

```ts
interface EmbeddingRuntime {
  load(model: SemanticModelDefinition, localPath: string): Promise<void>;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  dispose(): Promise<void>;
}

interface ModelDownloader {
  download(
    model: SemanticModelDefinition,
    targetDirectory: string,
    onProgress: (loadedBytes: number, totalBytes: number) => Promise<void>,
  ): Promise<void>;
}
```

- Internal routes:

```text
GET  /internal/health
POST /internal/embed-query
```

- [ ] **Step 1: Add the worker package and pinned dependencies**

Use:

```json
{
  "name": "@causality/semantic-worker",
  "type": "module",
  "dependencies": {
    "@causality/contracts": "workspace:*",
    "@causality/semantic-core": "workspace:*",
    "@huggingface/transformers": "4.2.0",
    "fastify": "5.10.0",
    "pg": "8.22.0",
    "pgvector": "0.3.0",
    "zod": "4.4.3"
  }
}
```

Add `dev`, `build`, `typecheck`, `test`, `start`, `smoke:model`, and `quality:model` scripts following the API package.

- [ ] **Step 2: Write failing downloader tests**

Use an in-memory fake fetch and temporary directory. Assert:

```ts
await downloader.download(model, target, onProgress);
expect(await pathExists(join(target, 'READY.json'))).toBe(true);
expect(progress.at(-1)).toEqual({ loaded: expectedBytes, total: expectedBytes });
```

Corrupt one response and assert checksum failure removes the temporary directory but leaves an existing ready model untouched.

- [ ] **Step 3: Implement safe pinned download**

For each manifest file:

```ts
const url =
  `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.remotePath}`;
```

Stream to `<modelsDir>/.partial/<model-code>/`, update aggregate byte progress, verify exact size and SHA-256, write `READY.json`, then atomically rename to `<modelsDir>/<model-code>/<revision>/`. Never derive paths from request input.

- [ ] **Step 4: Write failing runtime tests**

Inject a fake Transformers pipeline and assert:

```ts
expect(fakePipeline.calls[0]).toMatchObject({
  text: 'query: 政策利率提高',
  options: { pooling: 'mean', normalize: true, truncation: true, max_length: 512 },
});
expect(await runtime.embedDocuments(['融资成本上升'])).toHaveLength(1);
await runtime.dispose();
expect(fakePipeline.disposed).toBe(true);
```

Add BGE-M3 expectations for empty prefixes and `cls` pooling.

- [ ] **Step 5: Implement the Transformers.js runtime**

Configure server-local loading:

```ts
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelsDirectory;
env.useFSCache = false;
```

Load exactly one pipeline, serialize inference through a small concurrency limiter, validate returned dimensions, copy tensor data to plain arrays, and call `dispose()` on switch or shutdown.

- [ ] **Step 6: Implement download job leasing**

Claim one queued high-level job with `FOR UPDATE SKIP LOCKED`, a 60-second renewable lease, and a stable worker ID. The runner:

1. marks model `downloading`;
2. persists progress at most four times per second;
3. marks `verifying`;
4. downloads and verifies;
5. marks model `downloaded`;
6. turns the same workflow into or enqueues `full_index`;
7. records a bounded 500-character error after three attempts.

- [ ] **Step 7: Implement the internal query endpoint**

Request body:

```ts
z.object({
  modelCode: semanticModelCodeSchema,
  text: z.string().trim().min(1).max(200),
}).strict()
```

Return `{ modelCode, dimensions, vector }`. Reject when requested model is not the active loaded model. Do not expose this route through the API OpenAPI document.

At process startup, read `semantic_index_state`. If it names a ready model, verify its complete local manifest and load it before serving embed requests. If files are missing or invalid, mark the model/index unavailable with a bounded error instead of attempting a remote download without a user action.

- [ ] **Step 8: Run unit tests**

Run:

```bash
pnpm --filter @causality/semantic-worker test
pnpm --filter @causality/semantic-worker typecheck
```

Expected: PASS without downloading real models.

- [ ] **Step 9: Run the real light-model smoke test**

The explicit command downloads only the pinned light model into a temporary model directory and asserts dimension 384 plus cosine similarity ordering:

```bash
pnpm --filter @causality/semantic-worker smoke:model -- multilingual-e5-small
```

Expected:

```text
model=multilingual-e5-small dimensions=384 semantic_order=pass
```

- [ ] **Step 10: Commit Task 4**

```bash
git add apps/semantic-worker package.json pnpm-lock.yaml
git commit -m "feat: add local semantic model worker"
```

Reviewer gate: inspect real smoke output, downloaded byte totals, and cleanup before indexing.

---

### Task 5: Full and incremental vector indexing

**Files:**

- Create: `apps/semantic-worker/src/jobs/indexBuilder.ts`
- Create: `apps/semantic-worker/test/indexBuilder.test.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRepository.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRunner.ts`
- Modify: `apps/semantic-worker/src/server.ts`
- Modify: `apps/semantic-worker/test/jobRunner.test.ts`
- Modify: `apps/api/test/core-model.integration.test.ts`

**Interfaces:**

- Produces:

```ts
interface SemanticSourceRecord {
  entityType: SemanticEntityType;
  entityId: string;
  document: string;
  sourceHash: string;
}

interface IndexBuilder {
  buildFull(job: SemanticJob): Promise<void>;
  buildIncremental(job: SemanticJob): Promise<void>;
}
```

- [ ] **Step 1: Write failing source-loading tests**

Seed one record of each type and assert exact documents:

```ts
expect(await sourceRepository.load('event', eventId)).toMatchObject({
  entityType: 'event',
  document:
    '事件名称：政策利率上调\n别名：加息\n关键词：利率\n说明：中央银行提高政策利率',
});
expect((await sourceRepository.load('relation', relationId))?.document).not.toContain('案例');
expect((await sourceRepository.load('case', caseId))?.document).toBe(
  '具体案例：央行宣布上调政策利率',
);
```

- [ ] **Step 2: Implement deterministic source reads**

Use one query per batch with ordered alias/keyword aggregates. Relation sources join both event names. Return `null` if the business record was deleted after the job was queued.

- [ ] **Step 3: Write failing full-index tests**

With a fake 384-dimensional runtime:

```ts
await builder.buildFull(fullJob);
expect(await embeddingCount(pool)).toBe(3);
expect(await indexState(pool)).toMatchObject({
  status: 'ready',
  processed_items: 3,
  total_items: 3,
  pending_items: 0,
});
```

Add a concurrent update after the first batch and assert the final stored hash equals the latest source.

- [ ] **Step 4: Implement full indexing**

Use batches of 64 for the light model and 16 for BGE-M3. The workflow:

1. verifies job `state_version`;
2. sets index status `loading`, loads model, then sets `building`;
3. clears stale queued incrementals for older state versions;
4. counts all three business types;
5. reads stable ID-ordered batches;
6. embeds and upserts only if source hash is still current;
7. updates progress after each batch;
8. drains current-version incremental jobs until empty;
9. validates counts, model codes, dimensions, and source hashes;
10. sets `ready` and `last_ready_at`.

Any unrecoverable record failure makes the full job fail; it must never publish a partially complete index as ready.

- [ ] **Step 5: Write failing incremental tests**

Assert:

```ts
await builder.buildIncremental(job);
expect(await storedHash(pool, 'event', eventId)).toBe(hashSemanticDocument(latestDocument));

await deleteEvent(pool, eventId);
await builder.buildIncremental(job);
expect(await storedEmbedding(pool, 'event', eventId)).toBeNull();
```

Add stale model/state-version cases and expect a no-op.

- [ ] **Step 6: Implement incremental indexing**

Before and after inference, compare active model, state version, business existence, and source hash. Set the global index state to `updating` only while pending rows exist; return to `ready` after the queue drains. Delete successful incremental job rows to avoid unbounded history.

- [ ] **Step 7: Add restart recovery tests**

Expire a running lease, start a new runner, and assert it reclaims the job. Start with a current unexpired lease and assert the second runner does not process it.

- [ ] **Step 8: Run Task 5 tests**

Run:

```bash
pnpm --filter @causality/semantic-worker test
pnpm --filter @causality/api test:integration -- core-model.integration.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add apps/semantic-worker apps/api/test/core-model.integration.test.ts
git commit -m "feat: build and synchronize semantic indexes"
```

Reviewer gate: verify create/update/delete, event-rename propagation, restart recovery, and no stale overwrite.

---

### Task 6: Enhanced search API for all three lists

**Files:**

- Create: `apps/api/src/features/semantic/semanticWorkerClient.ts`
- Create: `apps/api/src/features/semantic/semanticSearchRepository.ts`
- Create: `apps/api/test/semantic-worker-client.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/features/events/{eventRepository,eventService,eventRoutes}.ts`
- Modify: `apps/api/src/features/relations/{relationRepository,relationService,relationRoutes}.ts`
- Modify: `apps/api/src/features/cases/{caseRepository,caseService,caseRoutes}.ts`
- Modify: `apps/api/test/{event-service,relation-service,case-service}.test.ts`
- Modify: `apps/api/test/{events,relations,cases}.integration.test.ts`

**Interfaces:**

- Produces:

```ts
interface SemanticWorkerClient {
  embedQuery(modelCode: SemanticModelCode, text: string): Promise<number[]>;
}

interface SemanticSearchRepository {
  candidates(input: {
    entityType: SemanticEntityType;
    modelCode: SemanticModelCode;
    dimensions: 384 | 1024;
    threshold: number;
    vector: number[];
    limit: 100;
  }): Promise<Array<{ id: string; similarity: number }>>;
}

interface SemanticQueryService {
  candidateIds(entityType: SemanticEntityType, query: string): Promise<string[]>;
}
```

- [ ] **Step 1: Write failing Worker client tests**

Assert a successful typed response, timeout, malformed dimension, and connection failure:

```ts
await expect(client.embedQuery('multilingual-e5-small', '政策收紧')).resolves.toHaveLength(384);
await expect(unavailableClient.embedQuery('multilingual-e5-small', '政策收紧')).rejects.toMatchObject({
  code: 'SEMANTIC_WORKER_UNAVAILABLE',
});
```

- [ ] **Step 2: Implement the Worker client**

Add environment values:

```ts
SEMANTIC_WORKER_URL: z.string().url().default('http://127.0.0.1:3100'),
SEMANTIC_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(10_000),
```

Use built-in `fetch`, `AbortSignal.timeout`, strict response parsing, and no retries inside a user request.

- [ ] **Step 3: Write failing semantic candidate integration tests**

Seed normalized vectors and assert threshold and type filtering:

```ts
expect(
  await repository.candidates({
    entityType: 'event',
    modelCode: 'multilingual-e5-small',
    dimensions: 384,
    threshold: 70,
    vector: queryVector,
    limit: 100,
  }),
).toEqual([{ id: relatedEventId, similarity: expect.any(Number) }]);
```

- [ ] **Step 4: Implement pgvector candidate retrieval**

Use `pgvector.toSql(vector)`, a model-specific dimension cast chosen only from the catalog, and cosine distance `<=>`:

```ts
const vectorType =
  definition.dimensions === 384 ? 'vector(384)' : 'vector(1024)';
const distance = `embedding::${vectorType} <=> $3::${vectorType}`;
```

The only possible fragments are the two string literals above. Use:

```sql
WHERE model_code = $1
  AND entity_type = $2
  AND 1 - (${distance}) >= $4
ORDER BY ${distance}, entity_id
LIMIT 100
```

Never interpolate client-supplied SQL; dimension fragments come from the immutable model catalog.

- [ ] **Step 5: Write failing list integration tests**

For each list prove:

- standard mode executes without a model;
- enhanced mode with empty `q` returns `SEMANTIC_QUERY_EMPTY`;
- unavailable states return the correct stable code;
- normal exact/prefix/contains matches precede semantic-only IDs;
- duplicate IDs appear once;
- orphan/event/relation filters apply to both result sources;
- page metadata describes the merged unique set;
- page size remains 50.
- an enhanced query during incremental updates returns `semanticIndexUpdating: true`.

Example:

```ts
expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([
  exactId,
  prefixId,
  semanticOnlyId,
]);
```

- [ ] **Step 6: Implement normal-first merged SQL in each repository**

Add a repository method taking ordered semantic IDs. Use a `VALUES (id, semantic_rank)` CTE, union it with the existing normal-match CTE, group by ID, and order by:

```text
source_priority ASC
normal_rank ASC NULLS LAST
semantic_rank ASC NULLS LAST
existing deterministic tie-breaker
```

Apply existing orphan, `eventId`, and `relationId` filters after the union and before count/pagination. Do not alter candidate endpoints used by forms.

- [ ] **Step 7: Wire enhanced mode through services and routes**

Standard mode calls the existing repository path without contacting the Worker. Enhanced mode:

1. rejects blank query;
2. verifies active model/index state;
3. maps states to stable API codes;
4. fetches semantic IDs;
5. calls merged list repository method.

Routine `updating` state is allowed and does not block the query.
Set `semanticIndexUpdating` to `true` on that enhanced response; standard responses and
ready enhanced responses return `false`.

- [ ] **Step 8: Run API checks**

Run:

```bash
pnpm --filter @causality/api test -- \
  semantic-worker-client.test.ts event-service.test.ts relation-service.test.ts case-service.test.ts
pnpm --filter @causality/api test:integration -- \
  semantic.integration.test.ts events.integration.test.ts relations.integration.test.ts cases.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add apps/api packages/contracts pnpm-lock.yaml
git commit -m "feat: add enhanced semantic list queries"
```

Reviewer gate: inspect response order and merged pagination with API fixtures before UI work.

---

### Task 7: Parameter settings page and model lifecycle UI

**Files:**

- Create: `apps/web/src/shared/controls/PercentageControl.tsx`
- Create: `apps/web/src/shared/controls/PercentageControl.test.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.test.tsx`
- Create: `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`
- Create: `apps/web/src/features/parameter-settings/ModelSwitchDialog.tsx`
- Create: `apps/web/src/features/parameter-settings/ParameterSettings.tsx`
- Create: `apps/web/src/features/parameter-settings/ParameterSettings.test.tsx`
- Modify: `apps/web/src/app/AppSidebar.tsx`
- Modify: `apps/web/src/app/AppSidebar.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/styles/events.css`
- Create: `tests/e2e/semantic-settings.spec.ts`

**Interfaces:**

- Produces:

```ts
function getSemanticSettings(signal?: AbortSignal): Promise<SemanticSettingsResponse>;
function useSemanticModel(modelCode: SemanticModelCode): Promise<SemanticUseModelResponse>;
function updateSemanticThreshold(
  modelCode: SemanticModelCode,
  threshold: number,
): Promise<SemanticSettingsResponse>;
function retrySemanticTask(): Promise<SemanticUseModelResponse>;
```

- [ ] **Step 1: Extract the existing percentage control with tests**

The reusable component contract:

```tsx
<PercentageControl
  id="relation-confidence"
  label="置信度"
  value={confidence}
  required
  sliderLabel="置信度滑块"
  numberLabel="置信度数值"
  onChange={setConfidence}
/>
```

Move the current range/number markup and CSS behavior without visual changes. Run the relation form tests before adding settings UI.

- [ ] **Step 2: Write failing settings page tests**

Assert:

```tsx
expect(screen.getByRole('heading', { name: '参数配置' })).toBeVisible();
expect(screen.getByText('轻量快速')).toBeVisible();
expect(screen.getByText('质量优先')).toBeVisible();
expect(screen.getByRole('button', { name: '下载并使用' })).toBeEnabled();
expect(screen.getByRole('spinbutton', { name: '相似度门槛数值' })).toHaveValue(70);
```

For an active ready model, assert “当前使用” and no enable switch. For a build task, assert progress text `120 / 1000` and a progressbar.

- [ ] **Step 3: Implement API adapter and polling**

Use TanStack Query:

- poll every 1 second only while download/load/build task is active;
- stop polling in terminal states;
- invalidate settings after use, threshold update, or retry;
- use a request timeout of 15 seconds for actions;
- keep API error messages in the current three-second transient style.

- [ ] **Step 4: Implement model cards and progress**

Each card displays label, purpose, supported languages, expected download size, download/active state, and its own threshold. Do not expose vector dimensions, repository names, commit SHAs, file paths, or technical scores in the normal UI.

The first undownloaded selection has “下载并使用”. A downloaded inactive model has “切换到此模型”.

- [ ] **Step 5: Implement switch confirmation**

The dialog contains no record lists. It states:

```text
切换后将立即删除当前语义索引。在新模型下载并完成索引前，增强查询暂不可用。
```

If download is required, add the formatted expected size. Only confirming sends `POST /use`.

- [ ] **Step 6: Add route and navigation**

Insert:

```ts
{ to: '/settings', label: '参数配置', icon: <SettingsIcon /> }
```

between `/maintenance` and `/system`, and add `{ path: 'settings', element: <ParameterSettings /> }`.

- [ ] **Step 7: Run component tests**

Run:

```bash
pnpm --filter @causality/web test -- \
  PercentageControl.test.tsx RelationForm.test.tsx ParameterSettings.test.tsx AppSidebar.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Run focused browser test**

Run:

```bash
pnpm exec playwright test tests/e2e/semantic-settings.spec.ts
```

Verify navigation order, initial download, progress, threshold edits, confirmation, error retry, and the absence of an enable switch.

- [ ] **Step 9: Commit Task 7**

```bash
git add apps/web tests/e2e/semantic-settings.spec.ts
git commit -m "feat: add semantic parameter settings"
```

Manual reviewer gate: user verifies the complete `/settings` page before list UI changes.

---

### Task 8: Enhanced-query interaction on event, relation, and case lists

**Files:**

- Create: `apps/web/src/shared/search/EnhancedSearchButton.tsx`
- Create: `apps/web/src/shared/search/EnhancedSearchButton.test.tsx`
- Create: `apps/web/src/shared/search/useEnhancedListSearch.ts`
- Create: `apps/web/src/shared/search/useEnhancedListSearch.test.tsx`
- Modify: `apps/web/src/features/events/api/eventApi.ts`
- Modify: `apps/web/src/features/relations/api/relationApi.ts`
- Modify: `apps/web/src/features/cases/api/caseApi.ts`
- Modify: `apps/web/src/features/events/pages/EventListPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseListPage.tsx`
- Modify: the three list page test files
- Modify: `apps/web/src/styles/events.css`
- Create: `tests/e2e/semantic-search.spec.ts`

**Interfaces:**

- Produces:

```ts
interface EnhancedListSearchState {
  mode: 'standard' | 'enhanced';
  requestEnhanced(): void;
  resetToStandard(): void;
  isEnhancing: boolean;
  notice: { tone: 'error' | 'info'; message: string; settingsLink?: boolean } | null;
}
```

- [ ] **Step 1: Extend API adapter tests**

Assert:

```ts
await getEvents({ q: '政策收紧', page: 1, searchMode: 'enhanced' });
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining('searchMode=enhanced'),
  expect.anything(),
);
```

Repeat for relations and cases. Standard calls omit `searchMode` to preserve current URLs.

- [ ] **Step 2: Write failing shared interaction tests**

Test:

- blank input yields “请先输入搜索内容” without a request;
- click enters enhanced mode and resets page to 1;
- changing text resets mode to standard;
- pagination keeps enhanced mode in component state;
- unmount/remount returns to standard;
- semantic API errors keep prior normal data and display mapped reason;
- `SEMANTIC_INDEX_FAILED` includes a `/settings` link.
- a successful enhanced response with `semanticIndexUpdating: true` shows
  “语义索引更新中，结果可能暂不包含最新修改”.

- [ ] **Step 3: Implement the shared button and hook**

Keep enhanced mode out of URL/search parameters so refresh cannot restore it. The hook takes current normalized query and resets on change. Map stable codes:

```ts
const semanticMessages: Partial<Record<ApiErrorCode, string>> = {
  SEMANTIC_MODEL_UNAVAILABLE: '尚未下载并使用语义模型',
  SEMANTIC_MODEL_DOWNLOADING: '模型正在下载，增强查询暂不可用',
  SEMANTIC_INDEX_BUILDING: '语义索引正在生成，增强查询暂不可用',
  SEMANTIC_INDEX_FAILED: '语义索引生成失败',
  SEMANTIC_WORKER_UNAVAILABLE: '语义服务暂不可用',
};
```

Use `useAutoDismissError` for the existing three-second behavior. The button is never disabled because of semantic state; disable only while the same click request is in flight to prevent duplicate submission.

- [ ] **Step 4: Integrate the event list**

Wrap the current search input and new button in one compact row. Add `searchMode` to the query key and API call. If enhanced loading fails, retain normal `events.data`, reset mode, and show the mapped notice without rendering the generic list failure state.

- [ ] **Step 5: Integrate relation and case lists**

Repeat the same shared hook without duplicating status mapping. Preserve relation `eventId`, case `relationId`, orphan filtering, expanded relation behavior, deletion errors, page correction, and list focus.

- [ ] **Step 6: Run page tests**

Run:

```bash
pnpm --filter @causality/web test -- \
  EnhancedSearchButton.test.tsx useEnhancedListSearch.test.tsx \
  EventListPage.test.tsx RelationListPage.test.tsx CasePages.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Run focused E2E tests**

Run:

```bash
pnpm exec playwright test tests/e2e/semantic-search.spec.ts
```

Verify all three pages, normal-first order, page 2 navigation, input-change reset, refresh reset, unavailable reasons, update notice, and settings link.

- [ ] **Step 8: Commit Task 8**

```bash
git add apps/web tests/e2e/semantic-search.spec.ts
git commit -m "feat: add enhanced search list controls"
```

Manual reviewer gate: user checks the three desktop list pages and confirms ordinary search has no regression.

---

### Task 9: Container delivery, real-model quality, performance, and final verification

**Files:**

- Create: `apps/semantic-worker/Dockerfile`
- Modify: `compose.yaml`
- Modify: `compose.dev.yaml`
- Modify: `.dockerignore`
- Modify: root `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/Dockerfile` only if shared package copying requires it
- Create: `apps/semantic-worker/test/fixtures/semantic-quality-cases.json`
- Create: `apps/semantic-worker/src/qualityBenchmark.ts`
- Create: `apps/api/src/database/benchmark/semanticSearchBenchmark.ts`
- Create: `apps/api/test/semantic-search-benchmark.test.ts`
- Modify: `tests/production/compose-contract.test.mjs`
- Modify: `tests/production/e2e-contract.test.mjs`
- Modify: `tests/production/production-smoke.spec.ts`
- Modify: `scripts/test-production-compose.sh`
- Modify: `README.md`
- Modify after acceptance: `docs/stages/phase-2/P2-02-semantic-enhanced-search-design.md`
- Modify after acceptance: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

**Interfaces:**

- Production services:

```text
postgres            pgvector/pgvector:0.8.2-pg18
migrate             causality-api:local
api                 causality-api:local
semantic-worker     causality-semantic-worker:local
web                 causality-web:local
```

- Persistent volumes:

```text
causality-postgres-data
causality-semantic-models
```

- [ ] **Step 1: Add production Worker image**

Use the same Node 24.18.0 multi-stage pattern as the API. Build contracts, semantic-core, and semantic-worker; the runtime command is:

```dockerfile
CMD ["node", "apps/semantic-worker/dist/server.js"]
```

Run as the existing non-root runtime user and create a writable `/var/lib/causality/models` owned by that user.

- [ ] **Step 2: Update Compose**

Change PostgreSQL to:

```yaml
image: pgvector/pgvector:0.8.2-pg18
```

Add Worker:

```yaml
semantic-worker:
  image: causality-semantic-worker:local
  build:
    context: .
    dockerfile: apps/semantic-worker/Dockerfile
  environment:
    NODE_ENV: production
    DATABASE_URL: postgresql://causality:causality@postgres:5432/causality
    HOST: 0.0.0.0
    PORT: 3100
    MODEL_DIRECTORY: /var/lib/causality/models
  volumes:
    - causality-semantic-models:/var/lib/causality/models
  depends_on:
    migrate:
      condition: service_completed_successfully
  healthcheck:
    test:
      - CMD
      - node
      - -e
      - >-
        fetch('http://127.0.0.1:3100/internal/health')
        .then((response) => { if (!response.ok) process.exit(1); })
        .catch(() => process.exit(1));
    interval: 3s
    timeout: 3s
    retries: 20
  restart: unless-stopped
```

Set API `SEMANTIC_WORKER_URL: http://semantic-worker:3100`. Do not add a host port for Worker. Do not make API health depend on Worker health.

- [ ] **Step 3: Extend production contract tests**

Assert pinned images, no Worker port mapping, model volume attachment, API internal URL, non-root runtime, and both persistent volumes.

Run:

```bash
pnpm test:compose
```

Expected: PASS.

- [ ] **Step 4: Add root commands**

Add:

```json
{
  "semantic:model-smoke": "pnpm --filter @causality/semantic-worker smoke:model",
  "semantic:quality": "pnpm --filter @causality/semantic-worker quality:model",
  "semantic:benchmark": "pnpm --filter @causality/api semantic:benchmark"
}
```

Root `dev` must build both shared packages and run API, web, and Worker in parallel.
Update root `typecheck`, `test`, and `build` so semantic-core and semantic-worker are
included in dependency order:

```text
contracts -> semantic-core -> api/semantic-worker -> web
```

- [ ] **Step 5: Create fixed semantic quality fixtures**

Use at least 30 reviewed queries split evenly across events, relations, and cases, including Chinese, English, and mixed ticker/company text. Each fixture contains:

```json
{
  "entityType": "event",
  "query": "央行加息",
  "relevantDocumentIds": ["event-policy-rate-rise"],
  "confusingDocumentIds": ["event-market-rate-fall"]
}
```

The benchmark reports top-10 hit rate and irrelevant-result rate for each model and threshold. Start with 70% for E5 and 55% for BGE-M3; only change catalog defaults when the same committed fixture and report justify the change.

- [ ] **Step 6: Run both real-model quality checks**

Run:

```bash
pnpm semantic:model-smoke -- multilingual-e5-small
pnpm semantic:model-smoke -- bge-m3
pnpm semantic:quality
```

Expected:

- both dimensions match the catalog;
- every reviewed relevant target appears in the top 10 for its acceptance query set;
- default thresholds do not return the committed confusing targets in bulk;
- BGE-M3 top-10 hit rate is no more than five percentage points below E5-small.

Save only the concise benchmark summary in the P2-02 acceptance notes; do not commit model binaries.

- [ ] **Step 7: Add the 100k-record benchmark**

Generate an isolated dataset with a combined 100,000 semantic records. Measure:

- normal search while Worker is indexing;
- pgvector candidate retrieval;
- warm end-to-end light-model query;
- warm end-to-end quality-model query;
- full-index restart recovery.

The test asserts candidate cap 100 and no correctness regression. It reports, but does not make CI flaky on, hardware-sensitive wall time. Manual acceptance targets are 2 seconds warm for E5-small and 5 seconds warm for BGE-M3.

- [ ] **Step 8: Update README**

Document:

- model purpose and approximate disk sizes;
- first download and switching behavior;
- model volume backup policy;
- offline use after download;
- Worker and index status troubleshooting;
- model files are not in database backups;
- real-model smoke, quality, and benchmark commands;
- normal search remains available during semantic failures.

- [ ] **Step 9: Run complete automated verification**

Run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:compose
pnpm test:e2e
pnpm test:production
pnpm db:verify
```

Expected: all commands PASS.

- [ ] **Step 10: Run production manual acceptance**

Using Colima's active Docker context:

```bash
docker compose build
docker compose up -d --wait
```

Verify the complete approved checklist in the design:

1. initial light-model download and automatic indexing;
2. all three enhanced list searches;
3. empty/unavailable/failure reasons with normal results retained;
4. threshold persistence per model;
5. incremental create/edit/delete updates;
6. event rename updates relation vectors;
7. confirmed model switch and retained old model files;
8. Worker and Compose restart recovery;
9. offline query after download;
10. ordinary filters, pagination, details, and return focus regression.

- [ ] **Step 11: Mark P2-02 complete only after user approval**

Update:

```text
docs/stages/phase-2/P2-02-semantic-enhanced-search-design.md
docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
```

Record the automated verification date and desktop manual approval date. Set P2-02 to `已完成` and P2-03 to `未开始`.

- [ ] **Step 12: Commit Task 9**

```bash
git add .
git commit -m "feat: complete P2-02 semantic enhanced search"
```

Do not push GitHub. Stop and request permission before entering P2-03 design.

---

## Execution Order and Review Gates

Execute strictly in this order:

```text
Task 1 contracts/core
  -> Task 2 pgvector schema
  -> Task 3 configuration API
  -> Task 4 Worker/download/inference
  -> Task 5 full/incremental indexing
  -> Task 6 enhanced list API
  -> Task 7 parameter settings UI + manual review
  -> Task 8 three list UIs + manual review
  -> Task 9 container, real models, full acceptance
```

After each task:

1. run the task's focused checks;
2. inspect the diff;
3. create the listed local commit;
4. report the evidence;
5. wait for the required reviewer gate before continuing when the task names one.

No task may weaken an earlier task's test to make a later task pass.
