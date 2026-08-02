# Global Loading Experience and Layout Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace transient loading text and layout jumps with delayed, reusable skeletons, non-blocking background refresh feedback, route preloading, and a non-interactive collapsed user identity.

**Architecture:** Keep authentication, route loading, and React Query ownership in their existing layers, but route their presentation through shared timing and loading components. Use five structural skeleton variants, a 30-second default query freshness policy with explicit real-time exceptions, and module-local boundaries on composite pages.

**Tech Stack:** React 19.2.7, React Router 8.3.0, TanStack React Query 5.101.3, TypeScript 6.0.2, Vitest 4.1.10, Testing Library 16.3.2, Playwright, CSS.

## Global Constraints

- Initial loading remains invisible for the first 180ms.
- A visible initial skeleton remains visible for at least 300ms.
- Background refresh feedback appears only after 500ms and never replaces existing content.
- Ordinary read queries use `staleTime: 30_000`; task polling and service status queries explicitly opt out.
- Authentication is revalidated by `/api/auth/session` after every hard refresh and is never restored from browser storage.
- The five skeleton variants are `list`, `detail`, `form`, `settings`, and `canvas`.
- Business-operation feedback such as creating, deleting, importing, downloading, and indexing remains unchanged.
- Web support remains desktop-first; no mobile layout work is included.
- Do not stage or modify `research/` or the user's existing `apps/api/.env.example` changes.

---

### Task 1: Finish Token UI Polish and Make Collapsed User Identity Non-Interactive

**Files:**
- Modify: `apps/web/src/features/auth/CurrentUserMenu.tsx`
- Modify: `apps/web/src/features/auth/CurrentUserMenu.test.tsx`
- Modify: `apps/web/src/styles/appShell.css`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/parameterSettings.css`
- Test: `tests/e2e/compact-workspace.spec.ts`
- Test: `tests/e2e/parameter-settings-mcp.spec.ts`

**Interfaces:**
- Consumes: `CurrentUserMenuProps { collapsed: boolean }` and the existing MCP token API.
- Produces: expanded-only user menu behavior and the final `20% / 34% / 16% / 30%` token table layout.

- [ ] **Step 1: Extend the user-menu component test with the non-interactive collapsed contract**

Add assertions to `CurrentUserMenu.test.tsx` that first open the menu, switch the context value to `collapsed=true`, and then require both the menu and button role to disappear:

```tsx
rerenderMenu(true);

expect(screen.queryByRole('menu', { name: '当前用户操作' })).toBeNull();
expect(screen.queryByRole('button', { name: /用户菜单/ })).toBeNull();
expect(screen.getByLabelText('当前用户 Jason').getAttribute('title')).toBe('Jason');
```

- [ ] **Step 2: Run the user-menu test and verify the new button-role assertion fails**

Run:

```bash
pnpm --filter @causality/web exec vitest run src/features/auth/CurrentUserMenu.test.tsx
```

Expected: FAIL because the collapsed avatar is still rendered as a button.

- [ ] **Step 3: Render a non-interactive identity when collapsed**

Keep the existing effect that closes the menu on collapse, then branch before the expanded button:

```tsx
if (collapsed) {
  return (
    <div
      className="current-user-menu current-user-menu--identity"
      aria-label={`当前用户 ${username}`}
      title={username}
    >
      <span className="current-user-menu__avatar" aria-hidden="true">
        {Array.from(username)[0]?.toLocaleUpperCase() ?? 'U'}
      </span>
    </div>
  );
}
```

Render the existing popover and trigger button only in the expanded branch. Add CSS that keeps the identity at 42px high, centers the avatar, and uses `cursor: default` without hover or focus treatment.

- [ ] **Step 4: Lock the token-dialog error and final column behavior**

Keep `closeCreateDialog()` as the single cancel/close path:

```ts
function closeCreateDialog(): void {
  setCreateOpen(false);
  setActionError(undefined);
}
```

Keep the token column widths at `20% / 34% / 16% / 30%`, the operation header left-aligned, and the create-dialog input focused on open. Ensure `McpSettingsPanel.test.tsx` asserts that cancelling a duplicate-name error leaves no list-level alert.

- [ ] **Step 5: Add browser-level regression assertions**

In `compact-workspace.spec.ts`, open the current-user menu before clicking “收起导航栏”, then assert:

```ts
await expect(page.getByRole('menu', { name: '当前用户操作' })).toBeVisible();
await page.getByRole('button', { name: '收起导航栏' }).click();
await expect(page.getByRole('menu', { name: '当前用户操作' })).toHaveCount(0);
await expect(page.getByRole('button', { name: /用户菜单/ })).toHaveCount(0);
await expect(page.getByLabel('当前用户 e2e-user')).toBeVisible();
```

In `parameter-settings-mcp.spec.ts`, assert the four column bounding boxes are ordered and the operation column width is smaller than the token column width.

- [ ] **Step 6: Run focused checks**

Run:

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/auth/CurrentUserMenu.test.tsx \
  src/features/parameter-settings/McpSettingsPanel.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: all tests and type checking pass.

- [ ] **Step 7: Commit only the Task 1 Web files**

```bash
git add \
  apps/web/src/features/auth/CurrentUserMenu.tsx \
  apps/web/src/features/auth/CurrentUserMenu.test.tsx \
  apps/web/src/styles/appShell.css \
  apps/web/src/features/parameter-settings/McpSettingsPanel.tsx \
  apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx \
  apps/web/src/features/parameter-settings/parameterSettings.css \
  tests/e2e/compact-workspace.spec.ts \
  tests/e2e/parameter-settings-mcp.spec.ts
