# UX-03 Long Text Overflow and Tooltip Implementation Plan

**Goal:** Implement the approved UX-03 design so long unbroken business text cannot distort compact pages, truncated DOM text exposes its full value through one scrollable Portal tooltip, and causal-graph nodes use fixed 22px three-line labels with full names available in the inspector.

**Architecture:** Deepen the existing delayed tooltip into a shared `OverflowText` module that owns clamping, overflow measurement, delayed/focus activation, Portal positioning, viewport collision handling, and scroll-safe close behavior. Keep editable text complete and use native input/textarea scrolling. Keep Cytoscape and ELK; replace adaptive graph label sizing with deterministic 22px measured wrapping and three-line ellipsis.

**Tech Stack:** TypeScript 6, React 19, React DOM Portal, React Router 8, TanStack Query 5, Vitest 4, Testing Library, Playwright, Cytoscape 3, ELK.

## Constraints

- Follow `docs/stages/pre-phase-2/UX-03-long-text-overflow-tooltip-design.md` exactly.
- Preserve the compact desktop design, page structure, navigation, field limits, API and database.
- Preserve the event-list rule that every non-empty alias/keyword value set has a tooltip.
- Do not introduce a third-party tooltip, positioning, state, or styling dependency.
- Do not truncate submitted or cached business data.
- Graph nodes remain `220 × 96`, use fixed `22px`, show at most three lines, and never open a hover tooltip.
- Work in vertical red-green slices and run Web typechecking after each major slice.

## Task 1: Shared overflow module

**Primary files:**

- `apps/web/src/shared/tooltip/OverflowText.tsx`
- `apps/web/src/shared/tooltip/OverflowText.test.tsx`
- existing `DelayedOverflowTooltip` callers/tests
- `apps/web/src/styles/events.css`

**Slices:**

1. Add failing public-interface tests for overflow-only and always modes.
2. Implement single/multiline clamping and DOM overflow measurement.
3. Add failing timer, focus, Escape, trigger-to-tooltip hover, Portal, positioning and scroll tests.
4. Implement fixed-width/max-height Portal tooltip and lifecycle cleanup.
5. Migrate event metadata and remove the shallow legacy implementation after callers move.

## Task 2: Events, relations, cases and candidates

**Primary files:** relevant page/form files under `features/events`, `features/relations`, and `features/cases`, plus `EventSelector`, `CaseSelectorRow`, `GraphEventSelector`, and related tests.

**Slices:**

1. Events: list name/metadata, detail title/description/tags, form tags and duplicate candidates.
2. Relations: list endpoints/expanded content, detail endpoints/description/cases, form selected values and candidates.
3. Cases: list content, detail title/relation entries, editable textarea wrapping.
4. Add page tests proving full text stays in the DOM while clamping and tooltip policies are applied.
5. Preserve virtual-list item heights and keyboard selection behavior.

## Task 3: Causal graph

**Primary files:**

- `fitNodeLabel.ts` and tests
- `createGraphElements.ts` and tests
- `graphStyles.ts`
- `GraphEventSelector.tsx`
- `CausalGraphInspector.tsx`
- `causalGraph.css`

**Slices:**

1. Add failing measured-label tests for fixed 22px, three lines, continuous Latin, CJK, mixed text and ellipsis width.
2. Replace adaptive sizes with deterministic measured wrapping and retain full node `name` separately.
3. Lock graph style to 22px, three-line geometry and anywhere wrapping.
4. Apply overflow treatment to the toolbar selector only; keep graph nodes tooltip-free.
5. Make every inspector business field wrap anywhere without truncation.

## Task 4: Verification and delivery

1. Run Web tests, typecheck, lint, Prettier and production build.
2. Run repository tests and integration/E2E checks in proportion to the UI-only change.
3. Verify at 1280×720 and 1440×900 in Browser/IAB with boundary-length continuous Latin data where practical.
4. Inspect final screenshots with `view_image`, including tables, a detail/form surface, candidates/tooltip, and the graph.
5. Run two-axis standards/spec review from the pre-UX-03 commit, resolve findings, update design status, and commit.

## Acceptance gate

- No business text creates horizontal page overflow or changes fixed table/list geometry.
- Tooltip is 360px wide, max 240px high, Portal-rendered, viewport-contained, scrollable, and keyboard dismissible.
- Editing remains complete and usable.
- Graph nodes are fixed 22px, maximum three lines, ellipsized when required, and expose full names only through selection plus inspector.
- All automated quality gates pass and the user receives a manual verification checklist.
