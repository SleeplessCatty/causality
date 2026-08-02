# Recoverable MCP Token Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-time personal MCP tokens with encrypted, recoverable tokens that can be viewed, copied, configured, and hard-deleted from a compact four-column settings table.

**Architecture:** Keep SHA-256 digests as the authentication lookup path, store AES-256-GCM ciphertext plus a safe precomputed mask for management, and expose plaintext only through an authenticated non-cacheable secret endpoint. Separate contracts, cryptography, persistence, service policy, and React presentation so list operations never require decrypting every token.

**Tech Stack:** TypeScript, Node.js `crypto`, Fastify, PostgreSQL 18, Drizzle schema/migrations, Zod, React 19, TanStack Query, Vitest, Testing Library, Playwright, pnpm.

## Global Constraints

- Delete all existing `mcp_access_tokens` rows during migration; existing digest-only tokens cannot be recovered.
- Token names are unique per user after `btrim` and case folding; `Codex`, `codex`, and ` Codex ` conflict.
- Use AES-256-GCM with a random 12-byte IV and a dedicated Base64-encoded 32-byte `CAUSALITY_TOKEN_ENCRYPTION_KEY`.
- Use `userId` and `tokenId` together as AES-GCM additional authenticated data.
- Keep SHA-256 `token_digest` authentication and the `cau_pat_[A-Za-z0-9_-]{43}` token format unchanged.
- Never return plaintext tokens from list or create responses and never write plaintext, ciphertext, or digests to logs or audit records.
- The secret endpoint is current-user scoped, returns `Cache-Control: no-store`, and returns 404 for missing or foreign tokens.
- The table has exactly four columns: `令牌名称`, `令牌`, `最近使用时间`, `操作`.
- Hidden tokens use `cau_pat_abcd••••wxyz`; viewing is temporary and copying does not change reveal state.
- Creation closes immediately after success; deletion is a hard delete with no revoked status or retained row.
- Preserve the existing maximum of 10 personal tokens per user.
- Do not modify the MCP client's Bearer Token protocol or add password reauthentication.
- Preserve the untracked `research/` directory and do not include it in commits.

## File and Responsibility Map

- `packages/contracts/src/mcp/mcpSettingsSchemas.ts`: public management request/response schemas.
- `packages/contracts/src/audit/auditSchemas.ts`: append-only `mcp_token.deleted` action.
- `apps/api/src/features/mcp-access/mcpTokenCipher.ts`: token generation support, AES-GCM encryption/decryption, and masking.
- `apps/api/src/features/mcp-access/mcpAccessRepository.ts`: persistence-only management and authentication queries.
- `apps/api/src/features/mcp-access/mcpAccessService.ts`: user policy, transactions, audit, and error mapping inputs.
- `apps/api/src/features/mcp-access/mcpAccessRoutes.ts`: HTTP schemas, status codes, and no-store response header.
- `database/migrations/0023_recoverable_mcp_tokens.sql`: destructive legacy-token migration and new constraints.
- `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`: typed management calls.
- `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`: temporary reveal state and row actions.
- `apps/web/src/features/parameter-settings/parameterSettings.css`: compact four-column table containment.
- `README.md`, Compose, and `.env.example`: encryption-key deployment instructions.

---

### Task 1: Replace Personal Token Contracts and Audit Vocabulary

**Files:**
- Modify: `packages/contracts/src/mcp/mcpSettingsSchemas.ts`
- Modify: `packages/contracts/src/audit/auditSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/mcp-settings.test.ts`
- Modify: `packages/contracts/test/audit.test.ts`

**Interfaces:**
- Produces: `McpTokenSummary`, `CreateMcpTokenInput`, `CreateMcpTokenResponse`, `McpTokenSecretResponse`, and `DeleteMcpTokenResponse`.
- Produces: audit action literal `mcp_token.deleted` while retaining the historical `mcp_token.revoked` literal.
- Consumed by: Tasks 3–5.