git commit -m "fix: stabilize token and collapsed user controls"
```

### Task 2: Implement Deterministic Delayed Visibility

**Files:**
- Create: `apps/web/src/shared/loading/useDelayedVisibility.ts`
- Create: `apps/web/src/shared/loading/useDelayedVisibility.test.tsx`

**Interfaces:**
- Consumes: an active boolean and exact delay/minimum-visible durations.
- Produces: `useDelayedVisibility(active, options): boolean`.

- [ ] **Step 1: Write fake-timer tests for all timing boundaries**

Create a test harness that renders the hook result as `visible` or `hidden`. Cover these exact cases:

```tsx
expect(screen.getByText('hidden')).toBeTruthy();
await vi.advanceTimersByTimeAsync(179);
expect(screen.getByText('hidden')).toBeTruthy();
await vi.advanceTimersByTimeAsync(1);
expect(screen.getByText('visible')).toBeTruthy();
```

After visibility begins, set `active=false`, advance 299ms, require `visible`, then advance 1ms and require `hidden`. Also test cancellation before 180ms and unmount cleanup.

- [ ] **Step 2: Run the new test and verify the missing module fails**

```bash
pnpm --filter @causality/web exec vitest run src/shared/loading/useDelayedVisibility.test.tsx
```

Expected: FAIL because `useDelayedVisibility` does not exist.

- [ ] **Step 3: Implement the hook with timer cleanup and minimum visibility**

Export:

```ts
export interface DelayedVisibilityOptions {
  delayMs: number;
  minimumVisibleMs?: number;
}

