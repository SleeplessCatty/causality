# P1-05 Concrete Case Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver independent concrete-case management and atomic many-to-many case associations for causal relations across PostgreSQL, Fastify, shared contracts, and the desktop React application.

**Architecture:** Replace the unreleased one-case-to-one-relation test model with `concrete_cases` and the `causal_relation_cases` join table. Shared Zod contracts define case and relation boundaries; Fastify case routes use a focused repository and service, while relation writes own the transaction that creates new cases and replaces relation links. React adds an independent case module and integrates a searchable case-row editor into the existing relation form.

**Tech Stack:** PostgreSQL 18.4, Drizzle ORM 0.45.2, Fastify 5.10.0, Zod 4.4.3, React 19.2.7, React Router 8.2.0, TanStack Query 5.101.3, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- Follow `docs/stages/phase-1/P1-05-concrete-case-management-design.md` exactly.
- Work directly on the user-approved `main` workspace; do not create a worktree or use subagents.
- Use TDD and observe each new behavior fail before implementing it.
- Reuse the existing global visual system; do not introduce a UI library, form library, or global state library.
- A case is one trimmed 1–50 character statement; do not add structured time, place, source, description, or attachments.
- Cases are independent and reusable through a many-to-many relation join; relation forms may contain zero cases.
- Candidate and search UI never display match reasons or scores.
- Case association changes never alter relation confidence.
- Do not implement deletion, merge, AI, semantic search, batch import, or graph functionality.
- Do not commit implementation until automated checks and user manual acceptance pass.

---

### Task 1: Shared case and relation contracts

**Files:**
- Create: `packages/contracts/src/cases/caseSchemas.ts`
- Create: `packages/contracts/test/cases.test.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/test/relations.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

```ts
type CaseSelection =
  | { type: 'existing'; caseId: string }
  | { type: 'new'; content: string };

type CaseReference = { id: string; content: string };
type CaseSummary = CaseReference & {
  relationCount: number;
  updatedAt: string;
};
type CaseDetail = CaseSummary & { createdAt: string };
```

- [ ] Write failing case contract tests for trimming, 1–50 character bounds, strict objects, list query defaults, `relationId`, candidate limit 10, summaries, details, relation pages, and error-code serialization.
- [ ] Extend relation contract tests first for mixed `caseSelections`, duplicate existing IDs, duplicate new content, real nonnegative `caseCount`, and at most five `recentCases`; confirm current contracts fail.
- [ ] Implement `caseContentSchema`, case form/list/candidate/relation-list schemas, response schemas, exported types, case error codes, and optional `existingId` on the shared strict API error response.
- [ ] Extend `relationFormInputSchema` with `caseSelections: z.array(caseSelectionSchema).default([])` and a refinement rejecting duplicate selections.
- [ ] Change `caseCount` from `z.literal(0)` to a nonnegative integer and add `recentCases: z.array(caseReferenceSchema).max(5)` to relation detail.
- [ ] Run `pnpm --filter @causality/contracts test` and `pnpm --filter @causality/contracts typecheck`; expect all contract tests green.

### Task 2: New database model, migration, and deterministic data tools

**Files:**
- Delete: `apps/api/src/database/schema/concreteCausalCases.ts`
- Create: `apps/api/src/database/schema/concreteCases.ts`
- Create: `apps/api/src/database/schema/causalRelationCases.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Modify: `apps/api/src/database/test-data/fixedSeed.ts`
- Modify: `apps/api/src/database/test-data/simulatedData.ts`
- Modify: `apps/api/src/database/test-data/simulate.ts`
- Modify: `apps/api/src/database/verify.ts`
- Modify: `apps/api/test/core-model.integration.test.ts`
- Modify: `apps/api/test/database-tools.integration.test.ts`
- Modify: `apps/api/test/simulation.test.ts`
- Create through Drizzle: `database/migrations/0003_concrete_case_management.sql`
- Modify through Drizzle: `database/migrations/meta/_journal.json`
- Create through Drizzle: `database/migrations/meta/0003_snapshot.json`

**Schema:**

```sql
create table concrete_cases (
  id uuid primary key default gen_random_uuid(),
  content varchar(50) not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (content = btrim(content) and char_length(content) between 1 and 50)
);

create table causal_relation_cases (
  causal_relation_id uuid not null references causal_relations(id) on delete restrict,
  concrete_case_id uuid not null references concrete_cases(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key (causal_relation_id, concrete_case_id)
);
```

