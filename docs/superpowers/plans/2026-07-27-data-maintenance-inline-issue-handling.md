# Data Maintenance Inline Issue Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace modal data-check handling with compact, URL-backed inline rows whose 26 issue types have readable sources, five explicit panel templates, and transaction-safe automatic actions.

**Architecture:** Contracts define a closed issue taxonomy, readable list sources, five panel kinds, and server-authorized action keys. The API enriches one issue page with bounded batch source queries, builds read-only action contexts, and executes only freshly recomputed whitelisted plans inside serializable transactions. The Web reuses the causal-relation list expansion pattern, renders focused source/panel components, and removes modal, edit-return, and single-issue recheck state.

**Tech Stack:** TypeScript 5, Zod, Fastify, PostgreSQL, React 19, React Router, TanStack Query, Vitest, Testing Library, pnpm.

## Global Constraints

- Work on the current branch; do not create a feature branch.
- Create local commits at task boundaries, but do not push GitHub until all P2 work has passed final review.
- Desktop-only compact layout; reuse existing application colors, buttons, `AppSelect`, `ListPagination`, `OverflowText`, and relation-list expansion behavior.
- The list has exactly four columns: `严重程度`, `问题类型`, `问题来源`, `处理入口`.
- Only one issue may be expanded; page/filter changes clear `expanded`.
- No dialog, close button, `open_edit` action, data-check edit-return state, or single-issue recheck.
- Every truncated source uses the existing fixed-size scrollable tooltip behavior.
- `确认处理` is rendered only for a complete server-authorized automatic plan and appears immediately before `忽略此问题`.
- All business mutations and the handled-state update commit in the same PostgreSQL transaction.
- Ignore affects only the current snapshot and never creates a permanent exception.
- A GET request must never mark an issue handled or mutate business data.
- No N+1 source queries: loading 50 issues uses a fixed number of database queries.
- The approved design is `docs/superpowers/specs/2026-07-27-data-maintenance-inline-issue-handling-design.md`.

---

### Task 1: Close the issue taxonomy and action contracts

**Files:**
- Modify: `packages/contracts/src/data-checks/dataCheckSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/data-checks.test.ts`

**Interfaces:**
- Produces: `DataCheckIssueType`, `DataCheckIssueSource`, `DataCheckIssueListItem`, `DataCheckPanelKind`.
- Produces: automatic action options with `actionKey`; automatic requests must echo that key.
- Removes: `open_edit`, `editPath`, `DataCheckRecheckResponse`, and the public `actionMode` field.
- Consumed by: Tasks 2-7.

- [ ] **Step 1: Write failing closed-taxonomy and source tests**

Add cases that enumerate all 26 issue types and validate every source display kind:

```ts
const issueTypes = [
  'missing_relation_cause_event',
  'missing_relation_effect_event',
  'delete_missing_alias',
  'delete_missing_keyword',
  'delete_missing_relation_case',
  'relation_self_loop',
  'relation_confidence_range',
  'duplicate_relation_direction',
  'duplicate_event_name',
  'duplicate_case_content',
  'delete_duplicate_alias',
  'delete_duplicate_keyword',
  'resequence_keywords',
  'invalid_event_name',
  'invalid_case_content',
  'invalid_alias_text',
  'invalid_keyword_text',
  'invalid_event_description',
  'invalid_relation_description',
  'invalid_event_timestamp_order',
  'invalid_relation_timestamp_order',
  'invalid_case_timestamp_order',
  'cross_event_alias_name',
  'cross_event_shared_alias',
  'semantic_duplicate_event',
  'semantic_duplicate_case',
] as const;

expect(issueTypes.every((value) => dataCheckIssueTypeSchema.safeParse(value).success)).toBe(true);
expect(dataCheckIssueTypeSchema.safeParse('unknown_issue').success).toBe(false);

expect(
  dataCheckIssueSourceSchema.parse({
    displayKind: 'relation',
    items: [
      { type: 'event', role: 'cause', label: '供应中断', detailPath: '/events/00000000-0000-4000-8000-000000000001' },
      { type: 'event', role: 'effect', label: '原材料价格上涨', detailPath: '/events/00000000-0000-4000-8000-000000000002' },
    ],
    relationDetailPaths: ['/relations/00000000-0000-4000-8000-000000000003'],
    auxiliaryText: null,
  }).displayKind,
).toBe('relation');
```

Assert source detail paths accept only internal `/events/:uuid`, `/cases/:uuid`, and `/relations/:uuid` paths; reject absolute URLs, protocol-relative URLs, edit paths, and mismatched record types.

- [ ] **Step 2: Write failing action-contract tests**

Add exact request/option assertions:

```ts
const impact = {
  relationsMoved: 2,
  relationsDeleted: 1,
  relationCaseLinksMoved: 4,
  relationCaseLinksDeleted: 1,
  recordsDeleted: 1,
  recordsUpdated: 0,
};

expect(
  dataCheckActionRequestSchema.parse({
    type: 'merge',
    snapshotId,
    keepId: eventA,
    mergeId: eventB,
    actionKey: 'a'.repeat(64),
  }),
).toMatchObject({ type: 'merge', actionKey: 'a'.repeat(64) });

expect(
  dataCheckActionRequestSchema.safeParse({
    type: 'cleanup',
    snapshotId,
  }).success,
).toBe(false);

expect(dataCheckAllowedActionSchema.safeParse('open_edit').success).toBe(false);
expect(dataCheckPanelKindSchema.options).toEqual([
  'merge',
  'cleanup',
  'delete_relation',
  'repair_timestamp',
  'manual',
]);
```

