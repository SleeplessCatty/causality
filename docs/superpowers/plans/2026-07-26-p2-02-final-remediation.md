# P2-02 Semantic Lifecycle Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlapping P2-02 model, index, task, and Worker status logic with the approved orthogonal lifecycle state machine, then repair recovery, incomplete-index handling, monitoring, units, and module boundaries before the next development stage.

**Architecture:** PostgreSQL remains the source of truth for per-model files, the single current model/index, and ephemeral executable jobs. The API owns a pure lifecycle resolver, stage-specific commands, Worker health composition, and enhanced-query availability; the Semantic Worker owns pinned files, runtime loading, leases, retry classification, and vector generation. React renders the server-provided lifecycle snapshot and allowed actions without reconstructing state rules.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, TypeScript 6.0.2, React 19.2.7, TanStack Query 5.101.3, Fastify 5.10.0, Zod 4.4.3, PostgreSQL 18, pgvector 0.8.2, pgvector-node 0.3.0, Transformers.js 4.2.0, Drizzle ORM 0.45.2, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- The approved source of truth is `docs/superpowers/specs/2026-07-26-semantic-model-lifecycle-design.md`.
- Model switching is immediate: the selected model becomes current, the old vectors are deleted, and enhanced search is unavailable until the new index is published.
- Download, load, and full-index jobs are mutually exclusive; model switching is blocked while any of them is active.
- Long-term storage keeps downloaded files for multiple models but only one current model's business vectors.
- Index statuses `ready`, `updating`, and `incomplete` are queryable; every other index status rejects enhanced search without affecting normal search.
- An incomplete index remains queryable and exposes only a failed count and concise warning. Do not expose failed entity IDs, a failed-record list, or single/bulk retry actions.
- Retryable failures receive three total execution attempts: the initial attempt, one retry after 5 seconds, and one retry after 30 seconds. Manual failures do not auto-retry.
- Invalid model files are deleted and wait for an explicit “重新下载并使用”; startup and validation must not automatically access the network.
- Use stage-specific actions and routes. Remove the generic `/api/semantic/retry` behavior.
- Successful jobs are deleted after atomically publishing stable state. Failed jobs exist only until retry, reindex, or model switch resolves them.
- Worker reachability is a separate runtime fact. It never changes downloaded-file or index facts.
- Active lifecycle polling is server-directed: 1 second for active work, 5 seconds when the Worker is unreachable during active work, and stopped for stable or terminal states.
- Model sizes and download progress use decimal MB: `1 MB = 1_000_000 bytes`.
- Keep normal search, list filters, page size 50, detail-return location, and business write latency unchanged.
- Add a new migration; never edit an already applied migration or delete business records and downloaded model files.
- Keep the legacy settings response and list-level `semanticIndexUpdating` field only as compile-safe adapters while their current callers still exist. New lifecycle code must not consume them. Task 8 removes the list boolean, and Task 9 removes the settings adapter and legacy repository.
- Every implementation task in Tasks 1–10 starts with a failing test and ends with focused automated verification. Tasks with visible Web changes wait for user review before the next task; Task 11 is the final documentation and acceptance gate.
- Keep commits local. Do not push GitHub until all P2 work and final review are complete.

---

## File Map

### Shared contracts

- Modify `packages/contracts/src/semantic/semanticSchemas.ts` — lifecycle, failure, operation, Worker, action, and notice schemas.
- Modify `packages/contracts/src/{events,relations,cases}/*Schemas.ts` — add `semanticIndexNotice`, then remove the transitional `semanticIndexUpdating` field in Task 8.
- Modify `packages/contracts/src/index.ts`.
- Modify `packages/contracts/test/semantic.test.ts`.

### API lifecycle and commands

- Create `apps/api/src/features/semantic/semanticLifecycleTypes.ts` — repository facts consumed by the resolver.
- Create `apps/api/src/features/semantic/semanticLifecycleResolver.ts` — pure stage/action/availability/polling resolver.
- Create `apps/api/src/features/semantic/semanticLifecycleRepository.ts` — transactional fact reads.
- Create `apps/api/src/features/semantic/semanticCommandRepository.ts` — switch, reindex, and stage-specific retry transactions.
- Modify `apps/api/src/features/semantic/{semanticRoutes,semanticService,semanticTypes}.ts`.
- Modify `apps/api/src/features/semantic/semanticWorkerClient.ts` — internal health status.
- Modify `apps/api/src/features/semantic/semanticQueryService.ts` — ready/updating/incomplete availability.
- Keep `apps/api/src/features/semantic/semanticRepository.ts` as a narrow legacy-settings adapter through Task 8; delete it in Task 9 after all callers move to focused repositories.

### Database

- Modify `apps/api/src/database/schema/{semanticModelSettings,semanticIndexState,semanticJobs}.ts`.
- Create `database/migrations/0013_semantic_lifecycle_state_machine.sql`.
- Modify generated migration metadata under `database/migrations/meta/`.

### Semantic Worker

- Create `apps/semantic-worker/src/jobs/jobTypes.ts`.
- Create `apps/semantic-worker/src/jobs/postgresJobSupport.ts`.
- Create `apps/semantic-worker/src/jobs/downloadJobRepository.ts`.
- Create `apps/semantic-worker/src/jobs/indexJobRepository.ts`.
- Create `apps/semantic-worker/src/jobs/leaseHeartbeat.ts`.
- Create `apps/semantic-worker/src/jobs/failureClassifier.ts`.
- Modify `apps/semantic-worker/src/jobs/{jobRunner,indexBuilder,incrementalIndexDrain}.ts`.
- Delete `apps/semantic-worker/src/jobs/jobRepository.ts` after migration.
- Modify `apps/semantic-worker/src/{internalServer,server}.ts`.
- Modify `apps/semantic-worker/src/model/{modelDownloader,transformersRuntime}.ts`.

### Web

- Modify `apps/web/src/features/parameter-settings/{ParameterSettings,SemanticModelCard,SemanticTaskProgress,SemanticModelActionDialog,parameterSettingsApi,semanticPresentation}.tsx`.
- Modify `apps/web/src/shared/search/{useEnhancedListSearch,EnhancedSearchButton}.tsx`.
- Modify the event, relation, and case list API adapters and page tests.
- Modify `apps/web/src/features/system-status/{SystemStatus,systemStatusApi}.tsx`.
- Modify `apps/web/src/styles/global.css`.

### Verification and documentation

