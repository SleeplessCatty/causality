# UX-01 Compact Full-Canvas Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top navigation with a compact collapsible desktop sidebar, tighten the existing management pages, and turn the causal-graph route into a full-canvas workspace with one floating toolbar, a bottom-left status overlay, and a right-side overlay inspector.

**Architecture:** Keep one shared `AppShell`, but make it route-aware: ordinary routes use a compact scrolling content surface, while `/graph` uses a full-bleed, overflow-hidden workbench. Isolate sidebar preference and graph-route overrides in one hook, keep graph query state URL-driven, and replace the filter popover and expansion buttons with discrete native selects that query immediately.

**Tech Stack:** React 19.2.7, React Router 8.2.0, TanStack Query 5.101.3, TypeScript 6.0.2, CSS, Testing Library 16.3.2, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- Implement only `docs/stages/pre-phase-2/UX-01-compact-layout-full-canvas-graph-design.md`.
- Do not modify API routes, database schemas, Docker topology, contracts, graph layout algorithms, or the 100-associated-node ceiling.
- Keep the application desktop-only and retain the current `body` minimum width unless a tested layout rule requires a larger value.
- Expanded sidebar width is approximately `184px`; collapsed width is approximately `56px`.
- Ordinary routes remember the user's sidebar preference; every graph-route entry starts collapsed and leaving restores the ordinary preference.
- Force the sidebar closed when an expanded sidebar would leave less than approximately `960px` of graph workspace.
- The graph toolbar is one row, approximately `1080px × 52px`, centered inside the current graph workspace and reduced only to the available width minus `32px`.
- Confidence choices are `0` through `100` in steps of `10`; case-count choices are `0` through `10` in steps of `1`; node-limit choices are `20`, `50`, and `100`.
- Query option changes apply immediately. Direction changes reset the node limit to `20`; node-limit and filter changes preserve the other query fields.
- Keep the previous graph visible while refreshing or after a refresh failure.
- The `360px` inspector overlays the canvas and must not resize or relayout the graph.
- Preserve all current graph selection, keyboard, drag, pan, zoom, fit, and inspector-toggle behavior.
- Respect `prefers-reduced-motion: reduce`.
- Do not add a runtime icon package; use project-owned SVG components.

---

### Task 1: Route-aware collapsible application sidebar

**Files:**
- Create: `apps/web/src/app/useAppSidebar.ts`
- Create: `apps/web/src/app/useAppSidebar.test.tsx`
- Create: `apps/web/src/app/AppSidebar.tsx`
- Create: `apps/web/src/app/AppSidebar.test.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/styles/events.css`

**Interfaces:**
- Produces: `useAppSidebar(isGraphRoute: boolean): AppSidebarState`.
- Produces: `AppSidebar({ collapsed, forced, onToggle }: AppSidebarProps)`.
- `AppSidebarState` is `{ collapsed: boolean; forced: boolean; toggle: () => void }`.
- Later tasks rely on `.product-shell.is-sidebar-collapsed`, `.product-shell.is-graph-route`, `.app-sidebar`, and `.product-main`.

- [ ] **Step 1: Write the failing sidebar-state tests**

Create `useAppSidebar.test.tsx` with a small hook harness and these exact behaviors:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sidebarStorageKey, useAppSidebar } from './useAppSidebar';