- [ ] **Step 1: Write failing contract tests for the new wire format**

Add cases equivalent to:

```ts
const summary = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Codex',
  maskedToken: 'cau_pat_abcd••••wxyz',
  createdAt: '2026-08-02T08:00:00.000Z',
  lastUsedAt: null,
};

expect(mcpTokenSummarySchema.parse(summary)).toEqual(summary);
expect(createMcpTokenInputSchema.parse({ name: '  Codex  ' })).toEqual({ name: 'Codex' });
expect(createMcpTokenResponseSchema.parse({ summary })).toEqual({ summary });
expect(mcpTokenSecretResponseSchema.parse({ token })).toEqual({ token });
expect(deleteMcpTokenResponseSchema.parse({ deleted: true })).toEqual({ deleted: true });
expect(mcpTokenSummarySchema.safeParse({ ...summary, status: 'valid' }).success).toBe(false);
expect(auditActionSchema.parse('mcp_token.deleted')).toBe('mcp_token.deleted');
```

- [ ] **Step 2: Run the contract tests and verify the old schemas fail**

Run:

```bash
pnpm --filter @causality/contracts exec vitest run test/mcp-settings.test.ts test/audit.test.ts
```

Expected: FAIL because the new properties, secret/delete schemas, and audit action do not exist.

- [ ] **Step 3: Implement the strict new schemas and exports**

Use these shapes:

```ts
export const mcpMaskedTokenSchema = z.string().regex(/^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$/);

export const mcpTokenSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  maskedToken: mcpMaskedTokenSchema,
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
}).strict();

export const createMcpTokenInputSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const createMcpTokenResponseSchema = z.object({ summary: mcpTokenSummarySchema }).strict();
export const mcpTokenSecretResponseSchema = z.object({ token: mcpPersonalAccessTokenSchema }).strict();
export const deleteMcpTokenResponseSchema = z.object({ deleted: z.literal(true) }).strict();
```

Keep `mcp_token.revoked` in `auditActions` for historical rows and append `mcp_token.deleted` for new operations.

- [ ] **Step 4: Run contracts tests and typecheck**

Run:

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/contracts typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/contracts
git commit -m "feat: define recoverable MCP token contracts"
```

---

### Task 2: Add Encryption Configuration and an Isolated AES-GCM Token Cipher

**Files:**
- Create: `apps/api/src/features/mcp-access/mcpTokenCipher.ts`
- Create: `apps/api/test/mcp-token-cipher.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `EncryptedMcpToken`, `McpTokenCipher`, and `createAesGcmMcpTokenCipher(base64Key)`.
- Produces: validated `AppEnv.CAUSALITY_TOKEN_ENCRYPTION_KEY: string`.
- Consumed by: Tasks 3 and 4.

- [ ] **Step 1: Write failing cipher tests**

Cover round-trip, random IVs, AAD binding, tampering, and masking:

```ts
const key = Buffer.alloc(32, 0x42).toString('base64');
const cipher = createAesGcmMcpTokenCipher(key);
const context = { userId: userA, tokenId };
const encrypted = cipher.encrypt(token, context);

expect(cipher.decrypt(encrypted, context)).toBe(token);
expect(cipher.encrypt(token, context).iv).not.toEqual(encrypted.iv);
expect(() => cipher.decrypt(encrypted, { userId: userB, tokenId })).toThrow('Unable to decrypt MCP token');
expect(() => cipher.decrypt({ ...encrypted, authTag: Buffer.alloc(16) }, context)).toThrow();
expect(cipher.mask(token)).toBe(`cau_pat_${token.slice(8, 12)}••••${token.slice(-4)}`);
```