- Modify `README.md`.
- Modify `docs/stages/phase-2/P2-02-semantic-enhanced-search-design.md`.
- Modify `docs/superpowers/plans/2026-07-23-p2-02-semantic-enhanced-search.md`.
- Modify `docs/chinese-finance-semantic-search-evaluation.md`.
- Modify `docs/semantic-model-selection-research.md`.
- Modify `tests/e2e/{semantic-settings,semantic-search}.spec.ts`.

---

### Task 1: Lifecycle Contracts and Pure Resolver

**Files:**

- Modify: `packages/contracts/src/semantic/semanticSchemas.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/src/cases/caseSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/semantic.test.ts`
- Create: `apps/api/src/features/semantic/semanticLifecycleTypes.ts`
- Create: `apps/api/src/features/semantic/semanticLifecycleResolver.ts`
- Create: `apps/api/test/semantic-lifecycle-resolver.test.ts`

**Interfaces:**

- Produces the public contracts approved by the lifecycle design:

```ts
type SemanticModelFileStatus =
  | 'not_downloaded'
  | 'download_queued'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'invalid'
  | 'failed';

type SemanticIndexStatus =
  | 'empty'
  | 'waiting_model'
  | 'loading'
  | 'index_queued'
  | 'building'
  | 'ready'
  | 'updating'
  | 'incomplete'
  | 'failed';

type SemanticTaskType = 'download' | 'load' | 'full_index' | 'incremental';
type SemanticTaskStatus = 'queued' | 'running' | 'retry_wait' | 'failed';
type SemanticTaskPhase = 'waiting' | 'downloading' | 'verifying' | 'loading' | 'indexing';
type SemanticFailureKind = 'retryable' | 'manual';
type SemanticIndexNotice = 'updating' | 'incomplete' | null;

type SemanticAction =
  | 'download_and_use'
  | 'use'
  | 'retry_download'
  | 'redownload_and_use'
  | 'retry_load'
  | 'retry_full_index'
  | 'reindex';
```

`SemanticModelLifecycle` also carries the existing model-card fields `label`, `description`, `languageLabel`, `dimensions`, `expectedDownloadBytes`, `threshold`, and `downloadedAt`. Its stage enum includes the stable inactive-file stages `downloaded` and `invalid`. These fields let Task 9 remove the legacy settings endpoint without adding a second model-metadata request.

- Adds the replacement list-response field:

```ts
semanticIndexNotice: z.enum(['updating', 'incomplete']).nullable().default(null)
```

Keep `semanticIndexUpdating` temporarily in the schema so Tasks 1–7 remain compile-safe against the existing API and Web callers. Mark it deprecated and forbid new code from reading it. Task 8 removes it after all three list flows migrate to `semanticIndexNotice`.

- Produces:

```ts
function resolveSemanticLifecycle(input: {
  models: readonly SemanticModelState[];
  index: SemanticIndexState;
  jobs: readonly SemanticJobState[];
  worker: SemanticWorkerStatus;
  now: string;
}): SemanticLifecycleSnapshot;
```

- [x] **Step 1: Add failing contract tests**

Add schema fixtures covering an incomplete current model, a running download, and a Worker mismatch:

```ts
expect(
  semanticLifecycleSnapshotSchema.parse({
    currentModelCode: 'bge-small-zh-v1.5',
    models: [
      {
        modelCode: 'bge-small-zh-v1.5',
        fileState: 'downloaded',
        role: 'current',
        stage: 'incomplete',
        availableForEnhancedSearch: true,
        allowedActions: ['reindex'],
        failure: null,
      },
    ],
    index: {
      status: 'incomplete',
      processedItems: 599,
      totalItems: 600,
      pendingItems: 0,
      failedItems: 1,
      availableForEnhancedSearch: true,
      failure: null,
      updatedAt: '2026-07-26T10:00:00.000Z',
    },
    operation: null,
    worker: {
      status: 'online',
      modelState: 'loaded',
      loadedModelCode: 'bge-small-zh-v1.5',
      checkedAt: '2026-07-26T10:00:00.000Z',
    },
    pollAfterMs: null,
    updatedAt: '2026-07-26T10:00:00.000Z',
  }),
).toMatchObject({ index: { status: 'incomplete' } });
```

Update event, relation, and case response tests to accept `semanticIndexNotice`. For this transitional task, continue accepting `semanticIndexUpdating`; add a test comment that Task 8 removes it after API and Web callers migrate.

- [x] **Step 2: Run contract tests and verify failure**

Run:

```bash
pnpm --filter @causality/contracts test
```

Expected: FAIL because lifecycle schemas and `semanticIndexNotice` do not exist.

- [x] **Step 3: Implement exact Zod schemas and exports**

Define strict schemas for `SemanticFailure`, `SemanticOperation`, `SemanticWorkerStatus`, `SemanticIndexLifecycle`, `SemanticModelLifecycle`, and `SemanticLifecycleSnapshot`. Use:

```ts
export const semanticPollAfterMsSchema = z.union([
  z.literal(1_000),
  z.literal(5_000),
  z.null(),
]);
```

Failure messages remain non-empty strings; attempts are nonnegative integers; progress totals and completed values are nonnegative.

Keep the current settings schemas and `SemanticDownloadStatus` exports as deprecated compatibility contracts until Task 9. Do not make the initial contract task break the existing settings page.

- [x] **Step 4: Add failing resolver table tests**

Use `it.each` for the approved states:

```ts
it.each([
  ['ready', 0, 0, true, null, ['reindex']],
  ['updating', 2, 0, true, 1_000, []],
  ['incomplete', 0, 1, true, null, ['reindex']],
  ['building', 0, 0, false, 1_000, []],
  ['failed', 0, 0, false, null, ['retry_full_index']],
] as const)(
  'resolves %s lifecycle',
  (status, pendingItems, failedItems, available, pollAfterMs, actions) => {
    const snapshot = resolveSemanticLifecycle(
      lifecycleInput({ status, pendingItems, failedItems }),
    );
    expect(snapshot.index.availableForEnhancedSearch).toBe(available);
    expect(snapshot.pollAfterMs).toBe(pollAfterMs);
    expect(snapshot.models.find((model) => model.role === 'current')?.allowedActions).toEqual(
      actions,
    );
  },
);
```

Add explicit tests for inactive `not_downloaded`, `downloaded`, `failed`, and `invalid` models; Worker `unreachable`, `missing`, and `mismatch`; stale-version jobs; and a 5-second poll when active work exists but Worker is unreachable.

- [x] **Step 5: Implement the pure resolver**

The resolver must:

1. discard jobs whose model/version do not match the current index;
2. select at most one high-level current operation;
3. resolve file state independently for every model;
4. derive stage and actions from facts;
5. return queryability only for `ready/updating/incomplete`;
6. set `pollAfterMs` from active work and Worker status;
7. never use natural-language error text for decisions.

