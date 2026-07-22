# Task 6 Report — 清理后端重复基础设施、模拟内存和死资源

## 状态

DONE（提交前报告；最终提交 SHA 见提交记录）。实现范围严格限于 Task 6，未修改 README 或进入 Task 7。

## 实现

- 新增 `apps/api/src/features/shared/sqlSearch.ts`，统一 `normalizeSearchQuery` 与 `escapeLikePattern`。三个 Repository 使用两项工具，三个 Cursor 使用同一规范化函数；Cursor 校验、checksum 和各自业务字段编码仍保留在原模块。
- 新增 Vitest 全局 PostgreSQL setup：一次集成测试运行只创建一个 `postgres:18.4-alpine` 容器，通过 `project.provide` 提供 host、mapped port、user、password，并由返回的 global teardown 停止容器。
- 新增 `startPostgresTestContext(databaseName)`：精确 allowlist 校验七个套件的固定数据库名，逐库创建、迁移、创建 Pool/Fastify app；`close()` 以 app → pool 的逆序并用 `finally` 保证池关闭。七个集成测试文件均改用独立主数据库。
- core-model 的主测试库由共享上下文迁移；两个迁移历史场景继续使用该文件内固定、隔离的子数据库，保持原测试含义且不启动额外容器。
- `runSimulation` 在第一次 `plan.caseLinks()` 循环中累计 `caseLinkCount` 并返回，删除第二次 `Array.from(...).length` 物化。
- 增加 0、默认 10,000、最大 1,000,000 cases 的纯生成器计数测试；最大用例只迭代生成器，不连接或写入数据库。
- 删除确认无源码引用的旧 CSS：`.app-shell`、`.app-header`、`.brand`、`.brand-mark`、`.environment-label`、旧全局 `main` 两栏布局、`.hero` 及子选择器；保留 `.eyebrow` 和所有 `.status-*`。
- 删除 Web 对 `elkjs@0.12.0` 的直接依赖与 lockfile 孤儿节点；保留 `cytoscape-elk` 实际使用的间接 `elkjs@0.9.3`。

## 变更文件

- 新增：`apps/api/src/features/shared/sqlSearch.ts`
- 新增：`apps/api/test/support/integrationGlobalSetup.ts`
- 新增：`apps/api/test/support/postgresTestContext.ts`
- 新增测试：`apps/api/test/sql-search.test.ts`、`apps/api/test/postgres-test-context.test.ts`
- Repository/Cursor：`apps/api/src/features/{events,cases,relations}/*Repository.ts`、`*Cursor.ts`
- 集成基础设施/套件：`apps/api/vitest.integration.config.ts`、七个 `apps/api/test/*.integration.test.ts`
- 模拟器：`apps/api/src/database/test-data/simulate.ts`、`apps/api/test/simulation.test.ts`
- Web/依赖：`apps/web/src/styles/global.css`、`apps/web/package.json`、`pnpm-lock.yaml`

## TDD：RED / GREEN

### RED

命令：

```bash
pnpm --filter @causality/api exec vitest run test/sql-search.test.ts test/postgres-test-context.test.ts test/simulation.test.ts
```

关键输出：exit 1；`sql-search.test.ts` 因 `../src/features/shared/sqlSearch.js` 不存在失败，`postgres-test-context.test.ts` 因 `./support/postgresTestContext.js` 不存在失败；simulation 的既有/生成器特征测试 20 项通过。这确认失败原因是待实现模块，而非测试拼写或环境错误。

### GREEN

命令：

```bash
pnpm --filter @causality/api exec vitest run test/sql-search.test.ts test/postgres-test-context.test.ts test/simulation.test.ts
pnpm --filter @causality/api typecheck
```

关键输出：3 test files passed，29 tests passed；API TypeScript typecheck exit 0。随后 API 完整单元测试在自审加固后为 13 files / 82 tests passed。

自审期间为幂等 Pool teardown 增加第二个 RED：单独运行 `test/postgres-test-context.test.ts` 时，新增用例以 `TypeError: closePostgresTestPool is not a function` 失败（1 failed / 1 passed）；实现基于 `WeakMap` 的单次关闭后，同文件 2 tests passed。

首次全仓 lint 捕获 12 个只类型导入/未使用变量错误；修正后重新运行 lint 与全仓 typecheck 均 exit 0。

## Task 6 全部门禁（最终连续运行）

命令：

```bash
pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
```

结果：整体 exit 0。

- install：Already up to date；frozen lockfile 通过。
- format：All matched files use Prettier code style。
- lint：exit 0，无错误。
- typecheck：contracts、api、web 全部 exit 0。
- unit tests：contracts 5 files / 28 tests；api 13 / 82；web 34 / 152，全部通过。
- integration：7 files / 53 tests，全部通过，运行 6.77s。
- build：contracts/API TypeScript 和 Web Vite production build 全部成功。
- build 保留独立图路由产物：`CausalGraphPage-*.js`（约 1.90 MB）与 `CausalGraphPage-*.css`（约 10.12 kB），主入口仍为独立 `index-*.js`，证明图路由继续懒加载。
- 唯一非失败提示：Vite 对超过 500 kB 的图 chunk 给出既有 size warning；不影响 exit code 或懒加载边界。

