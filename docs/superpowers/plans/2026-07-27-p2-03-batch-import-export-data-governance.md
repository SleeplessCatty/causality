# P2-03 Batch Import, Export, and Data Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict append-only CSV import, compatible full and filtered CSV export, successful import history, semantic duplicate discovery, and type-specific data-governance actions without changing the application's established interaction or visual language.

**Architecture:** A new `data-transfer` feature owns CSV parsing, import planning, import audit history, export scope calculation, short-lived download tokens, and streaming export. Existing semantic lifecycle and data-check modules gain per-model duplicate thresholds, semantic snapshot status, and transaction-safe typed issue actions. The Web application lazy-loads one new normal-layout feature and reuses or extracts the existing dialog, select, pagination, long-text, percentage, candidate, URL-return, API-error, and query-cache primitives.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, TypeScript 6.0.2, React 19.2.7, React Router 8.3.0, TanStack Query 5.101.3, Fastify 5.10.0, `@fastify/multipart` 10.1.0, Zod 4.4.3, PostgreSQL 18, pgvector 0.8.2, Drizzle ORM 0.45.2, `csv-parse` 7.0.1, `csv-stringify` 6.8.1, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- The approved design is `docs/stages/phase-2/P2-03-batch-import-export-data-governance-design.md` V1.1.
- Import accepts CSV only: no JSON, Excel, ZIP, public ingestion API, pre-import semantic review, or pending-review queue.
- CSV has no header, uses UTF-8, comma delimiters, `LF` or `CRLF`, and requires every field to be enclosed in ASCII double quotes.
- One file is limited to 20 MB, 50,000 non-empty logical records, 1,000 non-empty cases per relation row, 20 aliases per event, and 20 keywords per event.
- Import recognizes exactly `原子事件`, `具体案例`, and `因果关系`.
- Import is append-only: it may create records, reuse one strict match, and create missing relation-case links, but it never changes existing event, case, or relation fields.
- Recoverable invalid logical records are skipped and never logged. An unrecoverable CSV boundary error, no final valid data, cancellation, timeout, or database failure creates no import history.
- All final valid business writes, incremental semantic jobs created by existing database triggers, import batch counts, and import details commit in one serializable transaction.
- Import remains a synchronous request with a five-minute timeout and no fabricated percentage progress.
- Only successful import history is retained. Never retain raw CSV files, invalid row contents, failed import attempts, export files, or export history.
- Import history and every detail tab use page size 50 and stable URL-backed pagination.
- Export uses the same no-header, fully quoted CSV contract and outputs event rows, standalone case rows, then relation rows.
- Filtered export supports multiple start events, `upstream`, `downstream`, or `both`, and depth 1 through 10 with no result-count hard cap.
- Export preview tokens expire after 10 minutes, are unguessable, store filters rather than CSV data, and do not change the current Web route when downloaded.
- Every semantic model stores an independent duplicate threshold; the default is 100 and changing it never rebuilds an index.
- Semantic duplicate scanning applies only to events and cases, keeps at most five candidates per source, deduplicates pairs, and stores at most 50,000 semantic issues per snapshot.
- Data-check issue rows retain three columns. Every open row displays the same secondary `操作` button and opens a server-authorized, type-specific dialog.
- Merge direction is never preselected. Merge, cleanup, deletion, timestamp repair, ignore, and single-issue recheck are transaction-safe and validate live records.
- Event merge preserves the already-connected relation when a redirected relation collides, merges case links, and deletes generated self-loop relations without deleting case records.
- Existing normal search, semantic search, graph behavior, deletion behavior, model lifecycle behavior, list-return behavior, page sizes, and database triggers must not regress.
- Reuse the existing CSS variables, normal page layout, compact table density, 8px card radius, button variants, `AppSelect`, `PercentageControl`, `ListPagination`, `OverflowText`, TanStack Query, and shared API error presentation.
- Do not introduce another UI framework, CSS-in-JS system, component library, or mobile layout. Desktop minimum width remains 960px.
- Local commits are allowed after each accepted task. Do not push GitHub until all P2 work has passed code review and manual acceptance.

---

## File Map

### Shared contracts

- Create `packages/contracts/src/data-transfer/dataTransferSchemas.ts` — import history/detail, export preview, and download-availability contracts.
- Create `packages/contracts/test/data-transfer.test.ts`.
- Modify `packages/contracts/src/events/eventSchemas.ts` — extend the existing shared API error-code enum.
- Modify `packages/contracts/src/semantic/semanticSchemas.ts` — add `dedupeThreshold`.
- Modify `packages/contracts/src/data-checks/dataCheckSchemas.ts` — add semantic snapshot state and typed issue-action contracts.
- Modify `packages/contracts/src/relations/relationSchemas.ts` — export the existing confidence and description field schemas for CSV reuse.
- Modify `packages/contracts/src/index.ts`.

### Database

- Create `apps/api/src/database/schema/importBatches.ts`.
- Create `apps/api/src/database/schema/importRecords.ts`.
- Create `apps/api/src/database/schema/exportRequests.ts`.
- Modify `apps/api/src/database/schema/semanticModelSettings.ts`.
- Modify `apps/api/src/database/schema/dataCheckState.ts`.
- Modify `apps/api/src/database/schema/index.ts`.
- Create `database/migrations/0015_p2_03_data_transfer_governance.sql`.
- Modify `database/migrations/meta/_journal.json`.
- Create `database/migrations/meta/0015_snapshot.json`.
- Modify `apps/api/src/database/verify.ts`.

### Data-transfer API

- Create `apps/api/src/features/data-transfer/dataTransferTypes.ts`.
- Create `apps/api/src/features/data-transfer/csvLexicalValidator.ts`.
- Create `apps/api/src/features/data-transfer/csvCodec.ts`.
- Create `apps/api/src/features/data-transfer/importPlanner.ts`.
- Create `apps/api/src/features/data-transfer/importRepository.ts`.
- Create `apps/api/src/features/data-transfer/importService.ts`.
- Create `apps/api/src/features/data-transfer/importHistoryRepository.ts`.
- Create `apps/api/src/features/data-transfer/exportScopeRepository.ts`.
- Create `apps/api/src/features/data-transfer/exportRequestRepository.ts`.
- Create `apps/api/src/features/data-transfer/exportService.ts`.
- Create `apps/api/src/features/data-transfer/exportCsvStream.ts`.
- Create `apps/api/src/features/data-transfer/dataTransferRoutes.ts`.
- Modify `apps/api/src/app.ts`.
- Modify `apps/api/package.json` and `pnpm-lock.yaml`.
- Create API unit and integration tests listed by each task below.

### Semantic and data governance API

- Modify `apps/api/src/features/semantic/{semanticLifecycleRepository,semanticService,semanticRoutes}.ts`.
- Modify `apps/api/src/features/data-checks/{dataCheckTypes,dataCheckService,dataCheckRules,dataCheckRepository,dataCheckCoordinator,dataCheckRoutes}.ts`.
- Create `apps/api/src/features/data-checks/semanticDuplicateRule.ts`.
- Create `apps/api/src/features/data-checks/dataCheckActionService.ts`.
- Create `apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts`.
- Extend existing data-check unit, integration, and benchmark tests.

### Shared Web components

- Create `apps/web/src/shared/dialog/AppDialog.tsx` and its test.
- Create `apps/web/src/shared/controls/AppTabs.tsx` and its test.
- Create `apps/web/src/shared/candidates/EventCandidateCombobox.tsx` and its test.
- Modify `apps/web/src/shared/api/httpClient.ts` and its test.
- Modify `apps/web/src/shared/deletion/DeleteRecordDialog.tsx` and its test.
- Modify `apps/web/src/features/parameter-settings/SemanticModelActionDialog.tsx`.
- Modify `apps/web/src/features/causal-graph/components/GraphEventSelector.tsx` and its test.

### Data-transfer Web feature

- Create `apps/web/src/features/data-transfer/dataTransferApi.ts`.
- Create `apps/web/src/features/data-transfer/DataTransferPage.tsx`.
- Create `apps/web/src/features/data-transfer/DataTransferPage.test.tsx`.
- Create `apps/web/src/features/data-transfer/components/ImportPanel.tsx`.
- Create `apps/web/src/features/data-transfer/components/ImportHistoryTable.tsx`.
- Create `apps/web/src/features/data-transfer/pages/ImportDetailPage.tsx`.
- Create `apps/web/src/features/data-transfer/pages/ImportDetailPage.test.tsx`.
- Create `apps/web/src/features/data-transfer/components/ExportPanel.tsx`.
- Create `apps/web/src/features/data-transfer/components/ExportEventSelector.tsx`.
- Create `apps/web/src/features/data-transfer/components/ExportConfirmDialog.tsx`.
- Create `apps/web/src/features/data-transfer/dataTransfer.css`.
- Modify `apps/web/src/app/{AppSidebar,router}.tsx` and their tests.

### Data-governance Web feature

- Modify `apps/web/src/features/parameter-settings/{ParameterSettings,SemanticModelCard,parameterSettingsApi}.tsx`.
- Create `apps/web/src/features/data-maintenance/useDataCheckQueryState.ts`.
- Create `apps/web/src/features/data-maintenance/DataCheckIssueDialog.tsx`.
- Create `apps/web/src/features/data-maintenance/DataCheckMergeDialog.tsx`.
- Modify `apps/web/src/features/data-maintenance/{DataMaintenance,DataCheckPanel,DataCheckIssueTable,dataMaintenanceApi}.tsx`.
- Modify `apps/web/src/shared/navigation/{listReturn,useListRecordFocus}.ts`.
- Modify all three event/case/relation edit pages and their tests.
- Modify `apps/web/src/styles/global.css`.

