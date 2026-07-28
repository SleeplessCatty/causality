# P3-01 MCP Server and External AI Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MCP service that lets external AI clients query Causality, compare conversation-derived candidates, iteratively prepare an immutable import plan, and commit the user-approved plan transactionally with auditable history.

**Architecture:** Add a separate `@causality/mcp` application that exposes the same tool registry through Streamable HTTP and stdio and calls typed Causality API endpoints instead of PostgreSQL. The API owns candidate comparison, plan lifecycle, confidence policy, idempotent commit, token management, and successful AI-import history; the existing Web app only manages MCP connection settings and reads history.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, TypeScript 6.0.2, React 19.2.7, Fastify 5.10.0, PostgreSQL 18 with pgvector 0.8.2, Zod 4.4.3, `@modelcontextprotocol/sdk` 1.30.0, MCP Inspector 2.0.0, Vitest 4.1.10, Playwright 1.61.1, Docker Compose.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-07-28-p3-01-mcp-ai-capture-design.md`.
- Work on the current branch unless the user explicitly requests a branch.
- Commit each completed task locally; do not push to GitHub until all P3-01 tasks, code review, automated tests, and manual review are complete.
- Use `apply_patch` for hand edits and preserve unrelated user changes.
- Use TDD: every behavior change starts with a failing focused test.
- External AI data uses JSON; CSV remains exclusively for the existing import/export workflow.
- A capture contains at most 50 deduplicated atomic events. Cases, relations, and links have no business count limit but remain subject to finite body, memory, and timeout safeguards.
- MCP and API logs must never contain complete access tokens, full candidate payloads, conversation text, URLs, or model reasoning.
- AI import may append aliases and keywords and replace an existing event description, but may not rename events, modify case content, alter existing relation endpoints/descriptions, delete/merge records, or remove stored relation-case links.
- A prepared plan expires after 30 minutes and every replacement invalidates its predecessor.
- Commit is idempotent and all-or-nothing. Business data, semantic jobs, confidence changes, and successful history are written in one transaction.
- Automatic confidence uses `100 - (100 - baselineConfidence) * 0.9^(currentCaseCount - baselineCaseCount)`, is stored to four decimal places, and never automatically reaches 100.
- Streamable HTTP binds to `127.0.0.1` by default, validates Bearer Token and `Origin`, and uses stdio only as a compatibility transport.
- Reuse existing `AppTabs`, `ListPagination`, `OverflowText`, `AppDialog`, form alerts, page headings, and compact visual tokens.
- Every UI task ends with a desktop manual-review checkpoint; no mobile layout work is included.

## File and Boundary Map

### Shared contracts

- `packages/contracts/src/relations/relationSchemas.ts`: decimal confidence and explicit manual-override signal.
- `packages/contracts/src/causal-graph/causalGraphSchemas.ts`: decimal confidence on graph edges.
- `packages/contracts/src/ai-capture/aiCaptureSchemas.ts`: candidates, comparisons, decisions, plans, results, history, and structured workflow errors.
- `packages/contracts/src/mcp/mcpSettingsSchemas.ts`: HTTP MCP status, token rotation, and client configuration.
- `packages/contracts/src/index.ts`: public exports only.

### API and database

- `database/migrations/0016_relation_confidence_baseline.sql`: decimal confidence and baseline fields while preserving existing save behavior.
- `database/migrations/0017_relation_confidence_policy.sql`: statement-level relation-case triggers after every existing writer understands the new policy.
- `database/migrations/0018_ai_capture_foundation.sql`: plans, successful history, history records, and singleton MCP settings.
- `apps/api/src/features/relations/relationConfidencePolicy.ts`: TypeScript reference formula used by previews and cross-check tests.
- `apps/api/src/features/ai-capture/*`: candidate comparison, plan preparation, commit, history, errors, repositories, services, and routes.
- `apps/api/src/features/mcp-settings/*`: token generation, authorization, rotation, settings, and routes.
- `apps/api/src/features/semantic/*`: strict ready-index candidate mode and batch query embeddings.
- `apps/semantic-worker/src/internalServer.ts`: bounded batch query embedding endpoint.
- `apps/semantic-worker/src/model/*`: batch query embedding without changing document embedding behavior.

### MCP application

- `apps/mcp/src/api/causalityApiClient.ts`: the only adapter from MCP tools to the Causality API.
- `apps/mcp/src/server/createMcpServer.ts`: shared server, tools, prompts, and annotations.
- `apps/mcp/src/transports/httpServer.ts`: authenticated Streamable HTTP.
- `apps/mcp/src/transports/stdioServer.ts`: stdio compatibility.
- `apps/mcp/src/prompts/capturePrompt.ts`: canonical MCP Prompt content.
- `prompts/causality-capture.md`: portable Markdown Prompt generated from the same canonical source.
- `skills/causality-capture/SKILL.md`: thin client-specific wrapper with no duplicated business rules.

### Web

- `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`: status, endpoint, token, copy config, and rotation.
- `apps/web/src/features/data-transfer/components/AiImportHistoryTable.tsx`: successful AI batch list.
- `apps/web/src/features/data-transfer/pages/AiImportDetailPage.tsx`: five-category history detail.

---

### Task 1: Persist the Confidence Baseline and Decimal Contract

**Files:**
- Create: `database/migrations/0016_relation_confidence_baseline.sql`
- Modify: `apps/api/src/database/schema/causalRelations.ts`
- Modify: `apps/api/src/features/relations/relationRepository.ts`
- Modify: `apps/api/src/features/causal-graph/causalGraphRepository.ts`
- Modify: `apps/api/src/features/data-transfer/importRepository.ts`
- Modify: `apps/api/src/features/data-transfer/exportScopeRepository.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/src/causal-graph/causalGraphSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/relations.test.ts`
- Test: `packages/contracts/test/causal-graph.test.ts`
- Test: `apps/api/test/relation-confidence-migration.integration.test.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`

**Interfaces:**
- Produces: `RelationFormInput.confidenceManuallyEdited: boolean`.
- Produces: numeric `confidence`, `baselineConfidence`, and `baselineCaseCount` fields on `causal_relations`.
- Preserves: pre-policy relation and CSV writes continue to store the submitted confidence as their current baseline.
- Consumed by: Tasks 2, 5, and 7.

- [ ] **Step 1: Add failing contract tests for decimal confidence and the manual flag**

```ts
expect(
  relationFormInputSchema.parse({
    causeEventId,
    effectEventId,
    confidence: 34.4,
    confidenceManuallyEdited: true,
    description: null,
    caseSelections: [],
  }),
).toMatchObject({ confidence: 34.4, confidenceManuallyEdited: true });

expect(
  relationFormInputSchema.parse({
    causeEventId,
    effectEventId,
    confidence: 10,
    description: null,
    caseSelections: [],
  }).confidenceManuallyEdited,
).toBe(false);
```

- [ ] **Step 2: Run the focused contract test and verify it fails**

Run:

```bash
pnpm --filter @causality/contracts test -- relations.test.ts
```

Expected: FAIL because confidence still requires an integer and `confidenceManuallyEdited` is absent.

- [ ] **Step 3: Change the shared relation contract**

Use these definitions:

```ts
export const relationConfidenceSchema = z.number().finite().min(0).max(100);

export const relationFormInputSchema = z.object({
  causeEventId: z.uuid(),
  effectEventId: z.uuid(),
  confidence: relationConfidenceSchema,
  confidenceManuallyEdited: z.boolean().default(false),
  description: relationDescriptionSchema,
  caseSelections: caseSelectionSchema.max(1_000).default([]),
});
```

Keep the existing self-loop and duplicate-case validation unchanged.

Use `relationConfidenceSchema` in `relationSummarySchema` and change causal-graph edge
confidence to the same finite `0..100` decimal contract. This prevents relation list,
detail, and graph responses from rejecting four-decimal database values.

- [ ] **Step 4: Add a failing migration integration test**

Create a relation with confidence `73` and two links before applying the migration fixture, then assert:

```ts
expect(row).toEqual({
  confidence: '73.0000',
  baseline_confidence: '73.0000',
  baseline_case_count: 2,
});
```

Also assert the database rejects a baseline count below zero and a confidence outside `0..100`.

- [ ] **Step 5: Run the migration test and verify it fails**

Run:

```bash
pnpm --filter @causality/api test:integration -- relation-confidence-migration.integration.test.ts
```

Expected: FAIL because the baseline columns and migration do not exist.

- [ ] **Step 6: Change the Drizzle schema and generate the baseline migration**

Change `causalRelations.ts` from `smallint` to `numeric('confidence', { precision: 7, scale: 4 })`
with numeric number mode, and add matching non-null `baselineConfidence` and
`baselineCaseCount` fields. Then run:

```bash
pnpm --filter @causality/api exec drizzle-kit generate --config drizzle.config.ts --name relation_confidence_baseline
```

Expected: Drizzle creates the next migration and metadata snapshot. Rename only if necessary
to retain the expected `0016_relation_confidence_baseline.sql` sequence.

- [ ] **Step 7: Extend the generated migration with deterministic backfill**

Patch the generated migration rather than creating a second hand-written migration. It must:

```sql
ALTER TABLE causal_relations
  ALTER COLUMN confidence TYPE numeric(7,4) USING confidence::numeric(7,4),
  ADD COLUMN baseline_confidence numeric(7,4),
  ADD COLUMN baseline_case_count integer;

UPDATE causal_relations r
SET baseline_confidence = r.confidence,
    baseline_case_count = (
      SELECT count(*)::integer
      FROM causal_relation_cases crc
      WHERE crc.causal_relation_id = r.id
    );

ALTER TABLE causal_relations
  ALTER COLUMN baseline_confidence SET NOT NULL,
  ALTER COLUMN baseline_case_count SET NOT NULL,
  ADD CONSTRAINT causal_relations_baseline_confidence_check
    CHECK (baseline_confidence BETWEEN 0 AND 100),
  ADD CONSTRAINT causal_relations_baseline_case_count_check
    CHECK (baseline_case_count >= 0);
```

Do not add automatic recalculation triggers in this migration. Add only transitional
compatibility triggers that:

- initialize omitted baseline values from a newly inserted relation's submitted
  confidence and zero linked cases;
- synchronize `baseline_case_count` after direct link inserts/deletes without changing
  `confidence` or `baseline_confidence`.

These triggers preserve existing SQL, seed, benchmark, and test-data writers during the
intermediate Task 1 schema. Task 2 must replace them with the final automatic policy.

- [ ] **Step 8: Preserve existing writers during the intermediate schema**

For relation create/replace and CSV relation insertion, write submitted confidence to both
`confidence` and `baseline_confidence`, then set `baseline_case_count` to the final linked
case count after link mutation. Continue treating the submitted confidence as final in this
task; `confidenceManuallyEdited` becomes behaviorally active in Task 2.

Change CSV bulk SQL record declarations from `confidence smallint` to
`confidence numeric(7,4)`.

The `pg` driver returns `numeric` columns as strings. Convert confidence with
`Number(row.confidence)` at the relation, causal-graph, and CSV export repository
boundaries before constructing typed domain responses. Add regression assertions
for decimal list, detail, graph, and exported CSV values.

- [ ] **Step 9: Apply and verify migration metadata**

Run:

```bash
pnpm db:migrate
pnpm db:verify
```

Expected: migration succeeds and database verification remains valid.

- [ ] **Step 10: Run focused and regression tests**

Run:

```bash
pnpm --filter @causality/contracts test -- relations.test.ts causal-graph.test.ts
pnpm --filter @causality/api test:integration -- relation-confidence-migration.integration.test.ts
pnpm --filter @causality/api test:integration -- relations.integration.test.ts data-transfer-import.integration.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add database/migrations apps/api/src/database/schema/causalRelations.ts apps/api/src/features/relations apps/api/src/features/data-transfer apps/api/test packages/contracts
git commit -m "feat: persist relation confidence baselines"
```

### Task 2: Apply the Confidence Policy Across Every Link Mutation

**Files:**
- Create: `database/migrations/0017_relation_confidence_policy.sql`
- Create: `apps/api/src/features/relations/relationConfidencePolicy.ts`
- Modify: `apps/api/src/features/relations/relationRepository.ts`
- Modify: `apps/api/src/features/data-transfer/dataTransferTypes.ts`
- Modify: `apps/api/src/features/data-transfer/csvCodec.ts`
- Modify: `apps/api/src/features/data-transfer/importRepository.ts`
- Modify: `apps/api/src/features/data-checks/dataCheckActionService.ts`
- Modify: `apps/web/src/shared/controls/PercentageControl.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationCreatePage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Test: `apps/api/test/relation-confidence-policy.test.ts`
- Test: `apps/api/test/relation-confidence-policy.integration.test.ts`
- Test: `apps/web/src/features/relations/components/RelationForm.test.tsx`
- Test: `apps/web/src/shared/controls/PercentageControl.test.tsx`

**Interfaces:**
- Produces: `calculateAutomaticConfidence(input: ConfidenceCalculationInput): number`.
- Produces: PostgreSQL function `recalculate_relation_confidences(uuid[])`.
- Produces: repository ordering rule “mutate links first, apply explicit manual baseline last”.
- Consumed by: Task 7 plan previews and commits.

- [ ] **Step 1: Write failing formula tests**

```ts
expect(calculateAutomaticConfidence({
  baselineConfidence: 10,
  baselineCaseCount: 0,
  currentCaseCount: 3,
})).toBe(34.39);

expect(calculateAutomaticConfidence({
  baselineConfidence: 50,
  baselineCaseCount: 5,
  currentCaseCount: 4,
})).toBeCloseTo(44.4444, 4);
```

Add tests for restoring the baseline count, clamping below zero, and staying below 100.

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
pnpm --filter @causality/api test -- relation-confidence-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the TypeScript reference policy**

```ts
export interface ConfidenceCalculationInput {
  baselineConfidence: number;
  baselineCaseCount: number;
  currentCaseCount: number;
}

export function calculateAutomaticConfidence(input: ConfidenceCalculationInput): number {
  const effectiveBaseline = Math.min(input.baselineConfidence, 99.9999);
  const calculated =
    100 -
    (100 - effectiveBaseline) *
      0.9 ** (input.currentCaseCount - input.baselineCaseCount);
  return Number(Math.max(0, Math.min(99.9999, calculated)).toFixed(4));
}
```

- [ ] **Step 4: Add failing migration, repository, and CSV integration cases**

Cover:

- inserting or deleting multiple links in one statement recalculates each affected relation once;
- new relation, untouched default `10`, three initial links → `34.3900`;
- edit without touching confidence, remove one link → lower automatic value;
- edit with `confidenceManuallyEdited: true`, set `55` while changing links → final and baseline `55`, baseline count equals final link count;
- empty CSV confidence → automatic confidence from imported links;
- explicit CSV confidence → explicit value becomes final baseline after links;
- case deletion and data-maintenance link merge trigger recalculation.

- [ ] **Step 5: Run integration tests and verify the old behavior fails**

```bash
pnpm --filter @causality/api test:integration -- relation-confidence-policy.integration.test.ts
```

Expected: FAIL because repositories still write integer confidence directly.

- [ ] **Step 6: Generate and complete the trigger migration**

Run:

```bash
pnpm --filter @causality/api exec drizzle-kit generate --config drizzle.config.ts --custom --name relation_confidence_policy
```

This step adds database functions and triggers rather than Drizzle table fields, so use
Drizzle's custom migration mode. Patch the generated
`0017_relation_confidence_policy.sql` with
`recalculate_relation_confidences(uuid[])` and separate statement-level `AFTER INSERT`
and `AFTER DELETE` triggers using transition tables. The function must compute:

```sql
greatest(
  0::numeric,
  least(
    99.9999::numeric,
    100 - (100 - least(baseline_confidence, 99.9999))
      * power(0.9::numeric, current_case_count - baseline_case_count)
  )
)::numeric(7,4)
```

The triggers must update each affected relation once per SQL statement, not once per row.
Before creating them, drop the Task 1 compatibility triggers and their three functions:

```text
causal_relations_initialize_confidence_baseline
causal_relation_cases_sync_inserted_baseline_count
causal_relation_cases_sync_deleted_baseline_count
initialize_relation_confidence_baseline()
sync_inserted_relation_baseline_case_counts()
sync_deleted_relation_baseline_case_counts()
```

Apply the migration and verify it before changing repository semantics:

```bash
pnpm db:migrate
pnpm db:verify
```

- [ ] **Step 7: Change repository write ordering**

For a new relation, always insert the default automatic baseline:

```sql
insert into causal_relations (
  cause_event_id, effect_event_id, confidence,
  baseline_confidence, baseline_case_count, description
)
values ($1, $2, 10, 10, 0, $3)
```

Then mutate links. For both create and replace:

```ts
await replaceCaseSelections(client, relationId, input.caseSelections);
if (input.confidenceManuallyEdited) {
  await client.query(
    `update causal_relations
     set confidence = $2,
         baseline_confidence = $2,
         baseline_case_count = (
           select count(*)::int from causal_relation_cases where causal_relation_id = $1
         ),
         updated_at = clock_timestamp()
     where id = $1`,
    [relationId, input.confidence],
  );
}
```

When `confidenceManuallyEdited` is false, never overwrite the trigger-computed confidence.
For an existing relation, do not reset its baseline before link mutation.

- [ ] **Step 8: Preserve explicitness in CSV**

Change decoded relation data to carry:

```ts
interface ParsedRelationRecord {
  confidence: number;
  confidenceManuallyEdited: boolean;
}
```

An empty field sets `confidence: 10` and `confidenceManuallyEdited: false`; a non-empty valid field sets the flag to true. Apply explicit baselines only after all relation-case links are inserted.

- [ ] **Step 9: Track confidence touches in the Web form**

Add a generic `step?: number` prop to `PercentageControl`, default it to `1`, and use `0.1` for relation confidence. In `RelationForm`:

```ts
const [confidenceManuallyEdited, setConfidenceManuallyEdited] = useState(false);

onChange={(value) => {
  setConfidence(value);
  setConfidenceManuallyEdited(true);
}}
```

Submit `confidenceManuallyEdited`; initialize it as false on both create and edit.

- [ ] **Step 10: Run focused API and Web tests**

```bash
pnpm --filter @causality/api test -- relation-confidence-policy.test.ts
pnpm --filter @causality/api test:integration -- relation-confidence-policy.integration.test.ts
pnpm --filter @causality/web test -- RelationForm.test.tsx PercentageControl.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Run affected regressions**

```bash
pnpm --filter @causality/api test:integration -- relations.integration.test.ts data-transfer-import.integration.test.ts data-check-actions.integration.test.ts
pnpm --filter @causality/web test -- RelationCreatePage.test.tsx RelationEditPage.test.tsx
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add database/migrations apps/api apps/web packages/contracts
git commit -m "feat: recalculate confidence from case evidence"
```

### Task 3: Add AI Capture Contracts and Persistence

**Files:**
- Create: `packages/contracts/src/ai-capture/aiCaptureSchemas.ts`
- Create: `packages/contracts/src/mcp/mcpSettingsSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/database/schema/aiImportPlans.ts`
- Create: `apps/api/src/database/schema/aiImportBatches.ts`
- Create: `apps/api/src/database/schema/aiImportRecords.ts`
- Create: `apps/api/src/database/schema/mcpSettings.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Create: `database/migrations/0018_ai_capture_foundation.sql`
- Test: `packages/contracts/test/ai-capture.test.ts`
- Test: `packages/contracts/test/mcp-settings.test.ts`
- Test: `apps/api/test/ai-capture-migration.integration.test.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`

**Interfaces:**
- Produces: `AiCaptureCandidateSet`, `AiCaptureComparison`, `AiCaptureDecisionSet`, `PrepareAiImportPlanInput`, `AiImportPlan`, `AiImportPlanStatus`, `AiImportCommitResult`, `AiImportBatchSummary`, `AiImportBatchListResponse`, `AiImportBatchDetail`, `AiImportRecordType`, `AiImportRecordListResponse`, and `AiWorkflowError`.
- Produces: `McpSettingsResponse` and `McpTokenRotationResponse`.
- Produces: plan, successful history, history record, and MCP singleton tables.
- Consumed by: Tasks 4–13.

- [ ] **Step 1: Write failing contract tests**

Validate this minimum candidate shape:

```ts
const candidates = aiCaptureCandidateSetSchema.parse({
  topic: '供应链中断的影响',
  clientName: 'test-client',
  atomicEvents: [
    { ref: 'event-1', name: '港口停止作业', description: null, aliases: [], keywords: [] },
    { ref: 'event-2', name: '零部件到货延迟', description: null, aliases: [], keywords: [] },
  ],
  concreteCases: [{ ref: 'case-1', content: '2025年某港口停运后汽车零部件延迟到货' }],
  causalRelations: [{
    ref: 'relation-1',
    causeEventRef: 'event-1',
    effectEventRef: 'event-2',
    description: null,
  }],
  relationCaseLinks: [{ relationRef: 'relation-1', caseRef: 'case-1' }],
});
```

Assert 51 unique event refs fail, duplicate refs fail, missing relation endpoints fail, and a link to an unknown relation or case fails.
Assert unknown properties such as conversation transcript, source URL, and model reasoning
fail strict parsing. Concrete case content must reuse the existing 100-character contract.
Only the atomic-event array has a business count limit; the remaining arrays are bounded by
the transport body limit rather than an arbitrary record-count limit.

- [ ] **Step 2: Run contract tests and verify they fail**

```bash
pnpm --filter @causality/contracts test -- ai-capture.test.ts mcp-settings.test.ts
```

Expected: FAIL because schemas do not exist.

- [ ] **Step 3: Implement shared schemas**

Use strict discriminated unions:

```ts
type EventDecision =
  | { ref: string; action: 'create' }
  | {
      ref: string;
      action: 'reuse';
      existingId: string;
      appendAliases: string[];
      appendKeywords: string[];
      replaceDescription?: string | null;
    }
  | { ref: string; action: 'skip'; reason: string };
```

Create equivalent case decisions (`create`, `reuse`, `skip`), relation decisions (`create`, `reuse`, `skip`), and link decisions (`create`, `reuse`, `skip`). Existing relation-case links never accept a delete action.

Define plan status as the closed enum:

```ts
z.enum([
  'pending',
  'replaced',
  'invalidated',
  'expired',
  'submitting',
  'committed',
  'data_failed',
  'system_failed',
]);
```

Define structured errors:

```ts
export const aiWorkflowErrorSchema = z.object({
  category: z.enum(['data', 'system', 'configuration']),
  code: z.string().min(1),
  message: z.string().min(1),
  affectedRefs: z.array(z.string()).default([]),
  aiCanRepair: z.boolean(),
  retryCurrentPlan: z.boolean(),
  suggestedAction: z.string().min(1),
}).strict();
```

- [ ] **Step 4: Write a failing migration test**

Assert:

- plan status accepts only the approved state machine;
- `expires_at > created_at`;
- one successful batch references exactly one committed plan;
- history records cascade with batch deletion but business rows do not;
- MCP singleton contains one 64-hex token and positive token version.

- [ ] **Step 5: Run migration test and verify it fails**

```bash
pnpm --filter @causality/api test:integration -- ai-capture-migration.integration.test.ts
```

Expected: FAIL because tables do not exist.

- [ ] **Step 6: Add Drizzle schemas and generate the migration**

Define and export the four Drizzle schemas first, then run:

```bash
pnpm --filter @causality/api exec drizzle-kit generate --config drizzle.config.ts --name ai_capture_foundation
```

Expected: Drizzle creates `0018_ai_capture_foundation.sql` and the matching metadata snapshot.

- [ ] **Step 7: Complete the generated migration**

Create:

```text
ai_import_plans
  id, version, replaces_plan_id, status, topic, client_name,
  candidate_payload, plan_payload, result_payload,
  created_at, expires_at, committed_at, updated_at

ai_import_batches
  id, plan_id, topic, plan_version, client_name, completed_at,
  event_created, event_reused, event_updated,
  case_created, case_reused,
  relation_created, relation_reused,
  relation_case_created, confidence_changed

ai_import_records
  id, batch_id, sequence, record_type, action,
  primary_record_id, related_record_id, detail

mcp_settings
  singleton_key, access_token, token_version, updated_at
```

Require `candidate_payload` and `plan_payload` to be JSON objects,
`result_payload` to be null or a JSON object, and `ai_import_records.detail`
to be a JSON object. Insert the singleton token with
`encode(gen_random_bytes(32), 'hex')`.

Add a unique constraint on `ai_import_batches.plan_id`; this is the database
backstop for one successful history batch per immutable plan.

- [ ] **Step 8: Run migration checks**

```bash
pnpm db:migrate
pnpm db:verify
```

Expected: migration succeeds and the singleton exists.

- [ ] **Step 9: Run focused tests**

```bash
pnpm --filter @causality/contracts test -- ai-capture.test.ts mcp-settings.test.ts
pnpm --filter @causality/api test:integration -- ai-capture-migration.integration.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add database/migrations apps/api/src/database apps/api/test packages/contracts
git commit -m "feat: add AI capture persistence contracts"
```

### Task 4: Add Strict Batch Semantic Candidate Queries

**Files:**
- Modify: `apps/semantic-worker/src/model/modelRuntime.ts`
- Modify: `apps/semantic-worker/src/model/transformersRuntime.ts`
- Modify: `apps/semantic-worker/src/internalServer.ts`
- Modify: `apps/api/src/features/semantic/semanticWorkerClient.ts`
- Create: `apps/api/src/features/ai-capture/aiSemanticCandidateService.ts`
- Test: `apps/semantic-worker/test/modelRuntime.test.ts`
- Test: `apps/semantic-worker/test/internalServer.test.ts`
- Test: `apps/api/test/semantic-worker-client.test.ts`
- Test: `apps/api/test/ai-semantic-candidate-service.test.ts`

**Interfaces:**
- Produces: `SemanticWorkerClient.embedQueries(modelCode, texts): Promise<number[][]>`.
- Produces: `AiSemanticCandidateService.compare(entityType, texts): Promise<SemanticMatch[][]>`.
- Requires index status exactly `ready`; `updating` and `incomplete` are rejected for plan generation.
- Consumed by: Task 5.

- [ ] **Step 1: Write failing batch embedding tests**

```ts
expect(await runtime.embedQueries(['需求下降', '库存上升'])).toHaveLength(2);
expect(pipeline).toHaveBeenCalledWith(
  ['query: 需求下降', 'query: 库存上升'],
  expect.objectContaining({ normalize: true }),
);
```

Also assert an empty array returns immediately and the internal endpoint rejects more than 64 texts.

- [ ] **Step 2: Run Worker tests and verify they fail**

```bash
pnpm --filter @causality/semantic-worker test -- modelRuntime.test.ts internalServer.test.ts
```

Expected: FAIL because batch query embedding is absent.

- [ ] **Step 3: Implement batch query embedding**

Add:

```ts
export interface EmbeddingRuntime {
  embedQueries(texts: readonly string[]): Promise<number[][]>;
}
```

Implement one pipeline call using `model.queryPrefix` for every text and reuse the existing `copyVectors`.

Expose:

```http
POST /internal/embed-queries
{"modelCode":"bge-small-zh-v1.5","texts":["文本1","文本2"]}
```

Limit the request to 64 non-empty strings, each at most 200 characters.

- [ ] **Step 4: Extend the API Worker client**

```ts
embedQueries(modelCode: SemanticModelCode, texts: readonly string[]): Promise<number[][]>;
```

Validate the model code, dimensions, vector count, and every finite vector value.

- [ ] **Step 5: Write failing strict candidate-service tests**

Assert:

- only `ready` is accepted;
- `updating`, `incomplete`, downloading, building, failed, missing model, and Worker mismatch return stable configuration/data-preparation codes;
- texts are chunked into groups of 64;
- semantic database lookups use one bulk query per 64-text chunk, not one query per text;
- each text returns at most 10 candidates.

- [ ] **Step 6: Implement `AiSemanticCandidateService`**

Use:

```ts
export interface SemanticMatch {
  id: string;
  similarity: number;
}

compare(
  entityType: Extract<SemanticEntityType, 'event' | 'case'>,
  texts: readonly string[],
): Promise<SemanticMatch[][]>;
```

Read the active context once, require `status === 'ready'`, and batch embeddings by
64. For each chunk, pass indexed vectors through `unnest(... with ordinality)` or
`jsonb_to_recordset`, then use a lateral pgvector top-10 lookup so one SQL request
returns all result lists in input order. Run at most two chunk queries concurrently.
Do not issue a PostgreSQL request per candidate.

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter @causality/semantic-worker test -- modelRuntime.test.ts internalServer.test.ts
pnpm --filter @causality/api test -- semantic-worker-client.test.ts ai-semantic-candidate-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run semantic regressions**

```bash
pnpm --filter @causality/api test -- semantic-query-service.test.ts
pnpm --filter @causality/semantic-worker test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/features/semantic apps/api/src/features/ai-capture apps/api/test apps/semantic-worker
git commit -m "feat: add strict batch semantic comparison"
```

### Task 5: Compare Complete AI Candidate Sets

**Files:**
- Create: `apps/api/src/features/ai-capture/aiCandidateComparisonRepository.ts`
- Create: `apps/api/src/features/ai-capture/aiCandidateComparisonService.ts`
- Create: `apps/api/src/features/ai-capture/aiCaptureErrors.ts`
- Test: `apps/api/test/ai-candidate-comparison-service.test.ts`
- Test: `apps/api/test/ai-candidate-comparison.integration.test.ts`
- Modify: `apps/api/test/support/postgresTestContext.ts`

**Interfaces:**
- Consumes: `AiCaptureCandidateSet`, `AiSemanticCandidateService`.
- Produces: `compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison>`.
- Consumed by: Tasks 6 and 8.

- [ ] **Step 1: Write failing service tests for candidate-set integrity**

Cover:

- 51 events → `AI_EVENT_LIMIT_EXCEEDED`;
- duplicate candidate content is normalized to one comparison target while preserving refs;
- relation endpoint or link dependency missing → data error with affected refs;
- exact event name and alias matches precede fuzzy and semantic candidates;
- exact case content precedes fuzzy and semantic candidates;
- each event and case has at most 10 unique candidates.

- [ ] **Step 2: Run the unit test and verify it fails**

```bash
pnpm --filter @causality/api test -- ai-candidate-comparison-service.test.ts
```

Expected: FAIL because the comparison service does not exist.

- [ ] **Step 3: Implement deterministic bulk lookup**

The repository must expose:

```ts
findEventMatches(events: readonly AtomicEventCandidate[]): Promise<EventMatchRow[][]>;
findCaseMatches(cases: readonly ConcreteCaseCandidate[]): Promise<CaseMatchRow[][]>;
findRelationMatches(relations: readonly ResolvedRelationProbe[]): Promise<RelationMatch[]>;
findLinkMatches(links: readonly ResolvedLinkProbe[]): Promise<LinkMatch[]>;
```

Use `jsonb_to_recordset` or `unnest` to avoid one SQL request per candidate. Return event names, descriptions, aliases, keywords, case content, relation endpoints, confidence, case count, and `updated_at`.

- [ ] **Step 4: Merge and rank candidates**

Use rank order:

```text
exact standard name
exact alias
prefix/fuzzy SQL
semantic similarity
```

Deduplicate by database ID before truncating to 10. Similarity is informational and never selects an action.

- [ ] **Step 5: Add integration fixtures**

Seed:

- one exact event-name match;
- one alias match;
- one fuzzy-only match;
- one semantically similar event;
- two similar case descriptions that refer to different occurrences;
- same-direction and reverse-direction relations;
- one existing and one absent relation-case link.

Assert the response separates event, case, relation, and link comparison sections.

- [ ] **Step 6: Run integration tests**

```bash
pnpm --filter @causality/api test:integration -- ai-candidate-comparison.integration.test.ts
```

Expected: PASS after implementation.

- [ ] **Step 7: Run targeted regression**

```bash
pnpm --filter @causality/api test -- event-service.test.ts case-service.test.ts relation-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/features/ai-capture apps/api/test
git commit -m "feat: compare complete AI candidate sets"
```

### Task 6: Prepare Immutable Versioned Import Plans

**Files:**
- Create: `apps/api/src/features/ai-capture/aiImportPlanRepository.ts`
- Create: `apps/api/src/features/ai-capture/aiImportPlanService.ts`
- Create: `apps/api/src/features/ai-capture/aiImportPlanValidator.ts`
- Test: `apps/api/test/ai-import-plan-service.test.ts`
- Test: `apps/api/test/ai-import-plan.integration.test.ts`

**Interfaces:**
- Consumes: `AiCaptureCandidateSet`, `AiCaptureDecisionSet`, comparison snapshots.
- Produces: `prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan>`.
- Produces: `status(planId: string): Promise<AiImportPlanStatus>`.
- Consumed by: Tasks 7, 8, and 10.

- [ ] **Step 1: Write failing validator tests**

Reject:

- reused event/case/relation without an existing ID;
- event rename, alias/keyword removal, case content update, relation endpoint/description update;
- stored link deletion;
- relation referencing a skipped event;
- link referencing a skipped case or relation;
- two final creates that violate a unique event/case/relation constraint.

- [ ] **Step 2: Run unit tests and verify they fail**

```bash
pnpm --filter @causality/api test -- ai-import-plan-service.test.ts
```

Expected: FAIL because plan modules do not exist.

- [ ] **Step 3: Implement plan normalization**

Produce a canonical payload with:

```ts
interface PreparedMutationSet {
  createEvents: PreparedEventCreate[];
  updateEvents: PreparedEventUpdate[];
  reuseEvents: PreparedEventReuse[];
  createCases: PreparedCaseCreate[];
  reuseCases: PreparedCaseReuse[];
  createRelations: PreparedRelationCreate[];
  reuseRelations: PreparedRelationReuse[];
  createLinks: PreparedLinkCreate[];
  confidenceChanges: PreparedConfidenceChange[];
  skipped: PreparedSkippedItem[];
  dependencies: PreparedDependencyVersion[];
}
```

Sort every collection by candidate ref before hashing and storage.

- [ ] **Step 4: Implement 30-minute lifecycle and replacement**

Within one repository transaction:

```sql
UPDATE ai_import_plans
SET status = 'replaced', updated_at = clock_timestamp()
WHERE id = $old_plan_id AND status = 'pending';

INSERT INTO ai_import_plans (..., expires_at)
VALUES (..., clock_timestamp() + interval '30 minutes');
```

`status()` must lazily mark elapsed pending plans as expired and must never revive replaced, invalidated, committed, or failed plans.

- [ ] **Step 5: Add integration tests**

Assert:

- V2 replaces V1;
- V1 cannot be committed;
- plan expires at 30 minutes;
- changing a dependency makes status invalidated;
- replacing event description stores old and new values;
- confidence preview matches `calculateAutomaticConfidence`;
- no-change plan remains valid and executable.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @causality/api test -- ai-import-plan-service.test.ts
pnpm --filter @causality/api test:integration -- ai-import-plan.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/ai-capture apps/api/test
git commit -m "feat: prepare immutable AI import plans"
```

### Task 7: Commit Plans Idempotently and Record Successful History

**Files:**
- Create: `apps/api/src/features/ai-capture/aiImportCommitRepository.ts`
- Create: `apps/api/src/features/ai-capture/aiImportCommitService.ts`
- Create: `apps/api/src/features/ai-capture/aiImportHistoryRepository.ts`
- Create: `apps/api/src/features/ai-capture/aiWorkflowErrorClassifier.ts`
- Test: `apps/api/test/ai-import-commit-service.test.ts`
- Test: `apps/api/test/ai-import-commit.integration.test.ts`
- Test: `apps/api/test/ai-import-history.integration.test.ts`

**Interfaces:**
- Produces: `commit(planId: string): Promise<AiImportCommitResult>`.
- Produces: paginated successful history and five-category record detail.
- Produces: stable data/system/configuration errors.
- Consumed by: Tasks 8, 10, and 13.

- [ ] **Step 1: Write failing commit-service tests**

Cover:

- only pending, latest, unexpired plan can commit;
- second call returns the first result without another mutation;
- a retryable `system_failed` plan can be retried only while still latest, unexpired,
  and dependency-valid;
- data conflicts set a repairable data error;
- PostgreSQL/unknown failures become non-repairable system errors;
- no-change success creates history and a capture marker;
- a stored relation-case link can be reused but never deleted.

- [ ] **Step 2: Run unit tests and verify they fail**

```bash
pnpm --filter @causality/api test -- ai-import-commit-service.test.ts
```

Expected: FAIL because commit service does not exist.

- [ ] **Step 3: Implement the transactional commit**

Use one `PoolClient` transaction with `SERIALIZABLE` isolation:

```ts
await client.query('begin isolation level serializable');
const plan = await repository.lockPlan(client, planId);
if (plan.status === 'committed') {
  const stored = await repository.readStoredResult(client, plan);
  await client.query('commit');
  return stored;
}
repository.assertCommittable(plan);
await repository.markSubmitting(client, plan.id);
await repository.lockAndRevalidateDependencies(client, plan);
const result = await repository.applyMutations(client, plan);
const history = await repository.writeSuccessfulHistory(client, plan, result);
await repository.markCommitted(client, plan.id, history.id, result);
await client.query('commit');
```

On any exception, roll back before classifying it. Persist `data_failed`, or
best-effort persist `system_failed` when PostgreSQL remains available, in a new
short transaction without creating success history. A data-failed plan cannot
be committed again. A system-failed plan may re-enter submission only after a
user-requested retry and full expiry/latest/dependency revalidation.

- [ ] **Step 4: Apply allowed mutations only**

The repository may:

- insert events, cases, and relations;
- append unique aliases and keywords;
- replace event descriptions;
- insert missing relation-case links;
- enqueue the existing event/case semantic indexing jobs for every created or
  semantically changed record in the same transaction;
- rely on confidence triggers for automatic recalculation.

It must not update existing event names, case contents, relation endpoints/descriptions, delete links, or perform merges/deletes.

- [ ] **Step 5: Write history in the same transaction**

Store summary counts plus record details for:

```text
event: created | reused | updated
case: created | reused
relation: created | reused
relation_case: created | reused
confidence: changed
```

The returned marker is:

```ts
`[Causality-Capture: ${historyId}]`
```

- [ ] **Step 6: Add concurrency and rollback integration tests**

Run two commits for the same plan concurrently and assert one business mutation and one history batch. Inject a failure after links but before history and assert there are no new events, cases, relations, links, confidence changes, or history.

Also assert a data failure stores `data_failed`, a recoverable database connection
stores `system_failed`, a total database outage returns a structured system error
even when the best-effort status write cannot run, and retrying a still-valid
`system_failed` plan succeeds exactly once.

- [ ] **Step 7: Add history pagination tests**

Assert descending completion time, fixed page size 50, success-only batches, long detail content preserved, and categories independently paginated.

- [ ] **Step 8: Run focused tests**

```bash
pnpm --filter @causality/api test -- ai-import-commit-service.test.ts
pnpm --filter @causality/api test:integration -- ai-import-commit.integration.test.ts ai-import-history.integration.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/features/ai-capture apps/api/test
git commit -m "feat: commit AI plans with auditable history"
```

### Task 8: Expose Typed AI Capture and MCP Settings APIs

**Files:**
- Create: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Create: `apps/api/src/features/mcp-settings/mcpSettingsRepository.ts`
- Create: `apps/api/src/features/mcp-settings/mcpSettingsService.ts`
- Create: `apps/api/src/features/mcp-settings/mcpSettingsRoutes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Test: `apps/api/test/ai-capture-routes.test.ts`
- Test: `apps/api/test/ai-capture-routes.integration.test.ts`
- Test: `apps/api/test/mcp-settings.integration.test.ts`

**Interfaces:**
- Produces API routes consumed by `@causality/mcp` and Web:
  - `POST /api/ai-captures/compare`
  - `POST /api/ai-captures/plans`
  - `GET /api/ai-captures/plans/:planId`
  - `POST /api/ai-captures/plans/:planId/commit`
  - `GET /api/ai-captures/results/:historyId`
  - `GET /api/ai-captures/history`
  - `GET /api/ai-captures/history/:batchId`
  - `GET /api/ai-captures/history/:batchId/records`
  - `GET /api/mcp/settings`
  - `POST /api/mcp/settings/rotate-token`
  - `POST /api/mcp/authorize`

- [ ] **Step 1: Write failing route tests**

Assert Zod validation, 50-event rejection, plan IDs, history pagination, and exact HTTP mappings:

```text
400 invalid JSON/data
401 invalid MCP token
404 missing plan/history
409 stale/replaced/data conflict
410 expired plan
503 semantic/system dependency unavailable
```

Set an explicit 8 MiB body limit and bounded request timeout for compare and prepare routes.
Add one payload below the limit and one payload above it; the latter must fail before
candidate comparison and must not create a plan.

- [ ] **Step 2: Run route tests and verify they fail**

```bash
pnpm --filter @causality/api test -- ai-capture-routes.test.ts
```

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement token management**

Repository interface:

```ts
interface McpSettingsRepository {
  get(): Promise<McpSettingsRecord>;
  authorize(token: string): Promise<boolean>;
  rotate(): Promise<McpSettingsRecord>;
}
```

Compare token values with `timingSafeEqual` over equal-length buffers. Rotation uses `randomBytes(32).toString('hex')`, increments `token_version`, and returns the new client configuration.

- [ ] **Step 4: Implement API routes and error mapping**

Every workflow endpoint under `/api/ai-captures`—including compare, prepare,
status, commit, and result—requires `x-causality-mcp-token`. Web history and MCP
settings display endpoints remain accessible through the existing local Web
origin. `POST /api/mcp/authorize` accepts the forwarded token header and returns
only `{ authorized: true, tokenVersion }`.

`GET /api/mcp/settings` returns the current endpoint, service status, masked token,
full token for explicit reveal/copy actions, and token version. Resolve service
status with a bounded probe of the configured MCP `/health` endpoint; timeout or
connection failure reports `stopped` without failing the whole settings response.

- [ ] **Step 5: Register routes without enlarging `app.ts` responsibilities**

Create the services in a focused factory:

```ts
registerAiCaptureRoutes(app, pool, { semanticQuery, semanticWorkerClient });
registerMcpSettingsRoutes(app, pool);
```

Keep `app.ts` limited to wiring.

- [ ] **Step 6: Run integration tests**

```bash
pnpm --filter @causality/api test:integration -- ai-capture-routes.integration.test.ts mcp-settings.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run API regression**

```bash
pnpm --filter @causality/api test
pnpm --filter @causality/api test:integration
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api packages/contracts
git commit -m "feat: expose AI capture and MCP settings APIs"
```

### Task 9: Create the MCP Application and Read-Only Knowledge Tools

**Files:**
- Create: `apps/mcp/package.json`
- Create: `apps/mcp/tsconfig.json`
- Create: `apps/mcp/tsconfig.build.json`
- Create: `apps/mcp/vitest.config.ts`
- Create: `apps/mcp/src/config/env.ts`
- Create: `apps/mcp/src/api/causalityApiClient.ts`
- Create: `apps/mcp/src/server/createMcpServer.ts`
- Create: `apps/mcp/src/tools/registerKnowledgeTools.ts`
- Test: `apps/mcp/test/causalityApiClient.test.ts`
- Test: `apps/mcp/test/knowledgeTools.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `CausalityApiClient`.
- Produces read tools: `search_atomic_events`, `get_atomic_event`, `search_concrete_cases`, `get_causal_relation`, `get_relation_cases`, `query_local_causal_graph`.
- Consumed by: Task 10.

- [ ] **Step 1: Add the package with pinned SDK**

`apps/mcp/package.json` must include:

```json
{
  "name": "@causality/mcp",
  "type": "module",
  "dependencies": {
    "@causality/contracts": "workspace:*",
    "@modelcontextprotocol/sdk": "1.30.0",
    "zod": "4.4.3"
  }
}
```

Add `build`, `typecheck`, and `test` scripts matching the other apps.

- [ ] **Step 2: Write failing API-client tests**

Mock `fetch` and assert:

- correct API URL and query parameters;
- `x-causality-mcp-token` forwarding for protected operations;
- contract parsing;
- API errors become typed `CausalityApiClientError`;
- timeout and abort become a system error without logging the body.

- [ ] **Step 3: Run the MCP test and verify it fails**

```bash
pnpm --filter @causality/mcp test -- causalityApiClient.test.ts
```

Expected: FAIL because the client does not exist.

- [ ] **Step 4: Implement the API client**

Expose exact methods:

```ts
interface CausalityApiClient {
  searchEvents(query: string): Promise<EventListResponse>;
  getEvent(id: string): Promise<EventDetail>;
  getEventRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<EventRelationListResponse>;
  searchCases(query: string): Promise<CaseListResponse>;
  getRelation(id: string): Promise<RelationDetail>;
  getRelationCases(id: string): Promise<RelationCaseListResponse>;
  queryGraph(input: CausalGraphQuery): Promise<CausalGraphResponse>;
  compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison>;
  prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan>;
  planStatus(id: string): Promise<AiImportPlanStatus>;
  commit(id: string): Promise<AiImportCommitResult>;
  result(historyId: string): Promise<AiImportCommitResult>;
}
```

- [ ] **Step 5: Write failing tool registration tests**

Use an in-memory/fake API client and assert the six read tools are listed, use strict schemas, have `readOnlyHint: true`, and return both readable text and `structuredContent`.

- [ ] **Step 6: Register read-only tools**

Every result must identify database facts without adding model conclusions.
`get_atomic_event` returns the event detail plus one explicitly bounded relation
page and its continuation cursor, using `getEventRelations`; it must not silently
truncate without returning `hasMore`.

The local graph tool accepts only existing API limits:

```ts
{
  centerEventId: z.uuid(),
  direction: z.enum(['upstream', 'downstream', 'both']),
  limit: z.union([z.literal(20), z.literal(50), z.literal(100)]),
  minConfidence: z.number().min(0).max(100),
  minCaseCount: z.number().int().min(0).max(10),
}
```

- [ ] **Step 7: Run focused tests**

```bash
pnpm --filter @causality/mcp test
pnpm --filter @causality/mcp typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mcp package.json pnpm-lock.yaml
git commit -m "feat: add MCP knowledge query tools"
```

### Task 10: Add Capture Tools, Prompt, HTTP, and stdio Transports

**Files:**
- Create: `apps/mcp/src/tools/registerCaptureTools.ts`
- Create: `apps/mcp/src/prompts/capturePrompt.ts`
- Create: `apps/mcp/src/prompts/generatePortablePrompt.ts`
- Create: `apps/mcp/src/transports/httpServer.ts`
- Create: `apps/mcp/src/transports/stdioServer.ts`
- Create: `apps/mcp/src/http.ts`
- Create: `apps/mcp/src/stdio.ts`
- Create: `prompts/causality-capture.md`
- Create: `skills/causality-capture/SKILL.md`
- Test: `apps/mcp/test/captureTools.test.ts`
- Test: `apps/mcp/test/capturePrompt.test.ts`
- Test: `apps/mcp/test/httpTransport.test.ts`
- Test: `apps/mcp/test/stdioTransport.test.ts`

**Interfaces:**
- Produces tools: `compare_knowledge_candidates`, `prepare_knowledge_changes`, `get_import_plan_status`, `commit_knowledge_changes`, `get_import_result`.
- Produces MCP Prompt: `causality_capture`.
- Produces authenticated `/mcp` Streamable HTTP and stdio entrypoints.
- Produces unauthenticated local `/health` for Compose and settings status probes.

- [ ] **Step 1: Write failing capture-tool tests**

Assert:

- one compare call accepts all four candidate arrays;
- prepare returns a readable complete plan plus structured plan;
- commit requires only the immutable plan ID and is annotated as modifying data;
- data errors preserve `aiCanRepair`;
- system errors preserve `retryCurrentPlan`;
- successful commit returns the exact capture marker.

- [ ] **Step 2: Run the tool tests and verify they fail**

```bash
pnpm --filter @causality/mcp test -- captureTools.test.ts
```

Expected: FAIL because capture tools are absent.

- [ ] **Step 3: Register capture tools**

Use per-tool annotations:

```ts
const annotations = {
  compare_knowledge_candidates: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  },
  prepare_knowledge_changes: {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
  },
  get_import_plan_status: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  },
  commit_knowledge_changes: {
    readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
  },
  get_import_result: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  },
} as const;
```

Do not expose create/update/delete/merge/SQL tools.

- [ ] **Step 4: Write failing Prompt tests**

Assert the canonical Prompt contains:

- explicit user trigger only;
- automatic visible-scope marker discovery;
- main-topic relevance and 50-event cap;
- automatic pre-plan processing;
- conservative “skip” for unresolved candidates;
- complete-plan revision loop;
- explicit confirmation requirement;
- data-failure regeneration;
- system-failure stop-and-wait;
- success marker output.

- [ ] **Step 5: Implement one canonical Prompt source**

Export:

```ts
export const CAUSALITY_CAPTURE_PROMPT_NAME = 'causality_capture';
export function buildCausalityCapturePrompt(): string;
```

Add `pnpm --filter @causality/mcp prompt:generate`, implemented by
`generatePortablePrompt.ts`, to write `prompts/causality-capture.md` from that
canonical function. The Prompt test reads the checked-in Markdown file and asserts
byte-for-byte equality with `buildCausalityCapturePrompt()`. The Skill tells the
client to invoke the MCP Prompt or load the Markdown Prompt; it must not copy the
full workflow rules.

- [ ] **Step 6: Write failing HTTP security tests**

Assert:

- missing/invalid Bearer Token → 401;
- invalid `Origin` → 403;
- allowed local Origin or absent non-browser Origin reaches MCP initialization;
- body above configured limit → 413;
- token/body never appears in captured logs.
- a rotated token invalidates the next request on an existing MCP session;
- `/health` exposes only `{ status: 'ok' }` and no token or application data.

- [ ] **Step 7: Implement Streamable HTTP**

Parse:

```ts
const authorization = request.headers.authorization;
const origin = request.headers.origin;
```

Reject bodies above 8 MiB before parsing. Authorize via `POST /api/mcp/authorize`
on every HTTP request, validate `Origin`
against configured local origins, then pass the request to the session's
`StreamableHTTPServerTransport`. Store only transport/session objects in the
in-memory session map; bind each tool execution to the token from the currently
authorized request and never cache authorization across requests. Bind to
`127.0.0.1` by default.

- [ ] **Step 8: Implement stdio from the same server factory**

```ts
const server = createCausalityMcpServer({ apiClient });
await server.connect(new StdioServerTransport());
```

The stdio entrypoint retrieves the current local credential from
`GET /api/mcp/settings` at process startup, so users do not manually configure an
HTTP Bearer Token for process-based clients. It forwards that credential only to
the internal API. Only valid MCP JSON-RPC may be written to stdout; logs go to stderr.

- [ ] **Step 9: Run MCP tests**

```bash
pnpm --filter @causality/mcp test
pnpm --filter @causality/mcp typecheck
pnpm --filter @causality/mcp build
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/mcp prompts skills package.json pnpm-lock.yaml
git commit -m "feat: add MCP capture workflow transports"
```

### Task 11: Integrate MCP into Development and Docker Compose

**Files:**
- Create: `apps/mcp/Dockerfile`
- Modify: `compose.yaml`
- Modify: `compose.dev.yaml`
- Modify: `package.json`
- Modify: `apps/api/.env.example`
- Create: `apps/mcp/.env.example`
- Modify: `tests/production/compose-contract.test.mjs`
- Modify: `tests/production/e2e-contract.test.mjs`
- Modify: `tests/production/production-smoke.spec.ts`
- Modify: `scripts/test-production-compose.sh`

**Interfaces:**
- Produces: `pnpm mcp:dev`, `pnpm mcp:stdio`, `pnpm mcp:inspect`.
- Produces: `causality-mcp:local` image and localhost `${CAUSALITY_MCP_PORT:-8081}`.
- Consumed by: Tasks 12 and 14.

- [ ] **Step 1: Add failing production contract tests**

Assert Compose contains:

```text
mcp service
127.0.0.1:${CAUSALITY_MCP_PORT:-8081}:8081
dependency on healthy API
healthcheck
no database URL in MCP environment
API base URL http://api:3000
```

Also assert API, Worker, and PostgreSQL remain unexposed in production.

- [ ] **Step 2: Run contract tests and verify they fail**

```bash
pnpm test:compose
```

Expected: FAIL because the MCP service is absent.

- [ ] **Step 3: Add the MCP image and Compose service**

The Docker image builds contracts and MCP only. Compose configuration:

```yaml
mcp:
  image: causality-mcp:local
  build:
    context: .
    dockerfile: apps/mcp/Dockerfile
  environment:
    NODE_ENV: production
    HOST: 0.0.0.0
    PORT: 8081
    CAUSALITY_API_URL: http://api:3000
  ports:
    - '127.0.0.1:${CAUSALITY_MCP_PORT:-8081}:8081'
  depends_on:
    api:
      condition: service_healthy
```

Binding `0.0.0.0` is only inside the container; host publication remains loopback-only.
Configure the API-side status probe as
`CAUSALITY_MCP_HEALTH_URL=http://mcp:8081/health`; source development defaults to
`http://127.0.0.1:8081/health`. The probe is informational and must not participate
in API health readiness, preventing an API↔MCP startup dependency cycle.

- [ ] **Step 4: Add root development scripts**

```json
{
  "mcp:dev": "pnpm --filter @causality/contracts build && pnpm --filter @causality/mcp dev",
  "mcp:stdio": "pnpm --filter @causality/contracts build && pnpm --filter @causality/mcp stdio",
  "mcp:inspect": "pnpm dlx @modelcontextprotocol/inspector@2.0.0 pnpm mcp:stdio"
}
```

Include MCP HTTP in the root `dev`, `build`, `typecheck`, and `test` pipelines.

- [ ] **Step 5: Extend production smoke tests**

Verify `/mcp` without credentials returns 401 and the MCP container is healthy. Do not place the real token in test logs.

- [ ] **Step 6: Run container tests**

```bash
pnpm test:compose
pnpm test:production
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mcp compose.yaml compose.dev.yaml package.json apps/api/.env.example scripts tests/production
git commit -m "feat: run MCP with local Compose"
```

### Task 12: Add MCP Service Management to Parameter Settings

**Files:**
- Create: `apps/web/src/features/parameter-settings/McpSettingsPanel.tsx`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.tsx`
- Modify: `apps/web/src/features/parameter-settings/parameterSettingsApi.ts`
- Modify: `apps/web/src/features/parameter-settings/parameterSettings.css`
- Test: `apps/web/src/features/parameter-settings/McpSettingsPanel.test.tsx`
- Modify: `apps/web/src/features/parameter-settings/ParameterSettings.test.tsx`
- Test: `tests/e2e/parameter-settings-mcp.spec.ts`

**Interfaces:**
- Consumes: MCP settings and rotate-token API contracts.
- Produces: status, endpoint, masked/revealed token, copy configuration, and token rotation UI.

- [ ] **Step 1: Write failing component tests**

Assert:

- status and endpoint render;
- token is masked by default;
- reveal toggles locally;
- copy uses a complete Streamable HTTP configuration;
- rotation opens `AppDialog`;
- success replaces the shown token and invalidates cached data;
- failure uses the existing three-second auto-dismiss alert.

- [ ] **Step 2: Run component tests and verify they fail**

```bash
pnpm --filter @causality/web test -- McpSettingsPanel.test.tsx
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Add typed API functions**

```ts
export function getMcpSettings(signal?: AbortSignal): Promise<McpSettingsResponse>;
export function rotateMcpToken(): Promise<McpTokenRotationResponse>;
```

Use `requestJson` and shared Zod contracts.

- [ ] **Step 4: Build the compact settings panel**

Display:

```text
MCP 服务
状态        运行中
连接地址    http://127.0.0.1:8081/mcp
访问令牌    ••••••••••••abcd
[显示] [复制客户端配置] [重新生成令牌]
```

Use the existing page surface, buttons, dialog, and alert patterns. Do not add a new sidebar item.

- [ ] **Step 5: Add page and E2E tests**

Mock clipboard for component tests. In Playwright, verify the panel fits the compact desktop layout and rotation requires confirmation.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @causality/web test -- McpSettingsPanel.test.tsx ParameterSettings.test.tsx
pnpm exec playwright test tests/e2e/parameter-settings-mcp.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Manual review checkpoint**

Start the development app and verify:

- spacing matches the existing semantic section;
- token is not visible on initial render;
- copied URL and header are correct;
- rotation warning clearly says existing clients will disconnect.

- [ ] **Step 8: Commit**

```bash
git add apps/web tests/e2e/parameter-settings-mcp.spec.ts
git commit -m "feat: manage MCP connection settings"
```

### Task 13: Add AI Import History List and Detail UI

**Files:**
- Create: `apps/web/src/features/data-transfer/components/AiImportHistoryTable.tsx`
- Create: `apps/web/src/features/data-transfer/pages/AiImportDetailPage.tsx`
- Modify: `apps/web/src/features/data-transfer/DataTransferPage.tsx`
- Modify: `apps/web/src/features/data-transfer/dataTransferApi.ts`
- Modify: `apps/web/src/features/data-transfer/dataTransfer.css`
- Modify: `apps/web/src/app/router.tsx`
- Test: `apps/web/src/features/data-transfer/components/AiImportHistoryTable.test.tsx`
- Test: `apps/web/src/features/data-transfer/pages/AiImportDetailPage.test.tsx`
- Modify: `apps/web/src/features/data-transfer/DataTransferPage.test.tsx`
- Test: `tests/e2e/ai-import-history.spec.ts`

**Interfaces:**
- Consumes: successful AI history list, batch detail, and category record APIs.
- Produces: third `aiHistory` sub-tab and `/data-transfer/ai-imports/:batchId` route.

- [ ] **Step 1: Write failing DataTransferPage tests**

Assert tabs are exactly:

```ts
[
  { value: 'import', label: '导入' },
  { value: 'export', label: '导出' },
  { value: 'aiHistory', label: 'AI 导入历史' },
]
```

Assert `?tab=aiHistory&page=2` loads only AI history and preserves the active page.

- [ ] **Step 2: Run page tests and verify they fail**

```bash
pnpm --filter @causality/web test -- DataTransferPage.test.tsx
```

Expected: FAIL because the third tab is absent.

- [ ] **Step 3: Add typed history API functions**

```ts
getAiImportHistory(page: number, signal?: AbortSignal): Promise<AiImportBatchListResponse>;
getAiImportBatch(id: string, signal?: AbortSignal): Promise<AiImportBatchDetail>;
getAiImportRecords(
  id: string,
  type: AiImportRecordType,
  page: number,
  signal?: AbortSignal,
): Promise<AiImportRecordListResponse>;
```

- [ ] **Step 4: Build the list with existing shared components**

Columns:

```text
完成时间 | 采集主题 | 处理结果 | 数据变化 | 操作
```

Use `OverflowText`, `ListPagination`, list focus restoration, descending order, page size 50, and “成功·无变化”.

- [ ] **Step 5: Write and implement detail tests**

Detail summary includes event, case, relation, attribute/link, and confidence counts. Detail tabs are:

```text
原子事件 | 具体案例 | 因果关系 | 案例关联 | 置信度变化
```

Every category has independent page parameters, uses `OverflowText`, and remains read-only.

- [ ] **Step 6: Add router and consistent return navigation**

Route:

```text
/data-transfer/ai-imports/:batchId
```

Returning to history restores `tab=aiHistory`, page, and focused batch.

- [ ] **Step 7: Run component and E2E tests**

```bash
pnpm --filter @causality/web test -- DataTransferPage.test.tsx AiImportHistoryTable.test.tsx AiImportDetailPage.test.tsx
pnpm exec playwright test tests/e2e/ai-import-history.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Manual review checkpoint**

Verify the approved mockup:

- third tab placement;
- compact table and pagination;
- long topic and record tooltips;
- success/no-change badges;
- five detail categories;
- consistent heading, left margin, and return behavior.

- [ ] **Step 9: Commit**

```bash
git add apps/web tests/e2e/ai-import-history.spec.ts
git commit -m "feat: show successful AI import history"
```

### Task 14: Full MCP Acceptance, Documentation, and Release Gate

**Files:**
- Create: `apps/api/src/database/benchmark/aiCaptureBenchmark.ts`
- Create: `manual-test-data/p3-01-ai-capture-inspector.json`
- Create: `docs/testing/p3-01-mcp-inspector-and-client-acceptance.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `tests/production/compose-contract.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

**Interfaces:**
- Produces: `pnpm ai-capture:benchmark`.
- Produces: reproducible Inspector and external-client manual test instructions.
- Produces: complete development and Compose startup documentation.

- [ ] **Step 1: Add a failing representative-capacity benchmark test**

Generate one candidate request containing:

```text
50 atomic events
500 concrete cases
500 causal relations
1,000 relation-case links
```

Include exact, alias, fuzzy, semantic, reused link, reverse relation, and skipped candidates. Assert comparison and plan preparation finish without partial writes and report elapsed time and peak process RSS.

- [ ] **Step 2: Implement the benchmark command**

Add:

```json
"ai-capture:benchmark": "pnpm --filter @causality/api ai-capture:benchmark"
```

The benchmark must use a disposable Testcontainers database and must not modify the developer’s normal database.
Use the deterministic semantic-client fixture for the capacity measurement so the
automated gate does not download a model or depend on network access. The manual
Inspector acceptance uses the configured local lightweight model and completed real index.

- [ ] **Step 3: Add Inspector fixture and test document**

Document:

```bash
docker compose up -d --build --wait
pnpm mcp:inspect
```

Include exact manual calls for initialize, list tools/prompts, read query, compare, prepare, status, commit, repeated commit, expired plan, stale data, and invalid token. Use fixture JSON only for Inspector input; user-facing AI output remains ordinary language.

- [ ] **Step 4: Rewrite README sections**

Explain:

- Compose starts HTTP MCP automatically;
- endpoint and token location;
- Streamable HTTP client configuration;
- stdio fallback;
- MCP Prompt discovery and the non-standard nature of slash commands;
- Markdown Prompt and Skill usage;
- explicit capture/plan/confirmation loop;
- successful AI history;
- new confidence behavior;
- data/system failure recovery;
- no in-app online model or Web search.

- [ ] **Step 5: Run the complete automated gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:compose
pnpm test:production
pnpm test:e2e
pnpm ai-capture:benchmark
pnpm db:verify
```

Expected: every command exits 0; benchmark produces finite elapsed time and RSS; `db:verify` reports valid.

- [ ] **Step 6: Perform manual MCP acceptance**

Follow the new document and verify:

1. HTTP and stdio both work in Inspector.
2. External AI queries existing knowledge.
3. Explicit capture generates V1 without intermediate questions.
4. Two user revisions generate replacement plans.
5. Explicit confirmation commits once.
6. history and success marker appear.
7. a second capture starts after the marker.
8. data failure regenerates a plan.
9. system failure waits for user instruction.
10. no transcript, URL, failed batch, or reasoning is stored.

- [ ] **Step 7: Perform final code review**

Check:

- no MCP module connects to PostgreSQL;
- no duplicated Prompt workflow text;
- no unrestricted mutation tools;
- no token or candidate payload logging;
- no N+1 deterministic candidate queries;
- no row-level confidence trigger;
- no partial commit path;
- no UI reimplementation of shared pagination, tabs, dialogs, or tooltips.

- [ ] **Step 8: Update Roadmap state**

After automated verification set P3-01 to `等待人工复核`; after user approval set it to `已完成`. Do not mark P3-02 started.

- [ ] **Step 9: Commit the release candidate locally**

```bash
git add README.md apps packages database compose.yaml compose.dev.yaml docs manual-test-data package.json pnpm-lock.yaml scripts skills tests
git commit -m "docs: complete P3-01 MCP acceptance"
```

Do not push. Wait for the user’s final P3-01 code inspection and explicit GitHub push instruction.
