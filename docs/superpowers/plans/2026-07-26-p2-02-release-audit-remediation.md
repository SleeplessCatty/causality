# P2-02 Release Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Repair every lifecycle, concurrency, recovery, frontend-safety, dependency, and performance issue found in the final P2-02 code audit, add regression coverage, and produce a verified local release commit.

**Architecture:** PostgreSQL remains the authoritative lifecycle and job state. Worker failures are represented by stable typed classifications and persisted before best-effort cleanup; full and incremental index work share the same retry, lease, and cancellation primitives. Database triggers only enqueue work in lifecycle stages that can consume it, while React dispatches only exhaustively recognized lifecycle actions.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, TypeScript 6.0.2, React 19.2.7, Fastify 5.10.0, PostgreSQL 18, pgvector 0.8.2, Transformers.js 4.2.0, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- The approved source of truth is `docs/superpowers/specs/2026-07-26-semantic-model-lifecycle-design.md`.
- Use strict red-green-refactor for every behavioral correction.
- Add migration `0014`; never edit already-applied migration behavior in place.
- Retryable failures receive three execution opportunities: initial, 5-second retry, 30-second retry.
- Manual failures become terminal immediately and expose only their stage-specific operation.
- Persist authoritative failure state before file/runtime cleanup; cleanup is best-effort and must not replace the original failure.
- A lost lease must stop publication and be classified as `WORKER_LEASE_LOST`.
- Shutdown must have a bounded drain and must not wait forever for model or index work.
- Keep downloaded model files and business records unchanged.
- Keep all work on the current `main` branch as previously approved; do not push GitHub.

---

## File Map

### Worker failure and retry lifecycle

- Modify `apps/semantic-worker/src/jobs/failureClassifier.ts` — add index-stage codes and typed classification.
- Modify `apps/semantic-worker/src/jobs/jobTypes.ts` — pass classified index failure and cancellation signal through interfaces.
- Modify `apps/semantic-worker/src/jobs/jobRunner.ts` — classify index failures, persist before cleanup, and accept cancellation.
- Modify `apps/semantic-worker/src/jobs/indexJobRepository.ts` — due retry claims, 5/30-second scheduling, and terminal metadata.
- Modify `apps/semantic-worker/src/jobs/downloadJobRepository.ts` — preserve a retryable failed startup-load job.
- Modify `apps/semantic-worker/src/jobs/indexBuilder.ts` — distinguish source embedding failures from invalid vectors and database/publication failures.
- Modify `apps/semantic-worker/src/jobs/leaseHeartbeat.ts` — expose one shared lease guard.
- Modify `apps/semantic-worker/src/jobs/incrementalIndexDrain.ts` — reuse the shared lease guard while indexing.
- Modify `apps/semantic-worker/src/server.ts` — bounded shutdown and cancellation propagation.

### API, database, and Web

- Modify `apps/api/src/features/semantic/semanticCommandRepository.ts` — treat `retry_wait` jobs idempotently.
- Create `database/migrations/0014_semantic_lifecycle_hardening.sql` — restrict incremental enqueueing to supported index stages.
- Modify `database/migrations/meta/_journal.json` — register migration 0014.
- Modify `apps/web/src/features/parameter-settings/ParameterSettings.tsx` — exhaustive semantic action dispatch.

### Tests, dependencies, and documentation

- Modify Worker unit/integration tests for classification, cleanup, startup recovery, retry scheduling, invalid vectors, lease loss, and cancellation.
- Modify API integration tests for retry-wait idempotency and trigger stage restrictions.
- Modify Web tests for exhaustive action dispatch.
- Modify root and workspace dependency manifests plus `pnpm-lock.yaml` for patched dependency versions.
- Update the P2-02 design/remediation documents and README only where the corrected runtime behavior changes acceptance text.

---

### Task 1: Index Failure Classification and Retry State

**Files:**