Keep the resolver free of database, network, clock, and React imports.

- [x] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test -- semantic-lifecycle-resolver.test.ts
pnpm --filter @causality/contracts typecheck
pnpm --filter @causality/api typecheck
```

Expected: all contract and resolver tests pass.

- [x] **Step 7: Commit**

```bash
git add packages/contracts apps/api/src/features/semantic/semanticLifecycleTypes.ts apps/api/src/features/semantic/semanticLifecycleResolver.ts apps/api/test/semantic-lifecycle-resolver.test.ts
git commit -m "feat: define semantic lifecycle contracts"
```

---

### Task 2: Lifecycle Database Migration

**Files:**

- Modify: `apps/api/src/database/schema/semanticModelSettings.ts`
- Modify: `apps/api/src/database/schema/semanticIndexState.ts`
- Modify: `apps/api/src/database/schema/semanticJobs.ts`
- Modify: `apps/api/src/features/semantic/semanticRepository.ts`
- Modify: `apps/api/src/features/semantic/semanticQueryService.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRepository.ts`
- Modify: `apps/semantic-worker/src/internalServer.ts`
- Create: `database/migrations/0013_semantic_lifecycle_state_machine.sql`
- Modify: `database/migrations/meta/_journal.json`
- Create: `database/migrations/meta/0013_snapshot.json`
- Modify: `apps/api/test/core-model.integration.test.ts`
- Create: `apps/api/test/semantic-lifecycle-migration.integration.test.ts`

**Interfaces:**

- `semantic_model_settings` gains:

```text
file_status, failure_kind, failure_code
```

- `semantic_index_state` gains:

```text
failed_items, failure_stage, failure_kind, failure_code
```

- `semantic_jobs` gains:

```text
phase, next_attempt_at, failure_kind, failure_code
```

- Job type adds `load`; status adds `retry_wait`; new code no longer persists `succeeded`.

- [x] **Step 1: Write a migration preservation test**

Prepare old-style rows before running migration 0013:

```sql
update semantic_index_state
set active_model_code = 'multilingual-e5-small',
    status = 'ready',
    state_version = 5;

insert into semantic_jobs (
  job_type, model_code, entity_type, entity_id, status, state_version,
  attempts, started_at, completed_at, error
)
values (
  'incremental', 'multilingual-e5-small', 'event',
  '10000000-0000-4000-8000-000000000001',
  'failed', 5, 3, clock_timestamp(), clock_timestamp(), '旧增量失败'
);
```

After migration, assert:

```ts
expect(state.rows[0]).toMatchObject({
  status: 'incomplete',
  failed_items: 1,
  failure_stage: 'incremental',
});
expect(await businessCounts(pool)).toEqual(beforeCounts);
expect(await embeddingCount(pool)).toBe(beforeEmbeddingCount);
```

Also assert succeeded jobs are deleted, running jobs are reset to queued with empty leases, and stale-version jobs are deleted.

- [x] **Step 2: Run the migration test and verify failure**

Run:

```bash
pnpm --filter @causality/api exec vitest run \
  --config vitest.integration.config.ts \
  test/semantic-lifecycle-migration.integration.test.ts
```

Expected: FAIL because migration 0013 and new columns do not exist.

- [x] **Step 3: Update Drizzle schemas and generate migration metadata**

Use `fileStatus` instead of `downloadStatus` in the application schema. Add checks:

```sql
file_status in (
  'not_downloaded', 'download_queued', 'downloading',
  'verifying', 'downloaded', 'invalid', 'failed'
)
```

Index statuses include `index_queued` and `incomplete`. Progress checks include `failed_items >= 0`.

Job checks require:

```sql
job_type in ('download', 'load', 'full_index', 'incremental')
status in ('queued', 'running', 'retry_wait', 'failed')
phase in ('waiting', 'downloading', 'verifying', 'loading', 'indexing')
```

Mechanically update every existing raw SQL reference from `download_status` to `file_status` in the API and Worker in the same task. Keep current behavior and the transitional settings response intact by mapping `file_status` back to the legacy response field inside `semanticRepository.ts`; later tasks replace that adapter. This prevents the migration commit from leaving the workspace unable to compile or start.

Use `pnpm db:generate` to produce metadata, then review and edit the generated SQL only to implement deterministic data migration.

- [x] **Step 4: Implement safe data mapping**

In migration 0013:

1. add nullable/new columns;
2. populate `file_status` from `download_status`;
3. delete succeeded jobs;
4. delete jobs not matching the current model/version;
5. reset running jobs to queued and clear leases;
6. retain only the newest current high-level failed job;
7. count current failed incremental jobs;
8. map ready/updating plus failures to incomplete;
9. add new constraints and indexes;
10. drop obsolete `download_status` only after successful population.

Do not truncate `semantic_embeddings` or any business table.

- [x] **Step 5: Run migration and schema verification**

Run:

```bash
pnpm --filter @causality/api exec vitest run \
  --config vitest.integration.config.ts \
  test/semantic-lifecycle-migration.integration.test.ts \
  test/core-model.integration.test.ts
pnpm --filter @causality/api typecheck
pnpm --filter @causality/semantic-worker typecheck
pnpm db:verify
```

Expected: migration is repeatably applied to test databases, business counts remain valid, and schema verification passes.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/database/schema apps/api/src/features/semantic apps/semantic-worker/src database/migrations apps/api/test/core-model.integration.test.ts apps/api/test/semantic-lifecycle-migration.integration.test.ts
git commit -m "feat: migrate semantic lifecycle state"
```

---

### Task 3: Lifecycle Read API and Worker Health Composition

**Files:**

- Create: `apps/api/src/features/semantic/semanticLifecycleRepository.ts`
- Modify: `apps/api/src/features/semantic/semanticWorkerClient.ts`
- Modify: `apps/api/src/features/semantic/semanticService.ts`
- Modify: `apps/api/src/features/semantic/semanticRoutes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/semantic-worker-client.test.ts`
- Modify: `apps/api/test/semantic.integration.test.ts`

**Interfaces:**

- Produces:

```ts
interface SemanticLifecycleRepository {
  readFacts(): Promise<SemanticLifecycleFacts>;
  setThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void>;
}

interface SemanticWorkerClient {
  health(): Promise<SemanticWorkerHealth>;
  embedQuery(modelCode: SemanticModelCode, text: string): Promise<number[]>;
}
```

- Public route:

```http
GET /api/semantic/lifecycle
```

- [x] **Step 1: Add Worker health client failure tests**

Test valid health, timeout, invalid JSON, and non-2xx:

```ts
await expect(client.health()).resolves.toEqual({
  status: 'ok',
  modelLoaded: true,
  activeModelCode: 'bge-small-zh-v1.5',
});

await expect(unreachableClient.health()).rejects.toMatchObject({
  code: 'SEMANTIC_WORKER_UNAVAILABLE',
});
```

- [x] **Step 2: Add lifecycle route integration test**

Prepare a current ready model and mock Worker health. Assert `/api/semantic/lifecycle` returns `stage: ready`, `allowedActions: ['reindex']`, `pollAfterMs: null`, and `worker.modelState: loaded`.

Prepare a mismatched Worker response and assert facts remain ready while Worker is `mismatch`.

- [x] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @causality/api exec vitest run test/semantic-worker-client.test.ts
pnpm --filter @causality/api exec vitest run \
  --config vitest.integration.config.ts \
  test/semantic.integration.test.ts
```

Expected: FAIL because `health()` and lifecycle route do not exist.

- [x] **Step 4: Implement transactional fact reads**

`readFacts()` uses one read-only transaction to read:

- all model settings;
- the singleton index state;
- current model/version jobs only.

It returns facts, not UI stages. Do not select obsolete tasks and do not prefer failed tasks over current stable state.

- [x] **Step 5: Compose Worker health**

Call `/internal/health` with the existing short timeout. Convert connection failure to:

```ts
{
  status: 'unreachable',
  modelState: 'missing',
  loadedModelCode: null,
  checkedAt,
}
```

The lifecycle service passes database facts and Worker facts to `resolveSemanticLifecycle`. It must not mutate state after a health failure.

- [x] **Step 6: Replace settings reads**

Expose lifecycle from the route and return lifecycle snapshots after threshold changes. Keep `/api/semantic/settings` only until the Web task migrates, with a temporary adapter in the API test scope; remove it in Task 9.

- [x] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @causality/api exec vitest run \
  test/semantic-worker-client.test.ts \
  test/semantic-lifecycle-resolver.test.ts
pnpm --filter @causality/api exec vitest run \
  --config vitest.integration.config.ts \
  test/semantic.integration.test.ts
```

Expected: health composition and lifecycle reads pass without changing model/index facts.

- [x] **Step 8: Commit**

```bash
git add apps/api/src/features/semantic apps/api/src/app.ts apps/api/test
git commit -m "feat: expose semantic lifecycle snapshots"
```

---

### Task 4: Stage-Specific Semantic Commands

**Files:**

- Create: `apps/api/src/features/semantic/semanticCommandRepository.ts`
- Modify: `apps/api/src/features/semantic/semanticService.ts`
- Modify: `apps/api/src/features/semantic/semanticRoutes.ts`
- Modify: `apps/api/src/features/semantic/semanticTypes.ts`
- Modify: `apps/api/src/features/semantic/semanticRepository.ts`
- Modify: `apps/api/test/semantic-service.test.ts`
- Modify: `apps/api/test/semantic.integration.test.ts`

**Interfaces:**

- Produces:

```ts
interface SemanticCommandRepository {
  useModel(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  retryDownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  redownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  retryLoad(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  retryFullIndex(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  reindex(): Promise<SemanticActionAccepted>;
}
```

- Routes exactly match the approved design:

```http
POST /api/semantic/models/:modelCode/use
POST /api/semantic/models/:modelCode/retry-download
POST /api/semantic/models/:modelCode/redownload
POST /api/semantic/models/:modelCode/retry-load
POST /api/semantic/models/:modelCode/retry-full-index
POST /api/semantic/reindex
```

- [ ] **Step 1: Write command integration tests**

Cover:

```ts
it('switches immediately, clears vectors, advances version, and queues the correct job');
it('returns an existing matching queued job for duplicate action submission');
it('rejects switching while a high-level job is active');
it('requeues only the failed download selected by retry-download');
it('requeues only the failed load selected by retry-load');
it('requeues only the failed full index selected by retry-full-index');
it('reindex clears vectors and failed incremental jobs and starts with load');
```

For immediate switch, assert in one result:

```ts
expect(state).toMatchObject({
  active_model_code: targetModel,
  status: expectedIndexStatus,
  state_version: previousVersion + 1,
});
expect(embeddingCount).toBe(0);
expect(staleJobCount).toBe(0);
```

- [ ] **Step 2: Run integration tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test:integration -- semantic.integration.test.ts
```

Expected: FAIL because stage-specific routes and load jobs do not exist.

- [ ] **Step 3: Implement locked command transactions**

Every command:

1. begins a transaction;
2. locks the singleton index row;
3. reads target model with `for update`;
4. checks `allowedActions` from current facts;
5. returns an existing identical queued/running task for duplicate submission;
6. changes state and job rows atomically;
7. commits before returning.

`useModel` increments state version, immediately deletes embeddings and stale jobs, and queues download or load based on file state. `reindex` increments state version, clears embeddings/failures/jobs, validates downloaded file state, and queues load.

- [ ] **Step 4: Remove generic retry**

Delete `/api/semantic/retry`, `retryLatestFailure`, and the priority query that searches old failed jobs. Retain only the threshold/current-settings compatibility reads still needed by the existing Web page; do not add new responsibilities to the legacy repository. Stable conflict responses use stage-specific codes such as:

```ts
'SEMANTIC_ACTION_NOT_ALLOWED'
'SEMANTIC_HIGH_LEVEL_TASK_ACTIVE'
'SEMANTIC_MODEL_NOT_CURRENT'
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm --filter @causality/api test -- semantic-service.test.ts
pnpm --filter @causality/api test:integration -- semantic.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: stage-specific commands pass; no generic retry route remains.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/semantic apps/api/test packages/contracts
git commit -m "feat: add stage-specific semantic commands"
```

---

### Task 5: Split Worker Repositories and Serialize Lease Heartbeats

**Files:**

- Create: `apps/semantic-worker/src/jobs/jobTypes.ts`
- Create: `apps/semantic-worker/src/jobs/postgresJobSupport.ts`
- Create: `apps/semantic-worker/src/jobs/downloadJobRepository.ts`
- Create: `apps/semantic-worker/src/jobs/indexJobRepository.ts`
- Create: `apps/semantic-worker/src/jobs/leaseHeartbeat.ts`
- Create: `apps/semantic-worker/test/leaseHeartbeat.test.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRunner.ts`
- Modify: `apps/semantic-worker/src/jobs/indexBuilder.ts`
- Modify: `apps/semantic-worker/src/internalServer.ts`
- Modify: `apps/semantic-worker/src/server.ts`
- Modify: `apps/semantic-worker/test/jobRunner.test.ts`
- Modify: `apps/semantic-worker/test/jobRepository.integration.test.ts`
- Modify: `apps/semantic-worker/test/indexBuilder.integration.test.ts`
- Delete: `apps/semantic-worker/src/jobs/jobRepository.ts`

**Interfaces:**

- `PostgresDownloadJobRepository` owns download/load lifecycle and active-model file recovery.
- `PostgresIndexJobRepository` owns full/incremental task lifecycle and all `semantic_index_state` transitions.
- `PostgresIndexBuilder` owns source reads, inference, and stable embedding writes, but never writes task/index progress directly.

```ts
interface LeaseHeartbeat {
  assertValid(): void;
  stop(): Promise<void>;
}