Also assert `ignore` needs only `snapshotId`, while every data-changing request needs a 64-character lowercase hexadecimal `actionKey`.

- [ ] **Step 3: Run the contract tests to verify failure**

Run:

```bash
pnpm --filter @causality/contracts test -- data-checks.test.ts
```

Expected: FAIL because the closed issue/source/panel schemas and action keys do not exist.

- [ ] **Step 4: Implement the closed schemas**

Define the core interfaces exactly:

```ts
export const dataCheckIssueTypes = [
  'missing_relation_cause_event',
  'missing_relation_effect_event',
  'delete_missing_alias',
  'delete_missing_keyword',
  'delete_missing_relation_case',
  'relation_self_loop',
  'relation_confidence_range',
  'duplicate_relation_direction',
  'duplicate_event_name',
  'duplicate_case_content',
  'delete_duplicate_alias',
  'delete_duplicate_keyword',
  'resequence_keywords',
  'invalid_event_name',
  'invalid_case_content',
  'invalid_alias_text',
  'invalid_keyword_text',
  'invalid_event_description',
  'invalid_relation_description',
  'invalid_event_timestamp_order',
  'invalid_relation_timestamp_order',
  'invalid_case_timestamp_order',
  'cross_event_alias_name',
  'cross_event_shared_alias',
  'semantic_duplicate_event',
  'semantic_duplicate_case',
] as const;

export const dataCheckIssueTypeSchema = z.enum(dataCheckIssueTypes);

const uuidPathPart =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const dataCheckDetailPathSchema = z.string().regex(
  new RegExp(`^/(events|cases|relations)/${uuidPathPart}$`, 'i'),
);
const dataCheckRelationDetailPathSchema = z.string().regex(
  new RegExp(`^/relations/${uuidPathPart}$`, 'i'),
);

export const dataCheckSourceItemSchema = z.object({
  type: z.enum(['event', 'case', 'relation', 'alias', 'keyword', 'missing']),
  role: z.enum(['target', 'related', 'cause', 'effect', 'owner', 'value']),
  label: z.string().trim().min(1).max(4_000),
  detailPath: dataCheckDetailPathSchema.nullable(),
}).strict();

export const dataCheckIssueSourceSchema = z.object({
  displayKind: z.enum(['single', 'pair', 'relation', 'owned_value', 'broken_reference']),
  items: z.array(dataCheckSourceItemSchema).min(1).max(6),
  relationDetailPaths: z.array(dataCheckRelationDetailPathSchema).max(2),
  auxiliaryText: z.string().trim().min(1).max(300).nullable(),
}).strict().superRefine((source, context) => {
  for (const [index, item] of source.items.entries()) {
    if (!item.detailPath) continue;
    const expectedPrefix =
      item.type === 'event' ? '/events/' :
      item.type === 'case' ? '/cases/' :
      item.type === 'relation' ? '/relations/' :
      null;
    if (!expectedPrefix || !item.detailPath.startsWith(expectedPrefix)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'detailPath'],
        message: '问题来源类型与详情路径不匹配',
      });
    }
  }
});

export const dataCheckIssueListItemSchema = dataCheckIssueSchema.extend({
  issueType: dataCheckIssueTypeSchema,
  source: dataCheckIssueSourceSchema,
}).strict();

export const dataCheckPanelKindSchema = z.enum([
  'merge',
  'cleanup',
  'delete_relation',
  'repair_timestamp',
  'manual',
]);
```

Keep the database-only `action_mode` column and draft property for migration compatibility, but remove `actionMode` from public `DataCheckIssue`.

Extend impact with `recordsUpdated`, add `actionKey` to automatic options, remove `editPath`, and remove all recheck exports.

- [ ] **Step 5: Run contract tests and typecheck**

Run:

```bash
pnpm --filter @causality/contracts test -- data-checks.test.ts
pnpm --filter @causality/contracts typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/data-checks/dataCheckSchemas.ts packages/contracts/src/index.ts packages/contracts/test/data-checks.test.ts
git commit -m "refactor: close data-check issue contracts"
```

---

### Task 2: Add readable issue sources without N+1 queries

**Files:**
- Create: `apps/api/src/features/data-checks/dataCheckIssueSource.ts`
- Create: `apps/api/test/data-check-issue-source.test.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRepository.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckTypes.ts`
- Modify: `apps/api/test/data-checks.integration.test.ts`
- Modify: `apps/api/test/data-check-benchmark.test.ts`

**Interfaces:**
- Consumes: `DataCheckIssueSource` and `DataCheckIssueListItem` from Task 1.
- Produces: `loadDataCheckIssueSources(client, issues): Promise<Map<string, DataCheckIssueSource>>`.
- Produces: issue list items with readable sources.
- Consumed by: Task 6.

- [ ] **Step 1: Write failing source integration tests**

Create one snapshot containing representative rows for all five source layouts:

```ts
const expectedKinds = new Map([
  ['duplicate_event_name', 'pair'],
  ['duplicate_case_content', 'pair'],
  ['relation_self_loop', 'relation'],
  ['invalid_alias_text', 'owned_value'],
  ['delete_missing_relation_case', 'broken_reference'],
]);

const response = await api.get('/api/data-checks/latest/issues?page=1');
expect(response.statusCode).toBe(200);
for (const item of response.json().items) {
  const expected = expectedKinds.get(item.issueType);
  if (expected) expect(item.source.displayKind).toBe(expected);
}
expect(JSON.stringify(response.json().items)).not.toContain('targetId');
```

Also assert:

- event/case names and content have correct detail paths;
- relation sources contain cause/effect event links and at most two relation paths;
- missing records have `type: 'missing'` and `detailPath: null`;
- alias/keyword sources include the owner event and the offending value;
- the list remains valid when either side disappears after snapshot creation.

