# P1-09 Local Graph Expansion, Filter, and Layout Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL-restorable 20 → 50 → 100 local-graph expansion, explicit confidence/case filters, stop-state guidance, and transactional full ELK relayout while keeping the previous graph usable until the replacement is ready.

**Architecture:** Keep query parsing and transitions in framework-free pure functions, add focused filter/status React components, and let `CausalGraphPage` coordinate the requested query separately from the last successfully committed graph. `CausalGraphCanvas` continues to stage ELK work off-screen, but reports successful graph commits so page interaction state changes only after an atomic Runtime commit; the Runtime adds one narrow large-graph viewport method.

**Tech Stack:** React 19.2.7, React Router 8.2.0, TanStack Query 5.101.3, TypeScript 6.0.2, Cytoscape.js 3.34.0, cytoscape-elk 2.3.0, elkjs 0.12.0, Vitest 4.1.10, React Testing Library 16.3.2, Playwright 1.61.1.

**Status:** 已完成开发、自动化测试、真实浏览器视觉复核和用户人工验收（2026-07-21）。

## Global Constraints

- Implement only the approved P1-09 design in `docs/stages/phase-1/P1-09-local-graph-expansion-filter-layout-design.md`.
- Keep the existing desktop-first visual system; use the accepted compact toolbar + filter popover + persistent query-status-bar concept.
- Do not add dependencies, backend endpoints, shared-contract changes, database changes, another layout engine, full-match counts, or expansion beyond 100.
- Treat `limit` as related nodes excluding the center; supported values are exactly `20 | 50 | 100` with relation limits `200 | 500 | 1000` supplied by the existing API.
- Use test-driven development: every production behavior starts with a focused failing test and an observed expected failure.
- Preserve P1-08 selection, keyboard navigation, inspector, drag, Zoom, and Pan behavior on the currently committed graph while a replacement is pending or failed.
- A successful replacement clears selection, closes the inspector, discards dragged positions, and establishes a new viewport.
- The initial 50/100 viewport centers the center event with minimum zoom `0.6`; the user-triggered fit command remains unrestricted down to Runtime `minZoom=0.25`.

---

### Task 1: Pure query-state parsing, canonicalization, and transitions

**Files:**
- Create: `apps/web/src/features/causal-graph/graph/graphQueryState.ts`
- Create: `apps/web/src/features/causal-graph/graph/graphQueryState.test.ts`

**Interfaces:**
- Consumes: `CausalGraphQuery`, `CausalGraphResponse`, and `CausalGraphStopReason` from `@causality/contracts`.
- Produces: `GraphQueryState`, `DEFAULT_GRAPH_QUERY_STATE`, `parseGraphQueryState`, `toGraphSearchParams`, `nextGraphLimit`, `activeGraphFilterCount`, `validateGraphFilterDraft`, and `graphQueryStatus`.

- [ ] **Step 1: Write failing tests for URL defaults and canonicalization**

```ts
it('canonicalizes unsupported URL values to safe defaults', () => {
  const parsed = parseGraphQueryState(
    new URLSearchParams(
      `centerEventId=${centerEventId}&direction=sideways&limit=75&minConfidence=101&minCaseCount=-1`,
    ),
  );
  expect(parsed.state).toEqual({
    centerEventId,
    direction: 'both',
    limit: 20,
    minConfidence: 0,
    minCaseCount: 0,
  });
  expect(parsed.needsCanonicalization).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure**

Run: `pnpm --filter @causality/web test -- graphQueryState.test.ts`  
Expected: FAIL because `graphQueryState.ts` does not exist.

- [ ] **Step 3: Implement typed parsing and serialization**

```ts
export type GraphLimit = CausalGraphQuery['limit'];
export type GraphQueryState = Pick<
  CausalGraphQuery,
  'centerEventId' | 'direction' | 'limit' | 'minConfidence' | 'minCaseCount'
>;

export const DEFAULT_GRAPH_QUERY_STATE = {
  direction: 'both',
  limit: 20,
  minConfidence: 0,
  minCaseCount: 0,
} as const;

export function parseGraphQueryState(search: URLSearchParams): {
  state: GraphQueryState;
  needsCanonicalization: boolean;
};