### End-to-end, performance, and documentation

- Create `apps/api/src/database/benchmark/dataTransferBenchmark.ts`.
- Create `apps/api/test/data-transfer-benchmark.test.ts`.
- Create `tests/e2e/data-transfer-import.spec.ts`.
- Create `tests/e2e/data-transfer-export.spec.ts`.
- Extend `tests/e2e/data-maintenance.spec.ts` and `tests/e2e/semantic-settings.spec.ts`.
- Modify `README.md`, root `package.json`, production contract tests, and roadmap status only after acceptance.

---

### Task 1: Contracts, dependencies, and database foundation

**Files:**

- Create: `packages/contracts/src/data-transfer/dataTransferSchemas.ts`
- Create: `packages/contracts/test/data-transfer.test.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/semantic/semanticSchemas.ts`
- Modify: `packages/contracts/src/data-checks/dataCheckSchemas.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/database/schema/importBatches.ts`
- Create: `apps/api/src/database/schema/importRecords.ts`
- Create: `apps/api/src/database/schema/exportRequests.ts`
- Modify: `apps/api/src/database/schema/semanticModelSettings.ts`
- Modify: `apps/api/src/database/schema/dataCheckState.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Create: `database/migrations/0015_p2_03_data_transfer_governance.sql`
- Modify: `database/migrations/meta/_journal.json`
- Create: `database/migrations/meta/0015_snapshot.json`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/api/test/core-model.integration.test.ts`

**Interfaces:**

- Produces:

```ts
type ImportRecordType = 'event' | 'case' | 'relation' | 'relation_case';
type ImportOutcome = 'created' | 'reused';

interface ImportTypeCounts {
  created: number;
  reused: number;
}

interface ImportBatchSummary {
  id: string;
  filename: string;
  completedAt: string;
  recordTypes: ImportRecordType[];
  counts: {
    event: ImportTypeCounts;
    case: ImportTypeCounts;
    relation: ImportTypeCounts;
    relationCase: ImportTypeCounts;
  };
}

interface ImportBatchListResponse {
  items: ImportBatchSummary[];
  page: number;
  pageSize: 50;
  totalItems: number;
  totalPages: number;
}

type ImportRecordText =
  | { type: 'event'; eventName: string }
  | { type: 'case'; caseContent: string }
  | { type: 'relation'; causeEventName: string; effectEventName: string }
  | {
      type: 'relation_case';
      causeEventName: string;
      effectEventName: string;
      caseContent: string;
    };

interface ImportRecordItem {
  id: string;
  sequence: number;
  outcome: ImportOutcome;
  text: ImportRecordText;
}

interface ImportRecordListResponse {
  items: ImportRecordItem[];
  page: number;
  pageSize: 50;
  totalItems: number;
  totalPages: number;
}

interface ImportUploadResponse {
  batch: ImportBatchSummary;
}

type ExportDirection = 'upstream' | 'downstream' | 'both';
type ExportPreviewInput =
  | { type: 'full' }
  | {
      type: 'filtered';
      startEventIds: string[];
      direction: ExportDirection;
      depth: number;
    };

interface ExportCounts {
  events: number;
  cases: number;
  relations: number;
}

interface ExportPreviewResponse {
  token: string;
  expiresAt: string;
  counts: ExportCounts;
}

interface ExportAvailabilityResponse {
  available: true;
  expiresAt: string;
}

type DataCheckSemanticStatus = 'completed' | 'skipped' | 'failed' | 'truncated';
type DataCheckSemanticReason =
  | 'not_recorded'
  | 'no_active_model'
  | 'worker_unreachable'
  | 'index_not_ready'
  | 'no_embeddings'
  | 'candidate_limit'
  | 'internal_failure'
  | null;

type P203ApiErrorCode =
  | 'CSV_INVALID_UTF8'
  | 'CSV_UNRECOVERABLE_SYNTAX'
  | 'CSV_FILE_TOO_LARGE'
  | 'CSV_TOO_MANY_RECORDS'
  | 'CSV_NO_VALID_RECORDS'
  | 'IMPORT_CONFLICT_RETRY'
  | 'IMPORT_CANCELLED'
  | 'IMPORT_TIMEOUT'
  | 'IMPORT_BATCH_NOT_FOUND'
  | 'EXPORT_TOKEN_INVALID'
  | 'EXPORT_TOKEN_EXPIRED'
  | 'EXPORT_START_EVENT_NOT_FOUND'
  | 'DATA_CHECK_ACTION_NOT_ALLOWED'
  | 'DATA_CHECK_ACTION_CONFLICT';
```

- Database additions:

```sql
ALTER TABLE semantic_model_settings
  ADD COLUMN dedupe_threshold smallint NOT NULL DEFAULT 100,
  ADD CONSTRAINT semantic_model_settings_dedupe_threshold_check
    CHECK (dedupe_threshold BETWEEN 0 AND 100);

ALTER TABLE data_check_state
  ADD COLUMN semantic_status varchar(20),
  ADD COLUMN semantic_reason varchar(30);

CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename varchar(255) NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  record_types varchar(20)[] NOT NULL,
  event_created integer NOT NULL,
  event_reused integer NOT NULL,
  case_created integer NOT NULL,
  case_reused integer NOT NULL,
  relation_created integer NOT NULL,
  relation_reused integer NOT NULL,
  relation_case_created integer NOT NULL,
  relation_case_reused integer NOT NULL
);

CREATE TABLE import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_sequence integer NOT NULL,
  item_sequence integer NOT NULL,
  record_type varchar(20) NOT NULL,
  outcome varchar(10) NOT NULL,
  primary_record_id uuid NOT NULL,
  related_record_id uuid,
  text_snapshot jsonb NOT NULL
);

CREATE TABLE export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL,
  export_type varchar(10) NOT NULL,
  start_event_ids uuid[] NOT NULL DEFAULT '{}',
  direction varchar(10),
  depth smallint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
```

- Add database and Zod cross-field validation:
  - no snapshot → semantic status and reason are null;
  - `completed` → reason is null;
  - `truncated` → reason is `candidate_limit`;
  - `skipped` or `failed` → reason is non-null and valid for that status.
- `import_records.text_snapshot` is JSONB validated by the API contract; it stores import-time display text, not a live join.
- `import_records.primary_record_id` and `related_record_id` are audit values without foreign keys to live business tables, so later business deletion cannot erase or block history.
- `export_requests.token_hash` stores SHA-256 of the opaque token, never the raw token.

- [x] **Step 1: Install pinned server dependencies**

Run:

```bash
pnpm --filter @causality/api add @fastify/multipart@10.1.0 csv-parse@7.0.1 csv-stringify@6.8.1
```

Expected: `apps/api/package.json` and `pnpm-lock.yaml` contain the three exact versions.

- [x] **Step 2: Write failing contract tests**

Add parsing tests that assert:

```ts
expect(importRecordTypeSchema.parse('relation_case')).toBe('relation_case');
expect(importHistoryQuerySchema.parse({ page: '2' })).toEqual({ page: 2 });
expect(importDetailQuerySchema.parse({ type: 'case', page: '3' })).toEqual({
  type: 'case',
  page: 3,
});
expect(
  exportPreviewInputSchema.parse({
    type: 'filtered',
    startEventIds: [crypto.randomUUID()],
    direction: 'both',
    depth: 10,
  }).depth,
).toBe(10);
expect(exportPreviewInputSchema.safeParse({ type: 'filtered', startEventIds: [], depth: 0 }).success)
  .toBe(false);
```

Also assert that a semantic lifecycle model requires both `threshold` and `dedupeThreshold`, and that a data-check snapshot accepts all four semantic statuses with the defined reason codes.

Extract and export `relationConfidenceSchema` and `relationDescriptionSchema` from the current `relationFormInputSchema` without changing form parsing behavior.

- [x] **Step 3: Run contract tests and verify failure**

Run:

```bash
pnpm --filter @causality/contracts test -- data-transfer.test.ts semantic.test.ts data-checks.test.ts
```

Expected: FAIL because the new schemas and fields do not exist.

- [x] **Step 4: Implement the Zod schemas and exports**

Use strict objects, `z.uuid()`, the existing offset timestamp schema, page size literal `50`, depth integer `1..10`, and closed enums. Export inferred TypeScript types through `packages/contracts/src/index.ts`.

- [x] **Step 5: Add Drizzle schemas and SQL migration**

Run the generator with the feature-specific name:

```bash
pnpm --filter @causality/api exec drizzle-kit generate --config drizzle.config.ts --name p2_03_data_transfer_governance
```

Create tables with these exact columns and indexes:

```ts
importBatches: {
  id: uuid,
  filename: varchar(255),
  completedAt: timestamptz,
  recordTypes: varchar[],
  eventCreated, eventReused, caseCreated, caseReused,
  relationCreated, relationReused, relationCaseCreated, relationCaseReused
}

importRecords: {
  id: uuid,
  batchId: uuid,
  sourceSequence: integer,
  itemSequence: integer,
  recordType: varchar(20),
  outcome: varchar(10),
  primaryRecordId: uuid,
  relatedRecordId: uuid | null,
  textSnapshot: jsonb
}

exportRequests: {
  id: uuid,
  tokenHash: char(64),
  exportType: varchar(10),
  startEventIds: uuid[],
  direction: varchar(10) | null,
  depth: smallint | null,
  createdAt: timestamptz,
  expiresAt: timestamptz
}
```