- [ ] **Step 2: Add a fixed-query-count unit test**

Use a fake `PoolClient` that records SQL and returns fixture rows by table name:

```ts
function sourceClient(): { client: PoolClient; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    client: {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      },
    } as PoolClient,
  };
}

function buildIssueRows(count: number): DataCheckIssueRow[] {
  const variants = [
    { target_type: 'event', issue_type: 'invalid_event_name' },
    { target_type: 'case', issue_type: 'invalid_case_content' },
    { target_type: 'relation', issue_type: 'relation_self_loop' },
    { target_type: 'alias', issue_type: 'invalid_alias_text' },
    { target_type: 'keyword', issue_type: 'invalid_keyword_text' },
    { target_type: 'relation_case', issue_type: 'delete_missing_relation_case' },
  ] as const;
  return Array.from({ length: count }, (_value, index) => {
    const variant = variants[index % variants.length]!;
    return {
      id: crypto.randomUUID(),
      snapshot_id: snapshotId,
      severity: 'error',
      issue_type: variant.issue_type,
      description: '测试问题',
      suggestion: '测试建议',
      action_mode: 'manual',
      status: 'open',
      target_type: variant.target_type,
      target_id: crypto.randomUUID(),
      related_id: variant.target_type === 'relation_case' ? crypto.randomUUID() : null,
      handled_at: null,
    };
  });
}

const one = sourceClient();
await loadDataCheckIssueSources(one.client, buildIssueRows(6));
const fifty = sourceClient();
await loadDataCheckIssueSources(fifty.client, buildIssueRows(48));

const oneIssueQueries = one.queries.length;
const fiftyIssueQueries = fifty.queries.length;
expect(fiftyIssueQueries).toBe(oneIssueQueries);
expect(fiftyIssueQueries).toBeLessThanOrEqual(10);
```

Both fixtures span all six target types; the loader still performs at most six batched source lookups regardless of row count.

- [ ] **Step 3: Run the integration tests to verify failure**

Run:

```bash
pnpm --filter @causality/api test:integration -- data-checks.integration.test.ts
pnpm --filter @causality/api test -- data-check-issue-source.test.ts data-check-benchmark.test.ts
```

Expected: FAIL because list items expose raw IDs and no readable source.

- [ ] **Step 4: Implement the focused source loader**

Use a fixed set of sequential batched queries on the same repeatable-read client:

```ts
export async function loadDataCheckIssueSources(
  client: PoolClient,
  issues: readonly DataCheckIssueRow[],
): Promise<Map<string, DataCheckIssueSource>> {
  const eventIds = collectIds(issues, 'event');
  const caseIds = collectIds(issues, 'case');
  const relationIds = collectIds(issues, 'relation');
  const aliasIds = collectIds(issues, 'alias');
  const keywordIds = collectIds(issues, 'keyword');
  const relationCaseKeys = collectRelationCaseKeys(issues);

  const events = await loadEvents(client, eventIds);
  const cases = await loadCases(client, caseIds);
  const relations = await loadRelations(client, relationIds);
  const aliases = await loadAliases(client, aliasIds);
  const keywords = await loadKeywords(client, keywordIds);
  const relationCases = await loadRelationCases(client, relationCaseKeys);

  return new Map(
    issues.map((issue) => [
      issue.id,
      buildIssueSource(issue, { events, cases, relations, aliases, keywords, relationCases }),
    ]),
  );
}
```

`buildIssueSource` must use the 26-type matrix from the design rather than guessing from target type alone. Missing labels are fixed readable copy such as `原因事件已不存在`, never a UUID.

- [ ] **Step 5: Enrich the repository response**

Within the existing repeatable-read transaction:

```ts
const sources = await loadDataCheckIssueSources(client, issues.rows);
return {
  items: issues.rows.map((row) => ({
    ...mapDataCheckIssue(row),
    issueType: dataCheckIssueTypeSchema.parse(row.issue_type),
    source: sources.get(row.id)!,
  })),
  page,
  pageSize: issuePageSize,
  totalItems,
  totalPages,
};
```

Throw an internal consistency error if a known issue has no source; do not silently return raw IDs.

- [ ] **Step 6: Run source tests, benchmark, and typecheck**

Run:

```bash
pnpm --filter @causality/api test:integration -- data-checks.integration.test.ts
pnpm --filter @causality/api test -- data-check-issue-source.test.ts data-check-benchmark.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS and query count remains constant.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/data-checks/dataCheckIssueSource.ts apps/api/src/features/data-checks/dataCheckRepository.ts apps/api/src/features/data-checks/dataCheckTypes.ts apps/api/test/data-check-issue-source.test.ts apps/api/test/data-checks.integration.test.ts apps/api/test/data-check-benchmark.test.ts
git commit -m "feat: add readable data-check sources"
```

---

### Task 3: Make action contexts read-only and server-authorized

**Files:**
- Create: `apps/api/src/features/data-checks/dataCheckActionKey.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckActionService.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRepository.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckCoordinator.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRoutes.ts`
- Modify: `apps/api/test/data-check-action-service.test.ts`
- Modify: `apps/api/test/data-check-actions.integration.test.ts`

**Interfaces:**
- Consumes: closed issue types, panel kinds, action keys from Task 1.
- Produces: one explicit evaluator for every issue type.
- Produces: `createDataCheckActionKey(issue, records, optionWithoutKey): string`.
- Removes: legacy auto/manual routes and single-issue recheck route.
- Consumed by: Tasks 4, 5, and 7.

- [ ] **Step 1: Write failing evaluator registry tests**