export function toGraphSearchParams(state: GraphQueryState): URLSearchParams;
```

Parsing accepts only the exact direction and limit sets, finite base-10 integer filters in range, and leaves the center ID string available for the page's existing UUID validation. Serialization writes all five parameters in stable order.

- [ ] **Step 4: Add failing tests for tiers, filters, and stop-state view models**

```ts
expect(nextGraphLimit(20)).toBe(50);
expect(nextGraphLimit(50)).toBe(100);
expect(nextGraphLimit(100)).toBeNull();
expect(activeGraphFilterCount({ minConfidence: 60, minCaseCount: 0 })).toBe(1);
expect(validateGraphFilterDraft({ minConfidence: '60', minCaseCount: '2' })).toEqual({
  success: true,
  values: { minConfidence: 60, minCaseCount: 2 },
});
expect(graphQueryStatus(graphWith('exhausted', 20)).action).toBe('none');
expect(graphQueryStatus(graphWith('node_limit', 20)).nextLimit).toBe(50);
expect(graphQueryStatus(graphWith('relation_limit', 100)).action).toBe('adjust_filter');
```

- [ ] **Step 5: Run tests to verify the new assertions fail for missing functions**

Run: `pnpm --filter @causality/web test -- graphQueryState.test.ts`  
Expected: FAIL on undefined tier/filter/status exports.

- [ ] **Step 6: Implement the minimal pure helpers and make the focused tests pass**

`validateGraphFilterDraft` returns field-specific Chinese errors without coercing blank, decimal, signed-negative, or out-of-range strings. `graphQueryStatus` returns only approved copy and actions for `exhausted`, `node_limit`, and `relation_limit`; it never returns a complete or remaining count.

Run: `pnpm --filter @causality/web test -- graphQueryState.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit the pure query-state slice**

```bash
git add apps/web/src/features/causal-graph/graph/graphQueryState.ts apps/web/src/features/causal-graph/graph/graphQueryState.test.ts
git commit -m "feat: add local graph query state"
```

---

### Task 2: Parameterized graph API and focused filter/status components

**Files:**
- Modify: `apps/web/src/features/causal-graph/api/causalGraphApi.ts`
- Modify: `apps/web/src/features/causal-graph/api/causalGraphApi.test.ts`
- Create: `apps/web/src/features/causal-graph/components/GraphFilterPopover.tsx`
- Create: `apps/web/src/features/causal-graph/components/GraphFilterPopover.test.tsx`
- Create: `apps/web/src/features/causal-graph/components/GraphQueryStatus.tsx`
- Create: `apps/web/src/features/causal-graph/components/GraphQueryStatus.test.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.test.tsx`

**Interfaces:**
- Consumes: Task 1 query/filter helpers and the existing `CausalGraphResponse.meta`.
- Produces: `getCausalGraph(query, signal)`, `GraphFilterPopover`, and `GraphQueryStatus`; toolbar exposes `filterCount`, `filterOpen`, and `onFilterToggle`.

- [ ] **Step 1: Write a failing API test for all query parameters**

```ts
await getCausalGraph({
  centerEventId,
  direction: 'downstream',
  limit: 50,
  minConfidence: 60,
  minCaseCount: 2,
});
expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
  `direction=downstream&limit=50&minConfidence=60&minCaseCount=2`,
);
```

Run: `pnpm --filter @causality/web test -- causalGraphApi.test.ts`  
Expected: FAIL because the current API accepts direction separately and hardcodes `20/0/0`.

- [ ] **Step 2: Change the API client to serialize the complete query and pass the test**

```ts
export async function getCausalGraph(
  query: CausalGraphQuery,
  signal?: AbortSignal,
): Promise<CausalGraphResponse> {
  const parameters = new URLSearchParams({
    centerEventId: query.centerEventId,
    direction: query.direction,
    limit: String(query.limit),
    minConfidence: String(query.minConfidence),
    minCaseCount: String(query.minCaseCount),
  });
  // existing timeout, error parsing, and response validation remain
}
```

Run: `pnpm --filter @causality/web test -- causalGraphApi.test.ts`  
Expected: PASS.

