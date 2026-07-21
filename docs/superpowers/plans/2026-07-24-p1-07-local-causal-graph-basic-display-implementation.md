# P1-07 Local Causal Graph Basic Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each behavior change follows RED → GREEN → regression verification.

**Goal:** 在桌面端 Web 应用新增 `/graph` 模块，以一个原子事件为中心展示初始 20 节点档位的上游、下游或双向局部因果图。

**Architecture:** 页面负责 URL 与查询状态，独立选择器负责候选搜索，纯函数把 API 响应转换为稳定的 Cytoscape 元素；`CausalGraphCanvas` 独占 Cytoscape/ELK 实例并通过窄命令接口暴露 zoom、fit 和布局重试。图页面采用路由级动态导入，避免其他管理页面加载图形依赖。

**Tech Stack:** React 19、React Router 8、TanStack Query 5、TypeScript 6、Cytoscape 3.34.0、cytoscape-elk 2.3.0、elkjs 0.12.0、Vitest 4、Testing Library 16、Playwright 1.61。

## Global Constraints

- 固定请求 `limit=20&minConfidence=0&minCaseCount=0`；P1-07 不增加筛选和扩展。
- 只把 `centerEventId` 和 `direction` 写入 URL；无效方向规范为 `both`。
- 图始终保留原因到结果的真实边方向并使用从左到右的 ELK layered 布局。
- 节点固定 `220 × 96px`、不可选择、不可拖动；P1-08 交互不得提前实现。
- 缩放范围固定 25%–200%；适应画布不重新布局。
- API、共享契约、数据库 Schema 和后端代码保持不变。

---

### Task 1: Graph API adapter and deterministic element helpers

**Files:**

- Create: `apps/web/src/features/causal-graph/api/causalGraphApi.ts`
- Create: `apps/web/src/features/causal-graph/api/causalGraphApi.test.ts`
- Create: `apps/web/src/features/causal-graph/graph/fitNodeLabel.ts`
- Create: `apps/web/src/features/causal-graph/graph/fitNodeLabel.test.ts`
- Create: `apps/web/src/features/causal-graph/graph/createGraphElements.ts`
- Create: `apps/web/src/features/causal-graph/graph/createGraphElements.test.ts`
- Create: `apps/web/src/features/causal-graph/graph/graphLayoutOptions.ts`
- Create: `apps/web/src/features/causal-graph/graph/graphLayoutOptions.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Install the locked graph dependencies**

Run:

```bash
pnpm --filter @causality/web add cytoscape@3.34.0 cytoscape-elk@2.3.0 elkjs@0.12.0
```

Verify no React Cytoscape wrapper or separate Cytoscape types package is installed.

- [x] **Step 2: Write failing API and pure-function tests**

Cover:

```ts
expect(fetch).toHaveBeenCalledWith(
  `/api/causal-graph?centerEventId=${centerId}&direction=both&limit=20&minConfidence=0&minCaseCount=0`,
  expect.objectContaining({ signal: expect.any(AbortSignal) }),
);

expect(elements.nodes[0].data).toMatchObject({
  id: centerId,
  isCenter: true,
  width: 220,
  height: 96,
});
expect(elements.edges[0].data).toMatchObject({
  source: causeId,
  target: effectId,
  label: '80% · 6例',
});