function startLeaseHeartbeat(options: {
  leaseMilliseconds: number;
  renew(): Promise<void>;
}): LeaseHeartbeat;
```

- [ ] **Step 1: Write the heartbeat serialization test**

Use fake timers and a controlled renewal Promise:

```ts
await vi.advanceTimersByTimeAsync(1_000);
expect(renew).toHaveBeenCalledTimes(1);
await vi.advanceTimersByTimeAsync(1_000);
expect(renew).toHaveBeenCalledTimes(1);
releaseFirstRenewal();
await vi.advanceTimersByTimeAsync(1_000);
expect(renew).toHaveBeenCalledTimes(2);
```

Reject the second renewal and assert `heartbeat.assertValid()` throws the same error.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --filter @causality/semantic-worker test -- leaseHeartbeat.test.ts
```

Expected: FAIL because the shared heartbeat does not exist.

- [ ] **Step 3: Implement a serialized heartbeat**

Keep one renewal tail:

```ts
renewalTail = renewalTail
  .then(() => options.renew())
  .catch((error: unknown) => {
    failure = error;
  });
```

Do not allow overlapping renewals. `stop()` clears the timer and awaits the tail. Both runners call `assertValid()` before progress publication and final completion.

- [ ] **Step 4: Split Worker types and repositories**

Move shared types to `jobTypes.ts`; move `lockOwnedJob`, `lockIndexState`, `WorkerLeaseLostError`, and transaction helpers to `postgresJobSupport.ts`.

Create focused repositories with explicit methods. The index state interface includes:

```ts
interface IndexStateRepository {
  isCurrent(job: SemanticIndexJob): Promise<boolean>;
  markModelLoading(job: SemanticLoadJob): Promise<void>;
  beginFullBuild(job: SemanticIndexJob, totalItems: number): Promise<void>;
  updateFullProgress(job: SemanticIndexJob, processed: number, total: number): Promise<void>;
  publishIndex(job: SemanticIndexJob, indexed: number, failed: number): Promise<boolean>;
  refreshIncrementalState(job: SemanticIndexJob): Promise<void>;
}
```

- [ ] **Step 5: Remove state-machine SQL from the builder**

Move loading, building, progress, publication, failure, and retry-wait SQL from `indexBuilder.ts` to `PostgresIndexJobRepository`. Keep business source locking and `semantic_embeddings` writes in the builder.

- [ ] **Step 6: Update composition**

`server.ts` creates independent download and index repositories and injects the index state repository into the builder. `SemanticWorkerService` receives only the file/load repository methods it needs.

- [ ] **Step 7: Run Worker regression tests**

Run:

```bash
pnpm --filter @causality/semantic-worker test
pnpm --filter @causality/semantic-worker test:integration
pnpm --filter @causality/semantic-worker typecheck
```

Expected: existing behavior is preserved under focused repository boundaries; heartbeat tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/semantic-worker/src apps/semantic-worker/test
git commit -m "refactor: separate semantic worker state responsibilities"
```

---

### Task 6: Download, Validation, Load, and Retry Pipeline

**Files:**

- Create: `apps/semantic-worker/src/jobs/failureClassifier.ts`
- Create: `apps/semantic-worker/test/failureClassifier.test.ts`
- Modify: `apps/semantic-worker/src/jobs/downloadJobRepository.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRunner.ts`
- Modify: `apps/semantic-worker/src/model/modelDownloader.ts`
- Modify: `apps/semantic-worker/src/model/transformersRuntime.ts`
- Modify: `apps/semantic-worker/src/internalServer.ts`
- Modify: `apps/semantic-worker/test/{jobRunner,internalServer,modelDownloader}.test.ts`
- Modify: `apps/semantic-worker/test/jobRepository.integration.test.ts`

**Interfaces:**

```ts
interface ClassifiedSemanticFailure {
  kind: 'retryable' | 'manual';
  code:
    | 'DOWNLOAD_NETWORK_ERROR'
    | 'DOWNLOAD_TIMEOUT'
    | 'MODEL_STORAGE_FULL'
    | 'MODEL_FILE_MISSING'
    | 'MODEL_SIZE_MISMATCH'
    | 'MODEL_HASH_MISMATCH'
    | 'MODEL_LOAD_TRANSIENT'
    | 'MODEL_RUNTIME_INCOMPATIBLE'
    | 'MODEL_MEMORY_INSUFFICIENT';
  message: string;
}

function classifySemanticFailure(stage: SemanticFailureStage, error: unknown): ClassifiedSemanticFailure;
```

- [ ] **Step 1: Write classifier tests**

Map explicit typed errors, Node error codes, timeout errors, ONNX load errors, and unknown errors. Assert unknown is manual:

```ts
expect(classifySemanticFailure('load', new Error('unknown'))).toMatchObject({
  kind: 'manual',
  code: 'MODEL_RUNTIME_INCOMPATIBLE',
});
```

Use dedicated error classes for file missing, size mismatch, and hash mismatch rather than matching strings.

- [ ] **Step 2: Write retry schedule integration tests**

Fail a retryable download three times. Assert:

```ts
expect(attempt1).toMatchObject({ status: 'retry_wait', attempts: 1 });
expect(secondsUntil(attempt1.next_attempt_at)).toBe(5);
expect(attempt2).toMatchObject({ status: 'retry_wait', attempts: 2 });
expect(secondsUntil(attempt2.next_attempt_at)).toBe(30);
expect(attempt3).toMatchObject({ status: 'failed', attempts: 3 });
```

Fail a manual validation once and assert it becomes `invalid`, deletes the invalid directory, creates no automatic download, and stops polling.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @causality/semantic-worker test -- failureClassifier.test.ts jobRunner.test.ts modelDownloader.test.ts internalServer.test.ts
pnpm --filter @causality/semantic-worker test:integration -- jobRepository.integration.test.ts
```

Expected: FAIL because load tasks, retry_wait, next attempt time, and typed file failures are not implemented.