Add check constraints for closed record/outcome/export/direction values, non-negative counts, non-empty safe filename, positive source/item sequences, the full-vs-filtered nullable-field combination, filtered start-event cardinality, and `expires_at > created_at`.

Add:

```sql
CREATE INDEX import_batches_completed_id_idx
  ON import_batches (completed_at DESC, id DESC);
CREATE UNIQUE INDEX import_records_batch_source_item_sequence_uidx
  ON import_records (batch_id, source_sequence, item_sequence);
CREATE INDEX import_records_batch_type_sequence_idx
  ON import_records (batch_id, record_type, source_sequence, item_sequence);
CREATE UNIQUE INDEX export_requests_token_hash_uidx
  ON export_requests (token_hash);
CREATE INDEX export_requests_expires_at_idx
  ON export_requests (expires_at);
```

Update `database/migrations/meta/_journal.json` with index 15 and create `database/migrations/meta/0015_snapshot.json`. Generate the table/column/index portion with Drizzle Kit, then append only the explicit data backfill that Drizzle cannot infer; keep SQL and schema declarations identical.

For an existing successful pre-P2-03 data-check snapshot, backfill semantic state as `skipped/not_recorded`. Leave semantic state null only when `last_snapshot_id` is null.

- [x] **Step 6: Extend migration integration assertions**

Assert the three tables, indexes, threshold default/check, semantic status columns, and foreign-key cascade from `import_records.batch_id` to `import_batches.id`.

- [x] **Step 7: Run foundation tests**

Run:

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test:integration -- core-model.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [x] **Step 8: Commit locally**

```bash
git add packages/contracts apps/api/package.json pnpm-lock.yaml apps/api/src/database database/migrations/0015_p2_03_data_transfer_governance.sql apps/api/test/core-model.integration.test.ts
git commit -m "feat: add P2-03 contracts and database foundation"
```

---

### Task 2: Strict streaming CSV codec

**Files:**

- Create: `apps/api/src/features/data-transfer/dataTransferTypes.ts`
- Create: `apps/api/src/features/data-transfer/csvLexicalValidator.ts`
- Create: `apps/api/src/features/data-transfer/csvCodec.ts`
- Create: `apps/api/test/data-transfer-csv.test.ts`

**Interfaces:**

- Consumes: `ImportRecordType` from Task 1 and `csv-parse`.
- Produces:

```ts
type ParsedImportRecord =
  | {
      type: 'event';
      sequence: number;
      name: string;
      description: string | null;
      aliases: string[];
      keywords: string[];
    }
  | { type: 'case'; sequence: number; content: string }
  | {
      type: 'relation';
      sequence: number;
      causeEventName: string;
      effectEventName: string;
      confidence: number;
      description: string | null;
      caseContents: string[];
    };

interface CsvParseResult {
  validRecords: ParsedImportRecord[];
  logicalRecordCount: number;
  invalidRecordCount: number;
}

interface EventExportRow {
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
}

interface CaseExportRow {
  content: string;
}

interface RelationExportRow {
  causeEventName: string;
  effectEventName: string;
  confidence: number;
  description: string | null;
  caseContents: string[];
}

class CsvFileError extends Error {
  code:
    | 'CSV_INVALID_UTF8'
    | 'CSV_UNRECOVERABLE_SYNTAX'
    | 'CSV_FILE_TOO_LARGE'
    | 'CSV_TOO_MANY_RECORDS'
    | 'CSV_NO_VALID_RECORDS';
}

function parseImportCsv(
  input: NodeJS.ReadableStream,
  signal: AbortSignal,
): Promise<CsvParseResult>;

function encodeEventRow(input: EventExportRow): string[];
function encodeCaseRow(input: CaseExportRow): string[];
function encodeRelationRow(input: RelationExportRow): string[];
```

- [ ] **Step 1: Write failing lexical and business-record tests**

Cover these exact fixtures:

```ts
'"具体案例","包含,逗号\\n和""引号""的案例"\\r\\n'
'"原子事件","事件","说明","别名一;带\\\\;号的别名","关键词"\\n'
'"因果关系","原因","结果","","","案例一","","案例二"'
'"因果关系","结果","原因","101"'
'具体案例,"未加引号"'
'"具体案例","未闭合'
Buffer.from([0xc3, 0x28])
```

Assert:

- commas, embedded newlines, doubled quotes, `LF`, and `CRLF` parse correctly;
- BOM is ignored;
- every non-empty field must be quoted;
- blank logical records are ignored;
- recoverable row errors increment `invalidRecordCount`;
- unclosed quotes and invalid UTF-8 throw file errors;
- confidence defaults to 10;
- relation cases are deduplicated and capped at 1,000;
- aliases/keywords decode only `\;` and `\\`, reject dangling or unknown escapes;
- duplicate aliases or duplicate keywords make the current event row invalid, matching `eventFormInputSchema`;
- omitted trailing optional event/relation fields are accepted, while a skipped middle field must be represented by `""`;
- extra non-empty fields invalidate event and case rows; extra empty case/event fields are ignored;
- empty relation-case cells are ignored and do not count toward the 1,000-case limit;
- logical records above 50,000 reject the file.

- [ ] **Step 2: Run the CSV test and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- data-transfer-csv.test.ts
```

Expected: FAIL because the codec does not exist.

- [ ] **Step 3: Implement the UTF-8 and byte-limit transform**

Use `TextDecoder('utf-8', { fatal: true })` incrementally while passing original chunks downstream. Count actual bytes and abort as soon as the total exceeds `20 * 1024 * 1024`.

- [ ] **Step 4: Implement strict raw-record validation**

Configure `csv-parse` as a stream with:

```ts
parse({
  bom: true,
  delimiter: ',',
  quote: '"',
  escape: '"',
  record_delimiter: ['\r\n', '\n'],
  raw: true,
  relax_quotes: false,
  skip_empty_lines: false,
});
```

For each returned raw logical record, run a state machine that permits only:

```text
record := quotedField ("," quotedField)* recordEnd
quotedField := '"' ('""' | anyCharacterExceptUnescapedQuote)* '"'
```

Ignore a raw record only when it contains no non-whitespace character. Do not split source text by physical newline.

- [ ] **Step 5: Implement the three record decoders**

Trim business fields, preserve meaningful interior whitespace, reuse `eventFormInputSchema`, `eventNameSchema`, `caseContentSchema`, `relationConfidenceSchema`, and `relationDescriptionSchema`, and return only normalized in-memory records. Later duplicate records must retain their original `sequence` for logging.

- [ ] **Step 6: Add export row encoder tests**

Assert the encoder produces arrays in the approved field order, preserves optional empty columns, places every relation case after description, and never exposes IDs or timestamps.

- [ ] **Step 7: Run CSV tests and static checks**

Run:

```bash
pnpm --filter @causality/api test -- data-transfer-csv.test.ts
pnpm --filter @causality/api typecheck
pnpm lint
```

Expected: PASS.

- [ ] **Step 8: Commit locally**

```bash
git add apps/api/src/features/data-transfer apps/api/test/data-transfer-csv.test.ts
git commit -m "feat: add strict streaming CSV codec"
```

---

### Task 3: Append-only import planner and transaction

**Files:**

- Create: `apps/api/src/features/data-transfer/importPlanner.ts`
- Create: `apps/api/src/features/data-transfer/importRepository.ts`
- Create: `apps/api/src/features/data-transfer/importService.ts`
- Create: `apps/api/test/import-planner.test.ts`
- Create: `apps/api/test/data-transfer-import.integration.test.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`

**Interfaces:**

- Consumes: `ParsedImportRecord[]` and `CsvParseResult` from Task 2.
- Produces:

```ts
interface ImportCommand {
  filename: string;
  records: ParsedImportRecord[];
  signal: AbortSignal;
}

interface ImportCommitResult {
  batch: ImportBatchSummary;
}

interface ImportRepository {
  commit(command: ImportCommand): Promise<ImportCommitResult>;
}

class ImportError extends Error {
  code:
    | 'IMPORT_NO_VALID_DATA'
    | 'IMPORT_CONFLICT_RETRY'
    | 'IMPORT_CANCELLED'
    | 'IMPORT_TIMEOUT';
}
```

- `planFileRecords(records)` resolves file-local duplicates and dependencies without reading the database.
- `PostgresImportRepository.commit()` performs final database matching and every write in one serializable transaction.

- [ ] **Step 1: Write failing planner tests**

Assert:

- a relation may appear before both event rows;
- the first strict duplicate event/case supplies optional fields;
- later duplicates produce `reused` logs but never enrich fields;
- duplicate relation rows may add new case associations;
- a missing relation endpoint skips that relation and all embedded cases;
- a single ambiguous embedded case skips only that association;
- relation self-loops and invalid dependencies never enter the write plan.

- [ ] **Step 2: Run planner tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- import-planner.test.ts
```

Expected: FAIL because the planner is absent.

- [ ] **Step 3: Implement deterministic file-local planning**

Use maps keyed by:

```ts
eventKey = name.trim().toLowerCase();
caseKey = content.trim();
relationKey = `${causeEventKey}\u0000${effectEventKey}`;
relationCaseKey = `${relationKey}\u0000${caseKey}`;
```