export function useDelayedVisibility(
  active: boolean,
  { delayMs, minimumVisibleMs = 0 }: DelayedVisibilityOptions,
): boolean;
```

Use `Date.now()`, a `visibleSinceRef`, and one timeout per effect. When `active` ends before the delay, cancel the pending show. When it ends after showing, calculate the remaining minimum-visible duration before hiding. Clear the timeout during every effect cleanup and unmount.

- [ ] **Step 4: Run the hook test and Web typecheck**

```bash
pnpm --filter @causality/web exec vitest run src/shared/loading/useDelayedVisibility.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: all boundary tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shared/loading/useDelayedVisibility.ts apps/web/src/shared/loading/useDelayedVisibility.test.tsx
git commit -m "feat: add deterministic delayed loading visibility"
```

### Task 3: Build the Shared Loading Boundary and Five Skeleton Variants

**Files:**
- Create: `apps/web/src/shared/loading/LoadingState.tsx`
- Create: `apps/web/src/shared/loading/LoadingState.test.tsx`
- Create: `apps/web/src/shared/loading/PageSkeleton.tsx`
- Create: `apps/web/src/shared/loading/PageSkeleton.test.tsx`
- Create: `apps/web/src/styles/loading.css`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `useDelayedVisibility` from Task 2.
- Produces: `SkeletonVariant`, `PageSkeleton`, `LoadingState`, and `LoadingHeadingStatus`.

- [ ] **Step 1: Write structural skeleton tests**

Define the public variant type:

```ts
export type SkeletonVariant = 'list' | 'detail' | 'form' | 'settings' | 'canvas';
```

For every variant, render `PageSkeleton` and assert one `role="status"` with an accessible label such as `正在准备列表页面`, plus the variant data attribute:

```tsx
expect(screen.getByRole('status').getAttribute('data-skeleton-variant')).toBe('list');
```

- [ ] **Step 2: Write LoadingState behavior tests**

Use fake timers and assert:

```tsx
<LoadingState
  pending
  fetching
  hasData={false}
  error={null}
  skeleton="list"
  onRetry={retry}
>
  <div>真实内容</div>
</LoadingState>
```

The hidden skeleton reserves the variant container before 180ms, the visible skeleton appears at 180ms, content waits for the 300ms minimum, background refresh keeps `真实内容`, and background failure keeps content while exposing a retry button.

- [ ] **Step 3: Run both test files and verify they fail**

```bash
pnpm --filter @causality/web exec vitest run \
  src/shared/loading/PageSkeleton.test.tsx \
  src/shared/loading/LoadingState.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement the public component contracts**

Use these exact props:

```ts
export interface LoadingStateProps {
  pending: boolean;
  fetching: boolean;
  hasData: boolean;
  error: unknown;
  skeleton: SkeletonVariant;
  onRetry(): void;
  children: ReactNode;
}

export interface LoadingHeadingStatusProps {
  fetching: boolean;
  error: unknown;
  onRetry(): void;
}
```

`LoadingState` must render an invisible skeleton to reserve geometry while the initial request is inside 180ms, a visible skeleton after 180ms, and children plus `LoadingHeadingStatus` when data exists. A previously visible skeleton must remain until Task 2's 300ms minimum ends.

- [ ] **Step 5: Implement fixed-geometry skeleton CSS**

Use `.page-skeleton[data-skeleton-variant='…']` selectors. Give list, detail, form, and settings skeletons the same maximum content width and minimum height as their real page families. Give the canvas skeleton `position: absolute; inset: 0`. Use a subtle static gradient; animate only when `prefers-reduced-motion: no-preference`. Hidden waiting skeletons use `visibility: hidden`, not `display: none`.

Import `./styles/loading.css` from `main.tsx` after shared styles.

- [ ] **Step 6: Run tests, typecheck, and format check**

```bash
pnpm --filter @causality/web exec vitest run \
  src/shared/loading/PageSkeleton.test.tsx \
  src/shared/loading/LoadingState.test.tsx
pnpm --filter @causality/web typecheck
pnpm exec prettier --check apps/web/src/shared/loading apps/web/src/styles/loading.css apps/web/src/main.tsx
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shared/loading apps/web/src/styles/loading.css apps/web/src/main.tsx
git commit -m "feat: add shared page loading states"
```

### Task 4: Stabilize Authentication and Add Route Module Preloading

**Files:**
- Create: `apps/web/src/features/auth/RequireSession.test.tsx`
- Modify: `apps/web/src/features/auth/RequireSession.tsx`
- Create: `apps/web/src/app/preloadableRoutes.ts`
- Create: `apps/web/src/app/preloadableRoutes.test.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/AppSidebar.tsx`
- Modify: `apps/web/src/app/AppSidebar.test.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/features/auth/auth.css`

**Interfaces:**
- Consumes: `PageSkeleton`, `useDelayedVisibility`, and existing route modules.
- Produces: `preloadRoute(routeId)`, `preloadCommonRoutes()`, and deduplicated route loaders used by the router.