- [ ] **Step 4: Implement failure classification and retry scheduling**

Claim queries include:

```sql
status = 'queued'
or (status = 'retry_wait' and next_attempt_at <= clock_timestamp())
or (status = 'running' and lease_expires_at <= clock_timestamp())
```

On retryable failure:

```ts
const nextDelaySeconds = job.attempts === 1 ? 5 : 30;
const terminal = job.attempts >= 3;
```

Manual failures become terminal immediately. Persist code, kind, bounded message, and attempts.

- [ ] **Step 5: Separate download and load jobs**

Download success:

1. verifies all fixed files;
2. sets file state downloaded;
3. deletes download job;
4. sets index loading;
5. creates a load job.

Load success:

1. confirms current model/version;
2. loads the pinned runtime;
3. deletes load job;
4. sets index `index_queued`;
5. creates a full-index job.

Load failure never changes a valid downloaded file to failed.

- [ ] **Step 6: Implement startup/use-time validation**

Validate the current model at Worker startup and before load. Missing, size, or hash failure:

1. disposes the loaded runtime;
2. removes the invalid version and partial directory;
3. sets file state invalid;
4. sets index waiting_model;
5. removes load/full-index jobs;
6. does not enqueue download.

- [ ] **Step 7: Run Worker tests**

Run:

```bash
pnpm --filter @causality/semantic-worker test
pnpm --filter @causality/semantic-worker test:integration
```

Expected: download → verify → load → full-index task chain and all retry classifications pass.

- [ ] **Step 8: Commit**

```bash
git add apps/semantic-worker/src apps/semantic-worker/test
git commit -m "feat: unify semantic file and load recovery"
```

---

### Task 7: Resilient Full and Incremental Index Publication

**Files:**

- Modify: `apps/semantic-worker/src/jobs/indexBuilder.ts`
- Modify: `apps/semantic-worker/src/jobs/indexJobRepository.ts`
- Modify: `apps/semantic-worker/src/jobs/incrementalIndexDrain.ts`
- Modify: `apps/semantic-worker/test/indexBuilder.integration.test.ts`
- Modify: `apps/semantic-worker/test/jobRepository.integration.test.ts`

**Interfaces:**

```ts
interface CompleteIndexValidation {
  indexedItems: number;
  failedItems: number;
}

interface RecordFailure {
  entityType: SemanticEntityType;
  entityId: string;
  code: 'SOURCE_EMBEDDING_FAILED';
  message: string;
}
```

- [ ] **Step 1: Write full-build record isolation test**

Configure the fake runtime to fail one known document while embedding every other record. After full build:

```ts
expect(embeddingCount).toBe(totalSources - 1);
expect(indexState).toMatchObject({
  status: 'incomplete',
  processed_items: totalSources - 1,
  total_items: totalSources,
  failed_items: 1,
});
expect(currentFailedIncrementalCount).toBe(1);
```

Assert the full-index job completes and is deleted.

- [ ] **Step 2: Write incomplete-to-ready recovery test**

Modify the failed business record so the normal write trigger supersedes its old failure. Run the resulting incremental job successfully and assert:

```ts
expect(indexState).toMatchObject({
  status: 'ready',
  pending_items: 0,
  failed_items: 0,
});
```

The UI still offers no manual single-record retry; normal business editing may naturally resolve the record.

- [ ] **Step 3: Run integration tests and verify failure**

Run:

```bash
pnpm --filter @causality/semantic-worker test:integration -- indexBuilder.integration.test.ts jobRepository.integration.test.ts
```

Expected: FAIL because one record currently fails the whole batch/full job and incomplete status does not exist.

- [ ] **Step 4: Implement batch fallback**

Try the normal batch first. If batch inference fails, process each record independently:

```ts
for (const record of records) {
  try {
    const [vector] = await runtime.embedDocuments([record.document]);
    assertValidVector(vector, expectedDimensions);
    await writeStableRecord(job, record, vector);
  } catch (error) {
    await indexRepository.recordSourceFailure(job, record, {
      code: 'SOURCE_EMBEDDING_FAILED',
      message: boundedError(error),
    });
  }
}
```

Do not reduce normal-path batch efficiency.

- [ ] **Step 5: Publish ready or incomplete atomically**

Validation accepts a missing vector only when a current model/version failed incremental record explains the same entity. Any unexplained missing vector, stale hash, wrong model, invalid dimension, or extra vector fails publication.

Publish:

```ts
status = failedItems > 0 ? 'incomplete' : 'ready';
processedItems = indexedItems;
totalItems = indexedItems + failedItems;
```

- [ ] **Step 6: Fix incremental aggregation**

After an incremental finishes:

```ts
if (failedItems > 0) status = 'incomplete';
else if (pendingItems > 0) status = 'updating';
else status = 'ready';
```

A new queued job for the same entity deletes or supersedes its older failed record. A successful job removes current failure state for that entity.

- [ ] **Step 7: Run index tests**

Run:

```bash
pnpm --filter @causality/semantic-worker test
pnpm --filter @causality/semantic-worker test:integration
```

