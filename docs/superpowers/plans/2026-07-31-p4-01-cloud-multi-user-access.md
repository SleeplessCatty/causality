# P4-01 Cloud Multi-User Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Causality from a localhost-trusted single-user application into a single-server HTTPS application where a small set of CLI-provisioned, equal-permission users share one knowledge base and use independently revocable MCP personal access tokens.

**Architecture:** Keep one global knowledge database and the existing Web/API/MCP/Semantic Worker boundaries. Add native username/password authentication, hashed Web sessions, per-user MCP tokens, optimistic versions, minimal audit records, and a Caddy-only public edge. Preserve local deployment through a local Compose overlay; add a cloud overlay, automated PostgreSQL backup/restore tooling, and deny-by-default API boundaries.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, TypeScript 6.0.2, Fastify 5.10.0, React 19.2.7, React Router 8.3.0, TanStack Query 5.101.3, PostgreSQL 18 with pgvector 0.8.2, MCP SDK 1.30.0, Zod 4.4.3, `@node-rs/argon2` 2.0.2, `@fastify/cookie` 11.1.2, Caddy 2.10.2, Restic 0.18.0, Vitest 4.1.10, Playwright 1.61.1, Docker Compose.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-31-p4-01-cloud-multi-user-access-design.md`.
- All enabled users share one knowledge base and have identical business permissions.
- Accounts are created, enabled, disabled, unlocked, and reset only through server CLI commands.
- No public registration, invitations, administrator role, third-party login, OAuth, OIDC, or TOTP.
- Web remains desktop-only; mobile scope is limited to AI clients that support a custom Bearer header.
- Remote MCP supports personal access tokens only and must document that OAuth-only clients are incompatible.
- Passwords use Argon2id, are 12–128 characters, and are never logged or persisted in plaintext.
- Account lock: 10 consecutive failures for 15 minutes. Source limit: 20 failed logins per 15 minutes.
- Web session idle lifetime is 12 hours; absolute lifetime is 7 days. Cloud Cookies are always Secure; only loopback `127.0.0.1` or `localhost` local mode may disable Secure.
- Each user may hold at most 10 active MCP tokens. Tokens do not expire automatically.
- Every protected Web request and MCP HTTP request revalidates session/token revocation and user enabled state.
- Business records use optimistic concurrency; conflicts return `409 CONCURRENT_MODIFICATION` and never silently overwrite.
- Audit records retain 90 days and never contain password, Cookie, session secret, full MCP token, full request body, or field snapshots.
- Public cloud ingress exposes only ports 80 and 443 through Caddy. API, MCP, PostgreSQL, Semantic Worker, and Docker API remain private.
- Existing knowledge data stays global; do not add tenant, workspace, or owner columns to knowledge entities.
- Existing incomplete AI plans are invalidated during migration; successful histories remain readable.
- Existing global MCP token is accepted only during the explicit migration window and is disabled before P4-01 acceptance.
- Every Task ends with focused automated checks, a local commit, and a user review gate. Do not push GitHub until the entire stage is approved and the user explicitly requests a push.
- Preserve unrelated user files. `research/` remains outside project scope and must never be staged.

---

## Planned File Structure

### Shared contracts

- `packages/contracts/src/auth/authSchemas.ts`: login, session, password, actor, and auth error contracts.
- `packages/contracts/src/audit/auditSchemas.ts`: audit list query and response contracts.
- `packages/contracts/src/mcp/mcpSettingsSchemas.ts`: replace singleton-token responses with per-user token management responses.
- Existing event, relation, case, deletion, data-check, and AI-capture schemas: add record versions and expected-version inputs where required.

### API authentication

- `apps/api/src/features/auth/requestActor.ts`: the `RequestActor` union and Fastify request augmentation.
- `apps/api/src/features/auth/passwordPolicy.ts`: password acceptance rules and generated initial passwords.
- `apps/api/src/features/auth/passwordHasher.ts`: Argon2id hashing and verification adapter.
- `apps/api/src/features/auth/authRepository.ts`: users, sessions, and rate-limit persistence.
- `apps/api/src/features/auth/authService.ts`: login, password changes, session lifecycle, and account state rules.
- `apps/api/src/features/auth/authCookies.ts`: session and CSRF Cookie creation/clearing.
- `apps/api/src/features/auth/authRoutes.ts`: public login plus authenticated session endpoints.
- `apps/api/src/features/auth/authHooks.ts`: public/Web/internal-MCP route boundaries.
- `apps/api/src/commands/userAdmin.ts`: interactive account CLI entrypoint.

### MCP identity

- `apps/api/src/features/mcp-access/mcpAccessRepository.ts`: hashed personal token persistence and validation.
- `apps/api/src/features/mcp-access/mcpAccessService.ts`: create/list/revoke/authorize behavior.
- `apps/api/src/features/mcp-access/mcpAccessRoutes.ts`: Web token management and private MCP authorization routes.
- `apps/mcp/src/auth/mcpPrincipal.ts`: authorized user/token identity returned by API.
- Existing MCP HTTP transport and API client: validate every request and route tool API traffic through the private prefix.

### Audit and concurrency

- `apps/api/src/features/audit/auditRepository.ts`: Task 1 creates append-only auth/CLI audit support; Task 5 adds list and retention deletion.
- `apps/api/src/features/audit/auditService.ts`: safe structured audit events.
- `apps/api/src/features/audit/auditRoutes.ts`: authenticated list endpoint.
- Existing event/relation/case/data-check/AI-capture repositories: conditional version writes and actor-aware auditing.
- `apps/web/src/features/audit/*`: desktop audit list and filters.

### Deployment and recovery

- `compose.local.yaml`: local loopback publications.
- `compose.cloud.yaml`: Caddy, cloud routing, backup tooling, and secret mounts.
- `ops/caddy/Caddyfile`: one-domain route policy.
- `ops/backup/*`: PostgreSQL dump, Restic copy, restore, and restore-verification scripts.
- `ops/systemd/*`: daily backup and monthly restore-verification units.
- `scripts/cloud-preflight.sh`: production configuration and exposure checks.
- `scripts/test-cloud-compose.sh`: isolated cloud-stack smoke test.

---

### Task 1: Build the User, Password, Session, and CLI Foundation

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/package.json`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/auth/authSchemas.ts`
- Create: `packages/contracts/test/auth.test.ts`
- Create: `packages/contracts/src/audit/auditSchemas.ts`
- Create: `packages/contracts/test/audit.test.ts`
- Create: `apps/api/src/database/schema/users.ts`
- Create: `apps/api/src/database/schema/webSessions.ts`
- Create: `apps/api/src/database/schema/authRateLimits.ts`
- Create: `apps/api/src/database/schema/auditLogs.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Create: `database/migrations/0021_cloud_auth_foundation.sql`
- Modify: `database/migrations/meta/_journal.json`
- Create: `database/migrations/meta/0021_snapshot.json`
- Create: `apps/api/src/features/auth/requestActor.ts`
- Create: `apps/api/src/features/auth/passwordPolicy.ts`
- Create: `apps/api/src/features/auth/passwordHasher.ts`
- Create: `apps/api/src/features/auth/authRepository.ts`
- Create: `apps/api/src/features/auth/authService.ts`
- Create: `apps/api/src/features/auth/authCookies.ts`
- Create: `apps/api/src/features/auth/authRoutes.ts`
- Create: `apps/api/src/features/auth/authHooks.ts`
- Create: `apps/api/src/features/audit/auditRepository.ts`
- Create: `apps/api/src/commands/userAdmin.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`
- Create: `apps/api/test/password-policy.test.ts`
- Create: `apps/api/test/auth-service.test.ts`
- Create: `apps/api/test/auth-routes.integration.test.ts`
- Create: `apps/api/test/user-admin.integration.test.ts`
- Modify: `apps/api/test/production-entrypoints.test.ts`

**Interfaces:**
- Produces:

```ts
export type RequestActor =
  | {
      actorType: 'user';
      userId: string;
      username: string;
      channel: 'web' | 'mcp';
      requestId: string;
      sessionId?: string;
      mcpTokenId?: string;
    }
  | {
      actorType: 'system';
      actorLabel: 'server-cli';
      channel: 'cli';
      requestId: string;
    };

export interface AuthenticatedUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}
```

- Produces these public API routes:

```text
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/change-password
POST /api/auth/logout
POST /api/auth/logout-all
```

- Produces these root commands:

```text
pnpm user:create
pnpm user:list
pnpm user:reset-password
pnpm user:disable
pnpm user:enable
pnpm user:unlock
```

- Consumes the existing PostgreSQL pool and Fastify app builder. Task 2 consumes the auth routes, Cookies, and `RequestActor`.
- Produces an append-only `AuditWriter` used by authentication and CLI operations; Task 5 extends the same repository with query and retention methods.

Define the complete finite action catalog in the shared contracts during Task 1 so later Tasks do not invent incompatible strings:

```ts
export const auditActions = [
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.account_locked',
  'auth.password_changed',
  'auth.session_logged_out',
  'auth.sessions_revoked',
  'account.created',
  'account.password_reset',
  'account.enabled',
  'account.disabled',
  'account.unlocked',
  'mcp_token.created',
  'mcp_token.revoked',
  'mcp_token.auth_failed',
  'event.created',
  'event.updated',
  'event.deleted',
  'relation.created',
  'relation.updated',
  'relation.deleted',
  'case.created',
  'case.updated',
  'case.deleted',
  'data_check.executed',
  'data_check.issue_processed',
  'data_import.committed',
  'data_export.prepared',
  'ai_import.committed',
  'semantic.model_changed',
  'semantic.reindex_started',
  'setting.updated',
  'maintenance.enabled',
  'maintenance.disabled',
] as const;
```

Define `AuditTargetType` and `AuditResult` in shared contracts. Define this API-only write shape in `apps/api/src/features/audit/auditRepository.ts`, because it depends on the API `RequestActor`:

```ts
export interface AuditEventInput {
  actor: RequestActor;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  result: 'success' | 'failure' | 'conflict';
  occurredAt: Date;
}
```

- [ ] **Step 1: Add pinned authentication dependencies**

Run:

```bash
pnpm --filter @causality/api add @fastify/cookie@11.1.2 @node-rs/argon2@2.0.2
```

Expected: `apps/api/package.json` and `pnpm-lock.yaml` contain exact versions; no caret or range is introduced.

- [ ] **Step 2: Write failing contract tests for login and session schemas**

Add `packages/contracts/test/auth.test.ts` with cases for:

```ts
loginInputSchema.parse({ username: 'jason', password: 'a long passphrase' });
authSessionResponseSchema.parse({
  user: { id: crypto.randomUUID(), username: 'jason', mustChangePassword: false },
  csrfToken: 'base64url-token',
});
```

Reject unknown fields, usernames outside 3–50 characters, passwords outside 12–128 characters, and non-UUID user IDs.

Run:

```bash
pnpm --filter @causality/contracts exec vitest run test/auth.test.ts
```

Expected: FAIL because `authSchemas.ts` and exports do not exist.

- [ ] **Step 3: Implement shared authentication contracts**

Define and export:

```ts
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[\p{L}\p{N}._-]+$/u);
export const passwordSchema = z.string().min(12).max(128);
export const loginInputSchema = z.object({ username: usernameSchema, password: passwordSchema }).strict();
export const changePasswordInputSchema = z
  .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
  .strict();
```

Add `AuthenticatedUser`, session response, generic auth error, and logout result schemas. Re-export them from `packages/contracts/src/index.ts`.

Run the focused contract test and expect PASS.

- [ ] **Step 4: Write the failing auth-foundation migration test**

Add `apps/api/test/cloud-auth-migration.integration.test.ts`. Run migrations in an isolated database and assert:

- `users`, `web_sessions`, `auth_rate_limits`, and `audit_logs` exist;
- username uniqueness is case-insensitive;
- password hashes cannot be null;
- sessions and users use foreign keys;
- deleting users is rejected while historical audit/session references exist;
- raw IP, raw session token, and plaintext password columns do not exist.

Add `causality_cloud_auth_migration_test` to the allowlist in `postgresTestContext.ts`.

Run:

```bash
pnpm --filter @causality/api exec vitest run --config vitest.integration.config.ts test/cloud-auth-migration.integration.test.ts
```

Expected: FAIL because migration `0021` does not exist.

- [ ] **Step 5: Add Drizzle schemas and migration 0021**

Use Drizzle schema files with these database invariants:

```text
users.normalized_username is unique
users.failed_login_count >= 0
web_sessions.token_hash is unique and 32 bytes
web_sessions.absolute_expires_at > web_sessions.created_at
auth_rate_limits.source_digest is unique and 32 bytes
audit_logs has no UPDATE-facing repository method
```

Generate the migration through the existing Drizzle workflow, review the SQL, and name it `0021_cloud_auth_foundation.sql`. Do not edit older migration files or snapshots.

Run the migration test and expect PASS.

- [ ] **Step 6: Write failing password policy and hashing tests**

Test:

- 12-character passphrases are accepted;
- username-equivalent, repeated-character, and bundled common-password values are rejected;
- 129-character values are rejected before hashing;
- `hashPassword` produces different hashes for the same password;
- `verifyPassword` accepts the correct value and rejects another value;
- generated initial passwords satisfy policy and contain at least 20 random characters.

Run:

```bash
pnpm --filter @causality/api exec vitest run test/password-policy.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 7: Implement password policy and Argon2id adapter**

Expose:

```ts
export function validatePassword(password: string, username: string): void;
export function generateInitialPassword(): string;
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}
export const argon2idPasswordHasher: PasswordHasher;
```

Use `@node-rs/argon2` with Argon2id, per-hash random salt, 64 MiB memory, 3 iterations, and parallelism 1. Keep parameters centralized and include them in the encoded hash.

Run the focused tests and expect PASS.

- [ ] **Step 8: Write failing repository and auth service tests**

Cover:

- first user creation and case-insensitive duplicate rejection;
- login creates a hashed session and never stores the raw token;
- initial-password users receive `mustChangePassword: true`;
- 10 consecutive failures lock for 15 minutes;
- 20 failures for one source digest return a rate-limit error;
- restart-safe state is read from PostgreSQL rather than memory;
- correct credentials on a locked account return `ACCOUNT_LOCKED`;
- incorrect credentials always return `INVALID_CREDENTIALS`;
- disabled users cannot log in;
- disabling a user makes every existing Web session fail on its next request;
- session authentication rejects a 12-hour idle timeout and a 7-day absolute timeout independently;
- password change revokes other sessions;
- logout and logout-all revoke the correct rows.

Inject a clock, token generator, source-digest function, and `PasswordHasher` into the service so unit tests are deterministic.

- [ ] **Step 9: Implement repositories and `AuthService`**

Expose exact service methods:

```ts
login(input: LoginInput, sourceIp: string): Promise<LoginResult>;
authenticateSession(rawToken: string, now: Date): Promise<RequestActor | null>;
changePassword(actor: RequestActor, input: ChangePasswordInput): Promise<void>;
logout(actor: RequestActor): Promise<void>;
logoutAll(actor: RequestActor): Promise<void>;
```

Hash source IPs with HMAC-SHA-256 using `CAUSALITY_AUTH_IP_HASH_KEY`. Never persist the raw IP. Update session last-seen at most once every five minutes. Use constant-time comparisons for fixed-size token digests.

Create the initial audit interface in `features/audit/auditRepository.ts` using `AuditEventInput` from the shared catalog:

```ts
export interface AuditWriter {
  append(client: PoolClient, input: AuditEventInput): Promise<void>;
}
```

Authentication and CLI account mutations append their minimal event in the same transaction. Task 5 reuses this interface rather than creating a second audit path.

Run unit tests and expect PASS.

- [ ] **Step 10: Add Cookie and CSRF behavior with failing route tests**

Register `@fastify/cookie`. Test that cloud login sets:

```text
causality_session: Secure; HttpOnly; SameSite=Lax; Path=/
causality_csrf: Secure; SameSite=Lax; Path=/
```

State-changing authenticated requests must provide `X-CSRF-Token` equal to the non-HttpOnly CSRF Cookie. Verify `Origin` exactly matches `CAUSALITY_PUBLIC_ORIGIN`. `GET` and `HEAD` do not require CSRF.

Add a separate local-loopback test proving only `http://127.0.0.1` and `http://localhost` may omit Secure. Configure Fastify CORS with the exact development origin and `credentials: true`; wildcard origins are forbidden when Cookies are enabled.

Test that the login endpoint returns generic `401`, emits `423` only after correct credentials prove ownership of a still-locked account, and emits `429` for source throttling.

- [ ] **Step 11: Implement auth routes, Cookies, hooks, and environment validation**

Add these required production settings:

```text
CAUSALITY_PUBLIC_ORIGIN=https://causality.example.com
CAUSALITY_SESSION_HMAC_KEY=<64 hex characters>
CAUSALITY_AUTH_IP_HASH_KEY=<64 hex characters>
CAUSALITY_COOKIE_SECURE=true
```

Development defaults may use explicit non-production values. `CAUSALITY_COOKIE_SECURE=false` is accepted only when the configured public-origin hostname is exactly `127.0.0.1` or `localhost`; all other HTTP origins or insecure Cookie combinations fail parsing. Production parsing must reject missing, placeholder, or repeated secrets.

At this Task, register auth routes and actor helpers without protecting all existing business routes yet. That switch belongs to Task 2 so the Web remains usable between commits.

- [ ] **Step 12: Implement and test interactive user CLI**

The command reads username interactively, generates the initial password internally, hashes before insert, and prints the password exactly once. Reset follows the same rule. No password is accepted in argv or environment variables.

The core command functions receive a repository and IO adapter so tests can assert output without exposing a real password in test logs.

Add exact package scripts listed in the Interfaces block. Run:

```bash
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration
pnpm --filter @causality/api typecheck
```

Expected: all pass.

- [ ] **Step 13: Commit Task 1 and stop for backend review**

```bash
git add package.json pnpm-lock.yaml packages/contracts apps/api database/migrations
git commit -m "feat: add cloud user authentication foundation"
```

Review the CLI with an isolated database. Do not start Task 2 until the user approves Task 1.

---

### Task 2: Add Desktop Web Login and Enforce Web Sessions

**Files:**
- Create: `apps/web/src/features/auth/authApi.ts`
- Create: `apps/web/src/features/auth/AuthProvider.tsx`
- Create: `apps/web/src/features/auth/RequireSession.tsx`
- Create: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/InitialPasswordPage.tsx`
- Create: `apps/web/src/features/auth/CurrentUserMenu.tsx`
- Create: `apps/web/src/features/auth/auth.css`
- Create: `apps/web/src/features/auth/AuthProvider.test.tsx`
- Create: `apps/web/src/features/auth/LoginPage.test.tsx`
- Create: `apps/web/src/features/auth/CurrentUserMenu.test.tsx`
- Modify: `apps/web/src/app/AppProviders.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/app/AppSidebar.tsx`
- Modify: `apps/web/src/app/AppSidebar.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/shared/api/httpClient.ts`
- Modify: `apps/web/src/shared/api/httpClient.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/features/auth/authHooks.ts`
- Modify: `apps/api/src/features/events/eventRoutes.ts`
- Modify: `apps/api/src/features/relations/relationRoutes.ts`
- Modify: `apps/api/src/features/cases/caseRoutes.ts`
- Modify: `apps/api/src/features/causal-graph/causalGraphRoutes.ts`
- Modify: `apps/api/src/features/causal-evidence/causalEvidenceRoutes.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRoutes.ts`
- Modify: `apps/api/src/features/semantic/semanticRoutes.ts`
- Modify: `apps/api/src/features/data-transfer/dataTransferRoutes.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Modify: `apps/api/src/features/mcp-settings/mcpSettingsRoutes.ts`
- Create: `apps/api/test/support/authTestSession.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`
- Modify: `apps/api/test/events.integration.test.ts`
- Modify: `apps/api/test/relations.integration.test.ts`
- Modify: `apps/api/test/cases.integration.test.ts`
- Modify: `apps/api/test/causal-graph.integration.test.ts`
- Modify: `apps/api/test/causal-evidence-routes.integration.test.ts`
- Modify: `apps/api/test/data-checks.integration.test.ts`
- Modify: `apps/api/test/data-check-actions.integration.test.ts`
- Modify: `apps/api/test/data-transfer-import.integration.test.ts`
- Modify: `apps/api/test/data-transfer-export.integration.test.ts`
- Modify: `apps/api/test/data-transfer-history.integration.test.ts`
- Modify: `apps/api/test/semantic.integration.test.ts`
- Modify: `apps/api/test/ai-capture-routes.integration.test.ts`
- Modify: `apps/api/test/mcp-settings.integration.test.ts`
- Modify: `apps/mcp/src/api/causalityApiClient.ts`
- Modify: `apps/mcp/src/config/env.ts`
- Modify: `apps/mcp/src/transports/httpServer.ts`
- Modify: `apps/mcp/test/causalityApiClient.test.ts`
- Modify: `apps/mcp/test/httpTransport.test.ts`
- Create: `tests/e2e/authentication.spec.ts`
- Create: `tests/e2e/support/authenticateUser.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes Task 1 auth endpoints and `AuthenticatedUser`.
- Produces:

```ts
export interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthenticatedUser | null;
  csrfToken: string | null;
  login(input: LoginInput): Promise<void>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
}
```

- Produces deny-by-default Web protection for every business `/api/*` route while preserving health, readiness, login, and a temporary trusted legacy-MCP caller.

- [ ] **Step 1: Write failing `httpClient` Cookie and CSRF tests**

Assert that all requests use same-origin credentials and that `POST`, `PUT`, `PATCH`, and `DELETE` include `X-CSRF-Token`. Assert that a `401` dispatches one `causality:unauthorized` event without recursively retrying.

Run:

```bash
pnpm --filter @causality/web exec vitest run src/shared/api/httpClient.test.ts
```

Expected: FAIL because auth-aware behavior is absent.

- [ ] **Step 2: Implement auth-aware HTTP transport**

Keep JSON/error parsing centralized in `httpClient.ts`. Add `setCsrfTokenProvider(() => string | null)` rather than importing React context into the transport. Never write session or CSRF values to local storage.

- [ ] **Step 3: Write failing provider and login-page tests**

Cover session bootstrap, anonymous state, successful login, first-password redirect, preserved return URL, current logout, logout-all, `401` transition, `423`, and `429` copy. Assert no registration, recovery, OAuth, TOTP, or mobile navigation appears.

- [ ] **Step 4: Implement desktop auth pages and provider**

Routes:

```text
/login
/change-initial-password
```

Place both outside `AppShell`. Wrap all business routes in `RequireSession`. If `mustChangePassword` is true, only the initial-password route and logout are allowed.

Use existing colors, buttons, input styles, spacing, and auto-dismiss error conventions. Do not add mobile breakpoints.

- [ ] **Step 5: Add current-user controls to the sidebar**

At the bottom of the existing sidebar, display username and a compact menu for password change, current logout, and logout-all. The collapsed sidebar retains accessible labels and tooltips. Do not display role badges or other users.

- [ ] **Step 6: Write failing API protection contract tests**

Create `apps/api/test/route-access-policy.test.ts` that enumerates Fastify routes and asserts each is one of:

```ts
type RouteAccess = 'public' | 'business' | 'internal-mcp';
```

Only health, readiness, and login may be public. Existing routes are `business`. During Task 2 only, the business hook accepts either a Web session or the pair of a valid legacy global MCP Token and `CAUSALITY_INTERNAL_MCP_SECRET`; Task 3 removes that compatibility branch.

- [ ] **Step 7: Enforce Web authentication without breaking current MCP**

Register business routes inside a Fastify plugin guarded by the business-auth hook. Add `CAUSALITY_INTERNAL_MCP_SECRET` to API and MCP environment validation. Update `CausalityApiClient` to send both the internal secret and current global Token on every direct API request, including read calls. The API accepts this pair only from the current MCP compatibility path and constructs a temporary system actor. A global Token without the internal secret is rejected.

Add a test named `legacy MCP compatibility is explicitly temporary` that fails if the branch remains after Task 3. Do not accept the global Token from arbitrary browser requests, and never expose the internal secret in Caddy, Web code, errors, or logs.

Update integration helpers to create a real test user/session and supply session and CSRF headers. Do not add a production authentication bypass or a magic test header.

- [ ] **Step 8: Update existing API tests and E2E fixtures**

Every business integration request must authenticate through the real login route or a repository-created session fixture. Add explicit anonymous rejection tests for events, relations, cases, graph, data maintenance, data transfer, semantic settings, MCP settings, and AI history.

With zero users in the database, assert health and readiness remain available while every business route returns `401`; only the server CLI can create the first account.

E2E setup creates a user through the CLI core service, logs in through the browser, changes the initial password, and then runs existing desktop tests.

- [ ] **Step 9: Run Task 2 gates**

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration
pnpm --filter @causality/web test
pnpm test:e2e
pnpm typecheck
```

Expected: all pass; the existing MCP compatibility command still passes through the temporary legacy path.

- [ ] **Step 10: Commit Task 2 and stop for desktop review**

```bash
git add apps/api apps/web packages/contracts tests/e2e
git commit -m "feat: require desktop user sessions"
```

Ask the user to verify login, first-password change, return navigation, password change, logout, logout-all, and the unchanged desktop business pages.

---

### Task 3: Replace the Global MCP Token with Personal Access Tokens

**Files:**
- Modify: `packages/contracts/src/mcp/mcpSettingsSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/database/schema/mcpAccessTokens.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Create: `database/migrations/0022_personal_mcp_tokens.sql`
- Modify: `database/migrations/meta/_journal.json`
- Create: `database/migrations/meta/0022_snapshot.json`
- Create: `apps/api/src/features/mcp-access/mcpAccessRepository.ts`
- Create: `apps/api/src/features/mcp-access/mcpAccessService.ts`
- Create: `apps/api/src/features/mcp-access/mcpAccessRoutes.ts`
- Modify: `apps/api/src/features/mcp-settings/mcpSettingsRepository.ts`
- Modify: `apps/api/src/features/mcp-settings/mcpSettingsService.ts`
- Modify: `apps/api/src/features/mcp-settings/mcpSettingsRoutes.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config/env.ts`
- Create: `apps/api/test/mcp-access-service.test.ts`
- Create: `apps/api/test/mcp-access.integration.test.ts`
- Create: `apps/mcp/src/auth/mcpPrincipal.ts`
- Modify: `apps/mcp/src/api/causalityApiClient.ts`
- Modify: `apps/mcp/src/config/env.ts`
- Modify: `apps/mcp/src/transports/httpServer.ts`
- Modify: `apps/mcp/src/transports/stdioServer.ts`
- Modify: `apps/mcp/test/httpTransport.test.ts`
- Modify: `apps/mcp/test/stdioTransport.test.ts`
- Modify: `apps/mcp/test/compatibility/httpCompatibility.test.ts`
- Modify: `apps/mcp/test/compatibility/stdioCompatibility.test.ts`
- Modify: `apps/mcp/src/diagnostics/mcpCheck.ts`
- Modify: `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx`

**Interfaces:**
- Personal token format:

```text
cau_pat_<43-character base64url secret>
```

- Token storage uses SHA-256 over the full high-entropy token, with a unique binary digest index. The full value is returned only by `POST /api/mcp/tokens`.
- Produces Web routes:

```text
GET    /api/mcp/settings
GET    /api/mcp/tokens
POST   /api/mcp/tokens
DELETE /api/mcp/tokens/:tokenId
```

- Produces private routes under `/internal/mcp/*`, guarded by `CAUSALITY_INTERNAL_MCP_SECRET` and not forwarded by Caddy.
- Consumes `RequestActor`; produces a user actor with `channel: 'mcp'` and `mcpTokenId`.

- [ ] **Step 1: Write failing personal-token contract tests**

Test token summaries, create input, one-time create result, revoke result, active-token limit error, MCP settings without `accessToken`, and internal authorization response containing user and token IDs.

Run the focused contracts test and confirm RED.

- [ ] **Step 2: Write failing migration and repository tests**

Assert:

- digest uniqueness;
- device names are 1–80 trimmed characters;
- revoked tokens remain for audit linkage;
- no plaintext-token column exists;
- at most 10 active tokens is enforced transactionally by the service;
- disabled users cannot authorize;
- disabling a user revokes all personal Tokens in the same transaction;
- revocation is visible on the next validation.

- [ ] **Step 3: Implement migration 0022 and personal-token service**

Expose:

```ts
create(actor: RequestActor, deviceName: string): Promise<{ token: string; summary: McpTokenSummary }>;
list(actor: RequestActor): Promise<McpTokenSummary[]>;
revoke(actor: RequestActor, tokenId: string): Promise<void>;
authorize(rawToken: string): Promise<RequestActor | null>;
```

Generate 32 random bytes with `randomBytes(32).toString('base64url')`. Return the complete token only from `create`. Update `last_used_at` and client name no more than once every five minutes.

- [ ] **Step 4: Add the private MCP route boundary**

Register the business route groups used by the 15 MCP tools inside an encapsulated Fastify plugin with prefix `/internal/mcp`. Guard the plugin with both the internal service secret and current personal Token. Hide internal routes from public Swagger.

Keep Web business routes under `/api`. Remove the temporary legacy actor path from Task 2. Add a contract test proving `/api/mcp/authorize` and global-token rotation no longer exist.

Do not drop `mcp_settings` or its stored legacy value in migration 0022; keep it only for an emergency old-version rollback. New API and MCP runtime code must have no authorization read path from that table.

- [ ] **Step 5: Update MCP transport authorization**

For every HTTP request, call the private authorization endpoint before handling initialize or an existing MCP session. Do not cache authorization for the session. Bind returned `userId`, `username`, and `tokenId` to AsyncLocalStorage alongside the API client.

Add environment validation:

```text
CAUSALITY_INTERNAL_MCP_SECRET=<64 hex characters>
CAUSALITY_MCP_TOKEN=<personal token, required only for stdio>
```

The HTTP server receives the personal Token from the client. The stdio server receives it from the environment and never fetches a plaintext token from API settings.

- [ ] **Step 6: Route MCP API calls through the private prefix**

Extend `CausalityApiClientOptions`:

```ts
interface CausalityApiClientOptions {
  baseUrl: string;
  token: string;
  internalSecret: string;
  pathPrefix: '/internal/mcp';
  timeoutMs?: number;
  fetch?: typeof fetch;
}
```

Build request paths without `new URL('/absolute', base)` discarding the prefix. Send internal secret and personal Token only over the Docker/private direct API URL. Never include either in errors or logs.

- [ ] **Step 7: Replace the Web singleton-token panel**

Keep service status, endpoint, 15/5/4 counts, and client configuration help. Replace reveal/rotate behavior with a compact personal-token table and create/revoke dialogs. The create result has an explicit one-time warning and copy actions for both token and complete JSON configuration.

No user may list or revoke another user's tokens.

- [ ] **Step 8: Extend rate-limit and immediate-revocation tests**

Assert each Token is limited to 60 MCP HTTP requests per minute and each source to 120. Confirm one user's Token revocation does not affect another Token, while account disable rejects all of that user's Tokens. Confirm an existing MCP session fails on its next request after revocation.

- [ ] **Step 9: Update diagnostics and compatibility gates**

`pnpm mcp:check` continues to read Token only from environment or an ignored config file. HTTP and stdio compatibility tests create real personal tokens and assert exact 15 Tools, 5 Prompts, and 4 Resources. Add an explicit test documenting that OAuth discovery is not implemented.

Run:

```bash
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration
pnpm --filter @causality/mcp test
pnpm test:mcp-compat
pnpm --filter @causality/web test
pnpm typecheck
```

- [ ] **Step 10: Commit Task 3 and stop for MCP review**

```bash
git add packages/contracts apps/api apps/mcp apps/web database/migrations
git commit -m "feat: add per-user MCP access tokens"
```

Ask the user to verify two users, two clients, one-time display, independent revocation, current-session rejection, and the documented OAuth-only-client limitation.

---

### Task 4: Add Optimistic Concurrency and AI Plan Ownership

**Files:**
- Modify: `apps/api/src/database/schema/abstractEvents.ts`
- Modify: `apps/api/src/database/schema/causalRelations.ts`
- Modify: `apps/api/src/database/schema/concreteCases.ts`
- Modify: `apps/api/src/database/schema/aiImportPlans.ts`
- Modify: `apps/api/src/database/schema/aiImportBatches.ts`
- Create: `database/migrations/0023_optimistic_concurrency.sql`
- Modify: `database/migrations/meta/_journal.json`
- Create: `database/migrations/meta/0023_snapshot.json`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/src/cases/caseSchemas.ts`
- Modify: `packages/contracts/src/maintenance/deletionSchemas.ts`
- Modify: `packages/contracts/src/data-checks/dataCheckSchemas.ts`
- Modify: `packages/contracts/src/ai-capture/aiCaptureSchemas.ts`
- Modify: `apps/api/src/features/events/eventRepository.ts`
- Modify: `apps/api/src/features/events/eventService.ts`
- Modify: `apps/api/src/features/events/eventRoutes.ts`
- Modify: `apps/api/src/features/relations/relationRepository.ts`
- Modify: `apps/api/src/features/relations/relationService.ts`
- Modify: `apps/api/src/features/relations/relationRoutes.ts`
- Modify: `apps/api/src/features/cases/caseRepository.ts`
- Modify: `apps/api/src/features/cases/caseService.ts`
- Modify: `apps/api/src/features/cases/caseRoutes.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckActionService.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRoutes.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckTypes.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportPlanRepository.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportPlanService.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportPlanValidator.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportCommitRepository.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportCommitService.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportHistoryRepository.ts`
- Modify: `apps/web/src/features/events/api/eventApi.ts`
- Modify: `apps/web/src/features/events/components/EventForm.tsx`
- Modify: `apps/web/src/features/events/pages/EventEditPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventListPage.tsx`
- Modify: `apps/web/src/features/relations/api/relationApi.ts`
- Modify: `apps/web/src/features/relations/components/RelationForm.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Modify: `apps/web/src/features/cases/api/caseApi.ts`
- Modify: `apps/web/src/features/cases/components/CaseForm.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseEditPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseListPage.tsx`
- Modify: `apps/web/src/shared/deletion/usePermanentDeletion.ts`
- Modify: `apps/web/src/features/data-maintenance/dataMaintenanceApi.ts`
- Modify: `apps/web/src/features/data-maintenance/useDataCheckIssueAction.ts`
- Create: `apps/api/test/optimistic-concurrency.integration.test.ts`
- Create: `apps/api/test/ai-plan-ownership.integration.test.ts`
- Create: `tests/e2e/multi-user-concurrency.spec.ts`

**Interfaces:**
- Produces `recordVersionSchema = z.number().int().positive()`.
- Detail and list items for events, relations, and cases include `version`.
- Update bodies include `expectedVersion`; deletion requests include `expectedVersion` from the latest impact/detail response.
- Produces `ConcurrentModificationError` mapped to HTTP 409 and MCP nested code `CONCURRENT_MODIFICATION`.

- [ ] **Step 1: Write failing migration tests**

Assert all existing events, relations, and cases receive version `1`; versions are positive; AI plans and batches gain nullable legacy `created_by_user_id`; pending pre-migration plans become `invalidated`; successful history remains unchanged.

- [ ] **Step 2: Implement migration 0023 and schema changes**

Add foreign keys from new AI records to users using `ON DELETE RESTRICT`. Keep historical rows nullable and label them as legacy in read models. Do not add user ownership to knowledge tables.

- [ ] **Step 3: Split create and update contracts**

For each entity, preserve the existing form fields but define separate create/update schemas. Example:

```ts
export const eventUpdateInputSchema = eventFormInputSchema
  .extend({ expectedVersion: recordVersionSchema })
  .strict();
```

Add version to summaries so list-page edit/delete actions have the current value. Add expected version to deletion-impact responses and data-check action contexts.

- [ ] **Step 4: Write failing conditional-write repository tests**

For events, relations, and cases, execute two updates with the same expected version. Assert the first increments exactly once and the second changes zero rows. Repeat for delete and for a relation update that also changes case links and confidence.

- [ ] **Step 5: Implement conditional updates and deletes**

Use SQL predicates equivalent to:

```sql
update abstract_events
set name = $1, version = version + 1, updated_at = clock_timestamp()
where id = $2 and version = $3
returning *;
```

Distinguish missing IDs from version conflicts with a follow-up existence query inside the same transaction. Relation case-link and confidence changes increment the relation version once per completed transaction.

- [ ] **Step 6: Protect data-maintenance actions**

Include current versions in merge/action plans. Lock involved rows, re-check versions and issue status, and roll back the whole action on mismatch. Do not mark an issue processed after a failed or conflicting mutation.

- [ ] **Step 7: Bind AI plans to users**

Pass `RequestActor` through compare, prepare, status, commit, and result services. New plans require a user actor. `get_import_plan_status`, `commit_knowledge_changes`, and result lookup reject a different user with a non-enumerating not-found response. The same user may continue through another personal Token.

At commit, validate actor ownership, plan status, dependency fingerprints, and record versions in one transaction. Any mismatch invalidates the plan and writes no knowledge changes.

- [ ] **Step 8: Implement Web conflict handling**

Forms retain current input when the API returns `CONCURRENT_MODIFICATION`. Show a persistent message and a “重新加载” action. Ordinary errors keep the existing three-second behavior. Delete dialogs remain open and require a fresh impact query.

Do not attempt client-side field merges or add WebSocket refresh.

- [ ] **Step 9: Add two-user browser coverage**

In Playwright, sign in two isolated browser contexts, open the same event, save from user A, then save from user B. Assert B sees the conflict and A's value remains. Cover relation and case deletion conflicts through API integration tests.

- [ ] **Step 10: Run Task 4 gates**

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration
pnpm --filter @causality/mcp test
pnpm --filter @causality/web test
pnpm test:e2e
pnpm typecheck
```

- [ ] **Step 11: Commit Task 4 and stop for concurrency review**

```bash
git add packages/contracts apps/api apps/mcp apps/web database/migrations tests/e2e
git commit -m "feat: prevent multi-user write conflicts"
```

Ask the user to verify two-browser conflict behavior and same-user AI plan continuation.

---

### Task 5: Complete Minimal Audit Logging and the Desktop Audit Page

**Files:**
- Modify: `packages/contracts/src/audit/auditSchemas.ts`
- Modify: `packages/contracts/test/audit.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/features/audit/auditRepository.ts`
- Create: `apps/api/src/features/audit/auditService.ts`
- Create: `apps/api/src/features/audit/auditRoutes.ts`
- Create: `apps/api/src/features/audit/auditRetention.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/features/auth/authService.ts`
- Modify: `apps/api/src/features/mcp-access/mcpAccessService.ts`
- Modify: `apps/api/src/features/events/eventService.ts`
- Modify: `apps/api/src/features/relations/relationService.ts`
- Modify: `apps/api/src/features/cases/caseService.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckActionService.ts`
- Modify: `apps/api/src/features/data-transfer/importService.ts`
- Modify: `apps/api/src/features/data-transfer/exportService.ts`
- Modify: `apps/api/src/features/semantic/semanticService.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportCommitService.ts`
- Create: `apps/api/test/audit-service.test.ts`
- Create: `apps/api/test/audit.integration.test.ts`
- Create: `apps/web/src/features/audit/auditApi.ts`
- Create: `apps/web/src/features/audit/AuditPage.tsx`
- Create: `apps/web/src/features/audit/AuditPage.test.tsx`
- Create: `apps/web/src/features/audit/audit.css`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/AppSidebar.tsx`
- Modify: `apps/web/src/app/AppSidebar.test.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Produces:

```ts
export interface AuditEventInput {
  actor: RequestActor;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  result: 'success' | 'failure' | 'conflict';
  occurredAt: Date;
}

export interface AuditWriter {
  append(client: PoolClient, input: AuditEventInput): Promise<void>;
}
```

- Produces `GET /api/audit-logs?page=1&userId=&channel=&action=&result=&from=&to=` with fixed 50-row pages.

- [ ] **Step 1: Write failing audit contracts and redaction tests**

Define finite action/target/channel enums. Reject arbitrary detail payloads, passwords, Tokens, request bodies, and field snapshots at the schema boundary. Audit responses include target ID and an optional live display label, never stored business content.

- [ ] **Step 2: Implement audit repository and transaction-aware writer**

`append` requires a caller-supplied `PoolClient` for business writes so the record commits or rolls back with the mutation. Authentication failures that have no business transaction use a short dedicated transaction.

CLI actions use the `server-cli` system actor. Deleted targets remain displayable as type plus ID when no live label exists.

- [ ] **Step 3: Integrate authentication and Token lifecycle events**

Record login success/failure, lock, password change/reset, logout, account enable/disable, Token create/revoke, and Token authentication failure. Do not persist every successful MCP read; only throttle-update `last_used_at` and keep existing redacted request logs.

- [ ] **Step 4: Integrate business mutation audit events**

Add success, failure, and conflict events for entity create/update/delete/merge, data import, AI commit, data maintenance actions, semantic model switch, reindex, and global setting changes. AI commit, history, and audit must remain in one transaction.

- [ ] **Step 5: Add 90-day retention**

Implement `deleteExpired(cutoff)` and a scheduler that runs once at API startup and then every 24 hours. Inject the clock/timer in tests. Delete only rows with `occurred_at < now - interval '90 days'`.

- [ ] **Step 6: Implement audit query API**

Use fixed 50-row pages, descending time order with ID tie-breaker, and filters from the design. All authenticated users can read audit records. No create/update/delete audit route exists.

- [ ] **Step 7: Build the desktop audit page**

Add the “操作记录” item before “系统状态”. Reuse `AppSelect`, `ListPagination`, `OverflowText`, and existing page-title/table styles. Columns are time, user, entry, action, target, and result. Do not add mobile CSS or field-history expansion.

Long live target labels use the existing fixed-size `OverflowText` Tip. Deleted or unavailable targets display target type plus ID without synthesizing a content snapshot.

- [ ] **Step 8: Run redaction and retention gates**

Seed sentinel password, Cookie, full personal Token, query text, and business body values. Assert none appear in `audit_logs`, API responses, or captured application/MCP logs. Assert 89-day rows remain and 91-day rows are removed.

Run API, MCP, Web, integration, E2E, lint, and typecheck gates.

- [ ] **Step 9: Commit Task 5 and stop for audit-page review**

```bash
git add packages/contracts apps/api apps/web tests/e2e
git commit -m "feat: add minimal multi-user audit trail"
```

Ask the user to verify filtering, pagination, long-text Tips, user/channel distinctions, and absence of content snapshots.

---

### Task 6: Add Cloud Compose, Caddy HTTPS Routing, and Production Preflight

**Files:**
- Modify: `compose.yaml`
- Create: `compose.local.yaml`
- Modify: `compose.dev.yaml`
- Create: `compose.cloud.yaml`
- Create: `ops/caddy/Caddyfile`
- Create: `ops/cloud/cloud.env.example`
- Create: `ops/cloud/README.md`
- Create: `scripts/cloud-preflight.sh`
- Create: `scripts/deploy-cloud.sh`
- Create: `scripts/test-cloud-compose.sh`
- Modify: `apps/api/.env.example`
- Modify: `apps/mcp/.env.example`
- Modify: `apps/web/nginx.conf`
- Modify: `tests/production/compose-contract.test.mjs`
- Modify: `tests/production/e2e-contract.test.mjs`
- Modify: `tests/production/production-smoke.spec.ts`
- Modify: `scripts/test-production-compose.sh`
- Modify: `package.json`

**Interfaces:**
- Local production command:

```bash
docker compose -f compose.yaml -f compose.local.yaml up -d --build --wait
```

- Development PostgreSQL command:

```bash
docker compose -f compose.yaml -f compose.local.yaml -f compose.dev.yaml up -d --wait postgres
```

- Cloud command:

```bash
docker compose --env-file /opt/causality/environment/cloud.env \
  -f compose.yaml -f compose.cloud.yaml up -d --build --wait
```

- Caddy image is pinned to `caddy:2.10.2-alpine` and never uses `latest`.

- [ ] **Step 1: Write failing Compose contract tests**

Assert base Compose publishes no ports; local overlay publishes Web/MCP only on loopback; dev overlay additionally publishes PostgreSQL on loopback; cloud overlay publishes only Caddy 80/443 and contains no host port for Web, API, MCP, PostgreSQL, or Semantic Worker.

Assert cloud config uses a dedicated private network, persistent PostgreSQL/model/Caddy volumes, non-root application images, health checks, and required secret mounts.

- [ ] **Step 2: Restructure Compose without changing images**

Move existing Web/MCP loopback `ports` into `compose.local.yaml`. Keep `compose.dev.yaml` limited to PostgreSQL development exposure. Add cloud environment values for public origin, public MCP endpoint, internal API URL, session/IP keys, and internal MCP secret.

Update current local production smoke to pass both base and local files explicitly.

- [ ] **Step 3: Write failing Caddy route tests**

Parse `ops/caddy/Caddyfile` and assert route precedence:

```text
/mcp      → mcp:8081
/api/*    → api:3000
/*        → web:8080
/internal/* must return 404 and must not proxy
```

Assert HTTP-to-HTTPS redirect in production mode, HSTS, request ID forwarding, forwarded-header replacement, route-specific body limits, and log header redaction.

Use exact ingress limits: 16 KiB for login/password requests, 22 MiB for the CSV multipart upload route, 8 MiB for `/mcp`, and 2 MiB for other JSON API requests. MCP and import proxy timeouts are 130 seconds; ordinary API response timeout is 35 seconds.

- [ ] **Step 4: Implement the Caddy edge**

Use environment placeholders only for deployment values:

```caddyfile
{$CAUSALITY_SITE_ADDRESS} {
  handle /mcp {
    reverse_proxy mcp:8081
  }
  handle /api/* {
    reverse_proxy api:3000
  }
  handle {
    reverse_proxy web:8080
  }
}
```

Expand this minimal form with reviewed security headers, body/timeout limits, and explicit rejection of `/internal/*`. Do not log Cookie or Authorization headers.

Configure Docker log rotation for every cloud service with `max-size: 10m` and `max-file: 5`. Public `/health` returns only a constant success marker; readiness and dependency details remain authenticated or private.

- [ ] **Step 5: Add cloud preflight validation**

`scripts/cloud-preflight.sh` exits nonzero unless:

- public origin is HTTPS and has no path;
- cloud Cookie security is enabled;
- database password, session key, IP hash key, and internal MCP secret are present and distinct;
- secrets are not sample values;
- secret files are not group/world-readable;
- no internal service has a public port in rendered Compose;
- backup repository/password settings required by Task 7 are present before final acceptance.

Print variable names and remediation only; never print secret values.

- [ ] **Step 6: Add an isolated cloud routing smoke test**

Use a unique Compose project, temporary secret directory, local HTTP Caddy address, and disposable volumes. Verify login through Caddy, authenticated API, MCP personal Token, `/internal/mcp` public rejection, persistence after restart, and teardown of every owned resource.

- [ ] **Step 7: Run Task 6 gates**

```bash
pnpm test:compose
pnpm test:production
pnpm test:mcp-compat
bash scripts/test-cloud-compose.sh
pnpm build
```

Expected: local and cloud deployment modes both pass. Existing local user data volumes are not touched by cloud tests.

- [ ] **Step 8: Commit Task 6 and stop for deployment review**

```bash
git add compose.yaml compose.local.yaml compose.dev.yaml compose.cloud.yaml ops/caddy ops/cloud scripts package.json apps/api/.env.example apps/mcp/.env.example apps/web/nginx.conf tests/production
git commit -m "feat: add secure single-server cloud deployment"
```

Ask the user to verify the rendered Compose and a real test domain before continuing to backup tooling.

---

### Task 7: Add Automated Backup, Restore, and Maintenance Mode

**Files:**
- Create: `apps/api/src/database/schema/maintenanceState.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Create: `database/migrations/0024_maintenance_state.sql`
- Modify: `database/migrations/meta/_journal.json`
- Create: `database/migrations/meta/0024_snapshot.json`
- Create: `apps/api/src/features/maintenance-mode/maintenanceModeRepository.ts`
- Create: `apps/api/src/features/maintenance-mode/maintenanceModeHook.ts`
- Create: `apps/api/src/commands/maintenance.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `compose.cloud.yaml`
- Create: `ops/backup/create-backup.sh`
- Create: `ops/backup/copy-offsite.sh`
- Create: `ops/backup/restore-backup.sh`
- Create: `ops/backup/verify-restore.sh`
- Create: `ops/systemd/causality-backup.service`
- Create: `ops/systemd/causality-backup.timer`
- Create: `ops/systemd/causality-restore-check.service`
- Create: `ops/systemd/causality-restore-check.timer`
- Create: `scripts/install-cloud-timers.sh`
- Create: `tests/production/backup-contract.test.mjs`
- Create: `tests/production/backup-restore.spec.ts`

**Interfaces:**
- Produces:

```text
pnpm maintenance:on
pnpm maintenance:off
pnpm maintenance:status
pnpm cloud:backup
pnpm cloud:restore -- <validated-backup-name>
pnpm cloud:verify-restore
```

- Backup names use `causality-YYYYMMDDTHHMMSSZ.dump`; restore accepts only this basename pattern from the configured backup directory.
- Restic image is pinned to `restic/restic:0.18.0`; PostgreSQL dump/restore uses the same PostgreSQL 18 image family as the database.

- [ ] **Step 1: Write failing maintenance-mode tests**

Assert maintenance mode allows health, readiness, login, and read-only authenticated requests but returns `503 MAINTENANCE_MODE` for Web writes, MCP write tools, imports, data-check actions, model changes, and AI commit. Server CLI can read and change the state.

- [ ] **Step 2: Implement migration 0024 and the write guard**

Create a singleton state row with enabled flag, reason, changed time, and `server-cli` audit linkage. Add a central pre-handler after authentication and before business mutation. Do not duplicate checks in individual routes.

- [ ] **Step 3: Write failing backup-script safety tests**

Test scripts with stubbed `docker` and `restic` binaries. Assert:

- backup writes to a temporary file and atomically renames only after success;
- failure removes the incomplete file;
- filenames cannot escape the backup directory;
- commands never print database or Restic passwords;
- local retention deletes only matching dumps older than 14 days;
- offsite retention keeps at least 30 days;
- restore rejects absolute paths, separators, globs, and nonmatching names.

- [ ] **Step 4: Implement database backup and encrypted offsite copy**

`create-backup.sh` invokes PostgreSQL 18 `pg_dump --format=custom --no-owner --no-acl`, writes SHA-256 metadata, and enforces local retention. `copy-offsite.sh` runs Restic using mounted password and repository configuration, then executes `restic forget --keep-daily 30 --prune`.

No script uses unresolved broad deletion targets. All paths resolve under `/opt/causality/backups` or the mounted container equivalent.

- [ ] **Step 5: Implement safe restore**

The restore command requires maintenance mode, an existing checksum-valid basename, and an explicit typed confirmation. It stops API/MCP/Semantic Worker through the reviewed Compose project, restores PostgreSQL, runs migrations, clears all `web_sessions`, restarts services, and leaves maintenance mode enabled until verification succeeds.

Personal MCP Token hashes from the restore point remain valid. Add a separate `pnpm mcp:revoke-all` server command for emergency invalidation.

- [ ] **Step 6: Implement monthly restore verification**

Create a temporary database named `causality_restore_verify_<timestamp>`, where the name must match a strict allowlist. Restore the newest backup, run `dist/database/verify.js`, record success, and always drop only that validated temporary database in `trap` cleanup.

Never run verification against the production database name.

- [ ] **Step 7: Add systemd timers and installer**

Daily backup runs at a fixed server-local time with `Persistent=true`; monthly restore verification runs on the first day of the month. Unit failures remain visible through `systemctl --failed` and journal logs. The installer copies only the two reviewed units, reloads systemd, enables timers, and prints status commands without secrets.

- [ ] **Step 8: Run an isolated end-to-end recovery test**

Create data with two users and two personal Tokens, back up, mutate/delete data, restore, then assert:

- original knowledge data returns;
- Web sessions are invalid;
- restored personal Tokens work;
- audit/history rows from the restore point exist;
- semantic index can be rebuilt;
- temporary databases, containers, and volumes are removed.

- [ ] **Step 9: Commit Task 7 and stop for recovery review**

```bash
git add apps/api database/migrations compose.cloud.yaml ops/backup ops/systemd scripts package.json tests/production
git commit -m "feat: add cloud backup and recovery workflow"
```

Ask the user to execute one manual backup and restore on a non-production test deployment.

---

### Task 8: Complete Migration, Documentation, Security Gates, and Manual Delivery

**Files:**
- Modify: `README.md`
- Create: `docs/cloud-deployment.md`
- Create: `docs/user-account-operations.md`
- Create: `docs/cloud-backup-recovery.md`
- Modify: `docs/mcp-client-compatibility.md`
- Modify: `docs/superpowers/specs/2026-07-31-p4-01-cloud-multi-user-access-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-31-p4-01-cloud-multi-user-access.md`
- Modify: `tests/production/production-smoke.spec.ts`
- Modify: `tests/e2e/authentication.spec.ts`
- Modify: `tests/e2e/multi-user-concurrency.spec.ts`

**Interfaces:**
- Produces the release-candidate installation, upgrade, user, MCP, backup, restore, and troubleshooting documentation.
- Consumes all Task 1–7 commands and behavior.

- [ ] **Step 1: Write the upgrade runbook**

Document this exact safe order:

1. pull/build reviewed code;
2. run cloud preflight;
3. back up current database;
4. run migrations;
5. create first user through CLI;
6. start Web/API with authentication;
7. log in and create a personal MCP Token;
8. update and test AI clients;
9. disable legacy global MCP authorization;
10. verify backup timer and offsite repository.

Explain that incomplete AI plans are invalidated and successful history remains.

- [ ] **Step 2: Write fresh-install and operations guides**

Cover DNS, firewall, directory layout, secret permissions, Compose commands, account CLI, login lock recovery, personal Token lifecycle, unsupported OAuth-only clients, log inspection, backup status, restore, upgrade, rollback boundary, and complete uninstall scope.

Use example domains and placeholder secrets only. Never include local usernames, absolute developer paths, or real credentials.

- [ ] **Step 3: Run documentation consistency checks**

```bash
pnpm exec prettier --check README.md docs/cloud-deployment.md docs/user-account-operations.md docs/cloud-backup-recovery.md docs/mcp-client-compatibility.md docs/superpowers/specs/2026-07-31-p4-01-cloud-multi-user-access-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
rg -n "OAuth|个人访问令牌|12 小时|7 天|90 天|10 个|15 分钟" README.md docs
```

Expected: formatting passes and security limits agree with the approved design.

- [ ] **Step 4: Run focused security and compatibility gates**

```bash
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration
pnpm --filter @causality/mcp test
pnpm test:mcp-compat
pnpm --filter @causality/web test
pnpm test:compose
bash scripts/test-cloud-compose.sh
pnpm cloud:verify-restore
```

Expected: all pass with isolated databases and no residual test resources.

- [ ] **Step 5: Run full release-candidate gates**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm test:production
pnpm audit --prod --audit-level=high
git diff --check
```

Expected: all exit 0. The existing lazy causal-graph chunk warning remains non-blocking unless this stage changes its behavior.

- [ ] **Step 6: Review the complete P4-01 diff**

Confirm:

- no anonymous business route remains;
- no production auth bypass or test magic header exists;
- no secret, password, Cookie, personal Token, raw IP, or full body is logged;
- user identity does not create private knowledge ownership;
- all users retain equal business permissions;
- cross-user AI plan submission is rejected;
- personal Token revocation is immediate;
- global MCP authorization is disabled;
- `/internal/mcp/*` is not public;
- cloud Compose exposes only Caddy;
- backup and restore targets are explicitly validated;
- no OAuth, TOTP, mobile Web, role, tenant, or high-availability feature slipped into scope;
- `research/` remains untouched and untracked.

- [ ] **Step 7: Mark implementation complete but keep manual review open**

Update design and roadmap to:

```text
P4-01 状态：实施完成，等待人工复核
```

Record exact migrations, commands, test totals, image versions, known residual risks, and commit range. Do not mark complete or push GitHub.

- [ ] **Step 8: Commit release-candidate documentation**

```bash
git add README.md docs/cloud-deployment.md docs/user-account-operations.md docs/cloud-backup-recovery.md docs/mcp-client-compatibility.md docs/superpowers/specs/2026-07-31-p4-01-cloud-multi-user-access-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md docs/superpowers/plans/2026-07-31-p4-01-cloud-multi-user-access.md
git commit -m "docs: prepare P4-01 cloud multi-user review"
```

- [ ] **Step 9: Stop for manual verification**

Ask the user to verify all 12 items from design section 25 on a non-production domain first, then repeat the connection checks on the intended cloud server. Do not proceed until the user explicitly approves.

- [ ] **Step 10: Close P4-01 only after explicit approval**

After approval, mark design and roadmap `已完成`, record the date, run Prettier and `git diff --check`, and commit only status documents:

```bash
git add docs/superpowers/specs/2026-07-31-p4-01-cloud-multi-user-access-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
git commit -m "docs: complete P4-01 cloud multi-user access"
```

Do not push GitHub until the user separately requests it.

---

## Plan Self-Review Checklist

- [x] Every approved design section maps to at least one Task.
- [x] Every new interface is introduced before a later Task consumes it.
- [x] Task 1 leaves current business access unchanged; Task 2 adds Web protection with temporary MCP compatibility; Task 3 removes the global Token atomically.
- [x] No Task introduces role, tenant, workspace, OAuth, TOTP, public registration, Web mobile layout, or high availability.
- [x] Authentication tests exercise real Cookies and credentials; no production bypass is added for tests.
- [x] The cloud edge and restore scripts use explicit targets and isolated test resources.
- [x] Each Task has a focused test command, commit, and user review gate.
- [x] Final status remains waiting for manual review until explicit approval.