- [ ] **Step 3: Write failing filter-popover interaction tests**

Cover opening values, draft-only edits, invalid integer/range errors, Apply, immediate Reset, outside-click discard, and `Escape` discard. The test calls real callbacks and verifies no Apply callback occurs before explicit submission.

Run: `pnpm --filter @causality/web test -- GraphFilterPopover.test.tsx`  
Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement the accessible filter popover**

```ts
interface GraphFilterPopoverProps {
  open: boolean;
  values: Pick<GraphQueryState, 'minConfidence' | 'minCaseCount'>;
  onApply(values: GraphFilterValues): void;
  onReset(): void;
  onClose(): void;
}
```

Use a labelled popover region, labelled numeric text inputs with explicit input modes, inline `role="alert"` validation, focus the confidence input on open, and install document pointer/key listeners only while open. Reinitialize drafts from applied values on every open.

Run: `pnpm --filter @causality/web test -- GraphFilterPopover.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Write failing status-bar tests for all stop states**

Verify `exhausted` has no expansion, 20/50 node/relation limits call the exact next tier, 100 calls Adjust Filter, pending disables the action, and query/layout failure exposes Retry plus “仍显示上一查询结果”.

Run: `pnpm --filter @causality/web test -- GraphQueryStatus.test.tsx`  
Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement the query status bar and toolbar filter entry**

```ts
interface GraphQueryStatusProps {
  displayedGraph: CausalGraphResponse | null;
  requestedQuery: GraphQueryState;
  isPending: boolean;
  errorKind: 'query' | 'layout' | null;
  onExpand(limit: GraphLimit): void;
  onAdjustFilter(): void;
  onRetry(): void;
}
```

The component uses the last committed graph for counts/stop reason and requested query for the loading/error target. The toolbar filter button uses `aria-expanded`, `aria-controls`, and the visible label `筛选` or `筛选 N`.

Run: `pnpm --filter @causality/web test -- GraphFilterPopover.test.tsx GraphQueryStatus.test.tsx CausalGraphToolbar.test.tsx`  
Expected: PASS.

- [ ] **Step 7: Commit the parameterized API and presentational UI slice**

```bash
git add apps/web/src/features/causal-graph/api apps/web/src/features/causal-graph/components
git commit -m "feat: add graph filters and query status"
```

---

### Task 3: Transactional Canvas commit and readable large-graph viewport

**Files:**
- Modify: `apps/web/src/features/causal-graph/graph/createGraphRuntime.ts`
- Modify: `apps/web/src/features/causal-graph/graph/createGraphRuntime.test.ts`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.test.tsx`

**Interfaces:**
- Consumes: existing staged `layout` and atomic `commit` Runtime methods.
- Produces: `GraphRuntime.focusNode(id, padding, minimumZoom)`, Canvas `onGraphCommit(graph)`, and layout-state reporting that leaves the last committed graph visible on failure.

- [ ] **Step 1: Write failing Canvas tests for commit timing and viewport policy**

```ts
expect(onGraphCommit).not.toHaveBeenCalled();
act(() => fake.completeLayout());
expect(fake.runtime.commit).toHaveBeenCalled();
expect(onGraphCommit).toHaveBeenCalledWith(graph50);
expect(fake.runtime.focusNode).toHaveBeenCalledWith(centerEventId, 48, 0.6);
```

Also rerender from an already committed graph to a pending graph, fail the layout, and assert the Canvas data counts and navigation source remain the old committed graph.

Run: `pnpm --filter @causality/web test -- CausalGraphCanvas.test.tsx`  
Expected: FAIL because Canvas exposes candidate data before commit and Runtime lacks `focusNode`.

- [ ] **Step 2: Implement internal committed-graph state and callback ordering**

```ts
interface CausalGraphCanvasProps {
  graph: CausalGraphResponse | null; // requested candidate
  onGraphCommit?: (graph: CausalGraphResponse) => void;
  // existing props remain
}
```

Capture the candidate graph in each layout run. On valid success: Runtime commit, establish viewport, set internal committed graph, apply the current selection only when it belongs to that committed graph, report ready, then call `onGraphCommit`. On error: report error without changing internal committed graph or visible Runtime elements. Ignore stale callbacks using the existing run counter.