Store the first valid record as the provisional creator and append stable log intents for later reuse. PostgreSQL staging recomputes `lower(btrim(name))` and is authoritative if JavaScript and database Unicode casing differ. Do not use aliases, keywords, vectors, or fuzzy search to resolve dependencies.

- [ ] **Step 4: Write failing PostgreSQL import tests**

Seed existing event, case, relation, and relation-case records. Assert:

- strict existing rows are reused and unchanged;
- new rows and missing links are added;
- all four count groups are correct;
- only newly created entities generate incremental semantic jobs through existing triggers;
- import record snapshots remain readable after the live business row is edited or deleted;
- forced insertion failure rolls back business records, semantic jobs, batch, and details;
- two conflicting imports produce one success and one retryable conflict, not partial data.
- when test-only constraint removal permits multiple strict database matches, affected records and dependencies are skipped rather than choosing one;
- if database ambiguity removes every final operation, import returns `CSV_NO_VALID_RECORDS` and creates no batch.

Add `causality_data_transfer_test` to the explicit integration-test database allowlist.

- [ ] **Step 5: Implement set-based final matching**

Inside `BEGIN ISOLATION LEVEL SERIALIZABLE`, create transaction-local staging tables or use `unnest` recordsets. Batch-match normalized event names, exact case content, and relation endpoint pairs. Do not query once per imported row.

Use set-based `INSERT`, `ON CONFLICT DO NOTHING`, and `RETURNING` statements for events, aliases, keywords, cases, relations, and relation-case links. Existing field values remain untouched.

- [ ] **Step 6: Write audit rows in the same transaction**

Insert one batch row and stable detail rows for every successful created/reused event, case, relation, and relation-case result. Store readable JSON snapshots:

```ts
{ type: 'event', eventName }
{ type: 'case', caseContent }
{ type: 'relation', causeEventName, effectEventName }
{ type: 'relation_case', causeEventName, effectEventName, caseContent }
```

- [ ] **Step 7: Connect cancellation and error mapping**

Check `signal.aborted` between parse/planning/write phases, pass the signal to cancellable database queries, roll back any uncommitted transaction, map SQLSTATE `40001` to `IMPORT_CONFLICT_RETRY`, and preserve a committed batch even if the HTTP client later disconnects.

- [ ] **Step 8: Run import tests**

Run:

```bash
pnpm --filter @causality/api test -- import-planner.test.ts
pnpm --filter @causality/api test:integration -- data-transfer-import.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit locally**

```bash
git add apps/api/src/features/data-transfer apps/api/test/import-planner.test.ts apps/api/test/data-transfer-import.integration.test.ts apps/api/test/support/postgresTestContext.ts
git commit -m "feat: add append-only import transaction"
```

---

### Task 4: Import HTTP API, history, and detail queries

**Files:**

- Create: `apps/api/src/features/data-transfer/importHistoryRepository.ts`
- Create: `apps/api/src/features/data-transfer/dataTransferRoutes.ts`
- Create: `apps/api/test/data-transfer-routes.test.ts`
- Create: `apps/api/test/data-transfer-history.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`

**Interfaces:**

- Produces these routes:

```text
POST /api/data-transfers/imports
GET  /api/data-transfers/imports?page=1
GET  /api/data-transfers/imports/:batchId
GET  /api/data-transfers/imports/:batchId/records?type=event&page=1
```

- Upload form contains exactly one file part named `file`.
- History order is `(completed_at DESC, id DESC)`.
- Detail order is `source_sequence ASC, item_sequence ASC, id ASC`. The public response exposes
  `source_sequence` as `sequence`; `item_sequence` only disambiguates multiple audit entries
  produced by one CSV record.
- `registerDataTransferRoutes(app, pool, { importTimeoutMs = 300_000 })` accepts an injectable timeout for deterministic cancellation tests.

- [ ] **Step 1: Write failing route tests**

Use Fastify injection to assert:

- missing file, multiple files, non-`.csv` filename, and oversized streams return stable 400/413 errors;
- an unusual or absent MIME type is not trusted as proof of validity or invalidity; the strict CSV parser remains authoritative;
- valid multipart returns 201 with `batch`;
- a request exceeding five minutes is aborted with no history;
- import exceptions preserve the existing `{ code, message }` API shape.

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test -- data-transfer-routes.test.ts
```

Expected: FAIL because multipart and routes are not registered.

- [ ] **Step 3: Register multipart once**

In `buildApp`, register:

```ts
void app.register(multipart, {
  limits: {
    files: 1,
    parts: 1,
    fileSize: 20 * 1024 * 1024,
  },
});
```

Keep server-side byte counting from Task 2 as the authoritative second boundary.

- [ ] **Step 4: Implement upload route**

Sanitize `basename(part.filename)` by removing control characters, reject empty names, create a five-minute `AbortController`, combine request-close and timeout signals, parse the stream, commit through `ImportService`, and return status 201.

- [ ] **Step 5: Write failing history integration tests**

Create more than 50 batches and details. Assert:

- stable reverse pagination;
- page correction when requested page exceeds total pages;
- summary counts do not run live business-table counts;
- each detail type filters correctly;
- detail schemas never expose internal record IDs;
- text snapshots survive live record deletion.

- [ ] **Step 6: Implement `PostgresImportHistoryRepository`**

Use the shared page-size and pagination helpers. Select only the requested batch and closed detail type. Parse JSON snapshots with the matching Zod discriminated union before returning them.

- [ ] **Step 7: Register read routes and OpenAPI schemas**

Use the shared contracts for query, params, 200, 400, 404, and 500 responses. Add `registerDataTransferRoutes(app, pool, options?)` to `app.ts`.

- [ ] **Step 8: Run API tests**

Run:

```bash
pnpm --filter @causality/api test -- data-transfer-routes.test.ts
pnpm --filter @causality/api test:integration -- data-transfer-history.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit locally**

```bash
git add apps/api/src/app.ts apps/api/src/features/data-transfer apps/api/test/data-transfer-routes.test.ts apps/api/test/data-transfer-history.integration.test.ts apps/api/test/support/postgresTestContext.ts
git commit -m "feat: expose import and history APIs"
```

---

### Task 5: Shared Web dialog, tabs, candidate input, and file client

**Files:**

- Create: `apps/web/src/shared/dialog/AppDialog.tsx`
- Create: `apps/web/src/shared/dialog/AppDialog.test.tsx`
- Create: `apps/web/src/shared/controls/AppTabs.tsx`
- Create: `apps/web/src/shared/controls/AppTabs.test.tsx`
- Create: `apps/web/src/shared/candidates/EventCandidateCombobox.tsx`
- Create: `apps/web/src/shared/candidates/EventCandidateCombobox.test.tsx`
- Modify: `apps/web/src/shared/api/httpClient.ts`
- Modify: `apps/web/src/shared/api/httpClient.test.ts`
- Modify: `apps/web/src/shared/deletion/DeleteRecordDialog.tsx`
- Modify: `apps/web/src/shared/deletion/DeleteRecordDialog.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/SemanticModelActionDialog.tsx`
- Modify: `apps/web/src/features/causal-graph/components/GraphEventSelector.tsx`
- Modify: `apps/web/src/features/causal-graph/components/GraphEventSelector.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Produces:

```ts
interface AppDialogProps {
  open: boolean;
  title: string;
  descriptionId?: string;
  pending?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
  actions: ReactNode;
  onClose(): void;
}

interface AppTab<Value extends string> {
  value: Value;
  label: string;
}

interface AppTabsProps<Value extends string> {
  id: string;
  label: string;
  value: Value;
  tabs: readonly AppTab<Value>[];
  onChange(value: Value): void;
  children: ReactNode;
}

interface EventCandidateComboboxProps {
  label: string;
  ariaLabel: string;
  value: string;
  excludedIds?: ReadonlySet<string>;
  className?: string;
  placeholder: string;
  onInputChange(value: string): void;
  onSelect(candidate: EventCandidate): void;
}

function requestMultipartJson(
  url: string,
  form: FormData,
  signal: AbortSignal,
  timeoutMilliseconds: number,
): Promise<unknown>;

function startBrowserDownload(url: string, filename?: string): void;
```

- [ ] **Step 1: Write failing `AppDialog` tests**

Assert initial focus, Tab/Shift+Tab trap, Escape close, backdrop close, focus restoration, `aria-modal`, and refusal to close while `pending`.

- [ ] **Step 2: Implement `AppDialog` and migrate both existing dialogs**

`DeleteRecordDialog` and `SemanticModelActionDialog` retain their existing DOM copy, button order, classes, and pending behavior while delegating modal mechanics to `AppDialog`.

- [ ] **Step 3: Run dialog regression tests**

Run:

```bash
pnpm --filter @causality/web test -- AppDialog.test.tsx DeleteRecordDialog.test.tsx ParameterSettings.test.tsx
```

Expected: PASS with no snapshot or interaction changes outside modal mechanics.

- [ ] **Step 4: Write and implement `AppTabs` tests**

Assert `tablist/tab/tabpanel` semantics, active state, Left/Right wrap, Home, End, click selection, and visible focus. Use existing accent, border, surface, and compact spacing variables.

- [ ] **Step 5: Extract `EventCandidateCombobox`**

Move the 250ms debounce, exhaustive candidate pagination, virtualized list, active index, Escape, Arrow keys, Home/End, Enter, retry, and error state out of `GraphEventSelector`. Keep graph-specific label placement and CSS wrapper in `GraphEventSelector`.

- [ ] **Step 6: Run graph candidate regression**

Run:

