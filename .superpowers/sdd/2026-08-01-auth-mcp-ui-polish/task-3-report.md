# Task 3 Report: MCP Token Settings Polish

## Delivered

- Reorganized the MCP panel into compact service overview, personal token management, and client configuration help sections.
- Kept runtime status, endpoint, and `15 Tool / 5 Prompt / 4 Resource` capabilities together in the service overview.
- Moved token creation and the token table into one management section, with user-facing “令牌名称” language throughout.
- Reworded revocation around the token and connections using it, without presenting tokens as bound to devices or clients.
- Preserved the existing `deviceName` API payload and backend contract.
- Updated the MCP Playwright flow to use the new token-name label.

## TDD Evidence

1. Added component assertions for the three semantic sections, overview details, capability counts, token-name wording, revocation wording, and the unchanged `deviceName` request payload.
2. Confirmed RED with `pnpm --filter @causality/web exec vitest run src/features/parameter-settings/McpSettingsPanel.test.tsx`: all three tests failed against the old structure and wording.
3. Implemented the minimum JSX, copy, and CSS changes needed for the new layout.
4. Confirmed GREEN: all three focused component tests pass.

## Verification

- `pnpm --filter @causality/web exec vitest run src/features/parameter-settings/McpSettingsPanel.test.tsx` — passed, 3 tests.
- `pnpm --filter @causality/web typecheck` — passed.
- `pnpm exec eslint apps/web/src/features/parameter-settings/McpSettingsPanel.tsx apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx tests/e2e/parameter-settings-mcp.spec.ts` — passed.
- `pnpm exec prettier --check apps/web/src/features/parameter-settings/McpSettingsPanel.tsx apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx apps/web/src/features/parameter-settings/parameterSettings.css tests/e2e/parameter-settings-mcp.spec.ts` — passed.
- `git diff --check` — passed.

## Concerns

No known concerns. The focused Playwright spec was updated but not executed because this task's verification scope called for the focused component suite, Web typecheck, ESLint, and Prettier; no backend, shared contract, or research files were changed.

## Review Fix Round

- Scoped creation, table, “令牌名称” header, and revocation assertions to the “个人令牌管理” region; the full MCP panel also rejects the former “设备名称” and “为此客户端” copy.
- Added exact clipboard assertions for the raw token and parsed JSON configuration, plus a regression proving that a saved one-time token is forgotten when the creation dialog is reopened.
- Added a stateful revocation test proving query invalidation refreshes the row to “已撤销” and removes its revoke action.
- Added creation, clipboard, and revocation failure tests. Alerts now remain visible inside the active dialog, and a failed revocation leaves the token effective and retryable.
- Expanded the MCP Playwright flow through create, one-time save/close, reopen without the old token, confirmed revocation, and the final revoked state.
- Current-implementation RED: the three new error tests failed because alerts were outside the open dialogs.
- Mutation RED: removing `setCreatedToken(undefined)` exposed the saved token after reopening and failed the one-time-token regression.
- Mutation RED: removing MCP token query invalidation kept the row effective and failed the confirmed-revocation regression.
- Restored both mutations and confirmed GREEN with all 6 focused component tests passing.
- Re-ran Web typecheck, related ESLint, and related Prettier checks successfully. The expanded Playwright spec is left for the root agent's configured E2E run.
