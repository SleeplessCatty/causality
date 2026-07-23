# P2-01 Data Cleanup, Safe Deletion, and Integrity Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe permanent deletion for all three main records, manually refreshed orphan statistics, and a PostgreSQL-backed asynchronous integrity check with paged issue handling.

**Architecture:** Existing event, relation, and case modules keep ownership of resource deletion and hidden list filters. A new data-check module owns the singleton task state, current successful snapshot, rule execution, and issue handling; it runs inside the API process and uses PostgreSQL state plus an advisory lock instead of a new queue or worker service. The system status page remains the only maintenance UI.

**Tech Stack:** TypeScript 6.0.2, React 19.2.7, TanStack Query 5.101.3, Fastify 5.10.0, Zod 4.4.3, PostgreSQL 18.4, Drizzle ORM 0.45.2, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- The approved design is `docs/stages/phase-2/P2-01-data-cleanup-safe-deletion-integrity-design.md`.
- Deletion is permanent. Do not add `deleted_at`, archive state, recovery, or history tables.
- Event deletion is blocked by any cause/effect relation reference.
- Relation deletion preserves events and cases; case deletion preserves relations.
- Deletion dialogs show only whether associations exist, never association names, counts, or lists.
- Only deletion of the three main records requires confirmation; safe issue auto-handling does not.
- Data checks run only after a user action, with at most one task at a time.
- Keep only the current successful snapshot and latest attempt/failure state.
- A failed check never overwrites the current successful snapshot.
- Orphan counts are informational and never become integrity issues.
- Issue tables show exactly three columns and page at 50 rows.
- Do not add bulk repair, permanent warning exceptions, fuzzy duplicate detection, AI, or subjective quality rules.
- Use the existing compact desktop visual language and existing three-second transient error behavior.
- Keep every implementation commit local. Do not push GitHub during P2.

---

## File Map

### Shared contracts

- Create `packages/contracts/src/maintenance/deletionSchemas.ts` — deletion-impact and deletion-result schemas.
- Create `packages/contracts/src/data-checks/dataCheckSchemas.ts` — task, snapshot, issue, filter, and handling schemas.
- Modify `packages/contracts/src/events/eventSchemas.ts` — `orphan` list query.
- Modify `packages/contracts/src/relations/relationSchemas.ts` — `orphan` and `eventId` list query.
- Modify `packages/contracts/src/cases/caseSchemas.ts` — `orphan` list query.
- Modify `packages/contracts/src/pagination/pageSchemas.ts` — shared explicit boolean query parser.
- Modify `packages/contracts/src/index.ts` — public exports.
- Create `packages/contracts/test/maintenance.test.ts`.
- Create `packages/contracts/test/data-checks.test.ts`.
- Modify `packages/contracts/test/events.test.ts`.
- Modify `packages/contracts/test/relations.test.ts`.
- Modify `packages/contracts/test/cases.test.ts`.

### Database

- Create `apps/api/src/database/schema/dataCheckState.ts` — singleton attempt and snapshot summary.
- Create `apps/api/src/database/schema/dataCheckIssues.ts` — current snapshot issue rows.
- Modify `apps/api/src/database/schema/index.ts`.
- Create `database/migrations/0007_data_cleanup_integrity.sql`.
- Create `database/migrations/meta/0007_snapshot.json`.
- Modify `database/migrations/meta/_journal.json`.

### Event, relation, and case API

- Modify each resource repository, service, and route file under `apps/api/src/features/{events,relations,cases}`.
- Modify `apps/api/test/{event-service,relation-service,case-service}.test.ts`.
- Modify `apps/api/test/{events,relations,cases}.integration.test.ts`.

### Deletion UI

- Create `apps/web/src/shared/deletion/DeleteRecordDialog.tsx`.
- Create `apps/web/src/shared/deletion/DeleteRecordDialog.test.tsx`.
- Modify the three resource API adapters and list pages.
- Modify the existing page tests and `apps/web/src/styles/events.css`.

### Data-check API

- Create `apps/api/src/features/data-checks/dataCheckTypes.ts`.
- Create `apps/api/src/features/data-checks/dataCheckRepository.ts`.
- Create `apps/api/src/features/data-checks/dataCheckRules.ts`.
- Create `apps/api/src/features/data-checks/dataCheckService.ts`.
- Create `apps/api/src/features/data-checks/dataCheckCoordinator.ts`.
- Create `apps/api/src/features/data-checks/dataCheckRoutes.ts`.
- Modify `apps/api/src/app.ts`.
- Create `apps/api/test/data-check-service.test.ts`.
- Create `apps/api/test/data-checks.integration.test.ts`.
- Create `apps/api/src/database/benchmark/dataCheckBenchmark.ts`.
- Create `apps/api/test/data-check-benchmark.test.ts`.
- Modify `apps/api/package.json` and root `package.json` with `data-check:benchmark`.
- Modify `apps/api/test/support/postgresTestContext.ts` to allow the isolated data-check database.

### Data maintenance, system status UI, and end-to-end verification

- Keep runtime status APIs and UI in `apps/web/src/features/system-status/`.
- Create `apps/web/src/features/data-maintenance/DataMaintenance.tsx`.
- Create `apps/web/src/features/data-maintenance/dataMaintenanceApi.ts`.
- Create `apps/web/src/features/data-maintenance/DataCheckPanel.tsx`.
- Create `apps/web/src/features/data-maintenance/DataCheckIssueTable.tsx`.
- Create `apps/web/src/features/data-maintenance/DataMaintenance.test.tsx`.
- Modify navigation and routing to expose `/maintenance` before `/system`.
- Modify `apps/web/src/styles/global.css`.
- Create `tests/e2e/data-maintenance.spec.ts`.
- Modify `tests/e2e/foundation.spec.ts`.
- Modify `tests/production/production-smoke.spec.ts`.
- Modify `README.md` after implementation to document deletion and manual checks.

---

### Task 1: Database schema and shared contracts

**Files:**