Expected: full publication, concurrent writes, incomplete index, natural recovery, reindex, and stale-version tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/semantic-worker/src/jobs apps/semantic-worker/test
git commit -m "fix: publish resilient semantic indexes"
```

---

### Task 8: Enhanced Query Notice and Availability

**Files:**

- Modify: `apps/api/src/features/semantic/semanticQueryService.ts`
- Modify: `apps/api/src/features/semantic/semanticSearchRepository.ts`
- Modify: `apps/api/src/features/{events,cases,relations}/*Repository.ts`
- Modify: `apps/api/test/semantic-query-service.test.ts`
- Modify: `apps/api/test/semantic.integration.test.ts`
- Modify: event, relation, and case API tests
- Modify: `apps/web/src/shared/search/useEnhancedListSearch.ts`
- Modify: `apps/web/src/shared/search/useEnhancedListSearch.test.tsx`
- Modify: the three list API adapters and list page tests

**Interfaces:**

```ts
interface SemanticCandidateIds {
  ids: string[];
  semanticIndexNotice: 'updating' | 'incomplete' | null;
}
```

- [ ] **Step 1: Write query availability tests**

Use table tests:

```ts
it.each([
  ['ready', null],
  ['updating', 'updating'],
  ['incomplete', 'incomplete'],
] as const)('serves %s with notice %s', async (status, notice) => {
  await expect(serviceFor(status).candidateIds('event', '政策变化')).resolves.toMatchObject({
    semanticIndexNotice: notice,
  });
});
```

Assert empty/waiting/loading/index_queued/building/failed reject with stable reasons, and Worker mismatch/unreachable maps to `SEMANTIC_WORKER_UNAVAILABLE`.

- [ ] **Step 2: Write Web notice tests**

Assert exact copy:

```ts
expect(noticeFor('updating')).toEqual({
  tone: 'info',
  message: '语义索引尚在同步，结果可能暂不包含最新修改',
});

expect(noticeFor('incomplete')).toEqual({
  tone: 'info',
  message: '语义索引不完整，结果可能缺少部分记录',
  settingsLink: true,
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- semantic-query-service.test.ts
pnpm --filter @causality/web test -- useEnhancedListSearch.test.tsx EventListPage.test.tsx CasePages.test.tsx RelationPages.test.tsx
```

Expected: FAIL because responses still use `semanticIndexUpdating`.

- [ ] **Step 4: Implement API notice propagation**

The query context reads the approved index status. The three domain list repositories return normal-first merged rows with `semanticIndexNotice`. Standard search always returns `null`. Remove the transitional `semanticIndexUpdating` field from all three contracts, API responses, adapters, and tests in this task.

- [ ] **Step 5: Implement shared Web notice behavior**

Keep current enhanced mode and list-return URL behavior. Map the notice enum centrally in `useEnhancedListSearch`; do not duplicate copy in three pages.

- [ ] **Step 6: Run API and Web tests**

Run:

```bash
pnpm --filter @causality/api test
pnpm --filter @causality/web test -- useEnhancedListSearch.test.tsx EventListPage.test.tsx CasePages.test.tsx RelationPages.test.tsx
```

Expected: all three lists distinguish updating and incomplete indexes.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts apps/api/src apps/api/test apps/web/src
git commit -m "feat: distinguish semantic index query notices"
```

---

### Task 9: Parameter Configuration Lifecycle UI

**Files:**

- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.tsx`
- Modify: `apps/web/src/features/parameter-settings/SemanticModelCard.tsx`
- Modify: `apps/web/src/features/parameter-settings/SemanticTaskProgress.tsx`
- Modify: `apps/web/src/features/parameter-settings/SemanticModelActionDialog.tsx`
- Modify: `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`
- Modify: `apps/web/src/features/parameter-settings/semanticPresentation.ts`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/SemanticTaskProgress.test.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `tests/e2e/semantic-settings.spec.ts`
- Modify: `apps/api/src/features/semantic/semanticRoutes.ts` — remove temporary settings adapter after Web migration
- Delete: `apps/api/src/features/semantic/semanticRepository.ts` after threshold and lifecycle callers have moved

**Interfaces:**

- Consumes only `SemanticLifecycleSnapshot`, `stage`, `allowedActions`, `operation`, and `pollAfterMs`.
- Uses stage-specific API functions:

```ts
useSemanticModel(modelCode)
retrySemanticDownload(modelCode)
redownloadSemanticModel(modelCode)
retrySemanticLoad(modelCode)
retrySemanticFullIndex(modelCode)
reindexSemanticModel()
```

- [ ] **Step 1: Write lifecycle card tests**

Render snapshots for:

- inactive not downloaded → “下载并使用”;
- inactive downloaded → “使用此模型”;
- current invalid → “重新下载并使用”;
- current load failure → “重试加载”;
- current full-index failure → “重试全量索引”;
- current incomplete → “重新索引” and failed count;
- active high-level operation → all model switches disabled.

Assert the generic “重试任务” button is absent.

- [ ] **Step 2: Write server-directed polling tests**

Use fake timers and sequential lifecycle responses:

```ts
const responses = [
  lifecycle({ pollAfterMs: 1_000, stage: 'building' }),
  lifecycle({ pollAfterMs: 1_000, stage: 'building' }),
  lifecycle({ pollAfterMs: null, stage: 'ready' }),
];
```

Advance time and assert exactly three requests, then no more. Add a 5-second unreachable case and focus-refetch case.

- [ ] **Step 3: Update decimal MB tests**

Assert:

```ts
expect(screen.getByText('13.1 MB / 25.2 MB')).toBeTruthy();
expect(within(bgeM3Card).getByText('约 608 MB')).toBeTruthy();
```

- [ ] **Step 4: Run Web tests and verify failure**

Run:

```bash
pnpm --filter @causality/web test -- ParameterSettings.test.tsx SemanticTaskProgress.test.tsx
```

Expected: FAIL because the page consumes settings, derives actions locally, polls only activeTask, and uses binary MB.

- [ ] **Step 5: Replace settings with lifecycle snapshot**

Fetch `/api/semantic/lifecycle`. Render file, role, and index badges from the snapshot. Render current operation once above the four cards. Use `allowedActions` as the only source for buttons.

- [ ] **Step 6: Implement dynamic polling**

Use TanStack Query:

```ts
refetchInterval: (query) => query.state.data?.pollAfterMs ?? false,
refetchOnWindowFocus: true,
```

Do not duplicate activity rules in React.

- [ ] **Step 7: Implement stage-specific mutations**

Map each action to one endpoint and confirmation dialog. On success invalidate only the lifecycle query. Preserve the existing 3-second error display style.

- [ ] **Step 8: Convert MB**

Set:

```ts
const BYTES_PER_MEGABYTE = 1_000_000;
```

Keep download progress at one decimal and expected size rounded to an integer.

- [ ] **Step 9: Remove legacy settings API**

After Web tests use lifecycle, delete `/api/semantic/settings`, old response schemas that are no longer used, `retrySemanticTask`, generic retry UI, and the remaining legacy `semanticRepository.ts`. Verify no imports or routes remain before deleting the file.

- [ ] **Step 10: Run Web and E2E tests**

Run:

```bash
pnpm --filter @causality/web test -- ParameterSettings.test.tsx SemanticTaskProgress.test.tsx
pnpm test:e2e -- tests/e2e/semantic-settings.spec.ts
```

Expected: lifecycle cards, stage actions, dynamic polling, and MB display pass.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src apps/api/src/features/semantic packages/contracts tests/e2e/semantic-settings.spec.ts
git commit -m "feat: render semantic model lifecycle controls"
```

- [ ] **Step 12: User review**

Manually verify every model card stage, action label, disabled switch behavior, progress transition, incomplete warning, and stable-state polling stop before starting Task 10.

---

### Task 10: Semantic Worker in System Status

**Files:**

- Modify: `apps/api/src/features/semantic/semanticWorkerClient.ts`
- Modify: `apps/api/src/features/semantic/semanticService.ts`
- Modify: `apps/api/src/features/semantic/semanticRoutes.ts`
- Modify: `apps/api/test/semantic-worker-client.test.ts`
- Modify: `apps/api/test/semantic.integration.test.ts`
- Modify: `apps/web/src/features/system-status/systemStatusApi.ts`
- Modify: `apps/web/src/features/system-status/SystemStatus.tsx`
- Modify: `apps/web/src/features/system-status/SystemStatus.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Add API-proxied runtime status:

```http
GET /api/semantic/worker-status
```

- Returns `SemanticWorkerStatus` from the lifecycle contracts.

- [ ] **Step 1: Write API status tests**

Mock Worker health for idle, loaded, preparing, missing, mismatch, and unreachable. Assert the endpoint never changes database rows:

```ts
expect(afterModelState).toEqual(beforeModelState);
expect(afterIndexState).toEqual(beforeIndexState);
```

- [ ] **Step 2: Write System Status component tests**

Assert the third row:

```ts
expect(screen.getByText('Semantic Worker')).toBeTruthy();
expect(screen.getByText('正常·已加载当前模型')).toBeTruthy();
```

Click “重新检查” and assert API health, readiness, and Worker status each refetch exactly once. Assert no interval polling starts.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- semantic-worker-client.test.ts
pnpm --filter @causality/api test:integration -- semantic.integration.test.ts
pnpm --filter @causality/web test -- SystemStatus.test.tsx
```

Expected: FAIL because Worker status is not exposed or rendered.

- [ ] **Step 4: Implement API proxy**

Reuse `SemanticWorkerClient.health()` and current lifecycle facts. Return one of:

```text
online/idle
online/preparing
online/loaded
online/missing
online/mismatch
unreachable
```

Do not write model or index state.

- [ ] **Step 5: Add the System Status row**

Preserve existing API/PostgreSQL rows and visual style. Include Worker status in initial load and manual `Promise.all` refetch. Do not add automatic polling.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @causality/api test -- semantic-worker-client.test.ts
pnpm --filter @causality/api test:integration -- semantic.integration.test.ts
pnpm --filter @causality/web test -- SystemStatus.test.tsx
```

Expected: runtime rows remain independent and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/semantic apps/api/test apps/web/src/features/system-status apps/web/src/styles/global.css
git commit -m "feat: report semantic worker system status"
```

- [ ] **Step 8: User review**

Manually verify loaded, preparing, missing/mismatch, and unavailable Worker statuses; confirm “重新检查” does not start downloads or indexing.

---

### Task 11: Documentation, Full Gates, and P2-02 Acceptance

**Files:**

- Modify: `README.md`
- Modify: `docs/stages/phase-2/P2-02-semantic-enhanced-search-design.md`
- Modify: `docs/superpowers/plans/2026-07-23-p2-02-semantic-enhanced-search.md`
- Modify: `docs/chinese-finance-semantic-search-evaluation.md`
- Modify: `docs/semantic-model-selection-research.md`
- Modify: `docs/superpowers/specs/2026-07-26-semantic-model-lifecycle-design.md` — change status only after implementation matches it
- Modify only the files from Tasks 1–10 if a gate finds an in-scope defect

**Interfaces:**

- Produces a release candidate with no old generic retry, no binary-MB labels, no contradictory refresh behavior, and no stale terminology.

- [ ] **Step 1: Update documentation**

Document:

- lifecycle stages and stage-specific actions;
- immediate switch and reindex downtime;
- incomplete index behavior;
- Worker system status;
- decimal model sizes: approximately 24 MB, 135 MB, 123 MB, and 608 MB;
- query URL behavior: detail return and same-URL refresh preserve enhanced mode, while entering a bare list route does not.

Change “具体事件” to “具体案例” in the historical finance evaluation document. Remove the extra trailing blank line from `docs/semantic-model-selection-research.md`.

- [ ] **Step 2: Run static gates**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
git diff --check
```

Expected: all commands exit 0 and `git diff --check` prints nothing.

- [ ] **Step 3: Run all unit and component tests**

Run:

```bash
pnpm test
```

Expected: all workspace tests pass and the total is not lower than the pre-remediation 422 tests.

- [ ] **Step 4: Run all database integration tests**

Run:

```bash
pnpm test:integration
```

Expected: API and Worker integration tests pass and the total is not lower than the pre-remediation 119 tests.

- [ ] **Step 5: Run build and Compose contracts**

Run:

```bash
pnpm build
pnpm test:compose
```

Expected: all workspaces build and production Compose contracts pass.

- [ ] **Step 6: Run the real lightweight model smoke**

Run:

```bash
pnpm semantic:model-smoke -- bge-small-zh-v1.5
```

Expected output contains:

```text
model=bge-small-zh-v1.5
semantic_order=pass
```

Reuse the model cache; do not download or rebuild BGE-M3 for this gate.

- [ ] **Step 7: Run final manual lifecycle review**

Verify in order:

1. clean deployment shows four not-downloaded models and an idle Worker;
2. download and use progresses through queue, download, verification, load, and indexing;
3. active work blocks model switching;
4. ready state stops polling and enhanced search works;
5. detail return preserves enhanced results;
6. immediate switch clears old vectors and makes enhanced search unavailable;
7. invalid files wait for explicit redownload;
8. load and full-index failures expose only their stage-specific action;
9. one record failure publishes incomplete and shows no record list;
10. reindex clears failures and rebuilds from load;
11. System Status independently reports API, PostgreSQL, and Worker.

- [ ] **Step 8: Mark the lifecycle spec implemented**

Only after Steps 2–7 pass, change:

```markdown
**状态：** 已实现并通过人工复核
```

- [ ] **Step 9: Commit final verification and docs**

```bash
git add README.md docs
git commit -m "docs: complete semantic lifecycle remediation"
```

- [ ] **Step 10: Wait for acceptance**

Report command results, test counts, smoke output, and manual review checklist. Do not push GitHub or start the next P2 stage until the user confirms acceptance.

---

## Plan Self-Review

- Spec sections 4–9 map to Tasks 1–2.
- Download, switch, reindex, retry, and task-history decisions map to Tasks 4 and 6.
- Repository boundaries and lease serialization map to Task 5.
- Single-record isolation and incomplete-index invariants map to Task 7.
- Enhanced query availability and distinct updating/incomplete copy map to Task 8.
- Lifecycle rendering, stage-specific actions, decimal MB, and server-directed polling map to Task 9.
- Worker system status maps to Task 10.
- Migration preservation and final release gates map to Tasks 2 and 11.
- The plan adds no predownload, task history, cancellation, dual index, failed-record UI, SSE, or next-stage functionality.
- Types and endpoint names are consistent across contracts, API, Worker, Web, and tests.
- Compatibility fields are introduced and removed in explicit tasks, so every intermediate commit remains typecheckable.