```bash
pnpm --filter @causality/web test -- EventCandidateCombobox.test.tsx GraphEventSelector.test.tsx CausalGraphToolbar.test.tsx
```

Expected: PASS; graph sizing, candidate order, and keyboard behavior are unchanged.

- [ ] **Step 7: Refactor shared HTTP error parsing**

Keep `requestJson` public behavior unchanged. Extract response error parsing and timeout-signal composition, then add multipart and download-launch helpers. Never set multipart `Content-Type` manually.

- [ ] **Step 8: Run shared Web tests**

Run:

```bash
pnpm --filter @causality/web test -- httpClient.test.ts AppTabs.test.tsx AppDialog.test.tsx EventCandidateCombobox.test.tsx
pnpm --filter @causality/web typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit locally**

```bash
git add apps/web/src/shared apps/web/src/features/parameter-settings/SemanticModelActionDialog.tsx apps/web/src/features/causal-graph/components/GraphEventSelector.tsx apps/web/src/features/causal-graph/components/GraphEventSelector.test.tsx apps/web/src/styles/global.css
git commit -m "refactor: add reusable transfer UI primitives"
```

---

### Task 6: Import page, history, and detail UI

**Files:**

- Create: `apps/web/src/features/data-transfer/dataTransferApi.ts`
- Create: `apps/web/src/features/data-transfer/DataTransferPage.tsx`
- Create: `apps/web/src/features/data-transfer/DataTransferPage.test.tsx`
- Create: `apps/web/src/features/data-transfer/components/ImportPanel.tsx`
- Create: `apps/web/src/features/data-transfer/components/ImportHistoryTable.tsx`
- Create: `apps/web/src/features/data-transfer/pages/ImportDetailPage.tsx`
- Create: `apps/web/src/features/data-transfer/pages/ImportDetailPage.test.tsx`
- Create: `apps/web/src/features/data-transfer/dataTransfer.css`
- Modify: `apps/web/src/app/AppSidebar.tsx`
- Modify: `apps/web/src/app/AppSidebar.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**

- Routes:

```text
/data-transfer?tab=import&page=1
/data-transfer?tab=export
/data-transfer/imports/:batchId?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1
```

- `uploadCsv(file, signal)` uses a five-minute multipart request.
- Import errors use `useAutoDismissError` and remain retryable with the selected `File`.

- [ ] **Step 1: Write failing API adapter tests**

Mock the shared client and assert correct endpoints, page parameters, schema parsing, multipart field name `file`, AbortSignal propagation, and five-minute timeout.

- [ ] **Step 2: Implement the API adapter**

Expose:

```ts
uploadImport(file, signal): Promise<ImportBatchSummary>
getImportHistory(page, signal): Promise<ImportBatchListResponse>
getImportBatch(batchId, signal): Promise<ImportBatchSummary>
getImportRecords(batchId, type, page, signal): Promise<ImportRecordListResponse>
```

- [ ] **Step 3: Write failing page tests**

Assert:

- sidebar order is 数据维护 → 导入导出 → 参数配置;
- `tab` and history `page` live in the URL;
- the file name and MB size display after selection;
- import disables repeated submission and shows `正在导入…`;
- failure preserves the selected file and the alert disappears after three seconds;
- success navigates directly to the batch detail;
- history uses the approved eight columns and `ListPagination`;
- all four detail tabs preserve independent URL page values;
- `OverflowText` wraps file names, event names, case content, and relation text;
- back navigation restores the history page and focused row.

- [ ] **Step 4: Implement navigation protection**

Create an import-only hook that combines React Router blocking with `beforeunload`. While uploading:

```text
离开将取消本次导入
```

Use `AppDialog` for in-app confirmation. Confirm aborts the request before continuing navigation; cancel keeps the request alive.

- [ ] **Step 5: Implement the import page**

Use a normal `.page-heading`, a compact white 8px card, `AppTabs`, the existing button variants, and the data-maintenance max width. During this intermediate task, expose only the functional Import tab; Task 9 adds Export atomically, so no disabled or “coming soon” production placeholder is introduced. Do not create a canvas layout or new color palette.

- [ ] **Step 6: Implement history and detail**

Map UI tabs exactly as `events → event`, `cases → case`, `relations → relation`, and `relationCases → relation_case`. Use `keepPreviousData` for page transitions, disable pagination during fetch, call `scrollMainContentToTop` on navigation, correct invalid server-returned page values in the URL, and use the standard detail heading/back-link/button heights.

- [ ] **Step 7: Run Web tests**

Run:

```bash
pnpm --filter @causality/web test -- DataTransferPage.test.tsx ImportDetailPage.test.tsx AppSidebar.test.tsx
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: PASS.

- [ ] **Step 8: Commit locally**

```bash
git add apps/web/src/features/data-transfer apps/web/src/app apps/web/src/main.tsx
git commit -m "feat: add CSV import history interface"
```

- [ ] **Step 9: Request manual review**

Ask the user to verify file selection, cancel/leave protection, mixed-record import, error auto-dismiss, history paging, all detail tabs, long-text tips, and browser back/forward restoration before starting Task 7.

---

### Task 7: Export scope traversal, preview, and token repository

**Files:**

- Create: `apps/api/src/features/data-transfer/exportScopeRepository.ts`
- Create: `apps/api/src/features/data-transfer/exportRequestRepository.ts`
- Create: `apps/api/src/features/data-transfer/exportService.ts`
- Create: `apps/api/test/export-scope.integration.test.ts`
- Create: `apps/api/test/export-service.test.ts`
- Modify: `apps/api/src/features/data-transfer/dataTransferRoutes.ts`

**Interfaces:**

- Produces:

```ts
interface ExportScopeRepository {
  materialize(client: PoolClient, input: ExportPreviewInput): Promise<ExportCounts>;
  streamEvents(client: PoolClient, batchSize: number): AsyncIterable<EventExportRow[]>;
  streamCases(client: PoolClient, batchSize: number): AsyncIterable<CaseExportRow[]>;
  streamRelations(client: PoolClient, batchSize: number): AsyncIterable<RelationExportRow[]>;
}

interface ExportRequestRepository {
  create(client: PoolClient, input: ExportPreviewInput, expiresAt: Date): Promise<string>;
  read(client: PoolClient, rawToken: string): Promise<StoredExportRequest>;
  deleteExpired(client: PoolClient, now: Date): Promise<number>;
}

interface StoredExportRequest {
  id: string;
  input: ExportPreviewInput;
  createdAt: Date;
  expiresAt: Date;
}

function previewExport(input: ExportPreviewInput): Promise<ExportPreviewResponse>;
function checkExportAvailability(token: string): Promise<{ available: true; expiresAt: string }>;

interface ExportServiceOptions {
  now?: () => Date;
  createToken?: () => string;
  tokenLifetimeMs?: number;
}
```

- Routes:

```text
POST /api/data-transfers/exports/preview
GET  /api/data-transfers/exports/:token/availability
```

- [ ] **Step 1: Write failing recursive-scope tests**

Build a graph containing branches, a cycle, reverse relations, multiple start events, and shared cases. Assert exact event/relation/case sets for upstream, downstream, both, depth 1, depth 10, and minimum-depth revisits.

Also assert full export contains orphan events and orphan cases, while a filtered orphan start event contains that event and no unrelated relation/case.

- [ ] **Step 2: Run scope tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test:integration -- export-scope.integration.test.ts
```

Expected: FAIL because export traversal does not exist.

- [ ] **Step 3: Implement one recursive CTE scope definition**

The CTE starts events at depth 0, adds one per traversed relation, applies direction at each frontier, suppresses infinite cycle traversal, retains every in-range relation, includes both endpoints, and derives cases from included relation IDs. Materialize IDs into transaction-local `export_scope_events`, `export_scope_relations`, and `export_scope_cases` tables; never return an unbounded ID array to Node.js.

Preview and download must both call this repository; do not duplicate traversal SQL.

- [ ] **Step 4: Write failing token tests**

Assert:

- raw tokens contain at least 32 random bytes encoded URL-safely;
- only SHA-256 hashes are stored;
- token rows store filters and expiry, not entity sets or CSV;
- expiry is exactly 10 minutes from creation;
- expired, malformed, and missing tokens return stable errors;
- cleanup deletes only expired rows;
- a start event deleted before preview rejects the request.
- duplicate start event IDs are normalized to one start event without changing traversal results.

- [ ] **Step 5: Implement preview transaction**

Use a repeatable-read transaction to materialize and count the scope, then store the request filter and expiry. Return current counts and the raw token once.

- [ ] **Step 6: Register preview and availability routes**

Validate request/response with shared contracts. Availability rechecks expiry and the continued existence of every selected start event without generating CSV.

- [ ] **Step 7: Run export preview tests**

Run:

```bash
pnpm --filter @causality/api test -- export-service.test.ts
pnpm --filter @causality/api test:integration -- export-scope.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit locally**

```bash
git add apps/api/src/features/data-transfer apps/api/test/export-scope.integration.test.ts apps/api/test/export-service.test.ts
git commit -m "feat: add export scope preview and tokens"
```

---

### Task 8: Consistent streaming CSV export

**Files:**

- Create: `apps/api/src/features/data-transfer/exportCsvStream.ts`
- Create: `apps/api/test/data-transfer-export.integration.test.ts`
- Modify: `apps/api/src/features/data-transfer/exportScopeRepository.ts`
- Modify: `apps/api/src/features/data-transfer/exportService.ts`
- Modify: `apps/api/src/features/data-transfer/dataTransferRoutes.ts`

**Interfaces:**

- Produces:

```ts
interface ExportCsvStream {
  filename: string;
  stream: NodeJS.ReadableStream;
  close(): Promise<void>;
}

