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

## Concerns

No known concerns. The pre-existing untracked `research/` directory was not
modified or included in this change.