- [ ] Replace old integration expectations with failing tests for both new tables, content checks, exact unique content, composite primary key, restrictive foreign keys, search/list indexes, and relation/case traversal indexes.
- [ ] Write failing data-tool tests that require independent, single-relation, and shared cases plus deterministic link generation; preserve explicit output counts for cases and relation-case links.
- [ ] Implement the two Drizzle schemas and update schema exports.
- [ ] Generate migration `0003`, inspect that it drops only the old case table, creates the two new tables and indexes, and leaves abstract events, aliases, and causal relations untouched.
- [ ] Rewrite fixed seed and simulation generators for the new model; keep `--cases` as the number of independent cases and derive deterministic associations from the same seed.
- [ ] Extend `db:verify` with `concreteCases`, `causalRelationCaseLinks`, invalid foreign keys, and duplicate-link integrity checks.
- [ ] Run focused unit tests, then `pnpm test:integration`; expect the migration and data-tool suites green.

### Task 3: Concrete-case cursor, repository, service, and REST API

**Files:**
- Create: `apps/api/src/features/cases/caseCursor.ts`
- Create: `apps/api/src/features/cases/caseRepository.ts`
- Create: `apps/api/src/features/cases/caseService.ts`
- Create: `apps/api/src/features/cases/caseRoutes.ts`
- Create: `apps/api/test/case-cursor.test.ts`
- Create: `apps/api/test/case-service.test.ts`
- Create: `apps/api/test/cases.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/health.test.ts`

**Repository boundary:**

```ts
interface CaseRepository {
  list(query: CaseListQuery): Promise<CaseListResponse>;
  candidates(query: CaseCandidateQuery): Promise<CaseCandidateResponse>;
  findById(id: string): Promise<CaseDetail | null>;
  listRelations(id: string, query: CaseRelationListQuery): Promise<CaseRelationListResponse>;
  create(input: CaseFormInput): Promise<CaseDetail>;
  replace(id: string, input: CaseFormInput): Promise<CaseDetail | null>;
  findByContent(content: string): Promise<CaseReference | null>;
}
```

- [ ] Write failing cursor tests for list/search/relation-filter state, malformed values, query mismatch, tampering, and version mismatch.
- [ ] Implement versioned Base64URL cursors bound to normalized `q` and `relationId`.
- [ ] Write failing service tests for not found, duplicate content with existing case ID, known PostgreSQL constraints, and unknown errors.
- [ ] Implement the case service and stable `CASE_NOT_FOUND` / `CASE_CONTENT_CONFLICT` errors.
- [ ] Write failing Testcontainers tests for list, search, relation filter, candidates, detail, relation pagination, create, replace, duplicate conflict, missing records, stable pagination, indexes, and OpenAPI paths.
- [ ] Implement parameterized repository queries with set-based relation counts, ranked content search, stable cursor pagination, and no per-row queries.
- [ ] Register routes in static-before-parameter order and register the case module from `buildApp` only when a pool exists.
- [ ] Run all API unit and integration tests green.

### Task 4: Atomic relation-case persistence and real relation summaries

**Files:**
- Modify: `apps/api/src/features/relations/relationRepository.ts`
- Modify: `apps/api/src/features/relations/relationService.ts`
- Modify: `apps/api/src/features/relations/relationRoutes.ts`
- Modify: `apps/api/test/relation-service.test.ts`
- Modify: `apps/api/test/relations.integration.test.ts`

**Behavior:**

```ts
interface RelationDetail {
  // existing fields remain
  caseCount: number;
  recentCases: CaseReference[];
}
```

- [ ] Extend relation integration tests first for real set-based counts, recent five ordered by `linked_at desc`, mixed existing/new selections, zero selections, shared cases, unlink-without-delete, unchanged confidence, and full rollback.
- [ ] Add failing service tests for missing selected cases, duplicate selection, new-content conflict, and mapping join/content database constraints to stable errors.
- [ ] Refactor relation repository reads to aggregate counts and query only five recent cases for normal detail; edit preload obtains the complete association set through paged `GET /api/cases?relationId=<id>` calls.
- [ ] Implement `create` and `replace` with a checked-out pool client and one transaction covering relation write, new-case creation, link insertion, and removed-link deletion.
- [ ] Ensure failed writes roll back both the relation and newly inserted cases; never auto-reuse a conflicting `new` selection.
- [ ] Update route error mapping and OpenAPI response schemas.
- [ ] Run relation unit and integration tests, then the complete API suite green.