Assert all 26 types are explicit and map to the approved five categories:

```ts
expect(getDataCheckIssueEvaluator('duplicate_event_name').panelKind).toBe('merge');
expect(getDataCheckIssueEvaluator('delete_duplicate_keyword').panelKind).toBe('cleanup');
expect(getDataCheckIssueEvaluator('relation_self_loop').panelKind).toBe('delete_relation');
expect(getDataCheckIssueEvaluator('invalid_case_timestamp_order').panelKind).toBe('repair_timestamp');
expect(getDataCheckIssueEvaluator('relation_confidence_range').panelKind).toBe('manual');
expect(Object.keys(issueEvaluatorRegistry).sort()).toEqual([...dataCheckIssueTypes].sort());
```

Assert manual contexts expose only ignore and no automatic action.

- [ ] **Step 2: Write failing read-only GET tests**

For an issue whose target was deleted after the snapshot:

```ts
async function readIssueStatus(id: string): Promise<string> {
  const result = await pool.query<{ status: string }>(
    'select status from data_check_issues where id = $1',
    [id],
  );
  return result.rows[0]!.status;
}

const before = await readIssueStatus(issueId);
const response = await api.get(
  `/api/data-checks/issues/${issueId}/action-context?snapshotId=${snapshotId}`,
);
const after = await readIssueStatus(issueId);

expect(response.statusCode).toBe(200);
expect(response.json().actions).toEqual([]);
expect(response.json().message).toContain('重新执行数据检查');
expect(before).toBe('open');
expect(after).toBe('open');
```

Also assert the legacy `/auto-handle`, `/manual-handle`, and `/recheck` routes return 404.

- [ ] **Step 3: Write failing action-key tests**

Build a context, mutate one relevant record, and request the old action:

```ts
async function actionContext(issueId: string, snapshotId: string) {
  const response = await api.inject({
    method: 'GET',
    url: `/api/data-checks/issues/${issueId}/action-context?snapshotId=${snapshotId}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function renameEvent(eventId: string, name: string): Promise<void> {
  await pool.query(
    'update abstract_events set name = $2, updated_at = clock_timestamp() where id = $1',
    [eventId, name],
  );
}

const context = await actionContext(issueId, snapshotId);
const merge = context.actions.find((action) => action.type === 'merge')!;
await renameEvent(merge.keepId!, '发生变化的名称');

const response = await applyAction(issueId, {
  type: 'merge',
  snapshotId,
  keepId: merge.keepId,
  mergeId: merge.mergeId,
  actionKey: merge.actionKey,
});
expect(response.statusCode).toBe(409);
expect(response.json().code).toBe('DATA_CHECK_ACTION_CONFLICT');
```

- [ ] **Step 4: Run focused tests to verify failure**

Run:

```bash
pnpm --filter @causality/api test -- data-check-action-service.test.ts
pnpm --filter @causality/api test:integration -- data-check-actions.integration.test.ts
```

Expected: FAIL because GET mutates missing issues, registry fallback exists, and actions have no key.

- [ ] **Step 5: Implement deterministic action keys**

Hash canonical current evidence:

```ts
export function createDataCheckActionKey(
  issue: DataCheckIssue,
  records: readonly DataCheckActionRecord[],
  option: Omit<DataCheckActionOption, 'actionKey'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({
      issue: {
        snapshotId: issue.snapshotId,
        issueId: issue.id,
        issueType: issue.issueType,
        targetId: issue.targetId,
        relatedId: issue.relatedId,
      },
      records,
      option,
    }))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}
```

Use stable object-key sorting and preserve array order. Add keys after current records and live impacts have been loaded.

- [ ] **Step 6: Replace evaluator fallback with the closed registry**

Every issue type returns:

```ts
interface DataCheckIssueEvaluator {
  readonly panelKind: DataCheckPanelKind;
  loadContext(client: PoolClient, issue: DataCheckIssue): Promise<DataCheckActionRecord[]>;
  evaluate(client: PoolClient, issue: DataCheckIssue): Promise<DataCheckIssueEvaluation>;
  buildActions(
    client: PoolClient,
    issue: DataCheckIssue,
    records: readonly DataCheckActionRecord[],
  ): Promise<DataCheckActionOption[]>;
}
```

Manual evaluators return only `ignore`. Remove all `open_edit` creation and strict edit-page checks.

- [ ] **Step 7: Make context reads non-mutating**

Add `readCurrentIssue(client, issueId, snapshotId)` without `FOR UPDATE`. Use:

```ts
await client.query('begin transaction isolation level repeatable read read only');
const row = await readCurrentIssue(client, issueId, snapshotId);
const issue = mapDataCheckIssue(row);
const evaluation = await evaluator.evaluate(client, issue);
const context = await buildDataCheckActionContext(client, issue, evaluation);
await client.query('commit');
```

For `missing`, `resolved`, or `unavailable`, return no actions and a message requiring the top-level full check. Never call `markIssueHandled` from `context`.

- [ ] **Step 8: Remove obsolete endpoints and coordinator methods**

Delete route registration and public methods for:

```text
POST /api/data-checks/issues/:issueId/recheck
POST /api/data-checks/issues/:issueId/auto-handle
POST /api/data-checks/issues/:issueId/manual-handle
```

Remove corresponding legacy repository methods after confirming no caller remains.

- [ ] **Step 9: Run action tests and typecheck**

Run:

```bash
pnpm --filter @causality/api test -- data-check-action-service.test.ts
pnpm --filter @causality/api test:integration -- data-check-actions.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/features/data-checks apps/api/test/data-check-action-service.test.ts apps/api/test/data-check-actions.integration.test.ts
git commit -m "refactor: authorize inline data-check actions"
```

---

### Task 4: Complete event, case, and relation merge transactions

**Files:**
- Modify: `apps/api/src/features/data-checks/dataCheckActionService.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts`
- Modify: `apps/api/test/data-check-action-service.test.ts`
- Modify: `apps/api/test/data-check-actions.integration.test.ts`

**Interfaces:**
- Consumes: action key and merge panel contracts from Tasks 1 and 3.
- Produces: exact per-direction impact and atomic merge behavior for seven merge issue types.
- Consumed by: Task 7.

- [ ] **Step 1: Add failing event-merge matrix tests**

For both directions, assert:

```ts
async function exists(table: 'abstract_events' | 'concrete_cases' | 'causal_relations', id: string) {
  const result = await pool.query<{ exists: boolean }>(
    `select exists(select 1 from ${table} where id = $1) as exists`,
    [id],
  );
  return result.rows[0]!.exists;
}

