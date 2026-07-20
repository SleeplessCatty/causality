# P1-03 Abstract Event Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved abstract atomic event create, list, traditional search, detail, and edit workflow across PostgreSQL, Fastify, shared contracts, and the desktop React application.

**Architecture:** Shared Zod contracts define every HTTP boundary. Fastify routes delegate to a focused event service and PostgreSQL repository that share the existing pool. The React application uses route pages and TanStack Query; event writes use full-replacement PUT semantics and list browsing uses opaque keyset cursors.

**Tech Stack:** PostgreSQL 18.4, Drizzle ORM 0.45.2, Fastify 5.10.0, Zod 4.4.3, React 19.2.7, React Router 8.2.0, TanStack Query 5.101.3, Vitest 4.1.10, Playwright.

## Global Constraints

- Follow `docs/stages/phase-1/P1-03-abstract-event-management-design.md` exactly.
- Work directly on the user-approved `main` workspace; do not create a worktree.
- Use TDD: each behavior must be observed failing before its implementation is added.
- Do not add deletion, relation management, semantic search, AI, authentication, a UI library, a form library, or a global state library.
- Candidate responses and UI must never expose match reason or score.
- Preserve the existing P1-02 model meaning and use one shared PostgreSQL pool.
- Do not commit implementation until automated checks and user manual acceptance both pass.
- Treat the approved textual design as authoritative. Use the generated list and form images only for visual tokens, density, and control styling.

---

### Task 1: Shared event contracts and search migration

**Files:**
- Create: `packages/contracts/src/events/eventSchemas.ts`
- Create: `packages/contracts/src/events/eventSchemas.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/database/schema/abstractEvents.ts`
- Modify: `apps/api/src/database/schema/eventAliases.ts`
- Create through Drizzle: `database/migrations/0001_event_management.sql`
- Modify through Drizzle: `database/migrations/meta/_journal.json`
- Create through Drizzle: `database/migrations/meta/0001_snapshot.json`

**Interfaces:**
- Produces `eventFormInputSchema`, `eventListQuerySchema`, `eventCandidateQuerySchema`, `eventSummarySchema`, `eventDetailSchema`, `eventCandidateSchema`, `eventListResponseSchema`, `apiErrorSchema` and inferred types.
- Produces trigram indexes for normalized event names and aliases plus `(updated_at desc, id desc)` list index.

- [ ] Write contract tests for valid inputs, trimmed empty names, lengths, list limits, duplicate aliases/keywords, UUIDs, response shapes, and absence of candidate match metadata.
- [ ] Run `pnpm --filter @causality/contracts test` and confirm failures because event schemas do not exist.
- [ ] Implement the exact schemas and a case-insensitive normalized-duplicate refinement for aliases and keywords.
- [ ] Run the contract tests and full contract typecheck; confirm green.
- [ ] Add index declarations to Drizzle schema, generate migration `0001_event_management`, and inspect SQL for `create extension if not exists pg_trgm`, two GIN trigram indexes, and the list cursor index.
- [ ] Extend the migration integration test to run both migrations twice and assert all new indexes; observe red, then green.

### Task 2: Cursor, repository, and event service

**Files:**
- Create: `apps/api/src/features/events/eventCursor.ts`
- Create: `apps/api/src/features/events/eventCursor.test.ts`
- Create: `apps/api/src/features/events/eventRepository.ts`
- Create: `apps/api/src/features/events/eventService.ts`
- Create: `apps/api/src/features/events/eventService.test.ts`

**Interfaces:**
- `encodeEventCursor(state: EventCursorState): string`
- `decodeEventCursor(cursor: string, query: string): EventCursorState`
- `EventRepository` exposes `list`, `findCandidates`, `findById`, `create`, and `replace`.
- `EventService` exposes the same application operations and maps database conflicts to typed service errors.

- [ ] Write cursor tests for default-list and ranked-search states, malformed input, version mismatch, tampering, and query mismatch.
- [ ] Run the focused test and confirm missing-module failures.
- [ ] Implement versioned Base64URL cursor encoding with a query fingerprint; run tests to green.
- [ ] Write service tests using a complete in-memory repository double for normalization, not found, name conflict, alias conflict, and unknown failure behavior.
- [ ] Run tests and confirm service module failures.
- [ ] Implement service normalization and typed `EventServiceError`; run focused and API unit tests to green.
- [ ] Implement repository queries using parameterized SQL/Drizzle, `limit + 1`, stable keyset conditions, one batch alias query, ranked unique search results, and short write transactions.

### Task 3: Fastify event REST API and PostgreSQL integration

**Files:**
- Create: `apps/api/src/features/events/eventRoutes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/test/events.integration.test.ts`
- Modify: `apps/api/test/health.test.ts`

**Interfaces:**
- Registers `GET /api/events`, `GET /api/events/candidates`, `GET /api/events/:eventId`, `POST /api/events`, and `PUT /api/events/:eventId`.
- `buildApp` accepts the shared database pool/service dependency while preserving health-only unit construction.

