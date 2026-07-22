# Task 5 实施报告：收敛前端数据访问与关联详情加载策略

## 实现内容

- 新增 `shared/api/httpClient`：统一 10 秒超时、调用方取消、JSON Accept/Content-Type、标准 API 错误解析和非标准错误回退。`ApiClientError` 现在只由该模块导出。
- 事件、案例、关系和因果图 API 全部迁移至 `requestJson`；每个模块保留 URL、方法、负载和 Zod 响应解析职责。系统状态 API 未改动，仍保留 5 秒超时与 readiness 503 语义。
- 关系详情仍使用 `useInfiniteQuery`，但首次只请求固定 100 条。删除自动翻页 effect；有下一页时显示“加载更多”，后续页失败时保留已加载内容并提供重试。
- 因果图页删除中心事件 `getEvent` 查询及 `['events', 'detail', 'causal-graph', id]` 缓存键。中心名称依次取用户刚选候选、当前/已保留的成功图中心节点、URL 加载期的“中心事件”；重试只 refetch 图查询。
- 候选 Hook 的泛型收敛为 `{ id: string }`，内部以 `item.id` 去重；调用方使用基础 query key，Hook 只追加一次搜索词。候选仍自动读取所有分页结果，没有结果数上限。

## 变更文件

- 新增：`apps/web/src/shared/api/httpClient.ts`、`apps/web/src/shared/api/httpClient.test.ts`
- API：`eventApi.ts`、`caseApi.ts`、`relationApi.ts`、`causalGraphApi.ts`
- 页面与测试：`CausalGraphPage.tsx`、`CausalGraphPage.test.tsx`、`RelationDetailPage.tsx`、`RelationDetailPage.test.tsx`
- 候选：`useExhaustiveCandidates.ts`、`useExhaustiveCandidates.test.tsx`、`GraphEventSelector.tsx`、`EventSelector.tsx`、`CaseSelectorRow.tsx`
- 错误类型导入：`EventForm.tsx`、`CaseForm.tsx`、`RelationForm.tsx`

## RED / GREEN 证据

1. HTTP 客户端：
   - RED：`pnpm --filter @causality/web test -- src/shared/api/httpClient.test.ts`，预期失败，`Failed to resolve import "./httpClient"`。
   - GREEN：同一命令通过，`34 passed` / `147 passed`；覆盖 2xx JSON、标准/非标准错误、取消、10 秒超时、请求体 Header 和无 body Header。
2. 关系详情分页：
   - RED：`pnpm --filter @causality/web test -- src/features/relations/pages/RelationDetailPage.test.tsx`，2 项失败；第二页在未点击时已渲染且无“加载更多”。
   - GREEN：同一命令通过，`34 passed` / `147 passed`。
3. 因果图重复请求：
   - RED：`pnpm --filter @causality/web test -- src/features/causal-graph/pages/CausalGraphPage.test.tsx`，新增 URL 中心测试发现 `getEvent` 被调用一次。
   - GREEN：同一命令通过，`34 passed` / `148 passed`。
   - E2E 回归曾暴露替换图查询失败时中心名称退回“中心事件”；将成功图回退纳入名称优先级后，`pnpm exec playwright test tests/e2e/causal-graph-expansion-filter.spec.ts` 通过，`1 passed (7.0s)`。
4. 候选 Hook：
   - RED：`pnpm --filter @causality/web test -- src/shared/candidates/useExhaustiveCandidates.test.tsx`，3 项失败，关键错误为 `TypeError: getId is not a function`。
   - GREEN：候选 Hook 和三个选择器的局部测试命令通过，`34 passed` / `148 passed`。

## 全量验证

- `pnpm exec prettier --check <全部变更的 Web 源文件>`：通过。
- `pnpm lint`：通过。
- `pnpm --filter @causality/web test`：通过，34 文件、148 测试。
- `pnpm typecheck`：通过（contracts、API、Web）。
- `COREPACK_HOME=/tmp/causal-memory-corepack corepack pnpm test:e2e`：通过，exit 0，15 passed（39.7s）；密集因果图用例 6.0s 通过。

说明：首次在受限沙箱运行 E2E 时 Chromium 因 macOS Mach-port 权限被启动前终止；提升权限后正常执行。随后一次实际 E2E 发现并修复上述中心名称回退问题，最终全套 E2E 由主会话复跑确认通过。

## 自审

- 用 `rg` 确认不再存在业务代码从事件 API 导入 `ApiClientError`，也不再存在图页中心详情缓存键或 `getId` 回调。
- 用 `rg` 确认候选 Hook 仅有一次 `queryKey: [...queryKey, query]`。
- 检查关系详情：没有自动 `fetchNextPage` effect；按钮只在有下一页且非请求/错误状态显示；首批请求保持 `limit: 100`。
- 检查系统状态 API 未修改。
- `git diff --check` 通过；没有格式或空白错误。

## 风险 / 疑问

- 无阻塞疑问。`requestJson` 延续既有业务 API 的 JSON 响应假设；系统健康和 readiness 端点按要求不使用该客户端。

---

## 审查修复追加

### 修复内容

- `requestJson` 现在以 `new Headers(options.headers)` 合并请求头：调用方显式的 `Accept` / `Content-Type` 保持优先，缺省时才添加 `Accept: application/json`，且仅有 body 时才添加 JSON `Content-Type`。因此 `Headers` 与 tuple-array 两种 `HeadersInit` 都能完整保留。
- 非 2xx 响应的 JSON 解析失败（HTML、空响应或损坏 JSON）现在统一回退为 `ApiClientError(INTERNAL_ERROR)`；2xx 仍直接返回 `response.json()`，保留原始 JSON 解析失败语义。
- 加强测试：超时精确断言 `TimeoutError`；覆盖 HTML/空错误响应、两类自定义 Header、图查询重试仅调用 `getCausalGraph`，以及关系详情首批 URL 的 `limit=100`。

### RED / GREEN 证据

- RED：`pnpm --filter @causality/web test -- src/shared/api/httpClient.test.ts src/features/causal-graph/pages/CausalGraphPage.test.tsx src/features/relations/pages/RelationDetailPage.test.tsx`
  - 结果：4 项失败（152 项中 148 通过）。非 JSON 错误返回了 `SyntaxError`，且 `Headers`/tuple-array 的自定义 `Accept` 被默认 `application/json` 覆盖。
- GREEN：同一命令通过，34 文件、152 测试。

### 修复后验证

- `pnpm exec prettier --check <修复相关文件>`：通过。
- `pnpm lint`：通过。
- `pnpm --filter @causality/web test`：通过，34 文件、152 测试。
- `pnpm typecheck`：通过。
- 未重跑 E2E：本轮仅修复 HTTP 头/错误解析与单测断言；此前全套 E2E 已通过 15/15。