async function issueStatus(id: string): Promise<string> {
  const result = await pool.query<{ status: string }>(
    'select status from data_check_issues where id = $1',
    [id],
  );
  return result.rows[0]!.status;
}

expect(result.issue.status).toBe('handled');
expect(await exists('abstract_events', mergeId)).toBe(false);
expect(
  Number((await pool.query(
    `select count(*)::int as count from causal_relations
     where cause_event_id = $1 or effect_event_id = $1`,
    [mergeId],
  )).rows[0]!.count),
).toBe(0);
expect(
  Number((await pool.query(
    `select count(*)::int as count from (
       select normalized_alias from event_aliases where event_id = $1
       group by normalized_alias having count(*) > 1
     ) duplicates`,
    [keepId],
  )).rows[0]!.count),
).toBe(0);
expect(
  (await pool.query<{ position: number }>(
    'select position from event_keywords where event_id = $1 order by position',
    [keepId],
  )).rows.map((row) => row.position),
).toEqual([1, 2, 3]);
```

Create fixtures for:

- inbound and outbound redirection;
- generated self-loop deletion;
- same-direction collision with relation-case link merge;
- alias/keyword normalized deduplication;
- alias or keyword total over 20 causing complete rollback;
- stale action key after name, alias, keyword, relation, or case-link change;
- forced exception after relation migration proving the event and issue both remain unchanged.

- [ ] **Step 2: Add failing case/relation merge tests**

For each direction:

```ts
expect(await duplicateRelationCaseLinkCount()).toBe(0);
expect(await exists('concrete_cases', mergeCaseId)).toBe(false);
expect(await exists('causal_relations', mergeRelationId)).toBe(false);
expect(await issueStatus(issueId)).toBe('handled');
```

Also assert relation merge does not modify the kept relation’s description, confidence, cause, or effect.

- [ ] **Step 3: Verify failures**

Run:

```bash
pnpm --filter @causality/api test:integration -- data-check-actions.integration.test.ts
```

Expected: at least the stale-action and rollback assertions FAIL until action-key validation and exact effects are wired through execution.

- [ ] **Step 4: Recompute and compare the selected action inside the transaction**

Before dispatch:

```ts
const records = await evaluator.loadContext(client, issue);
const allowedActions = await evaluator.buildActions(client, issue, records);
const current = allowedActions.find((option) =>
  option.type === request.type &&
  option.actionKey === request.actionKey &&
  (request.type !== 'merge' ||
    (option.keepId === request.keepId && option.mergeId === request.mergeId)),
);
if (!current) unsafe('数据已变化，当前处理方案已经失效');
```

Use `current.impact` for invariant checks after mutation.

- [ ] **Step 5: Enforce exact merge invariants**

After each merge, compare actual affected counts with the selected current impact. Roll back on mismatch:

```ts
if (!impactEquals(actualImpact, current.impact)) {
  unsafe('实际数据影响与确认前的处理方案不一致');
}
```

Keep stable row locking, `ON CONFLICT DO NOTHING`, self-loop deletion, collision merge, alias/keyword limits, and sorted affected IDs.

- [ ] **Step 6: Run merge tests and API regression**

Run:

```bash
pnpm --filter @causality/api test -- data-check-action-service.test.ts
pnpm --filter @causality/api test:integration -- data-check-actions.integration.test.ts
pnpm --filter @causality/api test
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/data-checks/dataCheckActionService.ts apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts apps/api/test/data-check-action-service.test.ts apps/api/test/data-check-actions.integration.test.ts
git commit -m "fix: complete data-check merge transactions"
```

---

### Task 5: Complete cleanup, relation deletion, time repair, and ignore

**Files:**
- Modify: `apps/api/src/features/data-checks/dataCheckActionService.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts`
- Modify: `apps/api/test/data-check-action-service.test.ts`
- Modify: `apps/api/test/data-check-actions.integration.test.ts`

**Interfaces:**
- Consumes: fixed-plan action keys from Task 3.
- Produces: complete automatic actions for 12 fixed-plan issue types plus snapshot-only ignore.
- Consumed by: Task 7.

- [ ] **Step 1: Write the fixed-action coverage table test**

```ts
const automatic = new Map([
  ['delete_missing_alias', 'cleanup'],
  ['delete_missing_keyword', 'cleanup'],
  ['delete_missing_relation_case', 'cleanup'],
  ['delete_duplicate_alias', 'cleanup'],
  ['delete_duplicate_keyword', 'cleanup'],
  ['resequence_keywords', 'cleanup'],
  ['relation_self_loop', 'delete_relation'],
  ['missing_relation_cause_event', 'delete_relation'],
  ['missing_relation_effect_event', 'delete_relation'],
  ['invalid_event_timestamp_order', 'repair_timestamp'],
  ['invalid_relation_timestamp_order', 'repair_timestamp'],
  ['invalid_case_timestamp_order', 'repair_timestamp'],
]);