- [ ] **Step 1: Write RequireSession delayed-auth tests**

Use a deferred `/api/auth/session` response and fake timers. Assert that protected content and visible status are both absent at 179ms, an application skeleton is visible at 180ms, and protected content appears only after authentication plus the 300ms skeleton minimum.

- [ ] **Step 2: Write route-loader deduplication tests**

Expose a factory for testability:

```ts
export function createPreloadableRoute<T>(load: () => Promise<T>): {
  load(): Promise<T>;
  preload(): Promise<void>;
};
```

Call `preload()` twice and `load()` once, then assert the supplied importer ran once. Reject once and assert a later `load()` retries rather than reusing the rejected Promise.

- [ ] **Step 3: Run the new tests and verify red state**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/auth/RequireSession.test.tsx \
  src/app/preloadableRoutes.test.ts \
  src/app/AppSidebar.test.tsx
```

Expected: FAIL because delayed auth and route preloading are absent.

- [ ] **Step 4: Replace immediate authentication text with delayed application skeleton**

In `RequireSession`, keep all existing redirects. For `auth.status === 'loading'`, render a component that reserves the full viewport immediately but only reveals the settings-style application skeleton after 180ms. Remove the literal “正在检查登录状态…” text.

- [ ] **Step 5: Centralize route importers and use them in the router**

Create `routeLoaders`, with one `createPreloadableRoute()` instance for every lazy module currently declared in `router.tsx`: event list/create/detail/edit, relation list/create/detail/edit, case list/create/detail/edit, graph, maintenance, data transfer, import detail, AI import detail, settings, and system status. Every router lazy callback must call the corresponding `routeLoaders.<name>.load()` function rather than importing the module independently.

Create the smaller navigation-preload ID union separately:

```ts
export type PreloadableRouteId =
  | 'events'
  | 'relations'
  | 'cases'
  | 'graph'
  | 'maintenance'
  | 'data-transfer'
  | 'settings'
  | 'system';
```

Map these eight IDs only to the matching main navigation loaders (`eventList`, `relationList`, `caseList`, `graph`, `maintenance`, `dataTransfer`, `settings`, and `system`). Export `preloadRoute(id)` and `preloadCommonRoutes()` from that map; `preloadCommonRoutes()` excludes `graph`.

Define a route skeleton variant beside every router entry: list routes use `list`, detail routes use `detail`, create/edit routes use `form`, composite routes use `settings`, and graph uses `canvas`. Replace immediate text fallbacks with a delayed fallback component receiving that exact variant.

- [ ] **Step 6: Wire idle and intent preloading**

In `AppShell`, run `preloadCommonRoutes()` through `window.requestIdleCallback` with a `setTimeout` fallback and cleanup. In `AppSidebar`, add `onMouseEnter` and `onFocus` handlers that call the matching `preloadRoute`; graph is therefore loaded only on explicit navigation intent.

- [ ] **Step 7: Run focused tests and build**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/auth/RequireSession.test.tsx \
  src/app/preloadableRoutes.test.ts \
  src/app/AppSidebar.test.tsx
pnpm --filter @causality/web build
```

- [ ] **Step 8: Commit**

```bash
git add \
  apps/web/src/features/auth/RequireSession.tsx \
  apps/web/src/features/auth/RequireSession.test.tsx \
  apps/web/src/features/auth/auth.css \
  apps/web/src/app/preloadableRoutes.ts \
  apps/web/src/app/preloadableRoutes.test.ts \
  apps/web/src/app/router.tsx \
  apps/web/src/app/AppSidebar.tsx \
  apps/web/src/app/AppSidebar.test.tsx \
  apps/web/src/app/AppShell.tsx
git commit -m "feat: stabilize auth and route loading"
```

### Task 5: Apply Query Freshness Defaults and Background Refresh Feedback

**Files:**
- Modify: `apps/web/src/app/AppProviders.tsx`
- Create: `apps/web/src/app/AppProviders.test.tsx`
- Modify: `apps/web/src/features/system-status/SystemStatus.tsx`
- Modify: `apps/web/src/features/system-status/SystemStatus.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.tsx`