- Modify: `apps/semantic-worker/src/jobs/failureClassifier.ts`
- Modify: `apps/semantic-worker/src/jobs/jobTypes.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRunner.ts`
- Modify: `apps/semantic-worker/src/jobs/indexJobRepository.ts`
- Test: `apps/semantic-worker/test/failureClassifier.test.ts`
- Test: `apps/semantic-worker/test/jobRunner.test.ts`
- Test: `apps/semantic-worker/test/jobRepository.integration.test.ts`

**Interfaces:**

- Extend `SemanticFailureStage` with `full_index | incremental`.
- Extend stable codes with `DATABASE_TEMPORARILY_UNAVAILABLE`, `WORKER_LEASE_LOST`, `VECTOR_DIMENSION_INVALID`, `VECTOR_VALUE_INVALID`, `SOURCE_EMBEDDING_FAILED`, and `INDEX_VALIDATION_FAILED`.
- Change `failIndex(jobId, workerId, stage, failure)` to consume `ClassifiedSemanticFailure`.

- [x] **Step 1: Write failing classifier and repository tests**

Cover typed lease loss, PostgreSQL transient codes, invalid dimensions/values, validation failure, manual immediate failure, and retryable 5/30-second scheduling.

- [x] **Step 2: Run focused tests and verify the expected failures**

Run:

```bash
pnpm --filter @causality/semantic-worker test -- failureClassifier.test.ts jobRunner.test.ts
pnpm --filter @causality/semantic-worker test:integration -- jobRepository.integration.test.ts
```

Expected: failures show missing index classification and immediate requeue behavior.

- [x] **Step 3: Implement typed classification and repository scheduling**

Claim `retry_wait` only when `next_attempt_at <= clock_timestamp()`. Persist `failure_stage`, `failure_kind`, `failure_code`, bounded message, and `next_attempt_at`. Update `semantic_index_state` with terminal full-index failure metadata.

- [x] **Step 4: Run focused tests and verify green**

Run the two commands from Step 2 and require zero failures.

---

### Task 2: Startup Load Recovery and Failure-First Cleanup

**Files:**

- Modify: `apps/semantic-worker/src/jobs/downloadJobRepository.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRunner.ts`
- Test: `apps/semantic-worker/test/internalServer.test.ts`
- Test: `apps/semantic-worker/test/jobRunner.test.ts`
- Test: `apps/semantic-worker/test/jobRepository.integration.test.ts`

**Interfaces:**

- `failActiveModelLoad` atomically upserts one terminal failed `load` job for the current model/version.
- Download/load runners persist the original classified failure before cleanup.

- [x] **Step 1: Write failing recovery and cleanup tests**

Prove that startup load failure leaves a retryable failed load task and that cleanup exceptions do not prevent `failDownload` or `failLoad`.

- [x] **Step 2: Run focused tests and verify red**

Run:

```bash
pnpm --filter @causality/semantic-worker test -- internalServer.test.ts jobRunner.test.ts
pnpm --filter @causality/semantic-worker test:integration -- jobRepository.integration.test.ts
```

- [x] **Step 3: Implement atomic failed-load preservation and best-effort cleanup**

Persist first. Catch cleanup failures separately and leave the persisted lifecycle failure unchanged.

- [x] **Step 4: Run focused tests and verify green**

Run the commands from Step 2 and require zero failures.

---

### Task 3: Safe Vector Failure Isolation

**Files:**

- Modify: `apps/semantic-worker/src/jobs/indexBuilder.ts`
- Modify: `apps/semantic-worker/src/jobs/failureClassifier.ts`
- Test: `apps/semantic-worker/test/indexBuilder.integration.test.ts`
- Test: `apps/semantic-worker/test/failureClassifier.test.ts`

**Interfaces:**

- Invalid vector dimension/value and publication validation are typed manual full-index errors.
- Only a failed single-record embedding call may create `SOURCE_EMBEDDING_FAILED`.
- Database and stable-write failures propagate to the index job.

- [x] **Step 1: Add failing integration tests**