for (const [issueType, actionType] of automatic) {
  const fixture = await insertActionFixture(pool, issueType);
  const context = await service.context(fixture.issueId, fixture.snapshotId);
  expect(context.actions.map((item) => item.type)).toEqual([actionType, 'ignore']);
  expect(context.actions[0].actionKey).toMatch(/^[0-9a-f]{64}$/);
}
```

Implement `insertActionFixture(pool, issueType)` in the same integration test file as a switch over the 12 listed types. Each branch inserts the minimum valid target rows, the corresponding open issue, and returns `{ issueId, snapshotId }`; do not use a generic fixture that bypasses the real evaluator predicate.

- [ ] **Step 2: Write rollback and scope tests**

Assert:

- every cleanup deletes only its exact target;
- duplicate keyword cleanup also produces continuous positions;
- resequencing rejects duplicate normalized keywords and over-20 counts;
- abnormal relation deletion removes links first and retains all events/cases;
- each timestamp repair updates exactly one allowed table row;
- an incorrect action key leaves business data and issue status unchanged;
- a forced failure before `markIssueHandled` rolls back business data;
- a forced failure after `markIssueHandled` still rolls back both;
- ignore changes only issue/state counters in the current snapshot.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @causality/api test:integration -- data-check-actions.integration.test.ts
```

Expected: FAIL where exact impacts and action-key invariants are not yet enforced.

- [ ] **Step 4: Implement exact fixed-plan impacts**

Build non-ambiguous impacts:

```ts
cleanupAction({
  recordsDeleted: 1,
  recordsUpdated: 0,
  relationsMoved: 0,
  relationsDeleted: 0,
  relationCaseLinksMoved: 0,
  relationCaseLinksDeleted: 0,
});

repairAction({
  recordsDeleted: 0,
  recordsUpdated: 1,
  relationsMoved: 0,
  relationsDeleted: 0,
  relationCaseLinksMoved: 0,
  relationCaseLinksDeleted: 0,
});
```

For relation deletion, set `relationsDeleted: 1` and use the live relation-case count. For resequencing, set `recordsUpdated` to the keyword count.

- [ ] **Step 5: Validate effects and commit atomically**

Keep the shared sequence:

```ts
const affected = await applyWhitelistedAction(client, issue, request);
assertExpectedImpact(affected.impact, currentAction.impact);
const handled = await markIssueHandled(client, row);
await client.query('commit');
return { issue: handled, ...affected.ids };
```

No action accepts a client table, column, target type, arbitrary ID, or impact.

- [ ] **Step 6: Run fixed-action tests and complete API regression**

Run:

```bash
pnpm --filter @causality/api test -- data-check-action-service.test.ts
pnpm --filter @causality/api test:integration -- data-check-actions.integration.test.ts
pnpm --filter @causality/api test
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/data-checks/dataCheckActionService.ts apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts apps/api/test/data-check-action-service.test.ts apps/api/test/data-check-actions.integration.test.ts
git commit -m "fix: complete fixed data-check actions"
```

---

### Task 6: Build the four-column inline issue list

**Files:**
- Create: `apps/web/src/features/data-maintenance/DataCheckIssueSource.tsx`
- Create: `apps/web/src/features/data-maintenance/DataCheckExpandedRow.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataCheckIssueTable.tsx`
- Modify: `apps/web/src/features/data-maintenance/useDataCheckQueryState.ts`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: readable issue list items from Task 2.
- Produces: `expanded` URL state and one inline expanded row.
- Produces: source rendering for all five display kinds.
- Consumed by: Task 7.

- [ ] **Step 1: Write failing list structure tests**

```tsx
expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
  '严重程度',
  '问题类型',
  '问题来源',
  '处理入口',
]);

expect(screen.queryByRole('columnheader', { name: '问题描述' })).not.toBeInTheDocument();
expect(screen.queryByRole('columnheader', { name: '处理建议' })).not.toBeInTheDocument();
expect(screen.queryByText(targetId)).not.toBeInTheDocument();
```

Assert event/case links, relation arrow links, broken-reference copy, and always-on `OverflowText`.

- [ ] **Step 2: Write failing expansion-state tests**

```tsx
fireEvent.click(screen.getAllByRole('button', { name: '展开' })[0]!);
expect(router.state.location.search).toContain(`expanded=${issueA.id}`);
expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');

fireEvent.click(screen.getAllByRole('button', { name: '展开' })[0]!);
expect(router.state.location.search).toContain(`expanded=${issueB.id}`);
expect(screen.queryByTestId(`expanded-${issueA.id}`)).not.toBeInTheDocument();
```

Also assert filter/page changes remove `expanded`, and handled rows render `已处理` with no button.

- [ ] **Step 3: Run Web tests to verify failure**

Run:

```bash
pnpm --filter @causality/web test -- DataMaintenance.test.tsx
```

Expected: FAIL because the list still has three columns and opens a dialog.

- [ ] **Step 4: Replace issue modal URL state with relation-style expansion**

Expose:

```ts
interface DataCheckQueryState {
  page: number;
  severity: DataCheckSeverity | '';
  issueType: DataCheckIssueType | '';
  status: DataCheckIssueStatus | '';
  expandedId: string | null;
  changePage(page: number): void;
  changeSeverity(value: DataCheckSeverity | ''): void;
  changeIssueType(value: DataCheckIssueType | ''): void;
  changeStatus(value: DataCheckIssueStatus | ''): void;
  toggleExpanded(issueId: string): void;
  clearExpanded(): void;
  resetForSnapshot(): void;
}
```