**Interfaces:**
- Consumes: `LoadingHeadingStatus` from Task 3.
- Produces: ordinary query default `staleTime: 30_000` and explicit `staleTime: 0` for real-time queries.

- [ ] **Step 1: Write query-default and real-time exception tests**

Export the query client factory:

```ts
export function createAppQueryClient(): QueryClient;
```

Assert `client.getDefaultOptions().queries?.staleTime === 30_000`. In SystemStatus and ParameterSettings tests, render twice inside 30 seconds and verify their real-time fetch functions still execute according to their explicit configuration.

- [ ] **Step 2: Run tests and verify the default is currently zero**

```bash
pnpm --filter @causality/web exec vitest run \
  src/app/AppProviders.test.tsx \
  src/features/system-status/SystemStatus.test.tsx \
  src/features/parameter-settings/ParameterSettings.test.tsx
```

- [ ] **Step 3: Set the ordinary default and opt real-time queries out**

Set `staleTime: 30_000` in `createAppQueryClient`. Add `staleTime: 0` to service health, readiness, semantic Worker, semantic lifecycle, and running data-check task queries. Keep existing `refetchInterval` functions unchanged.

- [ ] **Step 4: Add non-blocking background refresh status**

Pass each module's `isFetching && !isPending`, error, and `refetch` to `LoadingHeadingStatus`. Do not disable unrelated controls while a background read refreshes. Existing explicit “重新检查” and semantic action buttons retain their operation-specific pending states.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm --filter @causality/web exec vitest run \
  src/app/AppProviders.test.tsx \
  src/features/system-status/SystemStatus.test.tsx \
  src/features/parameter-settings/ParameterSettings.test.tsx \
  src/features/data-maintenance/DataMaintenance.test.tsx
pnpm --filter @causality/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/app/AppProviders.tsx \
  apps/web/src/app/AppProviders.test.tsx \
  apps/web/src/features/system-status/SystemStatus.tsx \
  apps/web/src/features/system-status/SystemStatus.test.tsx \
  apps/web/src/features/parameter-settings/ParameterSettings.tsx \
  apps/web/src/features/data-maintenance/DataMaintenance.tsx
git commit -m "feat: retain data during background refresh"
```

### Task 6: Migrate the Three Business List Pages

**Files:**
- Modify: `apps/web/src/features/events/pages/EventListPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventListPage.test.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseListPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.test.tsx`

**Interfaces:**
- Consumes: `LoadingState` with `skeleton="list"` and React Query placeholder data.
- Produces: stable initial list skeletons and retained list content for events, cases, and relations.

- [ ] **Step 1: Replace immediate-loading test expectations with delayed skeleton expectations**

For each list test, use fake timers with a deferred response. Require no visible skeleton at 179ms, a list skeleton at 180ms, and no literal `加载事件…`, `加载案例…`, or `加载因果关系…` at any point. Resolve data and ensure the skeleton remains until its minimum duration ends.

- [ ] **Step 2: Add background-refresh retention tests**

Seed one successful response, trigger a query-key change, keep the second response deferred, and assert the original table remains. Advance 500ms and assert the heading update status appears without changing the table's bounding container class or removing row actions.

- [ ] **Step 3: Run all three list tests and verify failures**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/events/pages/EventListPage.test.tsx \
  src/features/cases/pages/CasePages.test.tsx \
  src/features/relations/pages/RelationListPage.test.tsx
```

- [ ] **Step 4: Wrap each list result region with LoadingState**

Use the same mapping in all three pages:

```tsx
<LoadingState
  pending={query.isPending}
  fetching={query.isFetching}
  hasData={Boolean(query.data)}
  error={query.error}
  skeleton="list"
  onRetry={() => void query.refetch()}
>
  {renderedListContent}
</LoadingState>
```

Keep `placeholderData: (previous) => previous`, pagination correction, enhanced-search errors, deletion dialogs, selection state, and list-return behavior unchanged. Remove only the old immediate `.table-state` loading branches.

