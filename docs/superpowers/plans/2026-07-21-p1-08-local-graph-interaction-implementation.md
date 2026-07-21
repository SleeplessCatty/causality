# P1-08 Local Graph Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 P1-07 局部因果图增加无悬浮的节点/关系选择、一跳邻接高亮、空间方向键导航、独立开关的右侧详情检查器和当前图会话内的节点拖动。

**Architecture:** Cytoscape Runtime 只处理图坐标、选择样式、点击和拖动事件；React 页面保存 `selection` 与 `inspectorOpen`；纯函数根据拓扑和坐标计算方向导航；节点和关系检查器分别复用现有详情 API。选中和位置均为临时状态，不进入 URL、Context 或数据库。

**Tech Stack:** React 19、React Router 8、TanStack Query 5、TypeScript 6、Cytoscape 3.34、Vitest 4、Testing Library 16、Playwright 1.61。

**Status:** 实施完成，等待人工复核（2026-07-21）。检查器内容按当前规模合并在一个组件中，真实浏览器验收使用 Playwright CLI 执行，没有新增重复的 E2E spec。

## Global Constraints

- 图初始无选择，不实现 hover 或 Tooltip。
- 节点选择高亮节点、所有直接相邻关系及另一端节点；关系选择只高亮关系和两个端点。
- 未高亮元素保持原样，不降低透明度。
- `selection` 与 `inspectorOpen` 独立；空格只切换检查器，点击和方向键只切换选择。
- 方向导航采用节点→关系→节点，按方向夹角、距离、ID 确定候选。
- 检查器宽约 380px，打开不重新布局或自动 fit。
- 所有节点可拖动，拖动不改变选择；新图、中心、方向或重新布局清除位置。
- 设置新中心保留当前方向。
- 不修改 `packages/contracts`、`apps/api`、数据库、20 节点档位和筛选参数。

---

### Task 1: Selection types, adjacency and spatial navigation

**Files:**

- Create: `apps/web/src/features/causal-graph/graph/graphSelection.ts`
- Create: `apps/web/src/features/causal-graph/graph/graphSelection.test.ts`
- Create: `apps/web/src/features/causal-graph/graph/graphNavigation.ts`
- Create: `apps/web/src/features/causal-graph/graph/graphNavigation.test.ts`
- Modify: `apps/web/src/features/causal-graph/graph/createGraphElements.ts`
- Modify: `apps/web/src/features/causal-graph/graph/createGraphElements.test.ts`

**Interfaces:**

```ts
export type GraphElementSelection =
  | { type: 'node'; id: string }
  | { type: 'relation'; id: string };

export type GraphNavigationDirection = 'up' | 'down' | 'left' | 'right';
export interface GraphPositionSnapshot {
  centerEventId: string;
  nodes: Array<{ id: string; x: number; y: number }>;
  relations: Array<{ id: string; causeEventId: string; effectEventId: string }>;
}

export function adjacentSelectionIds(
  selection: GraphElementSelection,
  graph: Pick<CausalGraphResponse, 'relations'>,
): { currentId: string; contextNodeIds: string[]; contextRelationIds: string[] };

export function navigateGraph(
  selection: GraphElementSelection | null,
  direction: GraphNavigationDirection,
  snapshot: GraphPositionSnapshot,
): GraphElementSelection;
```

- [x] **Step 1: Write failing pure-function tests**

Test node one-hop adjacency, relation endpoints, no recursive highlighting, center selection from null, node→incident relation, relation→endpoint node, directional exclusion, angle/distance/ID tie-breaking, reverse and parallel relations, and no-candidate retention.

Representative assertions:

```ts
expect(adjacentSelectionIds({ type: 'node', id: causeId }, graph)).toEqual({
  currentId: causeId,
  contextNodeIds: [effectId],
  contextRelationIds: [relationId],
});
expect(navigateGraph(null, 'right', snapshot)).toEqual({ type: 'node', id: centerId });
expect(navigateGraph({ type: 'node', id: centerId }, 'right', snapshot)).toEqual({
  type: 'relation',
  id: relationId,
});
```

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @causality/web test -- graphSelection.test.ts graphNavigation.test.ts`

Expected: FAIL because both modules do not exist.

- [x] **Step 3: Implement deterministic helpers and element accessibility data**

Use relation midpoints, positive directional dot product, absolute angular deviation, Euclidean distance, then ID. Add cause/effect names to edge data in `createGraphElements` so announcements do not require a detail request.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @causality/web test -- graphSelection.test.ts graphNavigation.test.ts createGraphElements.test.ts`

Expected: all focused tests PASS.

---

### Task 2: Interactive Cytoscape Runtime and Canvas keyboard model

**Files:**

- Create: `apps/web/src/features/causal-graph/graph/graphStyles.ts`
- Create: `apps/web/src/features/causal-graph/graph/createGraphRuntime.ts`
- Create: `apps/web/src/features/causal-graph/graph/createGraphRuntime.test.ts`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.test.tsx`

**Interfaces:**

```ts
export interface GraphInteractionCallbacks {
  onSelect(selection: GraphElementSelection): void;
  onClearSelection(): void;
}

export interface GraphRuntime {
  // existing layout, commit, fit and zoom methods
  setSelection(selection: GraphElementSelection | null): void;
  getNavigationSnapshot(centerEventId: string): GraphPositionSnapshot;
  resize(): void;
  ensureVisible(selection: GraphElementSelection, padding: number, animate: boolean): void;
  subscribeInteractions(callbacks: GraphInteractionCallbacks): () => void;
}
```

Canvas props add `selection`, `inspectorOpen`, `onSelectionChange`, `onClearSelection`, `onToggleInspector` and `onEscape`.

- [x] **Step 1: Write failing Runtime and Canvas tests**

Verify tap node/edge, tap background, `is-current`/`is-context` classes, no opacity class, enlarged edge overlay, drag not firing tap, nodes grabbable, subscription cleanup, direction keys, space and Escape separation, initial center selection, live announcement, resize and ensure-visible, and reduced motion.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @causality/web test -- createGraphRuntime.test.ts CausalGraphCanvas.test.tsx`