function openExportCsv(token: string, signal: AbortSignal): Promise<ExportCsvStream>;
```

- Route:

```text
GET /api/data-transfers/exports/:token
```

- [ ] **Step 1: Write failing CSV export integration tests**

Assert:

- output order is events, standalone cases, relations;
- every field is quoted and no header/BOM is emitted;
- relation rows repeat all associated cases;
- IDs/timestamps/vectors never appear;
- entities and links are deduplicated;
- a data change after preview appears according to the download transaction snapshot;
- deleting a selected start event invalidates filtered download;
- expired token returns JSON before CSV headers begin;
- response filename contains no control characters;
- exported CSV reimports into an empty database with equivalent business rows and links.

- [ ] **Step 2: Run export tests and verify failure**

Run:

```bash
pnpm --filter @causality/api test:integration -- data-transfer-export.integration.test.ts
```

Expected: FAIL because the stream route is absent.

- [ ] **Step 3: Implement keyset batch readers**

Hold one repeatable-read transaction for the download. Materialize resolved scope IDs into transaction-local temporary tables, then read events, cases, and relations in stable ID batches. Order entities by ID, aliases by normalized alias then ID, keywords by position then ID, and relation cases by linked time then case ID. Do not load the entire result or all case arrays into Node.js memory.

- [ ] **Step 4: Implement the CSV transform**

Use:

```ts
stringify({
  bom: false,
  header: false,
  quoted: true,
  delimiter: ',',
  record_delimiter: '\n',
});
```

Feed arrays from Task 2 encoders. Respect stream backpressure; stop database reads and roll back when the client signal aborts.

- [ ] **Step 5: Implement safe response handling**

Validate and lock the token before sending CSV headers. Set:

```text
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="causality-full-20260727-143000.csv"
Content-Disposition: attachment; filename="causality-filtered-20260727-143000.csv"
```

Filter CR, LF, quotes, and control characters from filename fragments. Commit/close after the final chunk; roll back/close on stream failure.

- [ ] **Step 6: Run round-trip and cancellation tests**

Run:

```bash
pnpm --filter @causality/api test:integration -- data-transfer-export.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit locally**

```bash
git add apps/api/src/features/data-transfer apps/api/test/data-transfer-export.integration.test.ts
git commit -m "feat: stream compatible CSV exports"
```

---

### Task 9: Export selection and confirmation UI

**Files:**

- Create: `apps/web/src/features/data-transfer/components/ExportPanel.tsx`
- Create: `apps/web/src/features/data-transfer/components/ExportEventSelector.tsx`
- Create: `apps/web/src/features/data-transfer/components/ExportConfirmDialog.tsx`
- Create: `apps/web/src/features/data-transfer/components/ExportPanel.test.tsx`
- Modify: `apps/web/src/features/data-transfer/DataTransferPage.tsx`
- Modify: `apps/web/src/features/data-transfer/dataTransferApi.ts`
- Modify: `apps/web/src/features/data-transfer/dataTransfer.css`
- Modify: `apps/web/src/shared/api/httpClient.ts`
- Modify: `apps/web/src/shared/api/httpClient.test.ts`

**Interfaces:**

- `ExportEventSelector` wraps `EventCandidateCombobox`, excludes selected IDs, and renders removable ordered chips.
- `previewExport(input)` returns counts/token.
- `downloadExport(token)` first calls availability, then starts a same-route browser download.

- [ ] **Step 1: Write failing export UI tests**

Assert:

- full and filtered modes use existing primary/secondary buttons;
- event candidates match graph search ordering, loading, retry, and keyboard behavior;
- selected events appear in selection order as removable `OverflowText` chips;
- duplicate selection is impossible;
- direction uses `AppSelect` in order 双向、下游、上游;
- depth uses `AppSelect` values 1 through 10;
- filtered preview is disabled without an event;
- selection/direction/depth changes clear prior counts and token;
- preview opens `AppDialog` with event/relation/case counts;
- confirm validates availability and starts download without navigation;
- expired token keeps all filters and asks for a new preview;
- no export history is rendered.

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
pnpm --filter @causality/web test -- ExportPanel.test.tsx
```

Expected: FAIL because export UI is absent.

- [ ] **Step 3: Implement API calls and download launcher**

Add preview and availability schema validation. After availability succeeds, create a temporary hidden `<a download>` pointing at the same-origin token GET route, click it, and remove it. Do not replace `window.location`.

- [ ] **Step 4: Implement selection controls**

Reuse `EventCandidateCombobox`, `AppSelect`, `OverflowText`, existing button styles, and existing error auto-dismiss. Do not duplicate graph candidate loading or use native selects.

- [ ] **Step 5: Implement confirmation dialog**

Use `AppDialog`; no direction is altered when it opens. Disable close/confirm while availability is being checked. Closing the dialog retains current filters and preview token; only parameter changes, token expiry, or a failed availability check discards it.

- [ ] **Step 6: Run Web regression**

Run:

```bash
pnpm --filter @causality/web test -- ExportPanel.test.tsx GraphEventSelector.test.tsx httpClient.test.ts
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: PASS.

- [ ] **Step 7: Commit locally**

```bash
git add apps/web/src/features/data-transfer apps/web/src/shared/api
git commit -m "feat: add filtered and full export interface"
```

- [ ] **Step 8: Request manual review**

Ask the user to verify multi-event selection, custom dropdowns, chip overflow tips, preview counts, full and filtered downloads, route preservation, and importing a downloaded file before Task 10.

---

### Task 10: Per-model duplicate thresholds and semantic data-check rules

**Files:**

- Modify: `apps/api/src/features/semantic/semanticLifecycleRepository.ts`
- Modify: `apps/api/src/features/semantic/semanticService.ts`
- Modify: `apps/api/src/features/semantic/semanticRoutes.ts`
- Create: `apps/api/src/features/data-checks/semanticDuplicateRule.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckTypes.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckService.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRepository.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRoutes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/semantic-duplicate-rule.integration.test.ts`
- Modify: `apps/api/test/data-check-service.test.ts`
- Modify: `apps/api/test/data-checks.integration.test.ts`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.tsx`
- Modify: `apps/web/src/features/parameter-settings/SemanticModelCard.tsx`
- Modify: `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.test.tsx`

**Interfaces:**

- New route:

```text
PATCH /api/semantic/models/:modelCode/dedupe-threshold
body: { "threshold": 100 }
```

- Data-check result gains:

```ts
interface DataCheckSemanticResult {
  status: DataCheckSemanticStatus;
  reason: DataCheckSemanticReason;
  issueCount: number;
}

interface DataCheckScanResult {
  snapshotId: string;
  checkedAt: Date;
  orphanCounts: DataCheckOrphanCounts;
  issues: DataCheckIssueDraft[];
  timings: DataCheckRuleTiming[];
  semantic: DataCheckSemanticResult;
}

function registerDataCheckRoutes(
  app: FastifyInstance,
  pool: Pool,
  semanticWorkerClient: SemanticWorkerClient,
): DataCheckCoordinator;
```

- [ ] **Step 1: Write failing threshold tests**

Assert:

- all existing model rows migrate to `dedupeThreshold: 100`;
- each model saves independently;
- values outside 0..100 reject;
- saving does not create semantic jobs or alter `semantic_index_state`;
- lifecycle responses include both thresholds.

- [ ] **Step 2: Implement threshold repository, service, and route**

Add `setDedupeThreshold(modelCode, threshold)` beside the existing query threshold method, with separate mutation, error handling, and lifecycle refresh.

- [ ] **Step 3: Add the second model-card control**

Render a second `PercentageControl` directly below “相似度门槛”:

```text
数据查重门槛
只影响数据检查的疑似重复候选，不会重新生成索引。
```

Use independent local state, pending state, save/revert logic, labels, and errors. Preserve the current dark model card and card height/order.

- [ ] **Step 4: Write failing semantic duplicate tests**

Seed active model settings and embeddings. Assert:

- no active model, unreachable Worker, non-ready index, and empty embeddings return `skipped` with the exact reason;
- a query error publishes deterministic issues with semantic `failed`;
- event and case pairs above threshold are emitted;
- exact normalized event names and exact case contents are excluded because deterministic rules own them;
- every source retains at most five candidates;
- `(A,B)` and `(B,A)` become one stable pair;
- 50,000 issues produce `truncated/candidate_limit`;
- threshold 100 only returns cosine similarity that reaches 100;
- relation vectors never create semantic duplicate issues.

- [ ] **Step 5: Implement preflight and batched pgvector rule**

Before the repeatable-read data scan, check Worker status and current lifecycle facts. Query only the active model's ready vectors. Use indexed nearest-neighbor/LATERAL candidate selection, stable ID ordering, top five, pair deduplication, and a global `50_001` probe so truncation is detectable without retaining more than 50,000 issues.

- [ ] **Step 6: Preserve deterministic results on semantic failure**

Catch only semantic-rule failures, set `failed/internal_failure`, and continue snapshot replacement. A deterministic rule or snapshot write failure still fails the whole data-check attempt.

- [ ] **Step 7: Persist and display semantic snapshot state**

Save semantic status/reason with the latest successful snapshot. Display one short status beside the latest check time; never display Worker stack traces or model internals.

- [ ] **Step 8: Run semantic-governance tests**

Run:

```bash
pnpm --filter @causality/contracts test -- semantic.test.ts data-checks.test.ts
pnpm --filter @causality/api test -- data-check-service.test.ts
pnpm --filter @causality/api test:integration -- semantic-duplicate-rule.integration.test.ts data-checks.integration.test.ts
pnpm --filter @causality/web test -- ParameterSettings.test.tsx DataMaintenance.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit locally**