Add environment tests proving production rejects a missing/development key and parsing rejects noncanonical Base64 or decoded lengths other than 32 bytes.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
pnpm --filter @causality/api exec vitest run test/mcp-token-cipher.test.ts test/health.test.ts
```

Expected: FAIL because the cipher and environment property are absent.

- [ ] **Step 3: Implement the cipher and environment validator**

The cipher must use Node `createCipheriv('aes-256-gcm', key, iv)`, `randomBytes(12)`, and this stable AAD encoding:

```ts
function aad({ userId, tokenId }: McpTokenContext): Buffer {
  return Buffer.from(`mcp-token\0${userId}\0${tokenId}`, 'utf8');
}
```

Expose only:

```ts
export interface EncryptedMcpToken {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface McpTokenCipher {
  encrypt(token: string, context: McpTokenContext): EncryptedMcpToken;
  decrypt(encrypted: EncryptedMcpToken, context: McpTokenContext): string;
  mask(token: string): string;
}
```

Validate a canonical Base64 key by decoding it, requiring 32 bytes, and requiring `decoded.toString('base64') === input`. Add a development default generated from `Buffer.alloc(32, 0x74).toString('base64')`; reject that value under `NODE_ENV=production`.

- [ ] **Step 4: Run focused tests, API typecheck, and secret-leak scan**

```bash
pnpm --filter @causality/api exec vitest run test/mcp-token-cipher.test.ts test/health.test.ts
pnpm --filter @causality/api typecheck
rg -n "console\.|log\.(info|debug|warn|error).*token" apps/api/src/features/mcp-access
```

Expected: tests/typecheck PASS; scan finds no plaintext logging.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/api/src/config/env.ts apps/api/src/features/mcp-access/mcpTokenCipher.ts apps/api/test/health.test.ts apps/api/test/mcp-token-cipher.test.ts
git commit -m "feat: encrypt recoverable MCP tokens"
```

---

### Task 3: Migrate Token Persistence and Remove Revoked-State Storage

**Files:**
- Create: `database/migrations/0023_recoverable_mcp_tokens.sql`
- Modify: `database/migrations/meta/_journal.json`
- Modify: `apps/api/src/database/schema/mcpAccessTokens.ts`
- Modify: `apps/api/src/database/schema/auditLogs.ts`
- Modify: `apps/api/src/database/verify.ts`
- Modify: `apps/api/src/features/mcp-access/mcpAccessRepository.ts`
- Modify: `apps/api/src/commands/userAdmin.ts`
- Modify: `apps/api/src/database/benchmark/mcpBenchmarkApi.ts`
- Modify: `apps/api/test/core-model.integration.test.ts`
- Modify: `apps/api/test/mcp-access.integration.test.ts`
- Modify: `apps/api/test/user-admin.integration.test.ts`

**Interfaces:**
- Consumes: `EncryptedMcpToken` from Task 2.
- Produces: `McpTokenSummaryRecord`, `McpEncryptedTokenRecord`, `McpAuthorizationTokenRecord`, and repository methods listed below.
- Consumed by: Task 4.

- [ ] **Step 1: Rewrite integration expectations before the migration**

Assert the exact post-migration columns:

```ts
expect(columnNames).toEqual([
  'id', 'user_id', 'token_digest', 'name', 'masked_token',
  'token_ciphertext', 'token_iv', 'token_auth_tag',
  'created_at', 'last_used_at', 'last_client_name',
]);
```

Add tests that seed a legacy 0022 token before applying 0023 and then assert it is deleted; insert `Codex` and reject ` codex ` for the same user while allowing `Codex` for another user; reject wrong digest/IV/tag lengths and empty ciphertext. Update the account-disable integration test to expect zero MCP token rows instead of populated `revoked_at` values.

- [ ] **Step 2: Run the relevant integration tests and confirm schema failures**

```bash
DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
pnpm --filter @causality/api test:integration -- test/mcp-access.integration.test.ts test/user-admin.integration.test.ts test/core-model.integration.test.ts
```

Expected: FAIL on old columns and revoked-row behavior.

- [ ] **Step 3: Add migration 0023 and update Drizzle/audit checks**

The migration must execute these operations in order:

```sql
DELETE FROM "mcp_access_tokens";
DROP INDEX "mcp_access_tokens_user_active_idx";
ALTER TABLE "mcp_access_tokens" RENAME COLUMN "device_name" TO "name";
ALTER TABLE "mcp_access_tokens" DROP COLUMN "revoked_at";
ALTER TABLE "mcp_access_tokens" ADD COLUMN "masked_token" varchar(25) NOT NULL;
ALTER TABLE "mcp_access_tokens" ADD COLUMN "token_ciphertext" bytea NOT NULL;
ALTER TABLE "mcp_access_tokens" ADD COLUMN "token_iv" bytea NOT NULL;
ALTER TABLE "mcp_access_tokens" ADD COLUMN "token_auth_tag" bytea NOT NULL;
ALTER TABLE "mcp_access_tokens" DROP CONSTRAINT "mcp_access_tokens_device_name_length_check";
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_name_length_check"
  CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 80);
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_mask_check"
  CHECK ("masked_token" ~ '^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$');
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_iv_length_check"
  CHECK (octet_length("token_iv") = 12);
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_auth_tag_length_check"
  CHECK (octet_length("token_auth_tag") = 16);
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_ciphertext_length_check"
  CHECK (octet_length("token_ciphertext") > 0);
CREATE UNIQUE INDEX "mcp_access_tokens_user_name_uidx"
  ON "mcp_access_tokens" ("user_id", lower(btrim("name")));
```

Also recreate the audit action check with both `mcp_token.revoked` and `mcp_token.deleted`, and append journal entry `{ "idx": 23, "version": "7", "when": 1785632400000, "tag": "0023_recoverable_mcp_tokens", "breakpoints": true }`.

- [ ] **Step 4: Refactor repository interfaces so list queries never select ciphertext**

Define distinct records and methods:

```ts
countForUser(client, userId): Promise<number>;
create(client, input: CreateMcpAccessTokenInput): Promise<McpTokenSummaryRecord>;
listForUser(client, userId): Promise<McpTokenSummaryRecord[]>;
findSecretForUser(client, userId, tokenId): Promise<McpEncryptedTokenRecord | null>;
deleteForUser(client, userId, tokenId): Promise<boolean>;
findByDigest(client, tokenDigest): Promise<McpAuthorizationTokenRecord | null>;
```

`listForUser` selects only ID, name, mask, created/last-used fields. `findSecretForUser` selects only ID, user ID, ciphertext, IV, and tag. `findByDigest` no longer filters `revoked_at`.

Change account disable to `delete from mcp_access_tokens where user_id = $1`. Update the benchmark fixture to generate an ID, encrypt its token with the Task 2 cipher, and insert all required columns.

- [ ] **Step 5: Run migration/integration tests and database verification**

```bash
DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
pnpm --filter @causality/api test:integration -- test/mcp-access.integration.test.ts test/user-admin.integration.test.ts test/core-model.integration.test.ts
pnpm --filter @causality/api typecheck
pnpm db:verify
```

Expected: PASS and verification reports the new token schema as valid.

- [ ] **Step 6: Commit Task 3**

```bash
git add database/migrations apps/api/src/database apps/api/src/features/mcp-access/mcpAccessRepository.ts apps/api/src/commands/userAdmin.ts apps/api/test apps/api/src/database/benchmark/mcpBenchmarkApi.ts
git commit -m "feat: migrate recoverable MCP token storage"
```

---

### Task 4: Implement Recoverable Token Service and HTTP Routes

**Files:**
- Modify: `apps/api/src/features/mcp-access/mcpAccessService.ts`
- Modify: `apps/api/src/features/mcp-access/mcpAccessRoutes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/mcp-access-service.test.ts`
- Modify: `apps/api/test/mcp-access.integration.test.ts`
- Modify: `apps/api/test/route-access-policy.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts, Task 2 `McpTokenCipher`, and Task 3 repository.
- Produces: `create(actor, name)`, `list(actor)`, `getSecret(actor, tokenId)`, `delete(actor, tokenId)`, and unchanged `authorize(rawToken, clientName)`.
- Produces routes: `GET/POST /api/mcp/tokens`, `GET /api/mcp/tokens/:tokenId/secret`, and `DELETE /api/mcp/tokens/:tokenId`.

- [ ] **Step 1: Rewrite service tests around recoverability and hard deletion**

The memory repository must store encrypted fields but not plaintext. Add tests for:

```ts
const created = await service.create(actor, '  Codex  ');
expect(created.summary.name).toBe('Codex');
expect(created.summary.maskedToken).toMatch(/^cau_pat_.{4}••••.{4}$/u);
expect(created).not.toHaveProperty('token');
expect(await service.getSecret(actor, created.summary.id)).toEqual({ token: knownToken });
await expect(service.create(actor, 'codex')).rejects.toMatchObject({ code: 'TOKEN_NAME_EXISTS' });
await service.delete(actor, created.summary.id);
expect(await service.authorize(knownToken)).toBeNull();
expect(audit.at(-1)?.action).toBe('mcp_token.deleted');
```

Also test foreign-user secret/delete as `TOKEN_NOT_FOUND`, decryption failure as `TOKEN_SECRET_UNAVAILABLE`, and the 10-token limit.

- [ ] **Step 2: Run focused service tests and verify failure**

```bash
pnpm --filter @causality/api exec vitest run test/mcp-access-service.test.ts
```

Expected: FAIL because create still returns plaintext and revoke state still exists.

- [ ] **Step 3: Implement service policy and atomic create/delete**

Add error codes:

```ts
type McpAccessErrorCode =
  | 'AUTH_REQUIRED'
  | 'TOKEN_LIMIT_REACHED'
  | 'TOKEN_NAME_EXISTS'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_SECRET_UNAVAILABLE';
```

Creation generates token ID and raw token before the transaction, encrypts with `{userId, tokenId}`, and inserts digest, mask, and encrypted fields. Translate PostgreSQL unique violation `23505` for `mcp_access_tokens_user_name_uidx` into `TOKEN_NAME_EXISTS`. Return only `{ summary }`.

`getSecret` loads the current user's encrypted row and decrypts it. `delete` hard-deletes and appends `mcp_token.deleted` in the same transaction. `authorize` stays digest-based.

- [ ] **Step 4: Add secret/delete routes and app wiring**

Map service errors as follows:

```ts
TOKEN_NAME_EXISTS -> 409
TOKEN_LIMIT_REACHED -> 409
TOKEN_NOT_FOUND -> 404
TOKEN_SECRET_UNAVAILABLE -> 500
AUTH_REQUIRED -> 401
```

The secret handler must set the header before returning:

```ts
reply.header('Cache-Control', 'no-store');
return mcpTokenSecretResponseSchema.parse(await service.getSecret(actor, tokenId));
```

Add `tokenEncryptionKey?: string` to `BuildAppOptions`, construct the cipher once in `buildApp`, and pass `env.CAUSALITY_TOKEN_ENCRYPTION_KEY` from `server.ts`.

- [ ] **Step 5: Rewrite and run API integration tests**

The integration flow must create a token, assert the create/list JSON never contains the plaintext, fetch the secret, reject cross-user access with 404, authorize the token, delete it, assert the row is gone, and assert authorization becomes 401.

```bash
DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
pnpm --filter @causality/api test:integration -- test/mcp-access.integration.test.ts
pnpm --filter @causality/api test
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: expose recoverable MCP token operations"
```

---

### Task 5: Rebuild the Personal Token Table and Row Operations

**Files:**
- Modify: `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`
- Modify: `apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/parameterSettings.css`
- Modify: `tests/e2e/parameter-settings-mcp.spec.ts`

**Interfaces:**
- Consumes: Task 1 contracts and Task 4 routes.
- Produces API helpers: `getMcpTokenSecret(tokenId)` and `deleteMcpToken(tokenId)`.
- Produces UI state: `revealedTokens: Record<string, string>` and operation-specific copy feedback.

- [ ] **Step 1: Replace component tests with the confirmed four-column behavior**

Add assertions that the table headers are exactly:

```ts
expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
  '令牌名称', '令牌', '最近使用时间', '操作',
]);
```

Test each row operation:

- create posts `{ name: 'Codex' }`, closes immediately, and renders the returned mask;
- duplicate-name 409 leaves the create dialog open with `令牌名称已存在`;
- view fetches `/secret`, shows plaintext only in that row, and changes to `隐藏`;
- hide removes the plaintext from DOM;
- copy token and copy JSON both work while hidden and do not change reveal state;
- delete confirmation removes the row after `{ deleted: true }`;
- delete failure keeps the dialog and row;
- an 80-character name and full token use `OverflowText` containment.

- [ ] **Step 2: Run focused web tests and confirm failure**

```bash
pnpm --filter @causality/web exec vitest run src/features/parameter-settings/McpSettingsPanel.test.tsx
```

Expected: FAIL because the current UI has a status column and one-time result dialog.

- [ ] **Step 3: Update typed API helpers**

Implement:

```ts
export async function createMcpToken(name: string): Promise<CreateMcpTokenResponse>;
export async function getMcpTokenSecret(tokenId: string): Promise<McpTokenSecretResponse>;
export async function deleteMcpToken(tokenId: string): Promise<void>;
```

Use encoded IDs and the new strict schemas. Do not cache secret responses in TanStack Query; call the helper directly from each reveal/copy action.

- [ ] **Step 4: Implement temporary reveal, copy, creation, and hard-delete state**

Replace `createdToken`, `deviceName`, `revokeToken`, and the one-time dialog branch with:

```ts
const [tokenName, setTokenName] = useState('');
const [revealedTokens, setRevealedTokens] = useState<Record<string, string>>({});
const [deleteToken, setDeleteToken] = useState<{ id: string; name: string }>();
const [copyNotice, setCopyNotice] = useState<'token' | 'json'>();
```

On component cleanup, clear `revealedTokens`. Viewing toggles only one record. Copy retrieves a secret only for the local operation and never inserts it into reveal state. Successful create closes the dialog and invalidates `mcpTokensQueryKey`.

- [ ] **Step 5: Rebuild the compact table and CSS containment**

Render four headers and four text actions. Use `OverflowText` for name and token values. Reserve enough width for the action column without horizontal page overflow:

```css
.mcp-settings-token-table th:nth-child(1) { width: 22%; }
.mcp-settings-token-table th:nth-child(2) { width: 25%; }
.mcp-settings-token-table th:nth-child(3) { width: 16%; }
.mcp-settings-token-table th:nth-child(4) { width: 37%; }
.mcp-token-row-actions { display: flex; justify-content: flex-end; gap: 8px; white-space: nowrap; }
```

Use the existing danger-action color for `撤销`. Format `lastUsedAt` with `Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })`; render `从未` for null.

- [ ] **Step 6: Run web tests, typecheck, and responsive containment checks**

```bash
pnpm --filter @causality/web test
pnpm --filter @causality/web typecheck
pnpm exec eslint apps/web/src/features/parameter-settings
pnpm exec prettier --check apps/web/src/features/parameter-settings
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/web/src/features/parameter-settings tests/e2e/parameter-settings-mcp.spec.ts
git commit -m "feat: manage recoverable MCP tokens in settings"
```

---

### Task 6: Configure Deployment, Document Key Handling, and Complete Release Verification

**Files:**
- Modify: `apps/api/.env.example`
- Modify: `compose.dev.yaml`
- Modify: `compose.yaml`
- Modify: `README.md`
- Modify: `playwright.config.ts`
- Modify: `tests/production/compose-contract.test.mjs`
- Modify: `tests/e2e/parameter-settings-mcp.spec.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: reproducible development/production configuration and release acceptance evidence.