- [ ] **Step 3: Write a failing Runtime test for center-focused readable zoom**

Use the real Cytoscape Runtime with a fixed-size container, commit positioned elements, call `focusNode(centerEventId, 48, 0.6)`, and assert zoom is at least `0.6` and the method safely ignores a missing ID.

Run: `pnpm --filter @causality/web test -- createGraphRuntime.test.ts`  
Expected: FAIL because `focusNode` does not exist.

- [ ] **Step 4: Implement the narrow Runtime viewport method**

```ts
focusNode(id, padding, minimumZoom) {
  const node = visible.getElementById(id);
  visible.fit(visible.elements(), padding);
  if (visible.zoom() < minimumZoom) visible.zoom(minimumZoom);
  if (!node.empty()) visible.center(node);
}
```

Canvas uses ordinary `fit(48, false)` at 20 and `focusNode(centerEventId, 48, 0.6)` at 50/100. The imperative Fit command continues calling ordinary Runtime fit.

- [ ] **Step 5: Run Canvas and Runtime tests and refactor only after green**

Run: `pnpm --filter @causality/web test -- createGraphRuntime.test.ts CausalGraphCanvas.test.tsx`  
Expected: PASS with stale-layout, failure-retention, 20-fit, 50/100-readable-viewport, and existing interaction tests green.

- [ ] **Step 6: Commit the transactional layout slice**

```bash
git add apps/web/src/features/causal-graph/graph/createGraphRuntime.ts apps/web/src/features/causal-graph/graph/createGraphRuntime.test.ts apps/web/src/features/causal-graph/components/CausalGraphCanvas.tsx apps/web/src/features/causal-graph/components/CausalGraphCanvas.test.tsx
git commit -m "feat: make graph layout replacement transactional"
```

---

### Task 4: Page orchestration, URL restoration, and old-graph failure retention