Use `expanded`, not `issue` or `recheck`. Filter/page changes clear it. Use replace navigation exactly as `RelationListPage`.

- [ ] **Step 5: Implement source rendering**

`DataCheckIssueSource` switches only on `source.displayKind`:

```tsx
switch (source.displayKind) {
  case 'single':
    return <SingleSource source={source} />;
  case 'pair':
    return <PairSource source={source} />;
  case 'relation':
    return <RelationSource source={source} />;
  case 'owned_value':
    return <OwnedValueSource source={source} />;
  case 'broken_reference':
    return <BrokenReferenceSource source={source} />;
}
```

All text items are wrapped in `OverflowText mode="always"`. Only non-null internal detail paths render `Link`.

- [ ] **Step 6: Render the inline row**

Use a `Fragment` per item:

```tsx
<Fragment key={issue.id}>
  <tr className={expandedId === issue.id ? 'data-check-row--expanded' : undefined}>
    <td><SeverityBadge severity={issue.severity} /></td>
    <td>{issueTypeLabel(issue.issueType)}</td>
    <td><DataCheckIssueSource source={issue.source} /></td>
    <td>{issue.status === 'handled' ? <span>已处理</span> : <ExpandButton />}</td>
  </tr>
  {expandedId === issue.id ? (
    <tr className="data-check-expanded-row">
      <td colSpan={4}><DataCheckExpandedRow issue={issue} snapshotId={snapshotId} /></td>
    </tr>
  ) : null}
</Fragment>
```

- [ ] **Step 7: Run list tests, typecheck, and build**

Run:

```bash
pnpm --filter @causality/web test -- DataMaintenance.test.tsx
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: PASS; build may retain the existing causal-graph chunk-size advisory only.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/data-maintenance apps/web/src/styles/global.css
git commit -m "feat: add inline data-check issue rows"
```

---

### Task 7: Implement the five inline treatment panels

**Files:**
- Create: `apps/web/src/features/data-maintenance/DataCheckIssueSummary.tsx`
- Create: `apps/web/src/features/data-maintenance/DataCheckActionPlan.tsx`
- Create: `apps/web/src/features/data-maintenance/DataCheckMergePlan.tsx`
- Create: `apps/web/src/features/data-maintenance/DataCheckActionError.tsx`
- Create: `apps/web/src/features/data-maintenance/useDataCheckIssueAction.ts`
- Modify: `apps/web/src/features/data-maintenance/DataCheckExpandedRow.tsx`
- Modify: `apps/web/src/features/data-maintenance/dataMaintenanceApi.ts`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.tsx`
- Delete: `apps/web/src/features/data-maintenance/DataCheckIssueDialog.tsx`
- Delete: `apps/web/src/features/data-maintenance/DataCheckMergeDialog.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: five panel kinds and server action keys from Tasks 1, 3-5.
- Produces: inline loading, plan selection, submission, failure, stale, and success behavior.
- Consumed by: Task 8.

- [ ] **Step 1: Write failing five-panel tests**

Assert exact action differences:

```tsx
expect(within(mergePanel).getAllByRole('radio')).toHaveLength(2);
expect(within(mergePanel).getByRole('button', { name: '确认处理' })).toBeDisabled();

expect(within(cleanupPanel).queryByRole('radio')).not.toBeInTheDocument();
expect(within(cleanupPanel).getByRole('button', { name: '确认处理' })).toBeEnabled();

expect(within(manualPanel).queryByRole('button', { name: '确认处理' })).not.toBeInTheDocument();
expect(within(manualPanel).getByRole('button', { name: '忽略此问题' })).toBeEnabled();
expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
```

Every panel contains only `问题描述` and `处理建议` as fixed sections.

- [ ] **Step 2: Write failing state tests**

Cover:

- loading skeleton and disabled operations;
- selecting one merge direction renders that action’s impact and enables confirm;
- confirm is immediately before ignore;
- pending buttons are locked and toggle expansion is disabled;
- API failure retains the expanded row and selected direction;
- stale/conflict response disables old actions and says to use top-level `检查数据`;
- success under open filter removes the row;
- success under all/handled filter renders static handled state.

- [ ] **Step 3: Run focused tests to verify failure**

Run:

```bash
pnpm --filter @causality/web test -- DataMaintenance.test.tsx
```

Expected: FAIL because inline treatment components do not exist.

- [ ] **Step 4: Update API requests**

Delete recheck imports and implement:

```ts
export async function applyDataCheckAction(
  issueId: string,
  request: DataCheckActionRequest,
): Promise<DataCheckActionResponse> {
  return dataCheckActionResponseSchema.parse(
    await requestJson(`/api/data-checks/issues/${issueId}/actions`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  );
}
```

For automatic actions, `requestFor` copies the server action’s `actionKey`. Ignore submits only `snapshotId`.

- [ ] **Step 5: Implement focused panel components**

`DataCheckExpandedRow` dispatches by `context.panelKind`:

```tsx
<DataCheckIssueSummary description={issue.description} suggestion={issue.suggestion} />
{context.panelKind === 'merge' ? <DataCheckMergePlan ... /> : null}
{context.panelKind !== 'merge' && automaticAction ? (
  <DataCheckActionPlan action={automaticAction} />
) : null}
<DataCheckPanelActions
  confirmAction={selectedOrFixedAction}
  ignoreAction={ignoreAction}
  pending={mutation.isPending}
/>
```

Manual panels have `confirmAction={null}`. Fixed plans render current impact in readable labels. Merge starts with no selection.