Cover wrong vector dimension, non-finite vector values, batch database failure, and one isolated source embedding failure.

- [x] **Step 2: Run the index-builder integration test and verify red**

Run:

```bash
pnpm --filter @causality/semantic-worker test:integration -- indexBuilder.integration.test.ts
```

- [x] **Step 3: Narrow catch boundaries and add typed index errors**

Keep the batch-to-single fallback only around runtime embedding calls. Validate vectors and write database rows outside that fallback.

- [x] **Step 4: Run focused tests and verify green**

Run the command from Step 2 plus the failure-classifier unit test.

---

### Task 4: Lifecycle-Aware Incremental Enqueueing

**Files:**

- Create: `database/migrations/0014_semantic_lifecycle_hardening.sql`
- Modify: `database/migrations/meta/_journal.json`
- Test: `apps/api/test/core-model.integration.test.ts`

**Interfaces:**

- `semantic_enqueue_incremental` enqueues only when index status is `building`, `ready`, `updating`, or `incomplete`.
- `ready` transitions to `updating`; the other allowed statuses remain unchanged.

- [x] **Step 1: Add failing database integration cases**

Write business records under `loading`, `failed`, `building`, and `ready`; assert jobs are absent for the first two and present for the latter two.

- [x] **Step 2: Run the focused API integration test and verify red**

Run:

```bash
pnpm --filter @causality/api test:integration -- core-model.integration.test.ts
```

- [x] **Step 3: Add and register migration 0014**

Replace only `semantic_enqueue_incremental`; keep existing triggers unchanged.

- [x] **Step 4: Run the focused integration test and verify green**

Run the command from Step 2 and require zero failures.

---

### Task 5: Idempotent Commands and Exhaustive Web Actions

**Files:**

- Modify: `apps/api/src/features/semantic/semanticCommandRepository.ts`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.tsx`
- Test: `apps/api/test/semantic.integration.test.ts`
- Test: `apps/web/src/features/parameter-settings/ParameterSettings.test.tsx`

**Interfaces:**

- Repeated high-level actions return the existing `retry_wait` task ID.
- `runSemanticAction` uses an exhaustive switch; no unknown value falls through to reindex.

- [x] **Step 1: Add failing API and Web regression tests**

Prove retry-wait idempotency and prove each declared action maps to exactly one API endpoint.

- [x] **Step 2: Run focused tests and verify red**

Run:

```bash
pnpm --filter @causality/api test:integration -- semantic.integration.test.ts
pnpm --filter @causality/web test -- ParameterSettings.test.tsx
```

- [x] **Step 3: Implement the minimal query and exhaustive switch changes**

Include `retry_wait` in active-job lookup and use `assertNever` for the action union.

- [x] **Step 4: Run focused tests and verify green**

Run the commands from Step 2 and require zero failures.

---

### Task 6: Shared Lease Guard and Bounded Worker Shutdown

**Files:**

- Modify: `apps/semantic-worker/src/jobs/leaseHeartbeat.ts`
- Modify: `apps/semantic-worker/src/jobs/incrementalIndexDrain.ts`
- Modify: `apps/semantic-worker/src/jobs/jobRunner.ts`
- Modify: `apps/semantic-worker/src/server.ts`
- Test: `apps/semantic-worker/test/incrementalIndexDrain.test.ts`
- Test: `apps/semantic-worker/test/jobRunner.test.ts`
- Test: `apps/semantic-worker/test/workerShutdown.test.ts`

**Interfaces:**

- All index paths call the same `startLeaseHeartbeat` guard during long-running work.
- Runner methods accept an `AbortSignal`; cancellation stops publication and records/relinquishes work safely.
- Shutdown aborts polling and active work, waits for a bounded drain, then closes resources.

- [x] **Step 1: Write failing lease-loss and shutdown tests**

Prove an incremental build observes lease loss before completion and prove an unresponsive job cannot block shutdown indefinitely.

- [x] **Step 2: Run focused Worker tests and verify red**

Run:

```bash
pnpm --filter @causality/semantic-worker test -- incrementalIndexDrain.test.ts jobRunner.test.ts workerShutdown.test.ts
```

- [x] **Step 3: Reuse the lease guard and introduce bounded cancellation**

Pass a live assertion callback through the drained incremental build. Use one process-level abort signal and a finite shutdown timeout.

- [x] **Step 4: Run focused Worker tests and verify green**

Run the command from Step 2 and require zero failures.

---

### Task 7: Patch Audited Dependencies and Preserve Lazy Loading

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/semantic-worker/package.json`
- Modify: `apps/web/package.json`
- Modify: `package.json` only if a documented pnpm override is required
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Resolve the patched `find-my-way >= 9.6.1` and `react-router >= 8.3.0`.
- Resolve `adm-zip >= 0.6.0` and `sharp >= 0.35.0` only through compatible upstream versions or scoped overrides verified by a real model smoke test.
- Keep the causal graph route lazy-loaded; its large route chunk is recorded as a later optimization rather than merged into the initial application bundle.