## 单容器与隔离数据库证据

- `rg "GenericContainer|postgres:18.4-alpine" apps/api/test` 仅命中 `test/support/integrationGlobalSetup.ts` 的一个 `new GenericContainer('postgres:18.4-alpine')`。
- `vitest.integration.config.ts` 同时包含唯一 global setup 和 `fileParallelism: false`。
- 七个集成文件分别调用 allowlist helper，固定主数据库为：
  - `causality_cases_test`
  - `causality_core_model_test`
  - `causality_database_tools_test`
  - `causality_events_test`
  - `causality_graph_test`
  - `causality_readiness_test`
  - `causality_relations_test`
- 一次真实 `pnpm test:integration` 以 7 files / 53 tests 通过；容器由 global teardown 停止。不存在套件内 `GenericContainer` 或 `container.stop()`。
- allowlist 单元测试确认任意 `causality_untrusted_test` 在读取注入配置或连接数据库前即被拒绝。

## 依赖树与死资源证据

命令：

```bash
pnpm --filter @causality/web why elkjs
```

输出仅一条依赖链：`elkjs@0.9.3 <- cytoscape-elk@2.3.0 <- @causality/web`；lockfile 中不再存在 `elkjs@0.12.0`。

源码引用检查未发现删除的旧 global.css selectors；`.eyebrow` 与 `.status-*` 仍同时存在于 CSS 和 `SystemStatus.tsx` 使用点。生产构建和 152 项 Web 测试验证页面/图相关资源未误删。

## 自审

- 范围：diff 只包含 brief 指定的 API 搜索/集成/模拟文件、Web CSS/依赖、相应测试与本报告；未触及 REST schema、路由含义、README 或 Task 7。
- 正确性：共享函数逐调用点检查，六个旧 `normalizeQuery`/三个旧 `escapeLike` 定义均已删除；SQL 参数和排序未改变。
- 生命周期：global setup 唯一持有容器；suite context 创建 pool 后创建 app，close 明确 app 后 pool，即使 app close 抛错也在 `finally` 尝试结束 pool；Pool teardown 由 `WeakMap` 幂等协调，不依赖 `pg` 错误字符串，readiness 测试主动结束 pool 的原行为仍通过。
- 双轴自审：spec 轴无缺失、越界或错误；standards 轴无硬性违规。已消除连接配置 Data Clump 与 teardown 错误字符串耦合；固定数据库名在 allowlist 与套件调用点保持显式重复，便于逐文件审计且运行时边界仍严格校验。
- 模拟内存：生产代码仅调用一次 `plan.caseLinks()`；测试最大值不 `Array.from`、不落库。
- 风险：core-model 为保留“旧迁移 → 当前迁移”的测试语义，在其独立主库旁创建两个该文件专属固定子库；它们共享同一容器并随 global teardown 删除。Vite 图 chunk 仍有既有体积 warning，Task 6 不改变其内容或切分策略。

## Review follow-up：生产路径与生命周期测试

### Simulation production-path RED

在 `simulation.test.ts` 增加经过真实 `runSimulation` 的测试。测试只 mock `createDatabaseClient` 的 transaction/insert chain，并用 spy plan 统计 `caseLinks()` 调用；没有数据库连接或写入。为证明测试能捕获原缺陷，临时恢复旧的 `Array.from(plan.caseLinks()).length` 返回路径后运行：

```bash
pnpm --filter @causality/api exec vitest run test/simulation.test.ts
```

关键输出：exit 1；20 tests passed / 1 failed；失败为 `expected "vi.fn()" to be called once, but got 2 times`。这直接证明新增测试覆盖 `runSimulation` 的二次迭代缺陷，而不只是生成器自身。

### Simulation production-path GREEN

恢复生产实现 `caseLinks: caseLinkCount`（首次插入循环内计数）后以同一命令运行：1 file / 21 tests passed。测试同时断言 `result.inserted.caseLinks === 2`。

### PostgreSQL context lifecycle coverage

在既有窄范围 module mocks 上增加：正常 close 的 app → pool 顺序、迁移失败关闭 database pool、app ready 失败按 app → pool 清理，以及原有 double pool close 幂等断言。未增加生产依赖注入或改动 helper 公共行为。

最终 focused 命令：

```bash
pnpm --filter @causality/api exec vitest run test/simulation.test.ts test/postgres-test-context.test.ts
```

输出：2 files / 26 tests passed，exit 0。

### Review follow-up 门禁

```bash
pnpm --filter @causality/api test
pnpm format:check
pnpm lint
pnpm typecheck
```

最终输出：API 13 files / 86 tests passed；Prettier 全部匹配；ESLint exit 0；contracts/API/Web TypeScript 全部 exit 0。未运行 E2E，原因是本 follow-up 仅增加 API 单元测试，不改变 Web 或运行时行为。桌面视觉复核保留为 controller/user 的后续人工门禁，未以自动化替代。