```bash
git add packages/contracts apps/api/src/features/semantic apps/api/src/features/data-checks apps/api/src/app.ts apps/api/test apps/web/src/features/parameter-settings apps/web/src/features/data-maintenance
git commit -m "feat: add semantic duplicate data checks"
```

- [ ] **Step 10: Request manual review**

Ask the user to verify both threshold controls, independent saving, no reindex side effect, semantic skipped/completed/truncated messages, and unchanged model-card styling before Task 11.

---

### Task 11: Server-authorized issue context and typed governance actions

**Files:**

- Create: `apps/api/src/features/data-checks/dataCheckIssueEvaluator.ts`
- Create: `apps/api/src/features/data-checks/dataCheckActionService.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckTypes.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRepository.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckCoordinator.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckRoutes.ts`
- Create: `apps/api/test/data-check-action-service.test.ts`
- Create: `apps/api/test/data-check-actions.integration.test.ts`
- Modify: `packages/contracts/src/data-checks/dataCheckSchemas.ts`
- Modify: `packages/contracts/test/data-checks.test.ts`

**Interfaces:**

- Routes:

```text
GET  /api/data-checks/issues/:issueId/action-context?snapshotId=:snapshotId
POST /api/data-checks/issues/:issueId/actions
POST /api/data-checks/issues/:issueId/recheck
```

- Action request is a discriminated union:

```ts
type DataCheckActionRequest =
  | { type: 'merge'; snapshotId: string; keepId: string; mergeId: string }
  | { type: 'cleanup'; snapshotId: string }
  | { type: 'delete_relation'; snapshotId: string }
  | { type: 'repair_timestamp'; snapshotId: string }
  | { type: 'ignore'; snapshotId: string };

type DataCheckDialogKind =
  | 'merge'
  | 'cleanup'
  | 'delete_relation'
  | 'repair_timestamp'
  | 'edit'
  | 'ignore_only';

type DataCheckAllowedAction = DataCheckActionRequest['type'] | 'open_edit';

interface DataCheckActionRecord {
  id: string;
  targetType: 'event' | 'case' | 'relation' | 'alias' | 'keyword' | 'relation_case';
  title: string;
  primaryText: string;
  secondaryText: string[];
  detailPath: string | null;
  relationCount: number;
  caseCount: number;
}

interface DataCheckActionImpact {
  relationsMoved: number;
  relationsDeleted: number;
  relationCaseLinksMoved: number;
  relationCaseLinksDeleted: number;
  recordsDeleted: number;
}

interface DataCheckActionOption {
  type: DataCheckAllowedAction;
  label: string;
  keepId: string | null;
  mergeId: string | null;
  editPath: string | null;
  impact: DataCheckActionImpact;
}

interface DataCheckActionContext {
  snapshotId: string;
  issueId: string;
  issueType: string;
  status: 'open' | 'handled';
  dialogKind: DataCheckDialogKind;
  records: DataCheckActionRecord[];
  actions: DataCheckActionOption[];
  message: string | null;
}

interface DataCheckActionResponse {
  issue: DataCheckIssue;
  affectedEventIds: string[];
  affectedCaseIds: string[];
  affectedRelationIds: string[];
}

type DataCheckRecheckResponse =
  | { status: 'resolved'; issue: DataCheckIssue; context: null }
  | { status: 'open'; issue: DataCheckIssue; context: DataCheckActionContext };
```

- Action context is server-derived and includes current display records, detail links, and one explicit action option per allowed direction with its own live impact counts. Record A is always the issue target and record B is always `relatedId`; the client cannot supply an arbitrary target pair.

- [ ] **Step 1: Write failing action-contract tests**

Assert every union branch rejects unknown fields, invalid IDs, wrong action names, and merge directions not matching the two records in the issue.

- [ ] **Step 2: Write failing context tests**

Assert:

- handled issues close as handled;
- deleted targets mark the current issue handled;
- changed but still problematic targets return latest text and counts;
- changed and no longer problematic issues disable actions and request recheck;
- each issue type maps to an explicit dialog kind;
- unknown issue types allow only details/edit when safe plus ignore.

- [ ] **Step 3: Implement `DataCheckIssueEvaluator`**

Create one registry keyed by closed issue type. Each entry defines:

```ts
{
  dialogKind,
  loadContext(client, issue),
  evaluate(client, issue),
  buildActions(client, issue)
}
```

Both action-context and single-issue recheck use this registry, so rule semantics are not duplicated in routes.

- [ ] **Step 4: Write failing merge integration tests**

Cover both directions for:

- event merge with inbound/outbound relations;
- event merge collision preserving the relation already attached to the kept event;
- event merge generated self-loop deletion while case rows remain;
- case link migration and deduplication;
- duplicate relation case-link migration and deletion;
- stable-ID locking under concurrent opposite merge attempts;
- rollback when either record disappears before submit.

- [ ] **Step 5: Implement transaction-safe merge services**

Use one serializable transaction, lock both primary rows in sorted UUID order, recompute impact counts, validate issue pair membership, migrate links with `ON CONFLICT DO NOTHING`, remove obsolete links/records, and rely on existing semantic triggers for affected live records.

- [ ] **Step 6: Implement cleanup, deletion, repair, and ignore**

Whitelist exact SQL by issue type:

- cleanup invalid relation-case, alias, keyword, duplicate alias/keyword;
- delete only the issue's live relation;
- repair `updated_at` to a value not earlier than `created_at`;
- ignore only sets the current snapshot issue handled.

No route accepts SQL, table names, target types, or unrelated target IDs from the client.

- [ ] **Step 7: Implement single-issue recheck**

Require both snapshot and issue IDs. Re-run only the registered evaluator:

- resolved → mark handled;
- still present → return refreshed context;
- stale snapshot → 409;
- missing target → mark handled.

- [ ] **Step 8: Register routes and retain legacy handlers temporarily**

Add the three typed routes. Keep old auto/manual endpoints only until Task 12 migrates the Web UI; mark their removal in Task 13.

- [ ] **Step 9: Run action tests**

Run:

```bash
pnpm --filter @causality/contracts test -- data-checks.test.ts
pnpm --filter @causality/api test -- data-check-action-service.test.ts
pnpm --filter @causality/api test:integration -- data-check-actions.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit locally**

```bash
git add packages/contracts/src/data-checks packages/contracts/test/data-checks.test.ts apps/api/src/features/data-checks apps/api/test/data-check-action-service.test.ts apps/api/test/data-check-actions.integration.test.ts
git commit -m "feat: add typed data-governance actions"
```

---

### Task 12: Data-maintenance dialogs, URL state, and edit return

**Files:**

- Create: `apps/web/src/features/data-maintenance/useDataCheckQueryState.ts`
- Create: `apps/web/src/features/data-maintenance/DataCheckIssueDialog.tsx`
- Create: `apps/web/src/features/data-maintenance/DataCheckMergeDialog.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataCheckPanel.tsx`
- Modify: `apps/web/src/features/data-maintenance/DataCheckIssueTable.tsx`
- Modify: `apps/web/src/features/data-maintenance/dataMaintenanceApi.ts`
- Modify: `apps/web/src/features/data-maintenance/DataMaintenance.test.tsx`
- Modify: `apps/web/src/shared/navigation/listReturn.ts`
- Modify: `apps/web/src/shared/navigation/listReturn.test.ts`
- Modify: `apps/web/src/shared/navigation/useListRecordFocus.ts`
- Modify: `apps/web/src/features/events/pages/EventEditPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventPages.test.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseEditPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**

- Data-maintenance URL:

```text
/maintenance?page=2&severity=warning&issueType=semantic_duplicate_event&status=open&issue=:issueId
```

- Navigation state:

```ts
interface DataCheckReturnState {
  dataCheckReturnPath: string;
  dataCheckSnapshotId: string;
  dataCheckIssueId: string;
  dataCheckReturnMode: 'cancel' | 'saved';
}
```

- [ ] **Step 1: Write failing URL-state tests**

Assert:

- page/filter/issue parse from and update the URL;
- invalid values normalize to defaults;
- filters reset page to 1;
- a new snapshot resets page to 1 and closes the old issue while retaining filters;
- browser forward/back restores filters and modal;
- current row scrolls into view after return.

- [ ] **Step 2: Implement `useDataCheckQueryState`**

Use `URLSearchParams`, `readListPage`, closed contract enums, and replace navigation only for normalization/one-time marker consumption. Do not keep duplicate filter/page state in `useState`.

- [ ] **Step 3: Write failing dialog tests**

Assert:

- every open row says `操作` with `button--secondary`;
- opening loads current server context;
- merge shows A/B side by side with `OverflowText`, details, relation/case counts, and no selected direction;
- confirmation is disabled until a direction is selected;
- selecting a direction displays the impact attached to that exact server-provided action option;
- cleanup/delete/timestamp/edit/ignore content matches context kind;
- ignore is visually separate and never initial focus;
- pending actions cannot close by Escape/backdrop;
- success refreshes latest snapshot, issue page, affected business details/lists, and graph queries;
- stale context shows the server message and reload action.

- [ ] **Step 4: Implement typed dialogs with `AppDialog`**