- [x] **Step 1: Inspect upstream-compatible versions**

Use package metadata and dependency trees to choose the smallest compatible upgrades.

- [x] **Step 2: Update manifests and lockfile**

Do not use broad unbounded overrides.

- [x] **Step 3: Run dependency, build, and model smoke checks**

Run:

```bash
pnpm audit --prod --audit-level=high
pnpm build
pnpm semantic:model-smoke
```

Require a green audit or document any upstream-unpatched, unreachable exception with exact dependency path. Require the downloaded lightweight model smoke test to pass.

---

### Task 8: Documentation, Full Verification, Code Review, and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-07-26-p2-02-release-audit-remediation.md`
- Modify: P2-02 acceptance documents only where behavior changed

- [x] **Step 1: Mark every completed plan checkbox and reconcile documentation**

Ensure retry timing, failure actions, startup recovery, and incremental-stage behavior match runtime code.

- [x] **Step 2: Run the complete fresh verification matrix**

Run:

```bash
git diff --check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:compose
pnpm build
pnpm audit --prod --audit-level=high
```

- [x] **Step 3: Perform a final standards and specification code review**

Review the diff against `docs/superpowers/specs/2026-07-26-semantic-model-lifecycle-design.md`, with special attention to retry state, cancellation, cleanup ordering, and migrations.

- [x] **Step 4: Commit the verified release remediation**

Stage only reviewed project files and create one local commit:

```bash
git commit -m "fix: harden semantic lifecycle release"
```

Do not push GitHub.

---

### Final Review Amendments

The post-implementation standards and specification reviews added the following verified
requirements:

- [x] Persist startup validation/load failure before best-effort cleanup.
- [x] Reject stale startup failure publication by model state version and skip stale file cleanup.
- [x] Serialize all task claims by locking the singleton index-state row.
- [x] Delete stale model/version tasks and enforce lifecycle-stage eligibility at claim time.
- [x] Propagate shutdown cancellation through runners, guard writes/publication, and release leases.
- [x] Fence every index mutation with the claimed lease owner and attempt token.
- [x] Fence drained incremental renew/completion and consume due `retry_wait` work.
- [x] Publish the index and remove its owned full-index task in one database transaction.
- [x] Requeue cancelled work without consuming an execution attempt.
- [x] Reset interrupted download progress and restore `download_queued` before re-execution.
- [x] Retry transient embedding-runtime failures instead of publishing widespread source failures.
- [x] Reconfirm the active model/version after startup loading before exposing the runtime.
- [x] Preserve observed invalid-file facts even when the index state version has moved on.
- [x] Fence startup invalidation by the captured download generation and avoid race-deleting files.
- [x] Scope dependency overrides to their direct parent packages.

Regression coverage includes concurrent high-level claims, non-zero interrupted download progress,
stale startup cleanup, inference-time lease loss, completion-time shutdown, retryable embedding
runtime failure, and current model/version isolation.