- [ ] **Step 5: Run focused tests and relevant E2E**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/events/pages/EventListPage.test.tsx \
  src/features/cases/pages/CasePages.test.tsx \
  src/features/relations/pages/RelationListPage.test.tsx
DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
pnpm test:e2e -- tests/e2e/events.spec.ts tests/e2e/cases.spec.ts tests/e2e/relations.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/features/events/pages/EventListPage.tsx \
  apps/web/src/features/events/pages/EventListPage.test.tsx \
  apps/web/src/features/cases/pages/CaseListPage.tsx \
  apps/web/src/features/cases/pages/CasePages.test.tsx \
  apps/web/src/features/relations/pages/RelationListPage.tsx \
  apps/web/src/features/relations/pages/RelationListPage.test.tsx
git commit -m "feat: stabilize business list loading"
```

### Task 7: Migrate Detail, Edit, and Import Detail Pages

**Files:**
- Modify: `apps/web/src/features/events/pages/EventDetailPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventEditPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventPages.test.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseDetailPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseEditPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationDetailPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationDetailPage.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.test.tsx`
- Modify: `apps/web/src/features/data-transfer/pages/ImportDetailPage.tsx`
- Modify: `apps/web/src/features/data-transfer/pages/ImportDetailPage.test.tsx`
- Modify: `apps/web/src/features/data-transfer/pages/AiImportDetailPage.tsx`
- Modify: `apps/web/src/features/data-transfer/pages/AiImportDetailPage.test.tsx`

**Interfaces:**
- Consumes: `LoadingState` with `detail` or `form` skeletons.
- Produces: stable initial loading for all read-backed detail and edit surfaces.

- [ ] **Step 1: Add delayed detail/form skeleton tests**

For one representative event detail, event edit, case detail, relation detail, import detail, and AI import detail test, defer the primary request and assert the correct skeleton variant after 180ms. Assert the old loading literals are absent.

- [ ] **Step 2: Add association-module independence tests**

Resolve the primary record while leaving related relations/cases deferred. Assert the title and summary remain visible and only the association region shows its local structural placeholder or existing compact loading state. A related-data error must not replace the primary detail.

- [ ] **Step 3: Run the representative page tests and verify failures**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/events/pages/EventPages.test.tsx \
  src/features/cases/pages/CasePages.test.tsx \
  src/features/relations/pages/RelationDetailPage.test.tsx \
  src/features/relations/pages/RelationEditPage.test.tsx \
  src/features/data-transfer/pages/ImportDetailPage.test.tsx \
  src/features/data-transfer/pages/AiImportDetailPage.test.tsx
```

- [ ] **Step 4: Replace top-level early returns with LoadingState boundaries**

Use `skeleton="detail"` for detail and import-detail pages, and `skeleton="form"` for edit pages. Preserve not-found behavior, list-return state, pagination, edit mutations, and related-record loading logic. Never wrap an already loaded primary page in a new full-page boundary because a related query is fetching.

- [ ] **Step 5: Run focused tests, typecheck, and build**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/events/pages/EventPages.test.tsx \
  src/features/cases/pages/CasePages.test.tsx \
  src/features/relations/pages/RelationDetailPage.test.tsx \
  src/features/relations/pages/RelationEditPage.test.tsx \
  src/features/data-transfer/pages/ImportDetailPage.test.tsx \
  src/features/data-transfer/pages/AiImportDetailPage.test.tsx
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/features/events/pages/EventDetailPage.tsx \
  apps/web/src/features/events/pages/EventEditPage.tsx \
  apps/web/src/features/events/pages/EventPages.test.tsx \
  apps/web/src/features/cases/pages/CaseDetailPage.tsx \
  apps/web/src/features/cases/pages/CaseEditPage.tsx \
  apps/web/src/features/cases/pages/CasePages.test.tsx \
  apps/web/src/features/relations/pages/RelationDetailPage.tsx \
  apps/web/src/features/relations/pages/RelationDetailPage.test.tsx \
  apps/web/src/features/relations/pages/RelationEditPage.tsx \
  apps/web/src/features/relations/pages/RelationEditPage.test.tsx \
  apps/web/src/features/data-transfer/pages/ImportDetailPage.tsx \
  apps/web/src/features/data-transfer/pages/ImportDetailPage.test.tsx \
  apps/web/src/features/data-transfer/pages/AiImportDetailPage.tsx \
  apps/web/src/features/data-transfer/pages/AiImportDetailPage.test.tsx