Use one `DataCheckIssueDialog` dispatcher and focused content components. Do not copy modal mechanics. Render only actions returned by the server.

- [ ] **Step 5: Extend safe edit-return state**

Add helpers:

```ts
createDataCheckEditReturnState(location, snapshotId, issueId): DataCheckReturnState
resolveRecordReturnTarget(state, normalBasePath, fallbackPage): {
  path: string;
  dataCheck?: { snapshotId: string; issueId: string; recheck: boolean };
}
```

Only accept `/maintenance` or the existing matching business list base path. Reject absolute URLs, protocol-relative URLs, encoded external URLs, and other app paths.

- [ ] **Step 6: Update all three edit pages**

From a data-check context:

- Cancel returns with the issue modal reopened and no recheck.
- Save returns with one `recheck` marker.
- DataMaintenance consumes the marker once, calls the single-issue recheck endpoint, then removes it with replace navigation.
- Refresh after consumption does not re-submit.

Normal list/detail edit return remains unchanged.

- [ ] **Step 7: Remove old UI action mode behavior**

Stop calling auto/manual endpoints and stop selecting button style/copy from `actionMode`. The list remains exactly three columns and handled rows still show `已处理`.

- [ ] **Step 8: Run Web tests**

Run:

```bash
pnpm --filter @causality/web test -- DataMaintenance.test.tsx listReturn.test.ts EventPages.test.tsx CasePages.test.tsx RelationEditPage.test.tsx
pnpm --filter @causality/web typecheck
pnpm --filter @causality/web build
```

Expected: PASS.

- [ ] **Step 9: Commit locally**

```bash
git add apps/web/src/features/data-maintenance apps/web/src/shared/navigation apps/web/src/features/events/pages apps/web/src/features/events/pages/EventPages.test.tsx apps/web/src/features/cases/pages apps/web/src/features/cases/pages/CasePages.test.tsx apps/web/src/features/relations/pages apps/web/src/styles/global.css
git commit -m "feat: add typed data-maintenance dialogs"
```

- [ ] **Step 10: Request manual review**

Ask the user to verify every dialog type, both merge directions, pending locks, current visual style, filters/page/modal in browser history, edit cancel return, edit save recheck, and unchanged normal list returns before Task 13.

---

### Task 13: Cleanup, performance limits, and end-to-end regression

**Files:**

- Modify: `packages/contracts/src/data-checks/dataCheckSchemas.ts`
- Modify: `packages/contracts/test/data-checks.test.ts`
- Modify: `apps/api/src/features/data-checks/{dataCheckTypes,dataCheckRepository,dataCheckCoordinator,dataCheckRoutes}.ts`
- Modify: `apps/web/src/features/data-maintenance/dataMaintenanceApi.ts`
- Create: `apps/api/src/database/benchmark/dataTransferBenchmark.ts`
- Create: `apps/api/test/data-transfer-benchmark.test.ts`
- Modify: `apps/api/src/database/benchmark/dataCheckBenchmark.ts`
- Modify: `apps/api/test/data-check-benchmark.test.ts`
- Create: `tests/e2e/data-transfer-import.spec.ts`
- Create: `tests/e2e/data-transfer-export.spec.ts`
- Modify: `tests/e2e/data-maintenance.spec.ts`
- Modify: `tests/e2e/semantic-settings.spec.ts`
- Modify: `apps/api/src/database/verify.ts`
- Modify: `apps/api/test/database-tools.integration.test.ts`
- Modify: root `package.json`

**Interfaces:**

- Removes the obsolete public `actionMode`, `auto-handle`, and `manual-handle` contracts/routes after the Web no longer consumes them.
- Adds `data-transfer:benchmark` root/API scripts.

- [ ] **Step 1: Remove legacy issue endpoints**

Delete old auto/manual handlers, repository methods, API adapters, and contract exposure. Keep internal rule metadata only if it is still required to select a typed evaluator; do not expose it in list responses.

- [ ] **Step 2: Run focused cleanup regression**

Run:

```bash
pnpm --filter @causality/contracts test -- data-checks.test.ts
pnpm --filter @causality/api test -- data-check-service.test.ts data-check-action-service.test.ts
pnpm --filter @causality/web test -- DataMaintenance.test.tsx
```

Expected: PASS and the focused scans below find no obsolete public path.

Use these focused scans so the internal database `action_mode` column may remain while public compatibility code is removed:

```bash
! rg "auto-handle|manual-handle" apps/api/src apps/web/src packages/contracts/src
! rg "actionMode" apps/web/src packages/contracts/src
```

- [ ] **Step 3: Add the import/export benchmark**

Generate in memory:

- 50,000 non-empty logical records;
- a mix of new/reused events, cases, relations, and links;
- quoted commas, quotes, and multiline fields;
- a depth-10 cyclic export graph.

Measure peak process RSS before/after, total time, database round trips, and output rows. Fail when:

- import exceeds five minutes;
- API peak RSS exceeds 1.5 GiB in the 8 GiB Colima reference environment;
- a 50,000-record import executes more than 500 SQL statements;
- export buffers the full CSV before the first response chunk.

- [ ] **Step 4: Extend data-check benchmark**

Seed enough active embeddings to exercise indexed top-five lookup and the 50,000 issue cap. Assert bounded candidate retention and no full vector-table load into Node.js.

- [ ] **Step 5: Add import E2E**

Cover:

- mixed valid/invalid records;
- embedded commas/quotes/newlines;
- append-only reuse;
- upload pending state and route blocker;
- history page 2 and detail tab/page restoration;
- long-text tooltip;
- response-loss recovery through history.

- [ ] **Step 6: Add export E2E**

Cover:

- event candidate keyboard selection;
- multiple removable chips;
- all three directions and depth changes;
- preview counts;
- full and filtered download;
- downloaded CSV round-trip import.

- [ ] **Step 7: Extend governance E2E**

Cover independent duplicate threshold controls, skipped semantic status, `操作` dialogs, both merge directions, generated self-loop cleanup, ignore/recheck, and edit save/cancel return.

- [ ] **Step 8: Extend database verification**

Verify new tables/indexes, expired export-request cleanup safety, import-count non-negativity, import-record snapshot shapes, threshold bounds, and semantic status/reason combinations.

- [ ] **Step 9: Run complete automated gates**

Run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:compose
pnpm data-transfer:benchmark
pnpm data-check:benchmark
pnpm test:e2e
```

Expected: every command exits 0.

- [ ] **Step 10: Commit locally**

```bash
git add packages/contracts apps/api apps/web tests package.json
git commit -m "test: complete P2-03 regression and performance gates"
```

---

### Task 14: README, acceptance record, and release-candidate handoff

**Files:**

- Modify: `README.md`
- Modify: `docs/stages/phase-2/P2-03-batch-import-export-data-governance-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`
- Modify: production contract/smoke files only if new route documentation requires it.

**Interfaces:**

- README documents operator behavior, not development history.
- Roadmap marks P2-03 complete only after automated and manual acceptance.

- [ ] **Step 1: Rewrite the README feature section**

Document:

- the three CSV record formats with fully quoted examples;
- UTF-8, no-header, comma, escaping, multiline, 20 MB, 50,000 record, 1,000 relation-case, and append-only rules;
- which invalid conditions skip a row and which reject a file;
- import history retention and non-retention;
- full/filtered export direction and depth semantics;
- semantic duplicate threshold and data-maintenance actions;
- development and production startup/migration commands;
- a warning that imported factual accuracy remains the user's responsibility.

- [ ] **Step 2: Add a compact manual acceptance checklist**

Record the 24 approved design checks plus:

```text
- Import and export round trip on an empty database
- Import cancellation leaves no history
- Existing records remain unchanged after reuse
- Merge collision preserves the kept relation fields
- All extracted shared components retain old behavior
```

- [ ] **Step 3: Run final documentation and release-candidate checks**

Run:

```bash
pnpm exec prettier --check README.md docs/stages/phase-2/P2-03-batch-import-export-data-governance-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
git diff --check
git status --short
```

Expected: formatting passes and only intended release-candidate files are modified.

- [ ] **Step 4: Request final manual acceptance**

Do not mark the design or roadmap complete yet. Ask the user to run the documented production-like startup and manually validate navigation, import, history/detail, export, semantic thresholds, issue dialogs, merges, and edit return.

- [ ] **Step 5: Mark P2-03 complete after user approval**

Update the design status and roadmap only after the user explicitly reports that manual review passed.

- [ ] **Step 6: Commit the accepted release candidate locally**

```bash
git add README.md docs tests/production
git commit -m "docs: finalize P2-03 release candidate"
```

Do not push GitHub. Report the local commit range and ask whether to enter P2-04 design.

---

## Execution Order and Review Gates

1. Tasks 1–4 establish the database, CSV, import transaction, and read APIs. Run automated tests after every task.
2. Tasks 5–6 deliver shared primitives and import UI. Stop for manual review after Task 6.
3. Tasks 7–9 deliver preview, streaming export, and export UI. Stop for manual review after Task 9.
4. Task 10 adds semantic duplicate detection and threshold UI. Stop for manual review.
5. Tasks 11–12 deliver typed governance actions and edit return. Stop for manual review after Task 12.
6. Task 13 removes compatibility paths and runs performance/full regression.
7. Task 14 updates formal documentation and waits for final manual acceptance before completion status.

Each task begins only after the previous task's automated gate passes. A failed manual gate returns to the owning task; it does not advance to later tasks.
