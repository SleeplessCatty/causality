# UX-02 Detail Navigation, Complete Candidates, and Graph Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete event/relation/case detail navigation, unbounded paginated candidate selection, delayed event metadata tooltips, and application-styled causal graph controls.

**Architecture:** Extend the existing candidate endpoints with stable cursor pagination while keeping database tables unchanged. Build one reusable exhaustive-candidate hook and one windowed listbox primitive, then connect the existing relation selectors and graph selector to them. Add a dedicated relation detail route and two narrowly scoped UI primitives (`DelayedOverflowTooltip` and `CompactSelect`) without restructuring unrelated pages.

**Tech Stack:** TypeScript 6, React 19, React Router 8, TanStack React Query 5, Fastify 5, PostgreSQL 18, Zod 4, Vitest 4, Testing Library, Playwright 1.61, Cytoscape 3.

## Global Constraints

- Do not add database columns, tables, migrations, or indexes.
- Candidate endpoints use cursor pagination with batches of at most 100 and no total result limit.
- Candidate UIs start rendering after the first page, automatically fetch remaining pages, deduplicate by ID, cancel stale searches, and do not show match reasons or total counts.
- Candidate listboxes retain all fetched data but window DOM rows so every match remains reachable without rendering thousands of buttons at once.
- Event creation/edit duplicate suggestions remain limited to five entries.
- Relation inline expansion shows only description and the five recent cases; relation detail shows every linked case without visible pagination.
- Desktop is the acceptance target; preserve the UX-01 compact layout and current visual tokens.
- Graph directions are ordered 双向、下游、上游; graph zoom range is 10%–200%.
- Do not begin Phase 2 or add unrelated refactors.

---

## File and Responsibility Map

### Contracts and API

- `packages/contracts/src/events/eventSchemas.ts`: event candidate cursor query and paginated response contract.
- `packages/contracts/src/cases/caseSchemas.ts`: case candidate cursor query and paginated response contract.
- `packages/contracts/src/index.ts`: exports the revised candidate page types.
- `packages/contracts/test/events.test.ts`: event candidate contract boundaries.
- `packages/contracts/test/cases.test.ts`: case candidate contract boundaries.
- `apps/api/src/features/events/eventCursor.ts`: signed event-candidate cursor encoding and validation.
- `apps/api/src/features/cases/caseCursor.ts`: signed case-candidate cursor encoding and validation.
- `apps/api/src/features/events/eventRepository.ts`: stable candidate page query and response.
- `apps/api/src/features/events/eventService.ts`: paginated candidate return type.
- `apps/api/src/features/events/eventRoutes.ts`: revised candidate response.
- `apps/api/src/features/cases/caseRepository.ts`: stable candidate page query and response.
- `apps/api/test/event-cursor.test.ts`: candidate cursor tamper/query tests.
- `apps/api/test/case-cursor.test.ts`: candidate cursor tamper/query tests.
- `apps/api/test/events.integration.test.ts`: event candidate pagination integration.
- `apps/api/test/cases.integration.test.ts`: case candidate pagination integration.

### Shared Web Candidate Infrastructure

- `apps/web/src/shared/candidates/useExhaustiveCandidates.ts`: automatic cursor traversal, cancellation, deduplication, and retry state.
- `apps/web/src/shared/candidates/useExhaustiveCandidates.test.tsx`: hook behavior.
- `apps/web/src/shared/listbox/WindowedListbox.tsx`: accessible fixed-row windowed listbox.
- `apps/web/src/shared/listbox/WindowedListbox.test.tsx`: windowing and active-item visibility.
- `apps/web/src/features/events/api/eventApi.ts`: `getEventCandidatePage` plus the existing five-item helper.
- `apps/web/src/features/cases/api/caseApi.ts`: `getCaseCandidatePage`.
- `apps/web/src/features/relations/components/EventSelector.tsx`: exhaustive event candidates.
- `apps/web/src/features/relations/components/CaseSelectorRow.tsx`: exhaustive case candidates and new-case-first ordering.
- `apps/web/src/features/relations/components/RelationForm.test.tsx`: event candidate pagination regression.
- `apps/web/src/features/relations/components/RelationCasesField.test.tsx`: case ordering and pagination regression.
- `apps/web/src/styles/events.css`: shared relation candidate placement and listbox styles.

### Relation and Event Navigation

- `apps/web/src/app/router.tsx`: `/relations/:relationId` route.
- `apps/web/src/features/relations/pages/RelationDetailPage.tsx`: relation detail and exhaustive linked cases.
- `apps/web/src/features/relations/pages/RelationDetailPage.test.tsx`: detail states and links.
- `apps/web/src/features/relations/pages/RelationListPage.tsx`: arrow/detail/edit links, concise expansion, pagination collapse.
- `apps/web/src/features/relations/pages/RelationListPage.test.tsx`: list behavior.
- `apps/web/src/features/relations/pages/RelationCreatePage.tsx`: post-create detail redirect.
- `apps/web/src/features/relations/pages/RelationEditPage.tsx`: detail return/cancel/save targets.
- `apps/web/src/features/relations/components/RelationForm.tsx`: existing/reverse detail links.
- `apps/web/src/features/cases/pages/CaseDetailPage.tsx`: linked relation detail links.
- `apps/web/src/features/cases/pages/CasePages.test.tsx`: case-to-relation navigation.
- `apps/web/src/features/events/pages/EventListPage.tsx`: row edit links.
- `apps/web/src/styles/events.css`: relation detail and action-column styles.