expect(graphLayoutOptions.elk).toMatchObject({
  algorithm: 'layered',
  'elk.direction': 'RIGHT',
});
```

Use an injected `measureText(text, fontSize)` in label tests so Happy DOM does not need a real Canvas. Test Chinese, English, mixed text, a no-space long word, and a 120-character name. Assert that the result uses only `14 | 12 | 10 | 9`, preserves every character, and never changes node dimensions.

- [x] **Step 3: Verify RED**

Run:

```bash
pnpm --filter @causality/web test -- causalGraphApi.test.ts fitNodeLabel.test.ts createGraphElements.test.ts graphLayoutOptions.test.ts
```

Expected: FAIL because the graph modules do not exist.

- [x] **Step 4: Implement the smallest adapters**

`getCausalGraph()` constructs the fixed request and parses with `causalGraphResponseSchema`. It uses the same ten-second timeout and `ApiClientError` behavior as the existing web APIs.

`fitNodeLabel()` returns `{ text, fontSize }`; it wraps to a `196 × 72px` text area, tries `14, 12, 10, 9`, treats CJK as characters, keeps English words together when possible, and falls back to character splitting for oversized words.

`createGraphElements()` preserves response order and emits center metadata plus real edge endpoints. `graphLayoutOptions` exports the approved layered/RIGHT configuration and `GRAPH_FIT_PADDING = 48`.

- [x] **Step 5: Verify GREEN and web regression**

Run:

```bash
pnpm --filter @causality/web test
pnpm --filter @causality/web typecheck
```

Expected: all tests and type checks PASS.

---

### Task 2: Accessible center selector and graph toolbar

**Files:**

- Create: `apps/web/src/features/causal-graph/components/GraphEventSelector.tsx`
- Create: `apps/web/src/features/causal-graph/components/GraphEventSelector.test.tsx`
- Create: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.tsx`
- Create: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.test.tsx`

- [x] **Step 1: Write failing interaction tests**

Test 250ms debounce, empty-query suppression, eight-candidate limit, ArrowUp/ArrowDown selection, Enter confirmation, Escape close, and nearby candidate-query error. Candidates show names only.

Test toolbar direction buttons as an accessible single-choice control and assert callbacks for `upstream | downstream | both`, zoom in, zoom out, and fit. Assert zoom buttons disable at 25% and 200%.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @causality/web test -- GraphEventSelector.test.tsx CausalGraphToolbar.test.tsx
```

Expected: FAIL because both components are missing.

- [x] **Step 3: Implement selector and toolbar**

Use the existing candidate endpoint via `getEventCandidates(query, { limit: 8 }, signal)`. Keep confirmed `value` separate from draft input, update the visible name when URL restoration supplies a value, and expose normal combobox/listbox semantics. The toolbar contains only the approved search, direction, `－`, zoom percentage, `＋`, and `适应画布` controls.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @causality/web test -- GraphEventSelector.test.tsx CausalGraphToolbar.test.tsx
```

Expected: both test files PASS.

---

### Task 3: Cytoscape canvas lifecycle, layout, zoom and status layers

**Files:**

- Create: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.tsx`
- Create: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.test.tsx`
- Create: `apps/web/src/features/causal-graph/causalGraph.css`

- [x] **Step 1: Write failing canvas tests against a narrow adapter**

Inject a `createGraphRuntime(container)` factory in tests. Verify:

- instance creation and `destroy()` on unmount;
- nodes are locked/ungrabbable/unselectable;
- each new response replaces elements, runs ELK, then calls fit with 48px padding;
- layout callbacks produce `loading | ready | error` state;
- retry layout does not call the API;
- zoom-in/out clamps to 0.25–2.0 and reports the actual percentage;
- fit changes only viewport;
- reduced-motion uses no animated viewport transition;
- stable `data-layout-state`, `data-node-count`, `data-relation-count` attributes and accessible canvas name.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @causality/web test -- CausalGraphCanvas.test.tsx
```

Expected: FAIL because the canvas is missing.

- [x] **Step 3: Implement production runtime and component**

Register `cytoscape-elk` once at module scope. `CausalGraphCanvas` owns the Cytoscape instance, exposes only:

```ts
interface CausalGraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  retryLayout(): void;
}
```

Apply a common 220×96 node style, center-node variant, compact edge label, triangle target arrow, bezier curves, min/max zoom, panning, wheel zoom, and disabled box selection. Maintain the previous rendered elements until replacement layout succeeds. Render approved empty, initial loading, refresh overlay, isolated-node, request-error, and layout-error layers.