**Files:**
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx`
- Modify: `apps/web/src/features/causal-graph/causalGraph.css`

**Interfaces:**
- Consumes: Tasks 1–3 helpers/components and Canvas commit callback.
- Produces: the complete user flow with requested query separated from `lastGraph` (the last successfully committed graph).

- [ ] **Step 1: Update page mocks and write failing URL/query transition tests**

Test exact five-parameter URLs and complete query objects for:

- selecting a search result: `both`, preserved filters, `limit=20`;
- setting a graph node as center: preserved direction/filters, `limit=20`;
- changing direction: preserved filters, `limit=20`;
- expanding: preserved center/direction/filters, next limit;
- applying/resetting filters: `limit=20`;
- refresh and browser history restoration;
- invalid parameter canonicalization with `replace`.

Run: `pnpm --filter @causality/web test -- CausalGraphPage.test.tsx`  
Expected: FAIL because the page currently stores only center/direction and API calls fixed values.

- [ ] **Step 2: Implement requested query and canonical URL state**

Derive the requested query with `parseGraphQueryState(searchParams)`, canonicalize invalid values in an effect, and use this complete key:

```ts
queryKey: [
  'causal-graph',
  query.centerEventId,
  query.direction,
  query.limit,
  query.minConfidence,
  query.minCaseCount,
]
```

All event handlers construct a full `GraphQueryState` and call one `setGraphQuery(next, options?)` serializer. Keep no duplicated query defaults in event handlers.

- [ ] **Step 3: Write failing transactional page tests**

Start with a committed graph and an open inspector, trigger a new query, and assert old counts/selection/inspector remain while the Canvas has not called `onGraphCommit`. Then invoke the mocked commit callback and assert the new counts appear, selection clears, and inspector closes. Reject the request and assert the old graph plus interaction state remain with Retry status.

Run: `pnpm --filter @causality/web test -- CausalGraphPage.test.tsx`  
Expected: FAIL because current page assigns query data to `lastGraph` and clears interaction immediately.

- [ ] **Step 4: Implement transactional page orchestration**

- `lastGraph` changes only in Canvas `onGraphCommit`;
- `displayedGraph` is exactly `lastGraph`, never raw pending query data;
- Canvas receives `graphQuery.data ?? null` as the requested candidate;
- Canvas commit clears selection and closes inspector;
- query/layout failure retains `lastGraph` and all interaction state;
- initial failure uses the existing canvas error overlay, while failure with `lastGraph` uses `GraphQueryStatus`;
- the inspector receives the committed graph center ID while an old graph is displayed;
- retry chooses API refetch or Canvas `retryLayout` from the current error kind.

- [ ] **Step 5: Integrate filter/status UI and approved styles**

Add the filter popover adjacent to its toolbar trigger and the status bar between toolbar and workbench. Use existing white/green tokens, 11–13px explicit control typography, 8px control radii, restrained borders, and no new card container. Update canvas/inspector height calculations for the added status row, and preserve 1280×720 usability.

- [ ] **Step 6: Run focused page, component, and Canvas tests**

Run: `pnpm --filter @causality/web test -- CausalGraphPage.test.tsx CausalGraphToolbar.test.tsx GraphFilterPopover.test.tsx GraphQueryStatus.test.tsx CausalGraphCanvas.test.tsx`  
Expected: PASS.

- [ ] **Step 7: Commit the integrated P1-09 page**

```bash
git add apps/web/src/features/causal-graph
git commit -m "feat: integrate local graph expansion and filters"
```

---

### Task 5: Browser regression, visual fidelity, and documentation

**Files:**
- Create: `tests/e2e/causal-graph-expansion-filter.spec.ts`
- Modify: `tests/e2e/causal-graph.spec.ts`
- Modify: `README.md`
- Modify after user acceptance only: `docs/stages/phase-1/P1-09-local-graph-expansion-filter-layout-design.md`
- Modify after user acceptance only: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

**Interfaces:**
- Consumes: complete P1-09 browser surface and deterministic API/seed behavior.
- Produces: automated expansion/filter/history/layout regression evidence and an executable manual-review checklist.

- [ ] **Step 1: Write failing Playwright scenarios**

Cover exact URL parameters, filter Apply/Reset, 20→50→100 availability from stop reasons, exhausted no-expand, 100 Adjust Filter, direction/center reset to 20 while preserving filters, browser reload/history, old-graph retention on an intercepted query failure, and no console errors.

Run: `pnpm exec playwright test tests/e2e/causal-graph-expansion-filter.spec.ts`  
Expected: FAIL on the first unimplemented or incorrect browser behavior; fix the product behavior rather than weakening assertions.

- [ ] **Step 2: Add 50/100 visual and Runtime assertions**

At 1280×720 capture:

- filter popover open;
- 50-node state/status row;
- 100-node maximum/Adjust Filter state.

Assert Canvas is ready, center ID is present in the Runtime snapshot/test hook, initial zoom is at least 60% for 50/100, and node/relationship selection plus inspector still operate.

- [ ] **Step 3: Run focused and full automated gates**

Run in order:

```bash
pnpm --filter @causality/web test
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git diff --check
```

Expected: every command exits 0; report exact test counts and any unchanged build warning.

- [ ] **Step 4: Perform accepted-concept fidelity verification**

Use the accepted concept source at `.superpowers/brainstorm/91049-1784641810/content/filter-expansion-layout.html`. Capture it and the implemented 1280×720 page using the built-in browser when available, otherwise Playwright. Inspect both images with `view_image`, compare at least toolbar density, filter popover placement, status-row hierarchy, typography, colors/borders, canvas height, action labels, and 100-limit state. Fix all material mismatches and record only unavoidable intentional deviations.

- [ ] **Step 5: Update README with the P1-09 manual path**

Document how to start the existing app and verify search center → filter → expand → inspect → retry/history. Do not mark P1-09 complete in the design or roadmap before user manual acceptance.

- [ ] **Step 6: Commit verified implementation and request manual review**

```bash
git add apps/web tests/e2e README.md
git commit -m "test: verify P1-09 graph expansion workflow"
```

Provide the user a concise numbered manual checklist. After the user explicitly confirms success, update the P1-09 design status, roadmap progress, and next step to P1-10 in a separate acceptance commit.