describe('useAppSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it('defaults ordinary pages to expanded and persists a manual collapse', () => {
    const { result } = renderHook(() => useAppSidebar(false));
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(sidebarStorageKey)).toBe('collapsed');
  });

  it('starts a graph entry collapsed without overwriting the ordinary preference', () => {
    localStorage.setItem(sidebarStorageKey, 'expanded');
    const { result, rerender } = renderHook(({ graph }) => useAppSidebar(graph), {
      initialProps: { graph: false },
    });
    rerender({ graph: true });
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    rerender({ graph: false });
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(sidebarStorageKey)).toBe('expanded');
  });
});
```

- [ ] **Step 2: Run the hook tests and verify RED**

Run:

```bash
pnpm --filter @causality/web test -- src/app/useAppSidebar.test.tsx
```

Expected: FAIL because `useAppSidebar.ts` does not exist.

- [ ] **Step 3: Implement the sidebar-state hook**

Create `useAppSidebar.ts` with the following public API and state rules:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export const sidebarStorageKey = 'causality.sidebar.preference';
const constrainedQuery = '(max-width: 1143px)';

export interface AppSidebarState {
  collapsed: boolean;
  forced: boolean;
  toggle: () => void;
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === 'collapsed';
  } catch {
    return false;
  }
}

export function useAppSidebar(isGraphRoute: boolean): AppSidebarState {
  const [ordinaryCollapsed, setOrdinaryCollapsed] = useState(readPreference);
  const [graphCollapsed, setGraphCollapsed] = useState(true);
  const [forced, setForced] = useState(() => window.matchMedia(constrainedQuery).matches);
  const previousGraphRoute = useRef(isGraphRoute);

  useEffect(() => {
    const query = window.matchMedia(constrainedQuery);
    const sync = () => setForced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (isGraphRoute && !previousGraphRoute.current) setGraphCollapsed(true);
    previousGraphRoute.current = isGraphRoute;
  }, [isGraphRoute]);

  const toggle = useCallback(() => {
    if (forced) return;
    if (isGraphRoute) {
      setGraphCollapsed((current) => !current);
      return;
    }
    setOrdinaryCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(sidebarStorageKey, next ? 'collapsed' : 'expanded');
      } catch {
        // Storage is an optional enhancement; layout remains usable without it.
      }
      return next;
    });
  }, [forced, isGraphRoute]);

  return {
    collapsed: forced || (isGraphRoute ? graphCollapsed : ordinaryCollapsed),
    forced,
    toggle,
  };
}
```

- [ ] **Step 4: Write the failing sidebar component tests**

Create `AppSidebar.test.tsx` using `MemoryRouter`; assert that expanded mode shows all five labels, collapsed mode exposes icon links with the same accessible names, the active link is preserved, and a forced toggle is disabled with the text `当前窗口空间不足`.

```tsx
render(
  <MemoryRouter initialEntries={['/graph']}>
    <AppSidebar collapsed forced={false} onToggle={onToggle} />
  </MemoryRouter>,
);
expect(screen.getByRole('link', { name: '因果图' })).toHaveAttribute('aria-current', 'page');
fireEvent.click(screen.getByRole('button', { name: '展开导航栏' }));
expect(onToggle).toHaveBeenCalledOnce();
```

- [ ] **Step 5: Run the component tests and verify RED**

Run the two sidebar test files. Expected: `AppSidebar` module missing.

- [ ] **Step 6: Implement the SVG navigation and route-aware shell**

Create `AppSidebar.tsx` with a local `navigationItems` array for `/events`, `/relations`, `/cases`, `/graph`, and `/system`. Each item contains a label and a focused inline SVG component. Render the brand at the top, `NavLink` items in the middle, and the toggle button at the bottom. In collapsed mode, put `data-tooltip={item.label}` on each link and expose the compact tooltip from both `:hover::after` and `:focus-visible::after`; keep `title={item.label}` only as a native fallback and preserve the link's accessible name.

Modify `AppShell.tsx`:

```tsx
import { Outlet, useLocation } from 'react-router';

import { AppSidebar } from './AppSidebar';
import { useAppSidebar } from './useAppSidebar';

export function AppShell() {
  const location = useLocation();
  const isGraphRoute = location.pathname === '/graph';
  const sidebar = useAppSidebar(isGraphRoute);

  return (
    <div
      className={`product-shell${sidebar.collapsed ? ' is-sidebar-collapsed' : ''}${isGraphRoute ? ' is-graph-route' : ''}`}
      data-sidebar-state={sidebar.collapsed ? 'collapsed' : 'expanded'}
    >
      <AppSidebar
        collapsed={sidebar.collapsed}
        forced={sidebar.forced}
        onToggle={sidebar.toggle}
      />
      <main className="product-main">
        <Outlet />
      </main>
    </div>
  );
}
```

Replace the top-header shell CSS in `events.css` with a two-column, full-height shell; use CSS custom properties `--sidebar-width-expanded: 184px` and `--sidebar-width-collapsed: 56px`; add `180ms` transitions and a reduced-motion override.

- [ ] **Step 7: Run sidebar tests, Web tests, typecheck, and commit**

Run:

```bash
pnpm --filter @causality/web test -- src/app/useAppSidebar.test.tsx src/app/AppSidebar.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: all new tests PASS and typecheck exits 0.

Commit:

```bash
git add apps/web/src/app apps/web/src/styles/events.css
git commit -m "feat: add compact collapsible app sidebar"
```

---

### Task 2: Compact ordinary management pages

**Files:**
- Modify: `apps/web/src/styles/events.css`
- Modify: `tests/e2e/foundation.spec.ts`
- Modify: `tests/e2e/relations.spec.ts`
- Modify: `tests/e2e/cases.spec.ts`

**Interfaces:**
- Consumes: Task 1's `.product-main` ordinary-route container and sidebar state attributes.
- Produces: compact, full-workspace ordinary routes without changing their DOM or business behavior.

- [ ] **Step 1: Add failing browser density assertions**

In `foundation.spec.ts`, after the events page is visible, assert:

```ts
await expect(page.locator('.product-shell')).toHaveAttribute('data-sidebar-state', 'expanded');
const firstRow = page.locator('.event-table tbody tr').first();
expect((await firstRow.boundingBox())?.height).toBeLessThanOrEqual(60);
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
  await page.evaluate(() => document.documentElement.clientWidth),
);
```

Add equivalent maximum-row-height and no-horizontal-overflow assertions to the existing relation and case desktop viewport tests.

- [ ] **Step 2: Run the focused E2E tests and verify RED**

Run:

```bash
pnpm exec playwright test tests/e2e/foundation.spec.ts tests/e2e/relations.spec.ts tests/e2e/cases.spec.ts --grep "readiness|fit the supported desktop"
```

Expected: FAIL because current rows are approximately `76px` and the current centered shell does not expose the sidebar state.

- [ ] **Step 3: Apply compact spacing without restructuring pages**

Update the existing selectors in `events.css` rather than changing page components:

```css
.product-main {
  min-width: 0;
  height: 100vh;
  padding: 26px 28px 36px;
  overflow: auto;
}

.page-heading h1 { font-size: 29px; }
.page-heading p { margin-top: 7px; font-size: 13px; }
.button { min-height: 38px; padding-inline: 15px; font-size: 13px; }
.event-search { margin-top: 22px; }
.event-search input { height: 42px; padding-left: 44px; }
.event-table-wrap { margin-top: 18px; }
.event-table th { height: 44px; }
.event-table td { height: 56px; }
.event-table th,
.event-table td { padding-inline: 16px; }
```

Apply the same density to the existing relation table, case table, forms, inline detail sections, pagination, and system status selectors already housed in `events.css`. Do not move elements or remove copy.

- [ ] **Step 4: Run focused E2E, Web regression, and commit**

Run the focused Playwright command from Step 2, then:

```bash
pnpm --filter @causality/web test
pnpm --filter @causality/web typecheck
```

Expected: all commands PASS.

Commit:

```bash
git add apps/web/src/styles/events.css tests/e2e/foundation.spec.ts tests/e2e/relations.spec.ts tests/e2e/cases.spec.ts
git commit -m "style: compact management page density"
```

---

### Task 3: Discrete auto-query graph toolbar

**Files:**
- Modify: `apps/web/src/features/causal-graph/graph/graphQueryState.ts`
- Modify: `apps/web/src/features/causal-graph/graph/graphQueryState.test.ts`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.test.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx`
- Delete: `apps/web/src/features/causal-graph/components/GraphFilterPopover.tsx`
- Delete: `apps/web/src/features/causal-graph/components/GraphFilterPopover.test.tsx`

**Interfaces:**
- Produces: `graphLimitOptions`, `graphConfidenceOptions`, and `graphCaseCountOptions` as readonly arrays.
- `CausalGraphToolbarProps` gains `limit`, `minConfidence`, `minCaseCount`, `onLimitChange`, `onMinConfidenceChange`, and `onMinCaseCountChange`.
- Removes: `filterCount`, `filterOpen`, `onFilterToggle`, and `filterPopover`.

- [ ] **Step 1: Write failing query-normalization tests**

Add tests asserting that URL values are normalized to selectable values:

```ts
expect(parseGraphQueryState(new URLSearchParams('minConfidence=25&minCaseCount=99')).state)
  .toMatchObject({ minConfidence: 20, minCaseCount: 10 });
expect(graphConfidenceOptions).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
expect(graphCaseCountOptions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
```

- [ ] **Step 2: Run graph-query tests and verify RED**

Expected: option exports are missing and `25/99` are not normalized to `20/10`.

- [ ] **Step 3: Implement discrete query normalization**

Export all three arrays, derive the existing limit-validation set from `graphLimitOptions`, and normalize parsed values with:

```ts
export const graphLimitOptions = [20, 50, 100] as const satisfies readonly GraphLimit[];
export const graphConfidenceOptions = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
export const graphCaseCountOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const graphLimits = new Set<number>(graphLimitOptions);
const normalizeConfidence = (value: number) =>
  Math.floor(Math.min(100, Math.max(0, value)) / 10) * 10;
const normalizeCaseCount = (value: number) => Math.min(10, Math.max(0, Math.floor(value)));
```

Keep query serialization field names unchanged. Delete the popover-only `GraphFilterValues`, `GraphFilterDraft`, `GraphFilterValidationResult`, `activeGraphFilterCount`, and `validateGraphFilterDraft` APIs and their unit tests after their only UI consumer is removed.

- [ ] **Step 4: Replace toolbar tests with native-select behavior**

Render the toolbar with current values and assert all four selects and zoom controls:

```tsx
expect(screen.getByRole('combobox', { name: '查询方向' })).toHaveValue('both');
expect(screen.getByRole('combobox', { name: '节点上限' })).toHaveValue('20');
expect(screen.getByRole('combobox', { name: '最低置信度' })).toHaveValue('30');
expect(screen.getByRole('combobox', { name: '最少案例数' })).toHaveValue('2');
fireEvent.change(screen.getByRole('combobox', { name: '节点上限' }), {
  target: { value: '50' },
});
expect(onLimitChange).toHaveBeenCalledWith(50);
```

- [ ] **Step 5: Run toolbar tests and verify RED**

Expected: FAIL because the toolbar still renders buttons and a filter popover trigger.

- [ ] **Step 6: Implement the single-row select toolbar**

Replace direction buttons and filter trigger with compact labelled `<select>` groups. Parse numeric values before invoking callbacks:

```tsx
<label className="graph-toolbar-field">
  <span>节点</span>
  <select
    aria-label="节点上限"
    value={limit}
    onChange={(event) => onLimitChange(Number(event.target.value) as GraphLimit)}
  >
    {graphLimitOptions.map((value) => <option key={value} value={value}>{value}</option>)}
  </select>
</label>
```

Use the same pattern for direction, confidence, and cases. Keep the existing event selector and zoom actions.

- [ ] **Step 7: Wire immediate URL-driven querying in the page**

Remove `filterOpen`, `GraphFilterPopover`, filter apply/reset handlers, and `activeGraphFilterCount`. Add handlers that call `setGraphQuery` immediately:

```ts
const changeLimit = (nextLimit: GraphLimit) =>
  setGraphQuery({ ...requestedQuery, limit: nextLimit });
const changeMinConfidence = (value: number) =>
  setGraphQuery({ ...requestedQuery, minConfidence: value });
const changeMinCaseCount = (value: number) =>
  setGraphQuery({ ...requestedQuery, minCaseCount: value });
```

Keep `changeDirection` resetting `limit` to `20`; keep `chooseEvent` resetting direction to `both` and limit to `20` while preserving both filters.

- [ ] **Step 8: Run graph component tests, delete obsolete popover files, and commit**

Run:

```bash
pnpm --filter @causality/web test -- src/features/causal-graph/graph/graphQueryState.test.ts src/features/causal-graph/components/CausalGraphToolbar.test.tsx src/features/causal-graph/pages/CausalGraphPage.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: PASS and no remaining import of `GraphFilterPopover`.

Commit:

```bash
git add apps/web/src/features/causal-graph
git commit -m "feat: add compact auto-query graph controls"
```

---

### Task 4: Full-canvas graph overlays

**Files:**
- Create: `apps/web/src/features/causal-graph/components/GraphStatusOverlay.tsx`
- Create: `apps/web/src/features/causal-graph/components/GraphStatusOverlay.test.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphInspector.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphInspector.test.tsx`
- Modify: `apps/web/src/features/causal-graph/causalGraph.css`
- Delete: `apps/web/src/features/causal-graph/components/GraphQueryStatus.tsx`
- Delete: `apps/web/src/features/causal-graph/components/GraphQueryStatus.test.tsx`

**Interfaces:**
- Produces: `GraphStatusOverlay({ graph, isPending, errorKind, empty, onRetry })` and exports `GraphQueryErrorKind = 'query' | 'layout' | null` for page-state typing.
- Retains: existing `CausalGraphInspector` public props and keyboard behavior.
- Removes: graph expansion and filter-adjustment actions from status UI, plus obsolete `GraphQueryStatus`, `nextGraphLimit`, and `graphQueryStatus` APIs and their tests.

- [ ] **Step 1: Write failing status-overlay tests**

Test these states:

```tsx
render(<GraphStatusOverlay graph={graph} isPending={false} errorKind={null} empty={false} onRetry={onRetry} />);
expect(screen.getByText('节点 21')).toBeVisible();
expect(screen.getByText('关系 37')).toBeVisible();

