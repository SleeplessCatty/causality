# Password and MCP UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一品牌标记、改善密码修改交互，并将 MCP 服务模块整理为紧凑且概念准确的桌面界面。

**Architecture:** 提取纯展示品牌组件和可复用密码输入组件；页面继续使用现有 React Router、TanStack Query、AppDialog 与样式体系。令牌 API 和数据库字段保持不变，所有“令牌名称”转换仅发生在展示层。

**Tech Stack:** React 19、React Router、TanStack Query、Vitest、Testing Library、Playwright、CSS、SVG

## Global Constraints

- 首次登录强制修改密码时不显示取消按钮。
- 主动修改密码取消后返回 `returnTo`，不退出登录。
- 当前密码、新密码、确认新密码均支持独立显示和隐藏。
- 用户界面不得把个人令牌描述为设备或特定客户端。
- 保留后端 `deviceName` 字段，不执行数据库迁移。
- 只支持桌面端现有布局，不新增移动端适配。

---

### Task 1: 修改密码交互

**Files:**
- Create: `apps/web/src/features/auth/PasswordField.tsx`
- Modify: `apps/web/src/features/auth/InitialPasswordPage.tsx`
- Modify: `apps/web/src/features/auth/auth.css`
- Test: `apps/web/src/features/auth/InitialPasswordPage.test.tsx`

**Interfaces:**
- Produces: `PasswordField({ id, label, value, onChange, autoComplete, ...inputProps })`，内部维护显示状态。
- Consumes: 路由 state 中现有的 `returnTo`。

- [ ] **Step 1: 写失败测试**

增加测试：三组密码输入可独立切换 `password/text`；主动修改显示“取消”并返回 `returnTo`，不请求 logout；首次登录不显示取消。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @causality/web exec vitest run src/features/auth/InitialPasswordPage.test.tsx`

Expected: 因缺少显示按钮、取消按钮仍为退出登录而失败。

- [ ] **Step 3: 最小实现**

创建 `PasswordField`，替换页面三个输入框；删除 `exit()`；主动流程中取消执行 `navigate(returnTo, { replace: true })`，首次流程不渲染取消。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @causality/web exec vitest run src/features/auth/InitialPasswordPage.test.tsx`

Expected: PASS。

### Task 2: 共享品牌图标与 favicon

**Files:**
- Create: `apps/web/src/shared/brand/AppBrandMark.tsx`
- Create: `apps/web/public/favicon.svg`
- Modify: `apps/web/src/app/AppSidebar.tsx`
- Modify: `apps/web/src/features/auth/LoginPage.tsx`
- Modify: `apps/web/src/features/auth/auth.css`
- Modify: `apps/web/src/styles/appShell.css`
- Modify: `apps/web/index.html`
- Test: `apps/web/src/features/auth/LoginPage.test.tsx`
- Test: `apps/web/src/app/AppSidebar.test.tsx`

**Interfaces:**
- Produces: `<AppBrandMark className?: string />`，登录页和侧栏共享相同标记结构。

- [ ] **Step 1: 写失败测试**

验证登录页和侧栏渲染同一 `data-brand-mark="causality"` 标记。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @causality/web exec vitest run src/features/auth/LoginPage.test.tsx src/app/AppSidebar.test.tsx`

Expected: 找不到共享品牌标记。

- [ ] **Step 3: 最小实现**

提取 `AppBrandMark`，复用现有侧栏造型；创建同造型 SVG favicon 并在 `index.html` 使用 `<link rel="icon" href="/favicon.svg">`。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @causality/web exec vitest run src/features/auth/LoginPage.test.tsx src/app/AppSidebar.test.tsx`

Expected: PASS。

### Task 3: MCP 服务紧凑布局与令牌文案

**Files:**
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/parameterSettings.css`
- Modify: `tests/e2e/parameter-settings-mcp.spec.ts`

**Interfaces:**
- Consumes: 现有 `deviceName` API 字段。
- Produces: 用户可见的“令牌名称”概念和紧凑的服务概览、令牌管理、配置帮助分区。

- [ ] **Step 1: 写失败测试**

验证“令牌名称”、服务概览、15/5/4 能力、配置帮助和撤销文案；断言不存在用户可见的“设备名称”“为此客户端”。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @causality/web exec vitest run src/features/parameter-settings/McpSettingsPanel.test.tsx`

Expected: 旧文案和旧结构导致失败。

- [ ] **Step 3: 最小实现**

重组现有 JSX 为三个语义分区，复用现有按钮、表格和 AppDialog；只改变用户可见文案与 CSS，不改变 API payload。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @causality/web exec vitest run src/features/parameter-settings/McpSettingsPanel.test.tsx`

Expected: PASS。

### Task 4: 回归与浏览器验收

**Files:**
- Test: `apps/web/src/features/auth/InitialPasswordPage.test.tsx`
- Test: `apps/web/src/features/auth/LoginPage.test.tsx`
- Test: `apps/web/src/app/AppSidebar.test.tsx`
- Test: `apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx`
- Test: `tests/e2e/parameter-settings-mcp.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3 完成的桌面页面。
- Produces: 自动化与渲染验收记录。

- [ ] **Step 1: 运行 Web 门禁**

Run: `pnpm --filter @causality/web test && pnpm --filter @causality/web typecheck`

- [ ] **Step 2: 运行 E2E**

Run: `pnpm test:e2e`

- [ ] **Step 3: 浏览器验证**

检查 `/settings`、`/login`、主动和首次 `/change-initial-password`：页面身份、非空、无错误覆盖层、控制台无相关错误、桌面截图及目标交互。

- [ ] **Step 4: 完整代码门禁**

Run: `pnpm lint && pnpm format:check && pnpm build`

Expected: 全部 PASS。