git commit -m "feat: stabilize detail and edit loading"
```

### Task 8: Split Composite Pages into Independent Loading Modules

**Files:**
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.tsx`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx`
- Modify: `apps/web/src/features/system-status/SystemStatus.tsx`
- Modify: `apps/web/src/features/system-status/SystemStatus.test.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.test.tsx`
- Modify: `apps/web/src/features/data-transfer/DataTransferPage.tsx`
- Modify: `apps/web/src/features/data-transfer/DataTransferPage.test.tsx`

**Interfaces:**
- Consumes: settings skeletons, `LoadingState`, and Task 5 query policies.
- Produces: independently loading MCP, semantic, system-status, maintenance, and transfer modules.

- [ ] **Step 1: Write ParameterSettings independence tests**

Keep semantic lifecycle deferred while resolving MCP settings and token queries. Assert the page heading and MCP service content are visible while only the semantic area shows a settings skeleton. Reverse the responses and assert semantic model cards render while the MCP region alone shows its skeleton or local error.

- [ ] **Step 2: Write system, maintenance, and transfer independence tests**

For each page, defer one module and resolve the others. Assert resolved modules stay visible. Reject one module and assert only that region contains a retry button. For data transfer, keep the selected tab and history pagination stable during a background refresh.

- [ ] **Step 3: Run composite-page tests and verify failures**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/parameter-settings/ParameterSettings.test.tsx \
  src/features/parameter-settings/McpSettingsPanel.test.tsx \
  src/features/system-status/SystemStatus.test.tsx \
  src/features/data-maintenance/DataMaintenance.test.tsx \
  src/features/data-transfer/DataTransferPage.test.tsx
```

- [ ] **Step 4: Remove page-wide lifecycle blocking in ParameterSettings**

Always render `.parameter-settings-page` and its heading. Wrap the semantic section in its own settings `LoadingState`; keep `McpSettingsPanel` mounted concurrently. Inside `McpSettingsPanel`, separate service settings and token list loading so either response can fail without hiding the other.

- [ ] **Step 5: Apply module-local boundaries to the remaining composite pages**

SystemStatus uses one stable status-card shell with independent row states. DataMaintenance separates readiness, snapshot/statistics, and issue-list boundaries. DataTransfer keeps its tab panel mounted and wraps history/AI-history lists independently. Preserve all operation mutations and navigation protection.

- [ ] **Step 6: Run tests and the parameter-settings E2E**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/parameter-settings/ParameterSettings.test.tsx \
  src/features/parameter-settings/McpSettingsPanel.test.tsx \
  src/features/system-status/SystemStatus.test.tsx \
  src/features/data-maintenance/DataMaintenance.test.tsx \
  src/features/data-transfer/DataTransferPage.test.tsx
DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
pnpm test:e2e -- tests/e2e/parameter-settings-mcp.spec.ts tests/e2e/data-transfer-import.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add \
  apps/web/src/features/parameter-settings/ParameterSettings.tsx \
  apps/web/src/features/parameter-settings/ParameterSettings.test.tsx \
  apps/web/src/features/parameter-settings/McpSettingsPanel.tsx \
  apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx \
  apps/web/src/features/system-status/SystemStatus.tsx \
  apps/web/src/features/system-status/SystemStatus.test.tsx \
  apps/web/src/features/data-maintenance/DataMaintenance.tsx \
  apps/web/src/features/data-maintenance/DataMaintenance.test.tsx \
  apps/web/src/features/data-transfer/DataTransferPage.tsx \
  apps/web/src/features/data-transfer/DataTransferPage.test.tsx