rerender(<GraphStatusOverlay graph={graph} isPending errorKind={null} empty={false} onRetry={onRetry} />);
expect(screen.getByText('更新中')).toBeVisible();

rerender(<GraphStatusOverlay graph={graph} isPending={false} errorKind="query" empty={false} onRetry={onRetry} />);
fireEvent.click(screen.getByRole('button', { name: '重试因果图查询' }));
expect(onRetry).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run status tests and verify RED**

Expected: FAIL because `GraphStatusOverlay` does not exist.

- [ ] **Step 3: Implement the compact status overlay**

Export `GraphQueryErrorKind` from the new component module. Render a labelled `<aside className="graph-status-overlay" aria-label="因果图状态">`. Show counts when a graph exists; show `请选择中心事件` only when `empty`; append update/error state only when active. The retry button uses the exact accessible name `重试因果图查询`.

- [ ] **Step 4: Write failing full-canvas page and inspector assertions**

Update `CausalGraphPage.test.tsx` to assert that the page has no `局部因果图` heading, contains one toolbar and one status overlay, and no expansion button. Update inspector tests to assert that the inspector stays mounted, changes `aria-hidden` and the `is-open` class, and preserves space/escape selection behavior.

- [ ] **Step 5: Run page and inspector tests and verify RED**

Expected: FAIL because the old heading, status row, and width-consuming workbench remain.

- [ ] **Step 6: Recompose the graph page as overlays**

Use this structure:

```tsx
<section className="causal-graph-page" aria-label="局部因果图工作台">
  <div className="causal-graph-workbench" data-inspector-open={inspectorOpen ? 'true' : 'false'}>
    <CausalGraphCanvas {...canvasProps} />
  </div>
  <CausalGraphToolbar {...toolbarProps} />
  <GraphStatusOverlay
    graph={graphQuery.data ?? lastGraph}
    isPending={isReplacing}
    errorKind={lastGraph ? errorKind : null}
    empty={!centerEventId}
    onRetry={retryRequest}
  />
  <CausalGraphInspector {...inspectorProps} />
</section>
```

Remove expansion callbacks and the header/count markup. Replace the inspector's early `return null` with an always-mounted `<aside>` whose `is-open`, `aria-hidden`, and `inert` values follow `open`; keep its data queries disabled while closed. This permits a real closing transition without leaving hidden controls keyboard-focusable. When the inspector opens, call only `ensureSelectionVisible()`; do not call `resize()` solely because the overlay opened.

- [ ] **Step 7: Implement full-canvas and overlay CSS**

Replace height calculations with container ownership:

```css
.product-shell.is-graph-route .product-main {
  height: 100vh;
  padding: 0;
  overflow: hidden;
}
.causal-graph-page,
.causal-graph-workbench,
.causal-graph-canvas { width: 100%; height: 100%; min-height: 0; }
.causal-graph-toolbar {
  position: absolute;
  z-index: 10;
  top: 16px;
  left: 50%;
  width: min(1080px, calc(100% - 32px));
  height: 52px;
  transform: translateX(-50%);
}
.graph-status-overlay { position: absolute; z-index: 8; left: 16px; bottom: 16px; }
.causal-graph-inspector {
  position: absolute;
  z-index: 12;
  top: 80px;
  right: 16px;
  bottom: 16px;
  width: 360px;
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: transform 180ms ease, opacity 180ms ease, visibility 0s linear 180ms;
}
.causal-graph-inspector.is-open {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition-delay: 0s;
}
```

Remove the workbench grid columns, canvas border-radius coupling, `calc(100vh - 252px)`, and any inspector rule that changes canvas width. Add reduced-motion overrides.

- [ ] **Step 8: Run focused graph tests, Web regression, build, and commit**

Run:

```bash
pnpm --filter @causality/web test -- src/features/causal-graph
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: PASS; build may retain the documented non-failing large graph chunk warning.

Commit:

```bash
git add apps/web/src/features/causal-graph apps/web/src/styles/events.css
git commit -m "feat: make causal graph a full-canvas workspace"
```

---

### Task 5: Desktop browser regression and UX-01 handoff

**Files:**
- Create: `tests/e2e/compact-workspace.spec.ts`
- Modify: `tests/e2e/causal-graph.spec.ts`
- Modify: `tests/e2e/causal-graph-expansion-filter.spec.ts`
- Modify: `README.md`
- Modify: `docs/stages/pre-phase-2/UX-01-compact-layout-full-canvas-graph-design.md`
- Modify: `docs/superpowers/plans/2026-07-22-ux-01-compact-full-canvas-workspace.md`

**Interfaces:**
- Consumes: all Task 1–4 selectors and behaviors.
- Produces: browser evidence and status `开发与自动化测试完成，等待人工复核` without starting Phase 2.

- [ ] **Step 1: Add the browser workflow before adjusting old E2E expectations**

Create `compact-workspace.spec.ts` that verifies at 1280×720:

```ts
await page.goto('/events');
await expect(page.locator('.product-shell')).toHaveAttribute('data-sidebar-state', 'expanded');
await page.getByRole('button', { name: '收起导航栏' }).click();
await expect(page.locator('.product-shell')).toHaveAttribute('data-sidebar-state', 'collapsed');
await page.getByRole('button', { name: '展开导航栏' }).click();
await page.getByRole('link', { name: '因果图' }).click();
await expect(page.locator('.product-shell')).toHaveAttribute('data-sidebar-state', 'collapsed');
await expect(page.getByLabel('局部因果图工作台')).toBeVisible();
await page.getByRole('link', { name: '事件' }).click();
await expect(page.locator('.product-shell')).toHaveAttribute('data-sidebar-state', 'expanded');
```

Also assert the graph toolbar remains one row, is centered within `.product-main`, the inspector does not change the canvas bounding box, the document has no horizontal overflow, and console/page errors remain empty.

- [ ] **Step 2: Run the new workflow and verify RED**

Run:

```bash
pnpm exec playwright test tests/e2e/compact-workspace.spec.ts
```

Expected: FAIL until all new selectors and final overlay behavior are present.

- [ ] **Step 3: Update existing graph E2E to the approved controls**

In `causal-graph.spec.ts`, replace the removed heading and radio assertions with the workbench and native direction select. In `causal-graph-expansion-filter.spec.ts`, replace expansion/filter-popover steps with immediate select changes:

```ts
await page.getByRole('combobox', { name: '节点上限' }).selectOption('50');
await expect(page).toHaveURL(/limit=50/);
await expect(canvas).toHaveAttribute('data-node-count', '51');
await page.getByRole('combobox', { name: '最低置信度' }).selectOption('90');
await page.getByRole('combobox', { name: '最少案例数' }).selectOption('10');
await expect(page).toHaveURL(/minConfidence=90.*minCaseCount=10/);
```

Keep the forced-failure/retry coverage by intercepting the next causal-graph request before changing a select.

- [ ] **Step 4: Run complete source E2E and inspect 1280×720 screenshots**

Run:

```bash
pnpm test:e2e
```

Expected: every Playwright test PASS; screenshots show no clipped toolbar, accidental page scrollbar, inspector-induced canvas shrink, or excessive ordinary-page whitespace.

- [ ] **Step 5: Run the complete local quality gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
git diff --check
```

Expected: all commands PASS. Record exact test counts and any non-failing build warning.

- [ ] **Step 6: Update documentation and implementation status**

Update README desktop navigation and graph usage instructions. Change UX-01 design and this plan to `开发与自动化测试完成，等待人工复核`; record automated counts and screenshot dimensions. Do not change Phase 2 from `未开始`.

- [ ] **Step 7: Commit the handoff**

```bash
git add tests/e2e README.md docs/stages/pre-phase-2/UX-01-compact-layout-full-canvas-graph-design.md docs/superpowers/plans/2026-07-22-ux-01-compact-full-canvas-workspace.md
git commit -m "test: prepare UX-01 manual acceptance"
```

- [ ] **Step 8: Hand off the manual browser checklist**

Ask the user to inspect sidebar animation and persistence, ordinary-page density, graph toolbar centering, all discrete query choices, refresh/error behavior, overlay status, inspector slide animation, keyboard controls, and 1280×720 overflow. Only after explicit acceptance may UX-01 be marked complete or Phase 2 planning resume.