- Create: `packages/contracts/src/maintenance/deletionSchemas.ts`
- Create: `packages/contracts/src/data-checks/dataCheckSchemas.ts`
- Create: `packages/contracts/test/maintenance.test.ts`
- Create: `packages/contracts/test/data-checks.test.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/src/cases/caseSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/database/schema/dataCheckState.ts`
- Create: `apps/api/src/database/schema/dataCheckIssues.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Create: `database/migrations/0007_data_cleanup_integrity.sql`
- Create: `database/migrations/meta/0007_snapshot.json`
- Modify: `database/migrations/meta/_journal.json`
- Modify: `apps/api/test/core-model.integration.test.ts`
- Modify: `packages/contracts/test/events.test.ts`
- Modify: `packages/contracts/test/relations.test.ts`
- Modify: `packages/contracts/test/cases.test.ts`

**Interfaces:**

- Produces:

```ts
type EventDeletionImpact = { canDelete: boolean; hasRelations: boolean };
type RelationDeletionImpact = { canDelete: true; hasEvents: true; hasCases: boolean };
type CaseDeletionImpact = { canDelete: true; hasRelations: boolean };
type DeleteResult = { deleted: true };

type DataCheckRunStatus = 'never_run' | 'running' | 'succeeded' | 'failed';
type DataCheckSeverity = 'error' | 'warning';
type DataCheckActionMode = 'auto' | 'manual';
type DataCheckIssueStatus = 'open' | 'handled';

interface DataCheckSnapshotSummary {
  snapshotId: string;
  checkedAt: string;
  orphanEventCount: number;
  orphanRelationCount: number;
  orphanCaseCount: number;
  errorCount: number;
  warningCount: number;
  openCount: number;
  handledCount: number;
}

interface DataCheckLatestResponse {
  task: {
    status: DataCheckRunStatus;
    startedAt: string | null;
    finishedAt: string | null;
  };
  snapshot: DataCheckSnapshotSummary | null;
  latestFailure: { failedAt: string; message: string } | null;
}

interface DataCheckIssueListResponse {
  items: DataCheckIssue[];
  page: number;
  pageSize: 50;
  totalItems: number;
  totalPages: number;
}
```

- The three list query types gain `orphan: boolean`; relation lists also gain `eventId?: string`.
- Add stable API codes `EVENT_DELETE_BLOCKED`, `DATA_CHECK_ISSUE_NOT_FOUND`,
  `DATA_CHECK_ISSUE_STALE`, and `DATA_CHECK_AUTO_HANDLE_UNSAFE`.

- [x] **Step 1: Write failing contract tests**

Add exact expectations:

```ts
expect(eventDeletionImpactSchema.parse({ canDelete: false, hasRelations: true })).toEqual({
  canDelete: false,
  hasRelations: true,
});

expect(
  dataCheckIssueListQuerySchema.parse({
    page: '2',
    severity: 'warning',
    issueType: 'cross_event_alias',
    status: 'open',
  }),
).toMatchObject({ page: 2, severity: 'warning', status: 'open' });

expect(eventListQuerySchema.parse({ orphan: 'true' }).orphan).toBe(true);
expect(relationListQuerySchema.parse({ eventId: EVENT_ID }).eventId).toBe(EVENT_ID);
expect(caseListQuerySchema.parse({ orphan: 'false' }).orphan).toBe(false);
```

- [x] **Step 2: Run contract tests and verify failure**

Run:

```bash
pnpm --filter @causality/contracts test -- maintenance.test.ts data-checks.test.ts
```

Expected: FAIL because the maintenance and data-check schemas do not exist.

- [x] **Step 3: Implement deletion and data-check schemas**

Use strict Zod objects and the existing ISO timestamp convention. Define:

```ts
export const dataCheckIssueListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    severity: z.enum(['error', 'warning']).optional(),
    issueType: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['open', 'handled']).optional(),
  })
  .strict();