git commit -m "feat: isolate composite page loading"
```

### Task 9: Stabilize the Graph Canvas and Complete Release Verification

**Files:**
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx`
- Modify: `apps/web/src/features/causal-graph/components/GraphStatusOverlay.tsx`
- Modify: `apps/web/src/features/causal-graph/components/GraphStatusOverlay.test.tsx`
- Create: `tests/e2e/loading-experience.spec.ts`
- Modify: `tests/e2e/compact-workspace.spec.ts`

**Interfaces:**
- Consumes: canvas skeleton, route preloading, background refresh status, and all page migrations.
- Produces: stable graph initialization and final cross-page regression coverage.

- [ ] **Step 1: Write graph initial-loading and refresh tests**

Defer the first graph query and assert that the toolbar/viewport geometry is reserved immediately, the canvas skeleton becomes visible at 180ms, and the old graph loading text is absent. Resolve the initial graph, trigger a filter refresh, and assert the existing nodes remain while the existing non-blocking `GraphStatusOverlay` reports an update.

- [ ] **Step 2: Run graph tests and verify failures**

```bash
pnpm --filter @causality/web exec vitest run \
  src/features/causal-graph/pages/CausalGraphPage.test.tsx \
  src/features/causal-graph/components/GraphStatusOverlay.test.tsx
```

- [ ] **Step 3: Apply the canvas skeleton without changing layout algorithms**

Keep Cytoscape, ELK, node limits, filters, inspector, zoom, keyboard selection, and extension behavior unchanged. Replace only the first-query visual state with the canvas skeleton. Continue using `GraphStatusOverlay` for graph regeneration because it is already a domain-specific non-blocking update indicator.

- [ ] **Step 4: Add cross-page Playwright timing coverage**

In `loading-experience.spec.ts`, use `page.route()` to test fast and slow responses. Install a mutation observer with `page.addInitScript()` that records legacy loading text. Cover:

```ts
const legacyLoadingText = [
  '正在检查登录状态',
  '正在加载页面',
  '加载事件',
  '加载案例',
  '加载因果关系',
];
```

For a response under 180ms, require no recorded loading text or visible skeleton. For a delayed response, require a visible skeleton, capture the main container bounding box, resolve the response, and assert the final container's left/top/width differ by no more than 1 CSS pixel. Test event list, event detail, parameter settings, system status, and graph.

- [ ] **Step 5: Run the full Web and E2E suites**

```bash
pnpm --filter @causality/web test
pnpm --filter @causality/web typecheck
DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
pnpm test:e2e
```

Expected: all Web unit/component tests and all desktop E2E tests pass.

- [ ] **Step 6: Run repository release gates**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
node --test tests/production/compose-contract.test.mjs
git diff --check
```

Expected: every command exits zero. The existing Vite large graph-chunk warning may remain; no new warning is accepted.

- [ ] **Step 7: Perform Browser-plugin desktop acceptance**

At `http://localhost:5173`, inspect 1280×720 and the user's current desktop viewport. Verify page identity, non-blank content, no framework overlay, clean console, fast reload without transient loading text, throttled reload with correct skeletons, background refresh content retention, and collapsed user identity behavior. Capture screenshots outside committed source.

- [ ] **Step 8: Commit final graph and verification changes**

```bash
git add \
  apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx \
  apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx \
  apps/web/src/features/causal-graph/components/GraphStatusOverlay.tsx \
  apps/web/src/features/causal-graph/components/GraphStatusOverlay.test.tsx \
  tests/e2e/loading-experience.spec.ts \
  tests/e2e/compact-workspace.spec.ts
git commit -m "test: verify stable loading experience"
```

## Final Manual Review Checklist

- Hard-refresh event, relation, case, detail, settings, system, maintenance, transfer, and graph pages.
- Confirm requests faster than 180ms show neither text nor skeleton.
- Confirm slow initial requests show the correct skeleton and no major layout shift.
- Confirm background refresh retains content and shows an update state only after 500ms.
- Confirm local module failure does not hide successful neighboring modules.
- Confirm collapsed navigation shows identity only and cannot open the account menu.
- Confirm creating, deleting, importing, downloading, and indexing still show their existing operation feedback.