- [ ] **Step 6: Implement mutation state and invalidation**

`useDataCheckIssueAction` retains selected action in the expanded component and exposes:

```ts
interface DataCheckIssueActionState {
  pending: boolean;
  error: string | null;
  stale: boolean;
  apply(action: DataCheckActionOption): void;
}
```

On success, invalidate:

- latest check summary and issue pages;
- event/case/relation lists and candidates;
- affected detail and association queries;
- causal graph queries.

Only clear `expanded` after the mutation has succeeded.

- [ ] **Step 7: Remove dialog implementation**

Delete both dialog components and all dialog CSS. Remove dialog rendering from `DataMaintenance`. Do not change the shared `AppDialog`, which remains used elsewhere.

- [ ] **Step 8: Run Web tests, typecheck, and build**

Run:

```bash
pnpm --filter @causality/web test -- DataMaintenance.test.tsx
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/data-maintenance apps/web/src/styles/global.css
git commit -m "feat: add inline data-check treatment panels"
```

---

### Task 8: Remove data-check edit-return state and complete regression

**Files:**
- Modify: `apps/web/src/shared/navigation/listReturn.ts`
- Modify: `apps/web/src/shared/navigation/listReturn.test.ts`
- Modify: `apps/web/src/features/events/pages/EventEditPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventPages.test.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseEditPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.test.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.test.tsx`
- Modify: `docs/superpowers/plans/2026-07-27-p2-03-batch-import-export-data-governance.md`

**Interfaces:**
- Removes: `DataCheckReturnState`, `createDataCheckEditReturnState`, `getDataCheckReturnState`, and recheck-aware `resolveRecordReturnTarget`.
- Preserves: all ordinary list/detail return behavior.
- Produces: a clean Task 12 replacement ready for manual review.

- [ ] **Step 1: Replace data-check return tests with normal navigation regression**

Delete data-check-specific cases and retain:

```ts
expect(resolveRecordReturnTarget(
  { listReturnPath: '/events?page=3', listFocusId: eventId },
  '/events',
  1,
)).toEqual({ path: '/events?page=3' });

expect(resolveRecordReturnTarget(
  { listReturnPath: 'https://evil.example' },
  '/events',
  2,
)).toEqual({ path: '/events?page=2' });
```

Assert no return result includes `dataCheck` or `recheck`.

- [ ] **Step 2: Run navigation/page tests to verify failure**

Run:

```bash
pnpm --filter @causality/web test -- listReturn.test.ts EventPages.test.tsx CasePages.test.tsx RelationEditPage.test.tsx
```

Expected: FAIL until obsolete data-check branches and page expectations are removed.

- [ ] **Step 3: Simplify navigation helpers and edit pages**

Return the normal shape only:

```ts
export function resolveRecordReturnTarget(
  state: unknown,
  normalBasePath: string,
  fallbackPage: number,
): { path: string } {
  const candidate = stateRecord(state)?.listReturnPath;
  return {
    path:
      typeof candidate === 'string' && isSafeReturnPath(candidate, normalBasePath)
        ? candidate
        : buildListPath(normalBasePath, fallbackPage),
  };
}
```

Remove data-check imports and special save/cancel state from all three edit pages. Preserve ordinary list return and focus behavior unchanged.

- [ ] **Step 4: Remove obsolete backend types and imports**

Run:

```bash
rg -n "DataCheckReturnState|createDataCheckEditReturnState|getDataCheckReturnState|recheckDataCheckIssue|DataCheckRecheckResponse|open_edit|DataCheckIssueDialog|DataCheckMergeDialog" apps packages
```

Expected: no runtime references. Test names that assert absence are acceptable; stale implementations are not.

- [ ] **Step 5: Run the complete automated suite**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @causality/api test:integration
pnpm build
pnpm data-check:benchmark
git diff --check
```

Expected:

- all tests pass;
- no TypeScript or ESLint errors;
- production builds pass;
- only the existing causal-graph chunk-size advisory may remain;
- benchmark stays within its existing acceptance thresholds.

- [ ] **Step 6: Update the parent P2-03 plan**

Mark original Task 12 as superseded by this approved inline design and link:

```markdown
> Superseded by `docs/superpowers/specs/2026-07-27-data-maintenance-inline-issue-handling-design.md`
> and `docs/superpowers/plans/2026-07-27-data-maintenance-inline-issue-handling.md`.
```

Do not rewrite unrelated completed P2-03 tasks.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shared/navigation apps/web/src/features/events/pages apps/web/src/features/cases/pages apps/web/src/features/relations/pages apps/web/src/features/data-maintenance/DataMaintenance.test.tsx docs/superpowers/plans/2026-07-27-p2-03-batch-import-export-data-governance.md
git commit -m "refactor: remove data-check edit returns"
```

- [ ] **Step 8: Browser verification**

Use the in-app browser at the normal desktop viewport and verify:

1. Four list columns and readable source links;
2. all five panel templates;
3. one-row expansion and URL `expanded`;
4. filters/page clear expansion;
5. merge direction selection and impact;
6. fixed-plan confirmation;
7. manual panels only show ignore;
8. pending action locks the row;
9. forced API failure retains panel and selection;
10. success behavior under open/all/handled filters;
11. source links open the correct detail page;
12. browser back returns normally without special edit-return behavior;
13. browser console has no warnings or errors.

Do not execute destructive merge/delete against user data. Use isolated integration fixtures or a disposable development record for mutation verification.

- [ ] **Step 9: Request manual review**

Ask the user to manually verify the same five panel templates, source links, transaction error presentation, and page/filter behavior before proceeding to the next P2-03 task.