export const dataCheckIssueSchema = z
  .object({
    id: z.uuid(),
    snapshotId: z.uuid(),
    severity: z.enum(['error', 'warning']),
    issueType: z.string().min(1).max(80),
    description: z.string().min(1).max(300),
    suggestion: z.string().min(1).max(300),
    actionMode: z.enum(['auto', 'manual']),
    status: z.enum(['open', 'handled']),
    targetType: z.enum(['event', 'relation', 'case', 'alias', 'keyword', 'relation_case']),
    targetId: z.string().min(1).max(100),
    relatedId: z.string().min(1).max(100).nullable(),
    handledAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
```

Define task and latest response schemas so a failed latest attempt can coexist with
a non-null successful snapshot. Define both handling request schemas as a strict
`{ snapshotId: uuid }` body; this lets the API distinguish a stale issue from an
unknown issue without retaining old snapshots.
The issue-list service, rather than the query contract, fixes the page size at 50 and
returns that value in response pagination metadata.

- [x] **Step 4: Add hidden list query fields and exports**

Do not use `z.coerce.boolean()`, because JavaScript treats the string `"false"` as
truthy. Reuse this explicit query-string parser in all three list contracts:

```ts
const booleanQuerySchema = z
  .union([
    z.boolean(),
    z.enum(['true', 'false']).transform((value) => value === 'true'),
  ])
  .default(false);
```

Add optional UUID `eventId` only to relation queries. Extend the shared API error
enum with the four maintenance codes listed above. Export every schema and inferred
type from `packages/contracts/src/index.ts`.

- [x] **Step 5: Write failing migration assertions**

Extend `core-model.integration.test.ts` to assert:

```ts
expect(tableNames).toEqual(
  expect.arrayContaining(['data_check_state', 'data_check_issues']),
);
expect(stateRow).toMatchObject({
  singleton_key: true,
  status: 'never_run',
  last_snapshot_id: null,
});
```

Also assert that migrating an existing database preserves all current event, relation, case, alias, keyword, and relation-case counts.

- [x] **Step 6: Add Drizzle schema**

Use one boolean primary key with a check requiring `singleton_key = true`:

```ts
export const dataCheckState = pgTable('data_check_state', {
  singletonKey: boolean('singleton_key').primaryKey().default(true),
  status: varchar('status', { length: 20 }).notNull().default('never_run'),
  attemptStartedAt: timestamp('attempt_started_at', { withTimezone: true }),
  attemptFinishedAt: timestamp('attempt_finished_at', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  lastFailureMessage: varchar('last_failure_message', { length: 500 }),
  lastSnapshotId: uuid('last_snapshot_id'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  orphanEventCount: integer('orphan_event_count').notNull().default(0),
  orphanRelationCount: integer('orphan_relation_count').notNull().default(0),
  orphanCaseCount: integer('orphan_case_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  openCount: integer('open_count').notNull().default(0),
  handledCount: integer('handled_count').notNull().default(0),
});
```

Define `data_check_issues` with UUID primary key, snapshot UUID, severity/type/action/status fields, target metadata, description/suggestion, `handled_at`, and indexes:

```text
(snapshot_id, severity, issue_type, status, id)
(snapshot_id, status, id)
```

Add checks for enum-like values and non-negative counts.

- [x] **Step 7: Generate and inspect migration**

Run:

```bash
pnpm --filter @causality/api exec drizzle-kit generate \
  --config drizzle.config.ts \
  --name data_cleanup_integrity
```

Expected: `0007_data_cleanup_integrity.sql` and `0007_snapshot.json`.

Drizzle will generate the tables and metadata but will not seed the singleton. Append
this idempotent statement to the generated SQL:

```sql
insert into data_check_state (singleton_key)
values (true)
on conflict (singleton_key) do nothing;
```

Inspect the SQL. It must create only the two maintenance tables, indexes, checks, and
the singleton seed row. It must not alter or delete existing business data.

- [x] **Step 8: Run focused tests**

Run:

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test:integration -- core-model.integration.test.ts
pnpm typecheck
```

Expected: all pass.

- [x] **Step 9: Commit locally**

```bash
git add \
  packages/contracts/src/maintenance/deletionSchemas.ts \
  packages/contracts/src/data-checks/dataCheckSchemas.ts \
  packages/contracts/src/events/eventSchemas.ts \
  packages/contracts/src/relations/relationSchemas.ts \
  packages/contracts/src/cases/caseSchemas.ts \
  packages/contracts/src/index.ts \
  packages/contracts/test/maintenance.test.ts \
  packages/contracts/test/data-checks.test.ts \
  packages/contracts/test/events.test.ts \
  packages/contracts/test/relations.test.ts \
  packages/contracts/test/cases.test.ts \
  apps/api/src/database/schema/dataCheckState.ts \
  apps/api/src/database/schema/dataCheckIssues.ts \
  apps/api/src/database/schema/index.ts \
  apps/api/test/core-model.integration.test.ts \
  database/migrations/0007_data_cleanup_integrity.sql \
  database/migrations/meta/0007_snapshot.json \
  database/migrations/meta/_journal.json
git commit -m "feat: add P2 data maintenance contracts and schema"
```

Do not push.

**Execution result (2026-07-23):**

- Contract RED: 11 expected failures for missing schemas and query fields.
- Migration RED: 2 expected failures for missing maintenance tables and singleton state.
- GREEN: 41 contract tests and 58 integration tests passed; repository typecheck and lint passed.
- Migration `0007_data_cleanup_integrity` preserves existing business counts and seeds exactly one
  `never_run` state row.
- Existing flat page metadata was retained for consistency with all current list contracts.

---

### Task 2: Permanent deletion and hidden list filters

**Files:**

- Modify: `apps/api/src/features/events/eventRepository.ts`
- Modify: `apps/api/src/features/events/eventService.ts`
- Modify: `apps/api/src/features/events/eventRoutes.ts`
- Modify: `apps/api/src/features/relations/relationRepository.ts`
- Modify: `apps/api/src/features/relations/relationService.ts`
- Modify: `apps/api/src/features/relations/relationRoutes.ts`
- Modify: `apps/api/src/features/cases/caseRepository.ts`
- Modify: `apps/api/src/features/cases/caseService.ts`
- Modify: `apps/api/src/features/cases/caseRoutes.ts`
- Modify: `apps/api/test/event-service.test.ts`
- Modify: `apps/api/test/relation-service.test.ts`
- Modify: `apps/api/test/case-service.test.ts`
- Modify: `apps/api/test/events.integration.test.ts`
- Modify: `apps/api/test/relations.integration.test.ts`
- Modify: `apps/api/test/cases.integration.test.ts`

**Interfaces:**

- Consumes the deletion and query contracts from Task 1.
- Produces repository methods:

```ts
deletionImpact(id: string): Promise<... | null>;
delete(id: string): Promise<boolean>;
```

- Event deletion may throw `EVENT_DELETE_BLOCKED`.
- The existing `list()` methods honor `orphan` and relation `eventId`.

- [x] **Step 1: Add failing service tests**

Test exact cases:

```ts
await expect(service.delete(MISSING_ID)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
await expect(service.delete(LINKED_EVENT_ID)).rejects.toMatchObject({
  code: 'EVENT_DELETE_BLOCKED',
});
await expect(service.deletionImpact(UNLINKED_EVENT_ID)).resolves.toEqual({
  canDelete: true,
  hasRelations: false,
});
```

Add equivalent relation and case impact/delete tests, asserting their services do not request deletion of related main records.

- [x] **Step 2: Run service tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- event-service.test.ts relation-service.test.ts case-service.test.ts
```

Expected: FAIL because deletion methods and error codes are absent.

- [x] **Step 3: Add repository deletion transactions**

Event:

```sql
begin;
select id from abstract_events where id = $1 for update;
select exists(
  select 1 from causal_relations
  where cause_event_id = $1 or effect_event_id = $1
) as has_relations;
delete from abstract_events where id = $1;
commit;
```

Return blocked before the delete when `has_relations` is true.

Relation:

```sql
begin;
select id from causal_relations where id = $1 for update;
delete from causal_relation_cases where causal_relation_id = $1;
delete from causal_relations where id = $1;
commit;
```

Case:

```sql
begin;
select id from concrete_cases where id = $1 for update;
delete from causal_relation_cases where concrete_case_id = $1;
delete from concrete_cases where id = $1;
commit;
```

Always roll back on error and release the client.

- [x] **Step 4: Implement deletion-impact queries**

Return booleans only:

```sql
select e.id,
       exists(
         select 1 from causal_relations r
         where r.cause_event_id = e.id or r.effect_event_id = e.id
       ) as has_relations
from abstract_events e
where e.id = $1;
```

Relation impact returns `hasEvents: true` and an `exists` check for cases. Case impact returns an `exists` check for relations.

- [x] **Step 5: Implement hidden filters in all count and row queries**

For events:

```sql
and (
  $orphan = false
  or not exists (
    select 1 from causal_relations r
    where r.cause_event_id = e.id or r.effect_event_id = e.id
  )
)
```

For relations:

```sql
and ($orphan = false or not exists (
  select 1 from causal_relation_cases crc where crc.causal_relation_id = r.id
))
and ($event_id is null or r.cause_event_id = $event_id or r.effect_event_id = $event_id)
```

For cases:

```sql
and ($orphan = false or not exists (
  select 1 from causal_relation_cases crc where crc.concrete_case_id = c.id
))
```

Apply the same predicates to total counts, normal lists, and searched lists.

- [x] **Step 6: Add routes and stable errors**

Register the six impact/delete routes. Return:

```text
200 impact
200 { deleted: true }
404 *_NOT_FOUND
409 EVENT_DELETE_BLOCKED
```

Extend the shared API error enum with `EVENT_DELETE_BLOCKED`.

- [x] **Step 7: Add integration tests**

Assert:

- linked event impact is blocked and DELETE returns 409;
- a relation inserted after the impact request but before DELETE still blocks event deletion;
- unlinked event deletion cascades aliases and keywords;
- relation deletion removes only relation-case rows and relation;
- case deletion removes only relation-case rows and case;
- none of the three deletion operations changes the saved data-check snapshot;
- deleting an already-removed record returns 404 without changing any related record;
- `orphan=true` totals, search, page clamping, and rows match;
- `eventId` returns both incoming and outgoing relations;
- `orphan=true&eventId=<id>&q=<term>` composes correctly.

Run `EXPLAIN (ANALYZE, BUFFERS)` assertions for the orphan and `eventId` predicates
against a deterministic fixture. Add a migration index only when the plan proves an
existing index is insufficient; record the expected index name in the test instead
of accepting any sequential scan silently.

- [x] **Step 8: Run focused and integration tests**

Run:

```bash
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration -- events.integration.test.ts relations.integration.test.ts cases.integration.test.ts
pnpm typecheck
```

Expected: all pass.

- [x] **Step 9: Commit locally**

```bash
git add \
  apps/api/src/features/events/eventRepository.ts \
  apps/api/src/features/events/eventService.ts \
  apps/api/src/features/events/eventRoutes.ts \
  apps/api/src/features/relations/relationRepository.ts \
  apps/api/src/features/relations/relationService.ts \
  apps/api/src/features/relations/relationRoutes.ts \
  apps/api/src/features/cases/caseRepository.ts \
  apps/api/src/features/cases/caseService.ts \
  apps/api/src/features/cases/caseRoutes.ts \
  apps/api/test/event-service.test.ts \
  apps/api/test/relation-service.test.ts \
  apps/api/test/case-service.test.ts \
  apps/api/test/events.integration.test.ts \
  apps/api/test/relations.integration.test.ts \
  apps/api/test/cases.integration.test.ts
git commit -m "feat: add safe permanent deletion and orphan filters"
```

Do not push.

**Execution result (2026-07-23):**

- Service RED: 4 expected failures for absent deletion operations.
- Integration RED: 10 expected failures for absent routes and hidden filters.
- GREEN: 86 API unit tests and 67 integration tests passed; typecheck, lint, format, and
  diff checks passed.
- Event deletion is transactionally blocked after concurrent relation creation; relation and case
  deletion remove only association rows and the requested main record.
- Existing directional and relation-case indexes satisfy `orphan` and `eventId` query plans, so no
  speculative index was added.

---

### Task 3: Deletion UI on the three lists

**Files:**

- Create: `apps/web/src/shared/deletion/DeleteRecordDialog.tsx`
- Create: `apps/web/src/shared/deletion/DeleteRecordDialog.test.tsx`
- Create: `apps/web/src/shared/deletion/usePermanentDeletion.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/test/events.test.ts`
- Modify: `apps/api/src/features/events/eventRepository.ts`
- Modify: `apps/api/test/events.integration.test.ts`
- Modify: `apps/web/src/features/events/api/eventApi.ts`
- Modify: `apps/web/src/features/relations/api/relationApi.ts`
- Modify: `apps/web/src/features/cases/api/caseApi.ts`
- Modify: `apps/web/src/features/events/pages/EventListPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventListPage.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.test.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseListPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/styles/events.css`

**Interfaces:**

```ts
interface DeleteRecordDialogProps {
  open: boolean;
  title: string;
  message: string;
  blocked: boolean;
  pending: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
  blockedAction?: { label: string; href: string };
}
```

Resource API adapters produce `get*DeletionImpact(id)` and `delete*(id)`.

- [x] **Step 1: Write failing dialog tests**

Cover:

```ts
expect(screen.queryByRole('list')).toBeNull();
expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled();
expect(screen.getByRole('link', { name: '查看相关因果关系' })).toHaveAttribute(
  'href',
  `/relations?eventId=${EVENT_ID}`,
);
```

Verify blocked mode has no confirm button, Escape/cancel closes, pending disables actions, and an error stays in the existing dialog position.

- [x] **Step 2: Run dialog tests and verify failure**

Run:

```bash
pnpm --filter @causality/web test -- DeleteRecordDialog.test.tsx
```

Expected: FAIL because the component is absent.

- [x] **Step 3: Implement the shared dialog**

Use a native accessible modal pattern with:

```tsx
<div role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
  <h2 id="delete-dialog-title">{title}</h2>
  <p>{message}</p>
  {error ? <div role="alert">{error}</div> : null}
  <button type="button" onClick={onCancel}>取消</button>
  {blockedAction ? <Link to={blockedAction.href}>{blockedAction.label}</Link> : null}
  {!blocked ? (
    <button className="button button--danger" type="button" onClick={onConfirm}>
      确认删除
    </button>
  ) : null}
</div>
```

Do not render names, counts, lists, or record previews.

- [x] **Step 4: Add API adapter functions**

Use `requestJson`, parse shared schemas, and send `DELETE`:

```ts
export async function deleteEvent(id: string): Promise<DeleteResult> {
  return deleteResultSchema.parse(
    await requestJson(`/api/events/${id}`, { method: 'DELETE' }),
  );
}
```

Implement the corresponding impact functions and relation/case variants.

- [x] **Step 5: Add delete state to each list**

Each page tracks only the selected resource ID, impact state, and transient error. Include `orphan` or `eventId` in the TanStack Query key and API call.

After success:

```ts
await queryClient.invalidateQueries({ queryKey: ['events', 'list'] });
setDeleteTargetId(null);
```

Let the existing server-clamped page effect move to the previous page when necessary.

- [x] **Step 6: Add exact resource copy**

Event, deletable:

```text
确认永久删除这个原子事件？此操作无法恢复。
```

Event, blocked:

```text
这个原子事件存在关联因果关系，必须先删除相关因果关系。
```

Relation:

```text
该因果关系关联原子事件，并且{有/没有}关联具体案例。删除只会移除因果关系及其关联，不会删除事件或案例。
```

Case:

```text
该具体案例{有/没有}关联因果关系。删除只会移除案例及其关联，不会删除因果关系。
```

- [x] **Step 7: Extend list page tests**

Verify delete follows edit, impact loads before dialog, no association details render, blocked event links to `eventId`, success refreshes the same filtered query, and API errors auto-dismiss after three seconds.
Also verify a 404 closes the dialog and refreshes the list, while a 409 returned after
an initially deletable impact switches the event dialog into its blocked state.

- [x] **Step 8: Run Web tests**

Run:

```bash
pnpm --filter @causality/web test
pnpm typecheck
```

Expected: all pass.

- [x] **Step 9: Manual checkpoint**

Start the development app and ask the user to verify:

- delete placement on all three lists;
- all four dialog states;
- event blocked navigation;
- current search/page preservation;
- no association lists or counts in dialogs.

Do not continue until the user confirms this checkpoint.

- [x] **Step 10: Commit locally**

```bash
git add \
  packages/contracts/src/events/eventSchemas.ts \
  packages/contracts/test/events.test.ts \
  apps/api/src/features/events/eventRepository.ts \
  apps/api/test/events.integration.test.ts \
  apps/web/src/shared/deletion/DeleteRecordDialog.tsx \
  apps/web/src/shared/deletion/DeleteRecordDialog.test.tsx \
  apps/web/src/shared/deletion/usePermanentDeletion.ts \
  apps/web/src/features/events/api/eventApi.ts \
  apps/web/src/features/events/pages/EventListPage.tsx \
  apps/web/src/features/events/pages/EventListPage.test.tsx \
  apps/web/src/features/relations/api/relationApi.ts \
  apps/web/src/features/relations/pages/RelationListPage.tsx \
  apps/web/src/features/relations/pages/RelationListPage.test.tsx \
  apps/web/src/features/cases/api/caseApi.ts \
  apps/web/src/features/cases/pages/CaseListPage.tsx \
  apps/web/src/features/cases/pages/CasePages.test.tsx \
  apps/web/src/styles/events.css
git commit -m "feat: add list deletion workflows"
```

Do not push.

**Execution result before manual checkpoint (2026-07-23):**

- Dialog RED: the shared deletion component was absent as expected.
- List RED: 4 expected failures for absent delete actions and workflows.
- GREEN: 37 Web test files and 181 tests passed; Web and workspace typecheck passed.
- The shared workflow treats delete-time 404 as an idempotent success, changes an event dialog
  to blocked mode on a concurrent 409, and auto-dismisses request errors after three seconds.
- Hidden `orphan`, `eventId`, `relationId`, search, and page parameters remain part of the active
  list query; dialogs contain no association names, counts, or lists.
- The event list now includes a relation count sourced from the same incoming/outgoing relation
  predicate as event detail; its contract, repository query, integration test, and table UI pass.
- Review follow-ups add a modal Tab focus loop, accurate hidden-filter empty states, and stale
  deletion-impact response protection; candidate search avoids unused relation-count work.
- Manual checkpoint approved by the user on 2026-07-23.

---

### Task 4: Asynchronous data-check backend and integrity rules

**Files:**

- Create: `apps/api/src/features/data-checks/dataCheckTypes.ts`
- Create: `apps/api/src/features/data-checks/dataCheckRepository.ts`
- Create: `apps/api/src/features/data-checks/dataCheckRules.ts`
- Create: `apps/api/src/features/data-checks/dataCheckService.ts`
- Create: `apps/api/src/features/data-checks/dataCheckCoordinator.ts`
- Create: `apps/api/src/features/data-checks/dataCheckRoutes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/data-check-service.test.ts`
- Create: `apps/api/test/data-checks.integration.test.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`
- Create: `apps/api/src/database/benchmark/dataCheckBenchmark.ts`
- Create: `apps/api/test/data-check-benchmark.test.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**

```ts
interface DataCheckRule {
  readonly issueType: string;
  scan(client: PoolClient, snapshotId: string): Promise<DataCheckIssueDraft[]>;
}

interface DataCheckCoordinator {
  start(): Promise<DataCheckLatestResponse>;
  latest(): Promise<DataCheckLatestResponse>;
  listIssues(query: DataCheckIssueListQuery): Promise<DataCheckIssueListResponse>;
  autoHandle(issueId: string, snapshotId: string): Promise<DataCheckIssue>;
  manualHandle(issueId: string, snapshotId: string): Promise<DataCheckIssue>;
  recoverInterrupted(): Promise<void>;
}
```

- [x] **Step 1: Write failing coordinator unit tests**

Use repository and rule-runner fakes to assert:

```ts
await Promise.all([coordinator.start(), coordinator.start()]);
expect(repository.tryStart).toHaveBeenCalledTimes(2);
expect(ruleRunner.run).toHaveBeenCalledTimes(1);
```

Also assert success replacement, failure retention, interrupted recovery, manual handling, and auto-handler revalidation branches.

- [x] **Step 2: Run unit tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- data-check-service.test.ts
```

Expected: FAIL because the data-check module is absent.

- [x] **Step 3: Implement singleton task coordination**

`tryStart()` performs one transaction:

```sql
select pg_try_advisory_xact_lock(2026072301) as acquired;
select status from data_check_state where singleton_key = true for update;
update data_check_state
set status = 'running',
    attempt_started_at = clock_timestamp(),
    attempt_finished_at = null
where singleton_key = true;
```

If the lock is not acquired or state is running, return the current task instead of creating another.

Track the background promise in the coordinator so Fastify can observe it during shutdown without exposing it through the HTTP interface.

- [x] **Step 4: Implement consistent snapshot scanning**

Run orphan counts and all rules through one client:

```sql
begin transaction isolation level repeatable read read only;
```

Commit the read transaction after collecting drafts. Then use a separate write transaction to replace the snapshot and issues atomically.

- [x] **Step 5: Implement the deterministic rule catalog**

Create one `DataCheckRule` per rule family:

```text
missing_required_references
relation_self_loop
relation_confidence_range
duplicate_relation_direction
duplicate_event_name
duplicate_case_content
duplicate_event_alias
duplicate_event_keyword
invalid_required_text
invalid_optional_text
invalid_keyword_position
invalid_timestamp_order
cross_event_alias_name
cross_event_shared_alias
```

The first twelve produce errors. The final two produce warnings. Do not emit orphan issues, reverse-relation issues, fuzzy matches, or subjective quality issues.

- [x] **Step 6: Implement issue drafts with compact copy**

Each rule returns only:

```ts
{
  severity,
  issueType,
  targetType,
  targetId,
  relatedId,
  description,
  suggestion,
  actionMode,
}
```

Descriptions and suggestions must be at most 300 characters and must not contain HTML. Web builds links from target metadata.

- [x] **Step 7: Implement auto and manual handling**

Auto handlers exist only for:

```text
delete_missing_alias
delete_missing_keyword
delete_missing_relation_case
delete_duplicate_alias
delete_duplicate_keyword
resequence_keywords
```

In one transaction, lock the issue, verify it belongs to the current snapshot and is open, recheck the target, apply the safe change when needed, set `handled_at`, and update summary counts.

Manual handling only updates issue status/counts. Re-running the check can rediscover unchanged data.
Both handlers compare the request body's `snapshotId` to the singleton's current
snapshot before selecting the issue. Return 409 `DATA_CHECK_ISSUE_STALE` for an old
snapshot, 404 `DATA_CHECK_ISSUE_NOT_FOUND` for an unknown ID in the current snapshot,
and 409 `DATA_CHECK_AUTO_HANDLE_UNSAFE` when revalidation makes an automatic change
unsafe. Repeating manual handling for an already-handled current issue returns the
unchanged issue successfully.

- [x] **Step 8: Add routes and lifecycle hook**

Register exactly:

```text
POST /api/data-checks
GET  /api/data-checks/latest
GET  /api/data-checks/latest/issues
POST /api/data-checks/issues/:issueId/auto-handle
POST /api/data-checks/issues/:issueId/manual-handle
```

`POST /api/data-checks` returns 202 both when it starts work and when it attaches to
the already-running task. Add a Fastify `onReady` hook that calls
`recoverInterrupted()` and an `onClose` hook that waits only for the coordinator's
currently tracked promise.

- [x] **Step 9: Write isolated integration tests**

Add `causality_data_checks_test` to the allowlist.

Test normal route/coordinator behavior only with schema-valid fixtures. Test rules
that detect impossible-in-normal-operation corruption directly through one dedicated
`PoolClient` and a transaction that always rolls back:

```sql
begin;
set session_replication_role = replica;
-- insert broken child/reference rows
-- invoke the rule scan on this same PoolClient
rollback;
```

For check/unique violations, drop the relevant constraint or unique index inside the
same rollback-only transaction, insert the invalid row, and invoke the rule scan on
that same `PoolClient`. PostgreSQL rolls the DDL and fixture changes back together.
Use `afterEach` cleanup that issues `rollback` defensively and restores
`session_replication_role = origin` before releasing the client. Do not add
production table-name parameters or test-only query branches.

Assert every rule, pagination/filtering, one-running-task behavior, snapshot replacement, failed-attempt retention, restart recovery, and both handling modes.

- [x] **Step 10: Add the benchmark command**

Add:

```json
"data-check:benchmark": "tsx src/database/benchmark/dataCheckBenchmark.ts"
```

The root command uses the same Docker/Testcontainers environment setup as `graph:benchmark`. Generate 100,000 events, 500,000 relations, and 100,000 cases, run one complete check, print per-rule and total milliseconds, and fail when total duration exceeds 30,000 ms.

- [x] **Step 11: Run focused, integration, and benchmark tests**

Run:

```bash
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration -- data-checks.integration.test.ts
pnpm data-check:benchmark
pnpm typecheck
```

Expected: all pass; benchmark total is at most 30 seconds.

- [x] **Step 12: Commit locally**

```bash
git add \
  apps/api/src/features/data-checks/dataCheckTypes.ts \
  apps/api/src/features/data-checks/dataCheckRepository.ts \
  apps/api/src/features/data-checks/dataCheckRules.ts \
  apps/api/src/features/data-checks/dataCheckService.ts \
  apps/api/src/features/data-checks/dataCheckCoordinator.ts \
  apps/api/src/features/data-checks/dataCheckRoutes.ts \
  apps/api/src/app.ts \
  apps/api/test/data-check-service.test.ts \
  apps/api/test/data-checks.integration.test.ts \
  apps/api/test/data-check-benchmark.test.ts \
  apps/api/test/support/postgresTestContext.ts \
  apps/api/src/database/benchmark/dataCheckBenchmark.ts \
  apps/api/package.json \
  package.json
git commit -m "feat: add asynchronous integrity checks"
```

Do not push.

**Execution result (2026-07-23):**

- Coordinator and scanner RED tests failed because the data-check modules were absent, then passed
  after implementing single-task coordination and one repeatable-read snapshot.
- The deterministic catalog contains all 14 approved rule families; impossible normal-operation
  corruption is exercised in rollback-only transactions without production test branches.
- Snapshot replacement, failure retention, restart recovery, fixed 50-row pagination, all six
  automatic actions, vanished targets, unsafe revalidation, stale snapshots, and idempotent manual
  handling pass database integration coverage.
- API unit suite: 14 files and 96 tests passed.
- API integration suite: 8 files and 75 tests passed.
- The 100,000-event, 500,000-relation, 100,000-case benchmark completed one full check in
  2,483.48 ms against the 30,000 ms target; the slowest rule completed in 320.51 ms.
- Workspace typecheck, lint, formatting, and diff checks passed.

---

### Task 5: Data maintenance, system status restoration, and issue handling UI

**Files:**

- Modify: `apps/web/src/features/system-status/systemStatusApi.ts`
- Modify: `apps/web/src/features/system-status/SystemStatus.tsx`
- Modify: `apps/web/src/features/system-status/SystemStatus.test.tsx`
- Create: `apps/web/src/features/data-maintenance/DataMaintenance.tsx`
- Create: `apps/web/src/features/data-maintenance/dataMaintenanceApi.ts`
- Create: `apps/web/src/features/data-maintenance/DataCheckPanel.tsx`
- Create: `apps/web/src/features/data-maintenance/DataCheckIssueTable.tsx`
- Create: `apps/web/src/features/data-maintenance/DataMaintenance.test.tsx`
- Create: `apps/web/src/shared/controls/AppSelect.tsx`
- Create: `apps/web/src/shared/controls/AppSelect.test.tsx`
- Modify: `apps/web/src/app/AppSidebar.tsx`
- Modify: `apps/web/src/app/AppSidebar.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- `/maintenance` is the standalone data-maintenance route and precedes `/system` in navigation.
- `/system` retains only API/PostgreSQL status and the original “重新检查” action.
- `DataCheckPanel` consumes `DataCheckLatestResponse`.
- `DataCheckIssueTable` owns issue page/filter URL-independent UI state and calls auto/manual handle mutations.
- Running state polls `GET /api/data-checks/latest`; succeeded/failed/never-run states do not poll.

- [x] **Step 1: Write failing status-page tests**

Cover:

```ts
expect(screen.getByRole('button', { name: '检查数据' })).toBeEnabled();
expect(screen.getByText('尚未执行数据检查')).toBeTruthy();
expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
  '问题描述',
  '处理建议',
  '执行入口',
]);
```

Also test running/polling, old snapshot plus failure, three card links, 50-row pagination, filters, auto/manual mutations, handled display, and no stale-result warning.

- [x] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @causality/web test -- SystemStatus.test.tsx
```

Expected: FAIL because the data-check UI does not exist.

- [x] **Step 3: Implement API adapter**

Add functions:

```ts
getLatestDataCheck(signal?)
startDataCheck()
getDataCheckIssues(query, signal?)
autoHandleDataCheckIssue(id, snapshotId)
manualHandleDataCheckIssue(id, snapshotId)
```

Both handling adapters also send the issue's `snapshotId` in the request body. Parse
every response with Task 1 contracts.

- [x] **Step 4: Implement the data-maintenance check button**

On click:

1. refetch readiness;
2. only when readiness is `ready`, call `startDataCheck`;
3. attach to returned running task;
4. poll latest state at a short fixed interval while running.

Do not start a data check on initial page entry.

- [x] **Step 5: Implement snapshot and failure presentation**

Render:

```text
latest successful checkedAt
latest failed attempt timestamp/message
orphan event/relation/case cards
error/warning/open/handled totals
```

If no successful snapshot exists, show the approved empty state even if the latest attempt failed.

- [x] **Step 6: Implement the three-column issue table**

Only render:

```text
问题描述 | 处理建议 | 执行入口
```

Build links from `targetType`, `targetId`, and `relatedId`. Missing targets render their raw ID as text.

The action cell renders exactly one of:

```text
自动处理
手动处理
已处理
```

Filters remain above the table and do not create additional columns. Severity, issue type,
and handling status use the shared application-styled select instead of native browser
select controls.

- [x] **Step 7: Implement mutation updates**

After auto/manual success:

```ts
queryClient.setQueryData(['data-checks', 'issues', filters], updateIssue);
void queryClient.invalidateQueries({ queryKey: ['data-checks', 'latest'] });
```

Do not invalidate event/relation/case lists or start a new check automatically.

- [x] **Step 8: Add compact styles**

Reuse existing card, table, button, focus, error, pagination, and desktop spacing tokens. The status page must remain usable at 1280×720 without a new page shell or mobile layout.

- [x] **Step 9: Run Web tests**

Run:

```bash
pnpm --filter @causality/web test
pnpm typecheck
```

Expected: all pass.

**Execution result (2026-07-23):**

- The Web suite passed with 39 files and 189 tests after splitting data maintenance from
  system status.
- Workspace lint, formatting, typecheck, and diff checks passed.
- Browser verification at `/maintenance` covered the saved result, success metrics, all
  three orphan links, issue actions, navigation placement, and the three-column table.
- Browser navigation to `/system` verified that only API, PostgreSQL, and the restored
  “重新检查” action remain.
- The three issue filters use the shared application-styled select, including keyboard
  navigation, single-menu behavior, and a scrollable issue-type menu.
- The causal-graph toolbar now reuses the same shared select behavior while retaining its
  existing control dimensions; selected options use weight 750 and unselected options use
  weight 400 consistently across both pages.
- The real check completed with 0 errors and 525 warnings; browser console errors and
  warnings were empty.
- The Task 5 desktop manual checkpoint was approved by the user on 2026-07-23.

- [x] **Step 10: Manual checkpoint**

Ask the user to verify:

- data-maintenance navigation, check button, and running state;
- leaving and returning while a task runs;
- success snapshot, old snapshot plus failure, and first-run empty state;
- three orphan card links;
- three-column issue table, filters, pagination, and all three action labels;
- no stale-result indicator.
- restored system-status page with only API, PostgreSQL, and “重新检查”.

Do not continue until the user confirms.

- [x] **Step 11: Commit locally**

```bash
git add \
  apps/web/src/features/system-status/systemStatusApi.ts \
  apps/web/src/features/system-status/SystemStatus.tsx \
  apps/web/src/features/system-status/SystemStatus.test.tsx \
  apps/web/src/features/data-maintenance/DataMaintenance.tsx \
  apps/web/src/features/data-maintenance/dataMaintenanceApi.ts \
  apps/web/src/features/data-maintenance/DataCheckPanel.tsx \
  apps/web/src/features/data-maintenance/DataCheckIssueTable.tsx \
  apps/web/src/features/data-maintenance/DataMaintenance.test.tsx \
  apps/web/src/app/AppSidebar.tsx \
  apps/web/src/app/AppSidebar.test.tsx \
  apps/web/src/app/router.tsx \
  apps/web/src/styles/global.css
git commit -m "feat: add data maintenance system status"
```

Do not push.

---

### Task 6: End-to-end, production, documentation, and acceptance

**Files:**

- Create: `tests/e2e/data-maintenance.spec.ts`
- Modify: `tests/e2e/foundation.spec.ts`
- Modify: `tests/production/production-smoke.spec.ts`
- Modify: `README.md`
- Modify: `docs/stages/phase-2/P2-01-data-cleanup-safe-deletion-integrity-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`
- Modify: this plan to record execution results

**Interfaces:**

- Consumes all Task 1–5 public behavior.
- Produces a release-quality local P2-01 candidate; it does not push GitHub.

- [x] **Step 1: Write end-to-end deletion tests**

Use API-created unique records and assert:

- linked event delete is blocked and link opens `/relations?eventId=...`;
- after deleting the relation, the event can be deleted;
- relation deletion preserves its two events and cases;
- case deletion preserves its relations;
- current search, hidden filter, and valid page remain after deletion;
- dialogs never render association lists, names, or counts.

- [x] **Step 2: Write end-to-end data-check tests**

Assert:

- `/maintenance` does not auto-start a data check;
- “检查数据” starts one task;
- navigation away and back recovers state;
- snapshot persists after page reload;
- orphan cards navigate to `orphan=true`;
- issue table has exactly three columns;
- manual handling changes only the current issue;
- a new check rediscovers an unchanged manually handled warning.

- [x] **Step 3: Extend production smoke**

In the isolated production Compose project:

1. start from an empty volume;
2. run migrations;
3. start a check and await success;
4. restart API/Web;
5. assert the snapshot remains;
6. verify deletion and hidden orphan list endpoints;
7. clean the temporary project and volume.

- [x] **Step 4: Update README**

Add concise user-facing documentation:

- permanent deletion and its constraints;
- standalone data-maintenance page and manual “检查数据” behavior;
- restored runtime-only system-status page;
- orphan statistics;
- latest-snapshot persistence;
- no soft delete, recovery, history, or automatic schedule.

Do not add implementation history or test counts to the public README.

- [x] **Step 5: Run the complete release-candidate gate**

Run in order:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:compose
pnpm graph:benchmark
pnpm data-check:benchmark
pnpm test:production
pnpm build
git diff --check
```

Expected: every command passes; Playwright and production smoke have no skipped P2-01 checks; data-check benchmark is at most 30 seconds.

Result (2026-07-23): all commands passed after review fixes. Unit suites passed
41 contracts, 96 API, and 192 Web tests; integration passed 75 tests; E2E passed
22 tests; Compose passed 6 tests; production smoke passed 1 test. The graph
benchmark generated 100,000 events, 500,000 relations, and 100,000 cases in
60.3 seconds and recorded a 24.98 ms P95 query time. The complete data check
finished in 2.53 seconds against the same dataset.

- [x] **Step 6: Perform final code review**

Review the complete P2-01 diff against:

```text
docs/stages/phase-2/P2-01-data-cleanup-safe-deletion-integrity-design.md
```

Check for unbounded SQL, unsafe cascades, duplicate query logic, stale query keys, inaccessible dialogs, dead styles, unused dependencies, and snapshot overwrite races. Fix every Critical, Important, and relevant Minor finding, then rerun the affected test and full gate.

Result (2026-07-23): the review found no Critical issues. All four Important
findings were fixed: concurrent starts now serialize before reading task state;
handled issues refetch filtered pagination; deletion dialogs retain modal focus
while pending; and issue links interpret alias/keyword identifiers by issue type.
Issue pagination now also reads the snapshot, total, and rows in one repeatable-read
transaction. The targeted tests and complete release gate passed after these fixes.

- [x] **Step 7: Commit the local implementation candidate**

First inspect `git status --short` and verify that every listed path belongs to
P2-01. Stage only the P2-01 paths from the file map; never stage unrelated user
changes or generated runtime files. Then commit:

```bash
git add \
  tests/e2e/data-maintenance.spec.ts \
  tests/e2e/foundation.spec.ts \
  tests/production/production-smoke.spec.ts \
  README.md \
  docs/stages/phase-2/P2-01-data-cleanup-safe-deletion-integrity-design.md \
  docs/superpowers/plans/2026-07-20-causality-application-roadmap.md \
  docs/superpowers/plans/2026-07-23-p2-01-data-cleanup-safe-deletion-integrity.md
git commit -m "feat: complete P2-01 data cleanup and integrity"
```

Do not push.

- [x] **Step 8: Deliver desktop manual acceptance**

Provide the exact checklist from design section 18 and keep the route map status at “等待人工复核”.

- [x] **Step 9: Record user acceptance**

Only after the user explicitly confirms:

- change the design status to completed with the confirmation date;
- change roadmap P2-01 to `已完成`;
- update this plan with final test/benchmark results;
- commit locally with:

```bash
git add docs
git commit -m "docs: complete P2-01 acceptance"
```

Then ask whether to enter P2-02. Do not push GitHub.

Result (2026-07-23): the user confirmed that desktop manual acceptance passed.
The P2-01 design and overall roadmap are marked complete. The implementation,
review, release-candidate gate, and acceptance commits remain local; nothing was
pushed to GitHub.

---

## Plan Self-Review Checklist

- Every approved deletion rule is implemented in Tasks 2–3 and verified in Task 6.
- Orphan statistics, hidden filters, and `eventId` navigation are covered in Tasks 2, 4, 5, and 6.
- The latest-success/last-failure model and one-task rule are covered in Tasks 1 and 4.
- All approved integrity rules and the two exact duplicate warnings are enumerated in Task 4.
- The three-column issue table and auto/manual/handled behavior are covered in Tasks 4–6.
- The 30-second benchmark and full release candidate gate are explicit.
- No step adds soft deletion, history, batch handling, permanent ignore, fuzzy matching, AI, or automatic scheduling.
- Every commit remains local until all second-phase work is complete.
