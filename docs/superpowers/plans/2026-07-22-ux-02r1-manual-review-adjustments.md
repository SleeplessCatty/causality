# UX-02R1 Manual Review Adjustments Implementation Plan

**Goal:** Implement the approved UX-02R1 revisions without entering Phase 2: consistent transient form errors, list-returning edit flows, relation UI fixes, independent graph query controls with entry-specific center reset rules, more readable graph elements, and the approved 50/80/50/100 text limits.

**Architecture:** Keep the current React/Fastify/PostgreSQL boundaries. Apply data-length rules in shared Contracts first, then align database schema and one forward-only migration. Reuse existing form error markup and add only timer lifecycle behavior. Keep Cytoscape and ELK; change viewport commit behavior, text fitting, selection classes, and stylesheet values without replacing the graph runtime.

**Tech Stack:** TypeScript 6, React 19, React Router 8, TanStack Query 5, Fastify 5, PostgreSQL 18, Drizzle ORM, Zod 4, Vitest 4, Testing Library, Playwright 1.61, Cytoscape 3, ELK.

## Global constraints

- Preserve the current compact desktop visual system and existing error positions/styles.
- Do not add Toast libraries, global state, new business fields, inference behavior, or Phase 2 features.
- Do not silently truncate existing data during migration.
- Node dimensions remain `220 × 96`; every event name must remain complete.
- Center changes from the toolbar and inspector intentionally have different parameter rules.
- Work in vertical TDD slices and commit each completed group.

## Task 1: Length contracts, schema, and migration

**Primary files:**

- `packages/contracts/src/events/eventSchemas.ts`
- `packages/contracts/src/cases/caseSchemas.ts`
- `packages/contracts/src/relations/relationSchemas.ts`
- `packages/contracts/src/causal-graph/causalGraphSchemas.ts`
- `apps/api/src/features/events/eventCursor.ts`
- `apps/api/src/features/cases/caseCursor.ts`
- `apps/api/src/database/schema/abstractEvents.ts`
- `apps/api/src/database/schema/eventAliases.ts`
- `apps/api/src/database/schema/concreteCases.ts`
- `database/migrations/0004_*.sql` and migration metadata
- related contract, cursor, integration, database-tool, and simulation tests

**TDD slices:**

1. Add red contract tests for event 50/51, alias 80/81, keyword 50/51, case 100/101, and updated case/event query limits.
2. Update schemas and cursor states until contract and cursor tests pass.
3. Add red integration tests proving API acceptance/rejection at the new boundaries.
4. Update Drizzle schema, generate migration, and inspect generated SQL.
5. Add a safe precondition for legacy over-limit event/alias/keyword rows and no truncation.
6. Run migration and database integration tests against PostgreSQL.
7. Update simulated/fixed test data assumptions and verify `db:verify` remains valid.

**Gate:** Contracts, API unit tests, targeted API integration tests, typecheck, and migration idempotency pass.

## Task 2: Form errors, edit returns, and relation case button

**Primary files:**

- `apps/web/src/features/events/components/EventForm.tsx`
- `apps/web/src/features/cases/components/CaseForm.tsx`
- `apps/web/src/features/relations/components/RelationForm.tsx`
- a small shared timer hook if duplication warrants it
- three `*EditPage.tsx` files
- `RelationCasesField.tsx`
- `apps/web/src/styles/events.css`
- related form/page tests

**TDD slices:**

1. Add red tests showing existing form-level and field-level errors disappear after 3 seconds.
2. Prove a second failed submit shows the same error again and restarts the timer.
3. Preserve existing markup, positions, `role="alert"`, conflict links, and styles while adding timer cleanup.
4. Add red page tests for event/relation/case edit cancel, top back link, and successful save returning to their lists.
5. Change only edit routes; preserve create success destinations.
6. Move “添加案例” after the rows/empty state and keep it right aligned, with a DOM-order regression test.
7. Align EventForm and CaseForm visible limits/help/counts with 50/80/50/100.

**Gate:** Targeted Web form/page tests and Web typecheck pass.

## Task 3: Event tips and relation list/detail fixes

**Primary files:**

- `DelayedOverflowTooltip.tsx`
- `EventListPage.tsx`
- `RelationListPage.tsx`
- `RelationDetailPage.tsx`
- `apps/web/src/styles/events.css`
- related page/component tests

**TDD slices:**

1. Add a red tooltip test for a non-empty, non-overflowing value and keep the 2-second hover/focus behavior.
2. Enable every non-empty metadata tooltip; keep empty cells without a tooltip.
3. Add style assertions/classes so cause, arrow, and effect links share hover/focus color and underline behavior, with no arrow hover background.
4. Convert the reproduced zero-case loading bug into a red relation-detail regression test.
5. Gate first-page loading on an actually enabled/fetching case query; preserve initial and next-page retry states.
6. Explicitly leave the “编辑因果关系” button unchanged.

**Gate:** Tooltip, event list, relation list, and relation detail tests pass.

## Task 4: Graph parameter semantics, fit, and visual readability

**Primary files:**

- `CausalGraphPage.tsx`
- `CausalGraphCanvas.tsx`
- `fitNodeLabel.ts`
- `graphStyles.ts`
- `createGraphRuntime.ts`
- related graph tests

**TDD slices:**

1. Add page tests proving direction/limit/confidence/case changes preserve the other three values.
2. Add distinct center-change tests:
   - toolbar selection resets to `both/20/0/0`;
   - inspector “设为中心” preserves all four parameters.
3. Add Canvas tests proving every committed 20/50/100 graph calls full `fit`.
4. Replace the 50/100 center-focus branch with full fit after successful relayout.
5. Add text-fitting tests for short, mixed, long, and 50-character names; choose the largest fitting size from 16 down to 9 without losing characters.
6. Add graph-style tests for 12px edge labels, no node underlay, larger arrows, and deterministic incoming/outgoing classes.
7. Add Runtime selection behavior so selected-node incoming edges are blue and outgoing edges warm orange; relation selection remains current green.

**Gate:** Complete causal-graph Web tests, typecheck, and production build pass.

## Task 5: Acceptance, documentation, and handoff

**Primary files:**

- relevant existing E2E specs plus a focused UX-02R1 spec if clearer
- `README.md`
- `UX-02R1-manual-review-adjustments-design.md`
- browser acceptance screenshots

**Acceptance coverage:**

1. Non-overflow metadata still shows the original tooltip after 2 seconds.
2. Create and edit errors remain in place, disappear at 3 seconds, and can reappear.
3. All three edit flows cancel/save back to lists.
4. Relation links, zero-case detail, and case-button order match the approved design.
5. Toolbar and inspector center changes obey different parameter semantics.
6. Direction/limit/confidence/case remain independent and every new graph fits the canvas.
7. Long names, graph labels, arrows, and incoming/outgoing colors are legible at 1280×720.
8. 50/80/50/100 limits work through the browser and API.

**Complete quality gate:**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
git diff --check
```

Use the in-app browser at 1280×720 and inspect final screenshots with `view_image`. Update the design status to “开发与自动化测试完成，等待人工复核”. Do not mark UX-02R1 complete or begin Phase 2 until the user confirms manual verification.
