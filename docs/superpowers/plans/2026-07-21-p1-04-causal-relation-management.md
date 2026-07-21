# P1-04 Causal Relation Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved causal relation list, search, inline detail, create, and edit workflow across PostgreSQL, Fastify, shared contracts, and the desktop React application.

**Architecture:** Shared Zod contracts define all relation HTTP boundaries. Fastify routes use a relation service and PostgreSQL repository with the existing shared pool. React route pages reuse the P1-03 application shell and visual system; relation details expand inside the list and writes use complete PUT replacement.

**Tech Stack:** PostgreSQL 18.4, Drizzle ORM 0.45.2, Fastify 5.10.0, Zod 4.4.3, React 19.2.7, React Router 8.2.0, TanStack Query 5.101.3, Vitest 4.1.10, Playwright 1.61.1.

**Status:** Completed after automated verification and user acceptance on 2026-07-21.

## Global Constraints

- Follow `docs/stages/phase-1/P1-04-causal-relation-management-design.md` exactly.
- Work directly on the user-approved `main` workspace; do not create a worktree or use subagents.
- Use TDD and observe each new behavior fail before implementing it.
- Reuse the P1-03 global UI style; do not introduce a UI library, form library, or global state library.
- Allow reverse relations, reject self-loops and duplicate same-direction relations.
- Candidate and search UI never display match reasons or scores.
- Do not implement deletion, cases, automatic confidence, conditions, or graph functionality.
- Do not commit implementation until automated checks and user manual acceptance pass.

---

### Task 1: Relation contracts and search indexes

**Files:**
- Create: `packages/contracts/src/relations/relationSchemas.ts`
- Create: `packages/contracts/test/relations.test.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/database/schema/causalRelations.ts`
- Create through Drizzle: `database/migrations/0002_relation_management.sql`
- Modify through Drizzle: `database/migrations/meta/_journal.json`
- Create through Drizzle: `database/migrations/meta/0002_snapshot.json`

**Interfaces:**
- `relationFormInputSchema`: `{ causeEventId, effectEventId, confidence, description }` with distinct UUIDs, integer confidence 0–100, trimmed nullable description up to 2000 characters.
- `relationListQuerySchema`: `{ q: string, limit: 1..100, cursor?: string }`.
- `relationPairCheckQuerySchema`: `{ causeEventId, effectEventId, excludeId?: string }`.
- Response types: `RelationReference`, `RelationSummary`, `RelationDetail`, `RelationListResponse`, and `RelationPairCheckResponse`.

- [x] Write contract tests for valid input, null confidence rejection, self-loop rejection, limits, response strictness, `caseCount: 0`, pair-check shape, and new error codes.
- [x] Run `pnpm --filter @causality/contracts test` and confirm missing relation exports fail.
- [x] Implement schemas and exports, then run contract tests and typecheck to green.
- [x] Add `(updated_at desc, id desc)` and lower-description trigram indexes to the Drizzle schema.
- [x] Extend the migration integration test first, observe missing indexes, generate migration `0002_relation_management`, inspect SQL, and rerun green.

### Task 2: Cursor, repository, and service

**Files:**
- Create: `apps/api/src/features/relations/relationCursor.ts`
- Create: `apps/api/src/features/relations/relationRepository.ts`
- Create: `apps/api/src/features/relations/relationService.ts`
- Create: `apps/api/test/relation-cursor.test.ts`
- Create: `apps/api/test/relation-service.test.ts`

**Interfaces:**

```ts
interface RelationRepository {
  list(query: RelationListQuery): Promise<RelationListResponse>;
  findById(id: string): Promise<RelationDetail | null>;
  checkPair(query: RelationPairCheckQuery): Promise<RelationPairCheckResponse>;
  create(input: RelationFormInput): Promise<RelationDetail>;
  replace(id: string, input: RelationFormInput): Promise<RelationDetail | null>;
}
```

- [x] Write cursor tests for list/search states, malformed values, query mismatch, tampering, and version mismatch; confirm missing module failure.
- [x] Implement versioned Base64URL cursors bound to normalized search text; run cursor tests green.
- [x] Write service tests for not found, self-loop, missing events, same-direction conflict, reverse allowed, known PostgreSQL constraints, and unknown errors; confirm missing module failure.
- [x] Implement typed `RelationServiceError` mapping and service delegation; run API unit tests green.
- [x] Implement parameterized repository queries with stable keyset pagination, ranked unique search, pair checking, short transactions, joined event names, and `caseCount: 0`.