### Task 5: Independent concrete-case Web module

**Files:**
- Create: `apps/web/src/features/cases/api/caseApi.ts`
- Create: `apps/web/src/features/cases/components/CaseForm.tsx`
- Create: `apps/web/src/features/cases/components/CaseForm.test.tsx`
- Create: `apps/web/src/features/cases/pages/CaseListPage.tsx`
- Create: `apps/web/src/features/cases/pages/CaseListPage.test.tsx`
- Create: `apps/web/src/features/cases/pages/CaseCreatePage.tsx`
- Create: `apps/web/src/features/cases/pages/CaseDetailPage.tsx`
- Create: `apps/web/src/features/cases/pages/CaseEditPage.tsx`
- Create: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/styles/events.css`

**Routes:**

```text
/cases
/cases/new
/cases/:caseId
/cases/:caseId/edit
```

- [ ] Write failing API-helper and page tests for navigation, list/search debounce, `relationId` filter, cursor pagination, loading/empty/error states, candidate-free form validation, duplicate conflict link, detail relation pagination, create navigation, edit warning, replace navigation, and input preservation.
- [ ] Implement abortable 10-second API helpers with shared error parsing and contract validation.
- [ ] Add the “具体案例” navigation item and four routes without changing the application shell style.
- [ ] Implement the case list with 30-row pages and URL-backed `q` / `relationId` state.
- [ ] Implement the one-field form with 50-character count, accessible errors, submit lock, and duplicate-case detail link.
- [ ] Implement detail and edit pages; linked relations navigate to `/relations?expanded=<id>`.
- [ ] Add only case-specific layout rules and run Web tests, typecheck, and production build green.

### Task 6: Case rows in relation forms and recent cases in relation detail

**Files:**
- Create: `apps/web/src/features/relations/components/CaseSelectorRow.tsx`
- Create: `apps/web/src/features/relations/components/RelationCasesField.tsx`
- Create: `apps/web/src/features/relations/components/RelationCasesField.test.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationCreatePage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationCreatePage.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.test.tsx`
- Modify: `apps/web/src/features/relations/api/relationApi.ts`
- Modify: `apps/web/src/styles/events.css`

**Form value:**

```ts
interface RelationFormValue {
  causeEvent: EventCandidate | null;
  effectEvent: EventCandidate | null;
  confidence: number | null;
  description: string | null;
  caseSelections: CaseSelection[];
}
```

- [ ] Write failing component tests for adding/removing rows, 250ms candidate search, candidate-only text, explicit “创建新案例”, 50-character validation, duplicate rows, zero rows, edit preload, preserved rows after failure, and disabled controls while saving.
- [ ] Implement reusable case selector rows with request cancellation, keyboard selection, explicit new-case confirmation, and no match reasons.
- [ ] Integrate `caseSelections` into relation validation and submission; new relation default is an empty array and edit loads every association by following the relation-filtered case-list cursor before rendering the form.
- [ ] Invalidate case lists/details/candidates and relation lists/details after relation writes.
- [ ] Extend relation inline detail with real count, five linked case references, case-detail links, and `/cases?relationId=<id>` for all cases.
- [ ] Run all Web tests, typecheck, and build green.

### Task 7: Browser workflow, documentation, and manual-review handoff

**Files:**
- Create: `tests/e2e/cases.spec.ts`
- Modify: `tests/e2e/relations.spec.ts`
- Modify: `tests/e2e/foundation.spec.ts`
- Modify: `README.md`
- Modify: `docs/stages/phase-1/P1-05-concrete-case-management-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-21-p1-05-concrete-case-management.md`

- [ ] Write failing Playwright workflows for independent create/search/edit, exact duplicate conflict, relation selection of existing and explicit new cases, shared reuse, unlink without deletion, zero cases, real count, recent five, and filtered “查看全部案例”.
- [ ] Implement remaining testability fixes and run Playwright green against the Colima PostgreSQL database.
- [ ] Inspect case and updated relation pages at 1280×800 and 1440×900; verify keyboard focus, row wrapping, candidate overlays, error messages, and no horizontal overflow.
- [ ] Rebuild fixed and 10,000-case simulated development data, then run `pnpm db:verify` and record both case and association counts.
- [ ] Update README and set P1-05 to `等待人工复核` without entering P1-06.
- [ ] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `git diff --check`, database verification, and production-bundle secret scan.
- [ ] Present exact results and the P1-05 manual checklist; keep implementation uncommitted until the user confirms successful verification.