### Tooltip and Graph Controls

- `apps/web/src/shared/tooltip/DelayedOverflowTooltip.tsx`: delayed hover, immediate focus, overflow detection, and cleanup.
- `apps/web/src/shared/tooltip/DelayedOverflowTooltip.test.tsx`: timing and visibility rules.
- `apps/web/src/features/events/pages/EventListPage.tsx`: tooltip integration for aliases/keywords.
- `apps/web/src/features/events/pages/EventListPage.test.tsx`: edit and tooltip tests.
- `apps/web/src/features/causal-graph/components/CompactSelect.tsx`: custom single-select listbox.
- `apps/web/src/features/causal-graph/components/CompactSelect.test.tsx`: keyboard and pointer behavior.
- `apps/web/src/features/causal-graph/components/GraphEventSelector.tsx`: exhaustive candidates and smaller typography.
- `apps/web/src/features/causal-graph/components/GraphEventSelector.test.tsx`: automatic candidate pagination.
- `apps/web/src/features/causal-graph/components/CausalGraphToolbar.tsx`: four `CompactSelect` instances and direction order.
- `apps/web/src/features/causal-graph/components/CausalGraphToolbar.test.tsx`: option order and change events.
- `apps/web/src/features/causal-graph/components/CausalGraphCanvas.tsx`: 10% zoom-out floor.
- `apps/web/src/features/causal-graph/graph/createGraphRuntime.ts`: Cytoscape `minZoom: 0.1`.
- `apps/web/src/features/causal-graph/components/CausalGraphCanvas.test.tsx`: zoom boundary.
- `apps/web/src/features/causal-graph/graph/createGraphRuntime.test.ts`: runtime boundary.
- `apps/web/src/features/causal-graph/causalGraph.css`: compact custom menus, font sizes, and symmetric zoom separators.

### Acceptance

- `tests/e2e/causal-graph.spec.ts`: graph selector/dropdown/zoom regression.
- `tests/e2e/management-navigation.spec.ts`: create this for event/relation/case navigation and edit actions.
- `tests/e2e/candidate-selection.spec.ts`: create this for complete candidate loading, new-case-first, and upward case menu.
- `tests/e2e/compact-workspace.spec.ts`: metadata tooltip and no-overflow regression.
- `README.md`: document relation detail and complete candidate behavior.
- `docs/stages/pre-phase-2/UX-02-detail-navigation-unbounded-candidates-graph-controls-design.md`: implementation and test status.

---

### Task 1: Paginated Candidate Contracts and API

**Files:**

- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/cases/caseSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/events.test.ts`
- Modify: `packages/contracts/test/cases.test.ts`
- Modify: `apps/api/src/features/events/eventCursor.ts`
- Modify: `apps/api/src/features/cases/caseCursor.ts`
- Modify: `apps/api/src/features/events/eventRepository.ts`
- Modify: `apps/api/src/features/events/eventService.ts`
- Modify: `apps/api/src/features/events/eventRoutes.ts`
- Modify: `apps/api/src/features/cases/caseRepository.ts`
- Modify: `apps/api/test/event-cursor.test.ts`
- Modify: `apps/api/test/case-cursor.test.ts`
- Modify: `apps/api/test/events.integration.test.ts`
- Modify: `apps/api/test/cases.integration.test.ts`

**Interfaces:**

- Produces: `EventCandidateListResponse = { items: EventCandidate[]; nextCursor: string | null; hasMore: boolean }`.
- Produces: `CaseCandidateListResponse = { items: CaseReference[]; nextCursor: string | null; hasMore: boolean }`.
- Produces: `encodeEventCandidateCursor`, `decodeEventCandidateCursor`, `encodeCaseCandidateCursor`, and `decodeCaseCandidateCursor`.
- Consumes: existing name/alias/keyword ranking and existing case content ranking.

- [ ] **Step 1: Write failing contract tests for cursor queries and page responses**

```ts
expect(
  eventCandidateQuerySchema.parse({ q: '油价', limit: '100', cursor: 'cursor-value' }),
).toEqual({ q: '油价', limit: 100, cursor: 'cursor-value' });
expect(() => eventCandidateQuerySchema.parse({ q: '油价', limit: 101 })).toThrow();
expect(
  eventCandidateListResponseSchema.parse({
    items: [{ id: eventId, name: '原油价格上涨' }],
    nextCursor: 'next',
    hasMore: true,
  }),
).toMatchObject({ hasMore: true, nextCursor: 'next' });

expect(
  caseCandidateQuerySchema.parse({ q: '关税', limit: '100', cursor: 'cursor-value' }),
).toEqual({ q: '关税', limit: 100, cursor: 'cursor-value' });
expect(() => caseCandidateQuerySchema.parse({ q: '关税', limit: 101 })).toThrow();
expect(
  caseCandidateListResponseSchema.parse({
    items: [{ id: eventId, content: '2025年4月美国宣布关税措施' }],
    nextCursor: null,
    hasMore: false,
  }),
).toMatchObject({ hasMore: false, nextCursor: null });
```

- [ ] **Step 2: Run contract tests and verify the old schemas fail**

Run: `pnpm --filter @causality/contracts test -- test/events.test.ts test/cases.test.ts`

Expected: FAIL because candidate query schemas reject `cursor`/100 and candidate responses do not accept pagination metadata.

- [ ] **Step 3: Extend the candidate contracts and exports**

```ts
export const eventCandidateQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(2_000).optional(),
    excludeId: z.uuid().optional(),
  })
  .strict();