### Task 3: Fastify REST API and PostgreSQL integration

**Files:**
- Create: `apps/api/src/features/relations/relationRoutes.ts`
- Create: `apps/api/test/relations.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/health.test.ts`

**Endpoints:**
- `GET /api/relations`
- `GET /api/relations/pair-check`
- `GET /api/relations/:relationId`
- `POST /api/relations`
- `PUT /api/relations/:relationId`

- [x] Write Testcontainers tests for list/search/pagination, create/detail/replace, rollback, self-loop, duplicate direction, reverse direction, pair-check, missing events, not found, case count zero, indexes, and OpenAPI paths.
- [x] Run focused integration tests and confirm relation endpoint failures.
- [x] Register routes before the parameterized detail route, use shared Zod validation, and map errors to stable 400/404/409/500 responses.
- [x] Register relation routes with the existing pool and preserve health/readiness construction without a pool.
- [x] Run all API unit and integration tests green.

### Task 4: Navigation, relation list, and inline expansion

**Files:**
- Create: `apps/web/src/features/relations/api/relationApi.ts`
- Create: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Create: `apps/web/src/features/relations/pages/RelationListPage.test.tsx`
- Create: `apps/web/src/features/relations/components/RelationExpandedDetails.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/styles/events.css`

**Behavior:**
- `/relations` stores `q` and `expanded` in the URL.
- The list uses 30-row cursor pages and one open row.
- A requested relation absent from the current page is shown as an expanded focused row above the table.

- [x] Write tests for navigation, loading, rows, event links, search debounce, pagination, empty/error states, inline expansion, collapse, URL state, and focused relation behavior; confirm missing pages fail.
- [x] Implement abortable 10-second relation API helpers with shared response parsing.
- [x] Add the relation navigation and routes without changing the established shell style.
- [x] Implement the list and lazy detail expansion using TanStack Query caches.
- [x] Add only relation-specific layout styles and run Web tests, typecheck, and build green.

### Task 5: Event selectors, confidence control, create, and edit

**Files:**
- Create: `apps/web/src/features/relations/components/EventSelector.tsx`
- Create: `apps/web/src/features/relations/components/ConfidenceInput.tsx`
- Create: `apps/web/src/features/relations/components/RelationForm.tsx`
- Create: `apps/web/src/features/relations/components/RelationForm.test.tsx`
- Create: `apps/web/src/features/relations/pages/RelationCreatePage.tsx`
- Create: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Create: `apps/web/src/features/relations/pages/RelationPages.test.tsx`
- Modify: `apps/web/src/features/relations/api/relationApi.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/styles/events.css`

**Behavior:**
- Event candidates reuse `GET /api/events/candidates` and show names only.
- Confidence state is `number | null`; create starts at 10%, edit uses the saved value, and the number and range controls stay synchronized.
- Pair-check blocks same direction and shows a nonblocking reverse warning.

- [x] Write component tests for selection, module link, self-loop, pair-check states, null confidence, slider/number sync, integer bounds, preserved input, and submit locking; confirm missing components fail.
- [x] Implement `EventSelector`, confidence controls, and `RelationForm` with semantic labels, alerts, keyboard support, debounce, and request cancellation.
- [x] Write route tests for create success, edit preload, full replacement, navigation to expanded list, and API failures; confirm missing pages fail.
- [x] Implement create/edit pages, invalidate list/pair/detail caches after writes, and avoid optimistic updates.
- [x] Run all Web tests and typecheck green.

### Task 6: Browser workflow, documentation, and handoff

**Files:**
- Create: `tests/e2e/relations.spec.ts`
- Modify: `tests/e2e/foundation.spec.ts`
- Modify: `README.md`
- Modify: `docs/stages/phase-1/P1-04-causal-relation-management-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

- [x] Write the failing Playwright workflow for search, create, expand, edit, duplicate blocking, reverse warning/creation, event navigation, and system readiness.
- [x] Implement remaining testability fixes and run Playwright green against the Colima PostgreSQL database.
- [x] Inspect list, expansion, create, and edit pages at 1280×800 and 1440×900; verify they match the established P1-03 UI baseline without a separate visual approval cycle.
- [x] Update README and set P1-04 to `等待人工复核`, then to `已完成` after user acceptance.
- [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `git diff --check`, database verification, and production-bundle secret scan.
- [x] Present exact results and a concise manual checklist; do not commit implementation or enter P1-05 until the user confirms successful verification.