- [ ] **Step 1: Add failing production/configuration checks**

Update environment tests to require `CAUSALITY_TOKEN_ENCRYPTION_KEY`. In `tests/production/compose-contract.test.mjs`, assert that the API and migrate services receive the same key, while MCP and semantic-worker do not receive it. Add the fixed E2E key to the API web-server environment in `playwright.config.ts`.

Run:

```bash
pnpm --filter @causality/api exec vitest run test/health.test.ts
node --test tests/production/compose-contract.test.mjs
```

Expected: FAIL until configuration files are updated.

- [ ] **Step 2: Update environment examples and Compose**

Add `CAUSALITY_TOKEN_ENCRYPTION_KEY` to `apps/api/.env.example` and `x-api-environment`. Use a development-only fallback in `compose.dev.yaml`; in production Compose require shell substitution with an error:

```yaml
CAUSALITY_TOKEN_ENCRYPTION_KEY: ${CAUSALITY_TOKEN_ENCRYPTION_KEY:?set CAUSALITY_TOKEN_ENCRYPTION_KEY}
```

Do not pass this key to the MCP process.

- [ ] **Step 3: Rewrite README token-management and backup guidance**

Document:

```bash
openssl rand -base64 32
```

State that upgrading deletes existing personal tokens, the key must be backed up with deployment secrets, changing/losing it makes token reveal/copy impossible, list responses remain masked, and deletion immediately invalidates MCP connections. Remove all “only displayed once”, device-name, revoked-status, and old rotation wording for personal tokens.