export const eventCandidateListResponseSchema = z
  .object({
    items: z.array(eventCandidateSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const caseCandidateQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(50),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const caseCandidateListResponseSchema = z
  .object({
    items: z.array(caseReferenceSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();
```

Keep the inferred type names and export them from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Write failing cursor unit tests**

```ts
const eventCursor = encodeEventCandidateCursor({
  query: '油价',
  excludeId: null,
  rank: 2,
  normalizedName: '原油价格上涨',
  id: '11111111-1111-4111-8111-111111111111',
});
expect(decodeEventCandidateCursor(eventCursor, '油价')).toMatchObject({ rank: 2 });
expect(() => decodeEventCandidateCursor(eventCursor, '利率')).toThrow(InvalidEventCursorError);

const caseCursor = encodeCaseCandidateCursor({
  query: '关税',
  rank: 2,
  updatedAt: '2026-07-22T00:00:00.000Z',
  id: '22222222-2222-4222-8222-222222222222',
});
expect(decodeCaseCandidateCursor(caseCursor, '关税')).toMatchObject({ rank: 2 });
expect(() => decodeCaseCandidateCursor(`${caseCursor}x`, '关税')).toThrow(InvalidCaseCursorError);
```

- [ ] **Step 5: Run cursor tests and verify the new functions are missing**

Run: `pnpm --filter @causality/api test -- test/event-cursor.test.ts test/case-cursor.test.ts`

Expected: FAIL because the candidate cursor functions do not exist.

- [ ] **Step 6: Add signed candidate cursor states**

Add event candidate state with exact fields:

```ts
const candidateCursorStateSchema = z
  .object({
    kind: z.literal('candidate'),
    query: z.string().min(1).max(120),
    excludeId: z.uuid().nullable(),
    rank: z.number().int().min(1).max(6),
    normalizedName: z.string().min(1).max(120),
    id: z.uuid(),
  })
  .strict();

export function encodeEventCandidateCursor(
  input: Omit<z.infer<typeof candidateCursorStateSchema>, 'kind'>,
): string {
  return encodeEventCursor({ kind: 'candidate', ...input });
}

export function decodeEventCandidateCursor(
  cursor: string,
  query: string,
  excludeId?: string,
): z.infer<typeof candidateCursorStateSchema> {
  const state = decodeVerifiedEventEnvelope(cursor);
  if (
    state.kind !== 'candidate' ||
    state.query !== normalizeQuery(query) ||
    state.excludeId !== (excludeId ?? null)
  ) {
    throw new InvalidEventCursorError();
  }
  return state;
}
```

Extend the case envelope kind to `'list' | 'relations' | 'candidates'` and add:

```ts
const candidateStateSchema = z
  .object({
    query: z.string().min(1).max(50),
    rank: z.number().int().min(1).max(3),
    updatedAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();
```

Encode/decode it through the existing checksum helper and reject mismatched normalized queries.

- [ ] **Step 7: Write failing API integration tests for consecutive candidate pages**

```ts
const first = await app!.inject({
  method: 'GET',
  url: '/api/events/candidates?q=CANDIDATEPAGE&limit=2',
});
const firstPage = first.json<EventCandidateListResponse>();
const second = await app!.inject({
  method: 'GET',
  url: `/api/events/candidates?q=CANDIDATEPAGE&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
});
const secondPage = second.json<EventCandidateListResponse>();
expect(firstPage).toMatchObject({ hasMore: true });
expect(secondPage.items.map((item) => item.id)).not.toEqual(
  expect.arrayContaining(firstPage.items.map((item) => item.id)),
);

const caseFirst = await app!.inject({
  method: 'GET',
  url: '/api/cases/candidates?q=CASEPAGE&limit=2',
});
const casePage = caseFirst.json<CaseCandidateListResponse>();
expect(casePage.nextCursor).toEqual(expect.any(String));
```

Also assert that using a cursor with a different query returns status 400 and `VALIDATION_ERROR`.

- [ ] **Step 8: Run integration tests and verify pagination metadata is missing**

Run: `pnpm test:integration -- events.integration.test.ts cases.integration.test.ts`

Expected: FAIL because the candidate repositories still return a single limited array/page.

- [ ] **Step 9: Implement stable event and case candidate pages**

Change repository/service interfaces to return the contract page types. Event candidate logic must:

```ts
const cursor = query.cursor
  ? decodeEventCandidateCursor(query.cursor, normalizedQuery, query.excludeId)
  : undefined;
const rows = await this.searchRows(normalizedQuery, query.limit + 2, cursor);
const eligible = rows.filter((row) => row.id !== query.excludeId).slice(0, query.limit + 1);
const hasMore = eligible.length > query.limit;
const pageRows = eligible.slice(0, query.limit);
const last = pageRows.at(-1);
return {
  items: pageRows.map((row) => ({ id: row.id, name: row.name })),
  hasMore,
  nextCursor:
    hasMore && last
      ? encodeEventCandidateCursor({
          query: normalizedQuery,
          excludeId: query.excludeId ?? null,
          rank: last.rank!,
          normalizedName: last.normalized_name!,
          id: last.id,
        })
      : null,
};
```

Allow `searchRows` to consume both normal search and candidate cursor states because both use `(rank ASC, normalized_name ASC, id ASC)`.

Implement the case candidate query through a ranked CTE and the mixed-order cursor predicate:

```sql
with ranked as (
  select c.id,
         c.content,
         c.created_at,
         c.updated_at,
         case
           when lower(c.content) = $1 then 1
           when lower(c.content) like $2 escape '\\' then 2
           else 3
         end::int as rank
  from concrete_cases c
  where lower(c.content) like $3 escape '\\'
)
select id, content, created_at, updated_at, 0::int as relation_count, rank
from ranked
where $4::int is null
   or rank > $4
   or (rank = $4 and (updated_at, id) < ($5::timestamptz, $6::uuid))
order by rank asc, updated_at desc, id desc
limit $7
```

Return `query.limit` items, `hasMore`, and a cursor created from the last visible row. Map invalid candidate cursors through the existing validation-error path.

- [ ] **Step 10: Run contracts, API unit tests, and integrations**

Run: `pnpm --filter @causality/contracts test && pnpm --filter @causality/api test && pnpm test:integration -- events.integration.test.ts cases.integration.test.ts`

Expected: all tests PASS.

- [ ] **Step 11: Commit candidate API pagination**

```bash
git add packages/contracts apps/api/src/features/events apps/api/src/features/cases apps/api/test
git commit -m "feat: paginate event and case candidates"
```

---

### Task 2: Exhaustive Candidate Hook and Windowed Selectors

**Files:**

- Create: `apps/web/src/shared/candidates/useExhaustiveCandidates.ts`
- Create: `apps/web/src/shared/candidates/useExhaustiveCandidates.test.tsx`
- Create: `apps/web/src/shared/listbox/WindowedListbox.tsx`
- Create: `apps/web/src/shared/listbox/WindowedListbox.test.tsx`
- Modify: `apps/web/src/features/events/api/eventApi.ts`
- Modify: `apps/web/src/features/cases/api/caseApi.ts`
- Modify: `apps/web/src/features/events/components/EventForm.tsx`
- Modify: `apps/web/src/features/relations/components/EventSelector.tsx`
- Modify: `apps/web/src/features/relations/components/CaseSelectorRow.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.test.tsx`
- Modify: `apps/web/src/features/relations/components/RelationCasesField.test.tsx`
- Modify: `apps/web/src/styles/events.css`

**Interfaces:**

- Consumes: Task 1 page response contracts.
- Produces: `getEventCandidatePage(query, options, signal)` and `getCaseCandidatePage(query, options, signal)`.
- Produces: `useExhaustiveCandidates<T>({ queryKey, query, enabled, loadPage, getId })`.
- Produces: `WindowedListbox` with fixed `itemHeight`, `activeIndex`, and `renderOption`.

- [ ] **Step 1: Write failing API-client and exhaustive-hook tests**

```tsx
const loadPage = vi
  .fn()
  .mockResolvedValueOnce({
    items: [{ id: '1', name: '第一项' }],
    nextCursor: 'next',
    hasMore: true,
  })
  .mockResolvedValueOnce({
    items: [
      { id: '1', name: '第一项' },
      { id: '2', name: '第二项' },
    ],
    nextCursor: null,
    hasMore: false,
  });

const { result } = renderHook(
  () =>
    useExhaustiveCandidates({
      queryKey: ['test-candidates'],
      query: '测试',
      enabled: true,
      loadPage,
      getId: (item: { id: string }) => item.id,
    }),
  { wrapper: createQueryWrapper() },
);
await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['1', '2']));
expect(loadPage).toHaveBeenNthCalledWith(2, '测试', 'next', expect.any(AbortSignal));
```

Add a second test that changes `query` before page two resolves and asserts stale items never enter the new result.

- [ ] **Step 2: Run the hook test and verify the module is missing**

Run: `pnpm --filter @causality/web test -- src/shared/candidates/useExhaustiveCandidates.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement page clients and `useExhaustiveCandidates`**

```ts
export async function getEventCandidatePage(
  query: string,
  options: { limit?: number; cursor?: string; excludeId?: string } = {},
  signal?: AbortSignal,
): Promise<EventCandidateListResponse> {
  const parameters = new URLSearchParams({ q: query, limit: String(options.limit ?? 100) });
  if (options.cursor) parameters.set('cursor', options.cursor);
  if (options.excludeId) parameters.set('excludeId', options.excludeId);
  return eventCandidateListResponseSchema.parse(
    await requestJson(`/api/events/candidates?${parameters}`, {}, signal),
  );
}
```

Keep `getEventCandidates` for `EventForm`, but implement it as one page with the requested limit and return `page.items`. Add the corresponding case page function.

The shared hook must use `useInfiniteQuery` with `initialPageParam: undefined`, `getNextPageParam`, and an effect that calls `fetchNextPage()` while `hasNextPage && !isFetchingNextPage`. Flatten pages through a `Set` keyed by `getId`.

- [ ] **Step 4: Write failing windowed-listbox tests**

```tsx
render(
  <WindowedListbox
    id="candidate-list"
    itemCount={1_000}
    itemHeight={36}
    activeIndex={500}
    renderOption={(index, style) => (
      <button role="option" style={style} aria-selected={index === 500}>
        候选 {index}
      </button>
    )}
  />,
);
expect(screen.getByRole('option', { name: '候选 500' })).toBeTruthy();
expect(screen.queryByRole('option', { name: '候选 0' })).toBeNull();
```

Also test a scroll event updates the rendered range and all rows retain correct absolute indices.

- [ ] **Step 5: Run the listbox test and verify the component is missing**

Run: `pnpm --filter @causality/web test -- src/shared/listbox/WindowedListbox.test.tsx`

Expected: FAIL because `WindowedListbox` does not exist.

- [ ] **Step 6: Implement `WindowedListbox`**

```tsx
interface WindowedListboxProps {
  id: string;
  itemCount: number;
  itemHeight: number;
  activeIndex: number;
  className?: string;
  renderOption: (index: number, style: CSSProperties) => ReactNode;
}
```

Use a scroll container with `role="listbox"`, a spacer of `itemCount * itemHeight`, an overscan of four rows, and absolutely positioned rendered options. When `activeIndex` changes, call `scrollTo` only when the active row is outside the visible range. Never change the logical option index because keyboard selection depends on it.

- [ ] **Step 7: Write failing relation selector tests**

For event selection, mock page one and page two and assert a page-two event becomes selectable. For cases, assert exact visible order:

```tsx
expect(await screen.findAllByRole('option')).toHaveLength(3);
expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
  '创建新案例：新的政策事件',
  '新的政策事件相关案例一',
  '新的政策事件相关案例二',
]);
expect(screen.getByRole('listbox').className).toContain('is-above');
```

Add an exact-match response test proving that `创建新案例` is absent.

- [ ] **Step 8: Run relation component tests and verify old limits/order fail**

Run: `pnpm --filter @causality/web test -- src/features/relations/components/RelationForm.test.tsx src/features/relations/components/RelationCasesField.test.tsx`

Expected: FAIL because selectors request only 8/10 entries, the new-case option is last, and the case menu opens below.

- [ ] **Step 9: Connect relation selectors to exhaustive pages**

Use `useExhaustiveCandidates` in both selectors. Maintain a numeric `activeIndex`; ArrowDown/ArrowUp wrap through all loaded options, Home/End select bounds, Enter selects the active option, and Escape closes the list.

Build case options with the new item first:

```ts
const options = useMemo(
  () => [
    ...(mayCreate ? [{ type: 'new' as const, content: normalizedQuery }] : []),
    ...candidates.items.map((candidate) => ({ type: 'existing' as const, candidate })),
  ],
  [candidates.items, mayCreate, normalizedQuery],
);
```

Because exact matches rank first, compute `mayCreate` after the first successful page; suppress it whenever any loaded item has exactly equal content. Render the case listbox with `is-above` and `bottom: calc(100% + 5px)`.

- [ ] **Step 10: Run all affected Web tests**

Run: `pnpm --filter @causality/web test -- src/shared src/features/events/components/EventForm.test.tsx src/features/relations/components`

Expected: all tests PASS.

- [ ] **Step 11: Commit exhaustive candidate selectors**

```bash
git add apps/web/src/shared apps/web/src/features/events/api apps/web/src/features/events/components/EventForm.tsx apps/web/src/features/cases/api apps/web/src/features/relations/components apps/web/src/styles/events.css
git commit -m "feat: load all relation form candidates"
```

---

### Task 3: Relation Detail and Cross-Entity Navigation

**Files:**

- Create: `apps/web/src/features/relations/pages/RelationDetailPage.tsx`
- Create: `apps/web/src/features/relations/pages/RelationDetailPage.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationCreatePage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationCreatePage.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationEditPage.test.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.test.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseDetailPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/styles/events.css`

**Interfaces:**

- Consumes: existing `getRelation` and paginated `getCases`.
- Produces: route `/relations/:relationId` and `RelationDetailPage`.
- Produces: relation list arrow/detail/edit destinations and post-write detail redirects.

- [ ] **Step 1: Write failing `RelationDetailPage` tests**

```tsx
expect(await screen.findByRole('heading', { name: /原油价格上涨.*航空成本上升/ })).toBeTruthy();
expect(screen.getByRole('link', { name: '原油价格上涨' }).getAttribute('href')).toBe(
  `/events/${detail.causeEvent.id}`,
);
expect(screen.getByRole('link', { name: '编辑因果关系' }).getAttribute('href')).toBe(
  `/relations/${detail.id}/edit`,
);
expect(await screen.findByRole('link', { name: '案例一' })).toBeTruthy();
expect(screen.getByRole('link', { name: '案例二' })).toBeTruthy();
```

Mock two `/api/cases?relationId=...` pages and assert both pages appear as one list. Add empty, retryable later-page failure, and missing relation tests.

- [ ] **Step 2: Run the detail-page test and verify the page is missing**

Run: `pnpm --filter @causality/web test -- src/features/relations/pages/RelationDetailPage.test.tsx`

Expected: FAIL because the page and route do not exist.

- [ ] **Step 3: Implement and route `RelationDetailPage`**

Use one normal query for the relationship and one infinite query for linked cases:

```ts
const relation = useQuery({
  queryKey: ['relations', 'detail', relationId],
  queryFn: ({ signal }) => getRelation(relationId, signal),
  enabled: Boolean(relationId),
});
const linkedCases = useInfiniteQuery({
  queryKey: ['cases', 'relation-associations', relationId],
  queryFn: ({ pageParam, signal }) =>
    getCases(
      {
        q: '',
        relationId,
        limit: 100,
        ...(pageParam ? { cursor: pageParam } : {}),
      },
      signal,
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
  enabled: relation.isSuccess && relation.data.caseCount > 0,
});
```

Add an effect that automatically calls `fetchNextPage()` while a next page exists and no next-page request is active. Flatten `linkedCases.data.pages` into one list. This preserves successful pages when a later page fails; the retry button calls `fetchNextPage()` rather than restarting the base relationship query.

Render a linked cause/effect heading, confidence, case count, description, created/updated timestamps, edit button, and a continuous list of every linked case. Register `{ path: 'relations/:relationId', element: <RelationDetailPage /> }` before the edit route.

- [ ] **Step 4: Rewrite relation-list tests for links, concise expansion, and collapse-on-page**

```tsx
expect(screen.getByRole('link', { name: '查看因果关系详情' }).getAttribute('href')).toBe(
  `/relations/${relation.id}`,
);
expect(screen.getByRole('link', { name: '编辑' }).getAttribute('href')).toBe(
  `/relations/${relation.id}/edit`,
);
fireEvent.click(screen.getByRole('button', { name: '展开' }));
expect(await screen.findByText('燃油成本传导')).toBeTruthy();
expect(screen.queryByText('创建时间')).toBeNull();
expect(screen.queryByRole('link', { name: '编辑关系' })).toBeNull();
fireEvent.click(screen.getByRole('button', { name: '下一页' }));
expect(router.state.location.search).not.toContain('expanded=');
```

Test the same removal for 上一页.

- [ ] **Step 5: Implement relation-list navigation and page collapse**

Change the action text to 展开/收起. Wrap the arrow in a `Link` with `aria-label="查看因果关系详情"`; keep both event name links. Add an edit link in the action cell. Remove created time and edit from the expanded row. Introduce `previousPage()` and call this helper from both page buttons:

```ts
function clearExpanded(): void {
  setSearchParameters(
    (current) => {
      const next = new URLSearchParams(current);
      next.delete('expanded');
      return next;
    },
    { replace: true },
  );
}
```

Call `clearExpanded()` before mutating `pageIndex` in both page directions.

- [ ] **Step 6: Update create/edit/form/case navigation tests**

Assert exact targets:

```ts
expect(router.state.location.pathname).toBe(`/relations/${relationId}`);
expect(screen.getByRole('link', { name: '查看已有关系' }).getAttribute('href')).toBe(
  `/relations/${relationId}`,
);
expect(screen.getByRole('link', { name: /测试原因.*测试结果/ }).getAttribute('href')).toBe(
  `/relations/${relationId}`,
);
```

- [ ] **Step 7: Implement all relation-detail destinations**

Change create success, edit success, edit cancel/back, same-direction notice, reverse-direction notice, and case relation links from `/relations?expanded=...` to `/relations/:relationId`. Keep list expansion links only for the explicit “查看全部 N 条” case filter behavior.

- [ ] **Step 8: Run relation and case page tests**

Run: `pnpm --filter @causality/web test -- src/features/relations src/features/cases/pages/CasePages.test.tsx`

Expected: all tests PASS.

- [ ] **Step 9: Commit relation detail navigation**

```bash
git add apps/web/src/app/router.tsx apps/web/src/features/relations apps/web/src/features/cases/pages/CaseDetailPage.tsx apps/web/src/features/cases/pages/CasePages.test.tsx apps/web/src/styles/events.css
git commit -m "feat: add causal relation detail navigation"
```

---

### Task 4: Event Row Editing and Delayed Metadata Tooltip

**Files:**

- Create: `apps/web/src/shared/tooltip/DelayedOverflowTooltip.tsx`
- Create: `apps/web/src/shared/tooltip/DelayedOverflowTooltip.test.tsx`
- Modify: `apps/web/src/features/events/pages/EventListPage.tsx`
- Modify: `apps/web/src/features/events/pages/EventListPage.test.tsx`
- Modify: `apps/web/src/styles/events.css`

**Interfaces:**

- Produces: `DelayedOverflowTooltip({ values, children, delay?: number })`.
- Produces: event list `/events/:eventId/edit` row action.

- [ ] **Step 1: Write failing tooltip timing and overflow tests**

```tsx
vi.useFakeTimers();
render(
  <DelayedOverflowTooltip values={['油价上涨', '原油上涨', '国际油价上涨', '第四个别名']}>
    <span data-testid="metadata">油价上涨、原油上涨、国际油价上涨</span>
  </DelayedOverflowTooltip>,
);
fireEvent.mouseEnter(screen.getByTestId('metadata'));
vi.advanceTimersByTime(1_999);
expect(screen.queryByRole('tooltip')).toBeNull();
vi.advanceTimersByTime(1);
expect(screen.getByRole('tooltip').textContent).toBe(
  '油价上涨、原油上涨、国际油价上涨、第四个别名',
);
fireEvent.mouseLeave(screen.getByTestId('metadata'));
expect(screen.queryByRole('tooltip')).toBeNull();
```

Add tests for immediate keyboard focus, Escape, zero hidden/overflow content, and timer cleanup on unmount. Mock `scrollWidth` and `clientWidth` for the truncation-only case.

- [ ] **Step 2: Run tooltip tests and verify the component is missing**

Run: `pnpm --filter @causality/web test -- src/shared/tooltip/DelayedOverflowTooltip.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `DelayedOverflowTooltip`**

```tsx
interface DelayedOverflowTooltipProps {
  values: string[];
  children: ReactElement;
  delay?: number;
}
```

Clone the child with a ref, `tabIndex={0}` only when tooltip is enabled, and `aria-describedby` while open. Enable when `values.length > 3` or `element.scrollWidth > element.clientWidth`. Use a 2,000ms hover timer, immediate focus open, and document Escape/scroll listeners only while open. Clear every timer/listener on close and unmount.

- [ ] **Step 4: Write failing event-list integration tests**

```tsx
expect(screen.getByRole('link', { name: '编辑' }).getAttribute('href')).toBe(
  '/events/11111111-1111-4111-8111-111111111111/edit',
);
fireEvent.mouseEnter(screen.getByText('油价上涨、原油上涨、国际油价上涨'));
await vi.advanceTimersByTimeAsync(2_000);
expect(screen.getByRole('tooltip')).toHaveTextContent('第四个别名');
```

Assert the two-value keyword cell does not get tooltip semantics when it fits.

- [ ] **Step 5: Add event edit column and tooltip integration**

Change `MetadataCell` to pass all values into `DelayedOverflowTooltip`, preserve the first-three display and `+N`, and render a final table action column with a text link to `/events/${event.id}/edit`. Keep the 56px row density.

- [ ] **Step 6: Run event and tooltip tests**

Run: `pnpm --filter @causality/web test -- src/shared/tooltip src/features/events/pages/EventListPage.test.tsx src/features/events/pages/EventPages.test.tsx`

Expected: all tests PASS.

- [ ] **Step 7: Commit event list interactions**

```bash
git add apps/web/src/shared/tooltip apps/web/src/features/events/pages/EventListPage.tsx apps/web/src/features/events/pages/EventListPage.test.tsx apps/web/src/styles/events.css
git commit -m "feat: add event row editing and metadata tooltips"
```

---

### Task 5: Application-Styled Graph Selects and 10% Zoom

**Files:**

- Create: `apps/web/src/features/causal-graph/components/CompactSelect.tsx`
- Create: `apps/web/src/features/causal-graph/components/CompactSelect.test.tsx`
- Modify: `apps/web/src/features/causal-graph/components/GraphEventSelector.tsx`
- Modify: `apps/web/src/features/causal-graph/components/GraphEventSelector.test.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphToolbar.test.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.tsx`
- Modify: `apps/web/src/features/causal-graph/components/CausalGraphCanvas.test.tsx`
- Modify: `apps/web/src/features/causal-graph/graph/createGraphRuntime.ts`
- Modify: `apps/web/src/features/causal-graph/graph/createGraphRuntime.test.ts`
- Modify: `apps/web/src/features/causal-graph/causalGraph.css`

**Interfaces:**

- Consumes: Task 2 `useExhaustiveCandidates` and `WindowedListbox`.
- Produces: `CompactSelect<T extends string | number>`.
- Preserves: toolbar change callbacks and URL-driven immediate graph refresh.

- [ ] **Step 1: Write failing `CompactSelect` behavior tests**

```tsx
render(
  <CompactSelect
    label="方向"
    ariaLabel="查询方向"
    value="both"
    options={[
      { value: 'both', label: '双向' },
      { value: 'downstream', label: '下游' },
      { value: 'upstream', label: '上游' },
    ]}
    onChange={onChange}
  />,
);
fireEvent.click(screen.getByRole('button', { name: '查询方向' }));
expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
  '双向',
  '下游',
  '上游',
]);
fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' });
fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
expect(onChange).toHaveBeenCalledWith('upstream');
```

Add Home, arrows, Space, Escape, outside click, selected value, and “only one open menu” tests.

- [ ] **Step 2: Run the custom-select test and verify the component is missing**

Run: `pnpm --filter @causality/web test -- src/features/causal-graph/components/CompactSelect.test.tsx`

Expected: FAIL because `CompactSelect` does not exist.

- [ ] **Step 3: Implement `CompactSelect`**

```tsx
interface CompactSelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface CompactSelectProps<T extends string | number> {
  label: string;
  ariaLabel: string;
  value: T;
  options: Array<CompactSelectOption<T>>;
  onChange: (value: T) => void;
}
```

Use a trigger button with `aria-haspopup="listbox"` and a positioned listbox. Track highlighted index separately from value. Stop propagation for handled keyboard events so the graph canvas does not react. Coordinate the single-open rule through a module-level custom event carrying a generated component ID; opening one instance tells other instances to close.

- [ ] **Step 4: Write failing toolbar and graph-event tests**

Assert no native combobox exists for the four discrete controls, direction option order is exact, and callbacks receive correct typed values. Mock two event candidate pages and assert a second-page event can be selected. Assert the API page requests use limit 100.

- [ ] **Step 5: Replace native selects and connect exhaustive center candidates**

Set direction data exactly:

```ts
const directions = [
  { value: 'both' as const, label: '双向' },
  { value: 'downstream' as const, label: '下游' },
  { value: 'upstream' as const, label: '上游' },
];
```

Render four `CompactSelect` instances and keep existing callback signatures. Replace `GraphEventSelector`'s single candidate query with `useExhaustiveCandidates`, add active-index/Home/End behavior, and render through `WindowedListbox`.

- [ ] **Step 6: Write failing zoom-boundary tests**

```ts
expect(cytoscape).toHaveBeenCalledWith(expect.objectContaining({ minZoom: 0.1 }));
canvasControl.zoomOut();
expect(runtime.setZoom).toHaveBeenLastCalledWith(0.1, expect.any(Boolean));
```

Set the current zoom close enough to 0.1 that one zoom-out would previously clamp at 0.25.

- [ ] **Step 7: Implement 10% zoom and graph toolbar styling**

Change `minZoom: 0.25` to `minZoom: 0.1`, `Math.max(0.25, ...)` to `Math.max(0.1, ...)`, and the toolbar minus-button disabled condition from `zoom <= 0.25` to `zoom <= 0.1`.

CSS must include:

```css
.graph-event-selector input {
  font-size: 12px;
}

.graph-event-selector__options button {
  font-size: 11px;
}

.graph-viewport-controls output {
  border-right: 1px solid #d9e0da;
}
```

Style custom triggers/menus from existing toolbar colors and dimensions; remove native-select-specific rules. The toolbar must remain 1080×52 at the accepted desktop width.

- [ ] **Step 8: Run all causal graph unit tests**

Run: `pnpm --filter @causality/web test -- src/features/causal-graph`

Expected: all tests PASS.

- [ ] **Step 9: Commit graph controls**

```bash
git add apps/web/src/features/causal-graph apps/web/src/shared/candidates apps/web/src/shared/listbox
git commit -m "feat: refine causal graph controls and zoom"
```

---

### Task 6: Browser Regression, Documentation, and Acceptance Handoff

**Files:**

- Create: `tests/e2e/management-navigation.spec.ts`
- Create: `tests/e2e/candidate-selection.spec.ts`
- Modify: `tests/e2e/causal-graph.spec.ts`
- Modify: `tests/e2e/compact-workspace.spec.ts`
- Modify: `README.md`
- Modify: `docs/stages/pre-phase-2/UX-02-detail-navigation-unbounded-candidates-graph-controls-design.md`

**Interfaces:**

- Consumes: completed Tasks 1–5.
- Produces: browser evidence and manual-review instructions.

- [ ] **Step 1: Add failing management navigation E2E coverage**

```ts
test('navigates relation details and keeps list expansion concise', async ({ page }) => {
  await page.goto('/relations');
  const row = page.locator('tbody tr').first();
  await expect(row.getByRole('button', { name: '展开' })).toBeVisible();
  await row.getByRole('button', { name: '展开' }).click();
  await expect(page.getByText('创建时间')).toHaveCount(0);
  await row.getByRole('link', { name: '查看因果关系详情' }).click();
  await expect(page).toHaveURL(/\/relations\/[0-9a-f-]+$/);
  await expect(page.getByRole('link', { name: '编辑因果关系' })).toBeVisible();
});
```

Add event-row edit, relation-row edit, cause/effect detail, case-to-relation, and page-change-collapse flows.

- [ ] **Step 2: Add failing complete-candidate E2E coverage**

Use deterministic simulated data whose matching set exceeds one batch. Assert a page-two event/case becomes selectable, the new-case option is first, and the case menu bounding box ends above the input bounding box.

- [ ] **Step 3: Add failing graph and tooltip E2E coverage**

Assert custom direction order, no native select elements in the toolbar, 10% minimum zoom, center candidate smaller computed font sizes, the missing zoom separator is present, and event metadata tooltip appears only after two seconds.

- [ ] **Step 4: Run targeted E2E and fix only observed regressions**

Run: `pnpm test:e2e -- tests/e2e/management-navigation.spec.ts tests/e2e/candidate-selection.spec.ts tests/e2e/causal-graph.spec.ts tests/e2e/compact-workspace.spec.ts`

Expected: all selected tests PASS with no console errors or horizontal overflow at 1280×720.

- [ ] **Step 5: Verify with the in-app browser and capture acceptance screenshots**

Start `pnpm dev`, then use the in-app Browser at 1280×720 to verify:

1. event row edit and 2-second metadata tooltip;
2. relation expand/edit/arrow and full detail page;
3. case detail relation link;
4. relation event/case exhaustive selection and upward case menu;
5. graph center exhaustive selection, custom selects, direction order, separator, and 10% zoom;
6. no horizontal overflow and unchanged compact sidebar behavior.

Capture screenshots for the relation detail, relation form case dropdown, event tooltip, and graph toolbar. Use `view_image` on each final screenshot before handoff.

- [ ] **Step 6: Update README and UX-02 status**

Document the new relation detail route, row edit links, complete candidate loading, delayed metadata tooltips, custom graph selects, and 10% zoom. Change UX-02 status to “开发与自动化测试完成，等待人工复核” and append exact test counts plus the browser viewport and screenshot evidence.

- [ ] **Step 7: Run the complete quality gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command PASS. The existing causal-graph lazy chunk size warning may remain if no new regression increases it materially.

- [ ] **Step 8: Commit acceptance coverage and documentation**

```bash
git add tests/e2e README.md docs/stages/pre-phase-2/UX-02-detail-navigation-unbounded-candidates-graph-controls-design.md
git commit -m "test: prepare UX-02 manual acceptance"
```

- [ ] **Step 9: Hand off manual verification**

Report commits, exact automated counts, browser evidence, the known non-blocking build warning if still present, and a concise manual checklist. Do not mark UX-02 complete or begin Phase 2 until the user explicitly replies that manual verification passed.
