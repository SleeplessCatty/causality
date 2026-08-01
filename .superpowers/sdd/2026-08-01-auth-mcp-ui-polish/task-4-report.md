# Task 4 Report: E2E Password Selector Regression

## Status

- Result: DONE
- Commit message: `test: disambiguate password field selectors`

## Delivered

- Made the initial-password confirmation field locator exact in the shared
  Playwright authentication setup.
- This prevents `getByLabel('确认新密码')` from also matching the accessible
  name of the adjacent "显示确认新密码" visibility button.
- Production components and accessibility labels were not changed.

## Verification

- `pnpm exec eslint tests/e2e/support/authenticateUser.ts` — passed.
- `pnpm exec prettier --check tests/e2e/support/authenticateUser.ts` — passed.
- `git diff --check` — passed.
- `DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm test:e2e` — passed, 36 Playwright tests. The E2E database cleanup completed and no failure artifacts were generated.
- Browser acceptance at `http://localhost:5173` — passed against an isolated temporary PostgreSQL database:
  - login, settings, voluntary password-change, and forced password-change pages were all non-empty and showed no error overlay;
  - relevant browser console error checks were empty during login and settings validation;
  - login and sidebar use the same shared `C` brand mark;
  - MCP settings render as the compact `服务概览` / `个人令牌管理` / `客户端配置说明` sections;
  - token creation uses `令牌名称` and contains no device/client terminology;
  - voluntary password change exposes independent visibility controls for current, new, and confirmation fields, and Cancel returns to `/settings`;
  - forced initial password change exposes new and confirmation visibility controls and does not render Cancel.
- Desktop screenshot artifacts:
  - voluntary password change: `/tmp/causality-voluntary-password.png` (1280×720 desktop viewport);
  - forced initial password change: `/tmp/causality-forced-password.png` (1280×720 desktop viewport).
- The temporary browser-QA users and database were removed after validation.
- `pnpm test` — passed: contracts 109, semantic-core 9, API 411, semantic-worker 61, MCP 125, web 344 tests.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm format:check` — passed.
- `pnpm build` — passed. Vite retained the existing large causal-graph chunk warning; no build failure occurred.

## Concerns

No known concerns. The pre-existing untracked `research/` directory was not
modified or included in this change.