Expected: FAIL on missing interaction interfaces and behaviors.

- [x] **Step 3: Extract styles/production Runtime and implement Canvas behavior**

Move P1-07 styles and factory out of the component. Use `desktopTapThreshold: 4`, `autoungrabify: false`, unlock nodes after commit, and batch class changes. Use one focusable `role="application"` renderer; prevent arrow/space defaults only while it owns focus.

- [x] **Step 4: Verify GREEN and regression**

Run:

```bash
pnpm --filter @causality/web test -- createGraphRuntime.test.ts CausalGraphCanvas.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: focused tests and type check PASS.

---

### Task 3: Event and relation inspector content

**Files:**

- Create: `apps/web/src/features/causal-graph/components/CausalGraphInspector.tsx`
- Create: `apps/web/src/features/causal-graph/components/CausalGraphInspector.test.tsx`
- Create: `apps/web/src/features/causal-graph/components/EventInspectorContent.tsx`
- Create: `apps/web/src/features/causal-graph/components/EventInspectorContent.test.tsx`
- Create: `apps/web/src/features/causal-graph/components/RelationInspectorContent.tsx`
- Create: `apps/web/src/features/causal-graph/components/RelationInspectorContent.test.tsx`

**Interfaces:**

```ts
interface CausalGraphInspectorProps {
  open: boolean;
  selection: GraphElementSelection | null;
  centerEventId: string;
  onClose(): void;
  onSetCenter(event: EventCandidate): void;
}
```

- [x] **Step 1: Write failing inspector tests**

Cover closed/no request, open empty prompt, skeleton, event name/description/aliases/keywords, empty fields, current-center state, set-center callback, relation direction/confidence/case count/description, zero cases, five recent cases, `/cases?relationId=...`, generic failure and retry.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @causality/web test -- CausalGraphInspector.test.tsx EventInspectorContent.test.tsx RelationInspectorContent.test.tsx`

Expected: FAIL because inspector modules do not exist.

- [x] **Step 3: Implement inspector components with existing APIs**

Use `getEvent(id, signal)` and `getRelation(id, signal)` only when `open && selection`. Keep the shell mounted only while open, use an accessible close button and a scrollable content region, and never render timestamps or edit actions.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @causality/web test -- CausalGraphInspector.test.tsx EventInspectorContent.test.tsx RelationInspectorContent.test.tsx`

Expected: all inspector tests PASS.

---

### Task 4: Page state orchestration, resize layout and center navigation

**Files:**

- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx`
- Modify: `apps/web/src/features/causal-graph/causalGraph.css`

- [x] **Step 1: Write failing page-state tests**

Mock Canvas and Inspector and verify: initial null/closed, selection does not open, space toggles without changing selection, switching selection keeps open state, blank clears but leaves inspector open, Escape clears/closes, close preserves selection, direction/search/new response clear all interaction state, set-center preserves direction, and inspector-open CSS state.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @causality/web test -- CausalGraphPage.test.tsx`

Expected: FAIL because P1-07 page has no interaction state or inspector.

- [x] **Step 3: Implement orchestration and 380px workbench CSS**

Keep `selection` and `inspectorOpen` local to the page. Wrap Canvas/Inspector in `.causal-graph-workbench`, use `grid-template-columns: minmax(0, 1fr) 380px` while open, call Canvas `resize()` after the CSS frame, then `ensureSelectionVisible(32)`. Clear state in every matrix-defined graph-reset path.

- [x] **Step 4: Verify GREEN and full web regression**

Run:

```bash
pnpm --filter @causality/web test
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: all web tests, type checks and production build PASS.

---

### Task 5: Real-browser acceptance, documentation and handoff

**Files:**

- Modify: `README.md`
- Modify: `docs/stages/phase-1/P1-08-local-graph-interaction-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

- [x] **Step 1: Run Playwright CLI acceptance scenarios**

Use fixed seed data and stable Runtime test attributes to verify mouse node/edge selection, adjacency highlighting, no initial selection, space open/close, selection switching with panel open/closed, arrow node→relation→node navigation, blank/Escape/close behavior, event and relation content, case link, drag position, direction reset, set-center URL preserving direction, and canvas focus restoration.

- [x] **Step 2: Inspect real-browser screenshots and runtime state**

Run the application against the fixed seed and drive the 1280×720 page through Playwright CLI. Inspect the full graph and relation-inspector screenshots, DOM state attributes, focus state and console output. Temporary browser artifacts are removed after review.

- [x] **Step 3: Update status documentation**

Mark P1-08 `等待人工复核`, record exact automated results, document interaction shortcuts in README, and leave P1-09 `未开始`.

- [x] **Step 4: Run the complete verification gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
git status --short
```

Expected: every command PASS and only intended P1-08 files are changed.

- [x] **Step 5: Commit and stop for manual review**

```bash
git add apps/web/src/features/causal-graph README.md docs/stages/phase-1/P1-08-local-graph-interaction-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md docs/superpowers/plans/2026-07-21-p1-08-local-graph-interaction-implementation.md
git commit -m "feat: add local graph interactions"
```

After committing, provide the manual checklist from the approved P1-08 design. Do not mark P1-08 complete or start P1-09 until the user explicitly reports successful manual verification.