- [ ] Write Testcontainers integration tests for create, normalized conflict, shared aliases across events, detail, full replacement edit, rollback, not found, list pagination, name/alias/keyword search, ranking, candidate shape, and index presence.
- [ ] Run `pnpm test:integration` and confirm event endpoint 404/module failures.
- [ ] Register event routes with Zod request/response schemas and map service errors to 400/404/409/500 without leaking internals.
- [ ] Pass the existing production pool into event registration and preserve graceful shutdown.
- [ ] Run event integration tests to green, then all API unit and integration tests.
- [ ] Extend OpenAPI assertions to require all five event paths and ensure `/api/openapi.json` remains valid.

### Task 4: Application shell and event list page

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/AppShell.tsx`
- Create: `apps/web/src/features/events/api/eventApi.ts`
- Create: `apps/web/src/features/events/pages/EventListPage.tsx`
- Create: `apps/web/src/features/events/pages/EventListPage.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- `/` redirects to `/events`; `/system` preserves `SystemStatus`.
- `getEvents`, `getEventCandidates`, and `getEvent` parse responses with shared Zod schemas.
- List query key is `['events', 'list', q, cursor]`.

- [ ] Write router and list tests for redirect, navigation, loading, populated table, empty data, search URL synchronization, request delay, failure retry, and previous/next cursor navigation.
- [ ] Run focused Web tests and confirm missing route/page failures.
- [ ] Implement the shared shell and route structure without disabled future navigation.
- [ ] Implement abortable 10-second API fetch helpers and the TanStack Query list page.
- [ ] Apply the approved visual system: 68px header, 1280px open content container, full-width search/table, restrained borders/radii, deliberate table/control typography, focus styles, and 960px desktop minimum.
- [ ] Run focused tests, Web typecheck, and Web build to green.

### Task 5: Event form, create/edit pages, and detail page

**Files:**
- Create: `apps/web/src/features/events/components/TagInput.tsx`
- Create: `apps/web/src/features/events/components/EventForm.tsx`
- Create: `apps/web/src/features/events/components/EventForm.test.tsx`
- Create: `apps/web/src/features/events/pages/EventCreatePage.tsx`
- Create: `apps/web/src/features/events/pages/EventEditPage.tsx`
- Create: `apps/web/src/features/events/pages/EventDetailPage.tsx`
- Create: `apps/web/src/features/events/pages/EventPages.test.tsx`
- Modify: `apps/web/src/features/events/api/eventApi.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- `EventForm` receives mode, initial value, candidate exclusion ID, submit callback, and cancel destination.
- API helpers `createEvent` and `replaceEvent` use shared request/response schemas.
- Routes `/events/new`, `/events/:eventId`, and `/events/:eventId/edit` implement the approved workflow.

- [ ] Write TagInput/EventForm tests for Enter and comma confirmation, removal labels, duplicate/limit validation, atomic naming guidance, candidates with names only, submit locking, field errors, and preserved input on failure.
- [ ] Run focused tests and confirm missing component failures.
- [ ] Implement TagInput and EventForm with semantic labels, alerts, keyboard behavior, and candidate debounce.
- [ ] Write route-page tests for create success, edit preload/save, detail display, missing description, API not found, and cache invalidation/navigation.
- [ ] Run tests and confirm missing page failures.
- [ ] Implement create, edit, and detail pages with TanStack Query mutations and no optimistic updates.
- [ ] Complete standalone form/detail styling according to the approved route-page layout, not the discarded drawer concept.
- [ ] Run all Web tests and typecheck to green.

### Task 6: Browser workflow, visual QA, documentation, and handoff

**Files:**
- Create: `tests/e2e/events.spec.ts`
- Modify: `tests/e2e/foundation.spec.ts` if route expectations change
- Modify: `README.md`
- Modify: `docs/stages/phase-1/P1-03-abstract-event-management-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

**Interfaces:**
- Playwright validates list/search/create/detail/edit/conflict/system-status against real PostgreSQL.
- Final stage status becomes `等待人工复核`, never `已完成` before user confirmation.

- [ ] Write the browser test first and confirm failure on the first missing P1-03 interaction.
- [ ] Implement any remaining testability/accessibility fixes, then run browser tests to green.
- [ ] Start the real stack and inspect the list, create, detail, and edit pages at 1280×800 and 1440×900.
- [ ] Capture current implementation screenshots and compare with both visual references using `view_image`; record at least five checks for layout, typography, palette, density, controls, and copy.
- [ ] Fix every visible clipping, wrapping, spacing, focus, or prototype-quality issue and repeat visual inspection.
- [ ] Update README and set P1-03 status to `等待人工复核`.
- [ ] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `git diff --check`, and a production-bundle secret scan.
- [ ] Present exact automated results and a concise manual browser checklist; do not commit or enter P1-04 until the user reports successful verification.