- [x] **Step 4: Verify GREEN and production build**

Run:

```bash
pnpm --filter @causality/web test -- CausalGraphCanvas.test.tsx
pnpm --filter @causality/web build
```

Expected: tests PASS and the Vite build emits a separate graph chunk.

---

### Task 4: Page URL orchestration, lazy route and navigation

**Files:**

- Create: `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`
- Create: `apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/main.tsx`

- [x] **Step 1: Write failing page and shell tests**

Cover:

- no center displays the selection prompt and sends no graph request;
- selecting a candidate writes `?centerEventId=<uuid>&direction=both` and queries immediately;
- valid URL restores event name and direction;
- missing/invalid direction is replaced with canonical `both`;
- non-UUID center displays an invalid-link state and sends no graph request;
- all three directions trigger their exact request;
- requery keeps the previous graph visible under `正在重新生成…`;
- 404, generic error, retry, isolated graph, and `relation_limit` messages;
- count heading uses response meta;
- app shell exposes `因果图` and router loads `/graph` lazily.

Use a mocked `CausalGraphCanvas` for page tests so URL/query behavior is independent of Canvas rendering.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @causality/web test -- CausalGraphPage.test.tsx
```

Expected: FAIL because the page and route do not exist.

- [x] **Step 3: Implement page orchestration**

Parse URL state without global storage. Query event details and graph data with TanStack Query and pass each query `AbortSignal`. Selecting a new center resets direction to `both`; direction changes preserve the center. Normalize only invalid/missing direction with `replace: true`.

Add `因果图` between `具体案例` and `系统状态`. Use React Router `lazy` to import the page module. Import `causalGraph.css` from the lazy page module so graph CSS follows the graph chunk rather than the application entry.

- [x] **Step 4: Verify GREEN and route regression**

Run:

```bash
pnpm --filter @causality/web test
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: all web tests, type checks and build PASS; non-graph routes remain functional.

---

### Task 5: Real-browser acceptance, documentation and handoff

**Files:**

- Create: `tests/e2e/causal-graph.spec.ts`
- Modify: `README.md`
- Modify: `docs/stages/phase-1/P1-07-local-causal-graph-basic-display-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

- [x] **Step 1: Write the Playwright acceptance test**

With the deterministic seeded database, navigate from the header, search/select a center, assert canonical URL, layout-ready attributes and API-matching counts, switch all directions, reload, use zoom and fit, verify isolated state, collect browser errors, and save `causal-graph-desktop.png` at 1280×720. Do not locate text inside the Cytoscape Canvas.

- [x] **Step 2: Verify E2E RED before relying on it**

Run the graph spec once before the final UI wiring is considered complete. Any failed state/locator becomes a product or test fix; do not weaken the acceptance criteria.

- [x] **Step 3: Run focused E2E and inspect the screenshot**

Run:

```bash
pnpm test:e2e -- causal-graph.spec.ts
```

Expected: PASS with no console/page errors. Inspect the screenshot for 1280×720 clipping, overlaps, label legibility, left-to-right direction, and consistency with existing modules.

- [x] **Step 4: Update stage documentation**

README adds graph-page usage. Mark P1-07 `等待人工复核` in its design and roadmap, record automated commands/results, and leave P1-08 `未开始`.

- [x] **Step 5: Run the complete verification gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git diff --check
git status --short
```

Expected: every command PASS; only intended P1-07 files are changed.

- [x] **Step 6: Commit and stop for manual review**

```bash
git add apps/web/src/features/causal-graph apps/web/src/app/AppShell.tsx apps/web/src/app/router.tsx apps/web/package.json pnpm-lock.yaml tests/e2e/causal-graph.spec.ts README.md docs/stages/phase-1/P1-07-local-causal-graph-basic-display-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
git commit -m "feat: add local causal graph display"
```

After the commit, provide the manual checklist from the approved design. Do not mark P1-07 complete or start P1-08 until the user explicitly reports that manual verification succeeded.