- [ ] **Step 4: Complete the Playwright workflow**

The E2E test must:

1. create `Playwright token` and observe the modal close;
2. verify a masked token and no status column;
3. click `查看` and match the full `cau_pat_...` value;
4. click `隐藏` and verify only the mask remains;
5. copy token and JSON while hidden and verify the UI notices;
6. confirm撤销 and verify the row disappears;
7. save a 1280×720 screenshot using `testInfo.outputPath('recoverable-mcp-token-settings.png')`.

Run:

```bash
DOCKER_HOST=unix:///Users/jason/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
pnpm test:e2e
```

Expected: all Playwright tests PASS and the temporary E2E database is dropped.

- [ ] **Step 5: Run full release gates**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
git diff --check
git status --short
```

Expected: every command PASS; `git status --short` shows only the known untracked `research/` directory before the task commit.

- [ ] **Step 6: Perform browser acceptance on an isolated test database**

At a 1280×720 desktop viewport, verify non-empty pages, no error overlay, and no console errors while creating, revealing, hiding, copying, and deleting a token. Inspect the list network response and confirm it contains only `maskedToken`; confirm secret responses carry `Cache-Control: no-store`. Do not use a production account or production token.

- [ ] **Step 7: Commit Task 6**

```bash
git add apps/api/.env.example compose.dev.yaml compose.yaml README.md playwright.config.ts tests/production/compose-contract.test.mjs tests/e2e/parameter-settings-mcp.spec.ts
git commit -m "docs: deliver recoverable MCP token management"
```

---

## Final Review Checklist

- [ ] Review `git diff <base>..HEAD` against the approved design.
- [ ] Confirm the database contains no legacy or revoked personal token rows.
- [ ] Confirm no list/create response or log contains a complete token.
- [ ] Confirm foreign-user secret/delete requests return 404.
- [ ] Confirm name uniqueness is case-insensitive per user and allows the same name for different users.
- [ ] Confirm account disable hard-deletes that user's personal tokens.
- [ ] Confirm `research/` is untouched and not committed.
- [ ] Run an independent specification and code-quality review before user acceptance.
