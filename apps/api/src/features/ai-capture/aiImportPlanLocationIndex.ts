import type { AiCaptureQualityEntityType, PrepareAiImportPlanInput } from '@causality/contracts';

export interface IndexedPlanValue<T> {
  value: T;
  index: number;
  path: string;
}

export interface RefPlanLocationIndex<T> {
  byRef: Map<string, IndexedPlanValue<T>[]>;
}

export interface LinkPlanLocationIndex<T extends { relationRef: string; caseRef: string }> {
  byKey: Map<string, IndexedPlanValue<T>[]>;
  byRef: Map<string, IndexedPlanValue<T>[]>;
}

export interface AiImportPlanLocationIndex {
  candidates: {
    atomicEvents: RefPlanLocationIndex<
      PrepareAiImportPlanInput['candidates']['atomicEvents'][number]
    >;
    concreteCases: RefPlanLocationIndex<
      PrepareAiImportPlanInput['candidates']['concreteCases'][number]
    >;
    causalRelations: RefPlanLocationIndex<
      PrepareAiImportPlanInput['candidates']['causalRelations'][number]
    >;
    relationCaseLinks: LinkPlanLocationIndex<
      PrepareAiImportPlanInput['candidates']['relationCaseLinks'][number]
    >;
  };
  decisions: {
    atomicEvents: RefPlanLocationIndex<
      PrepareAiImportPlanInput['decisions']['atomicEvents'][number]
    >;
    concreteCases: RefPlanLocationIndex<
      PrepareAiImportPlanInput['decisions']['concreteCases'][number]
    >;
    causalRelations: RefPlanLocationIndex<
      PrepareAiImportPlanInput['decisions']['causalRelations'][number]
    >;
    relationCaseLinks: LinkPlanLocationIndex<
      PrepareAiImportPlanInput['decisions']['relationCaseLinks'][number]
    >;
  };
}

export function aiImportPlanLinkKey(relationRef: string, caseRef: string): string {
  return `${relationRef}\u0000${caseRef}`;
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function indexByRef<T extends { ref: string }>(
  values: readonly T[],
  basePath: string,
): RefPlanLocationIndex<T> {
  const byRef = new Map<string, IndexedPlanValue<T>[]>();
  values.forEach((value, index) => {
    append(byRef, value.ref, { value, index, path: `${basePath}/${index}` });
  });
  return { byRef };
}

function indexLinks<T extends { relationRef: string; caseRef: string }>(
  values: readonly T[],
  basePath: string,
): LinkPlanLocationIndex<T> {
  const byKey = new Map<string, IndexedPlanValue<T>[]>();
  const byRef = new Map<string, IndexedPlanValue<T>[]>();
  values.forEach((value, index) => {
    const entry = { value, index, path: `${basePath}/${index}` };
    append(byKey, aiImportPlanLinkKey(value.relationRef, value.caseRef), entry);
    append(byRef, value.relationRef, entry);
    if (value.caseRef !== value.relationRef) append(byRef, value.caseRef, entry);
  });
  return { byKey, byRef };
}

export function buildAiImportPlanLocationIndex(
  input: PrepareAiImportPlanInput,
): AiImportPlanLocationIndex {
  return {
    candidates: {
      atomicEvents: indexByRef(input.candidates.atomicEvents, '/candidates/atomicEvents'),
      concreteCases: indexByRef(input.candidates.concreteCases, '/candidates/concreteCases'),
      causalRelations: indexByRef(input.candidates.causalRelations, '/candidates/causalRelations'),
      relationCaseLinks: indexLinks(
        input.candidates.relationCaseLinks,
        '/candidates/relationCaseLinks',
      ),
    },
    decisions: {
      atomicEvents: indexByRef(input.decisions.atomicEvents, '/decisions/atomicEvents'),
      concreteCases: indexByRef(input.decisions.concreteCases, '/decisions/concreteCases'),
      causalRelations: indexByRef(input.decisions.causalRelations, '/decisions/causalRelations'),
      relationCaseLinks: indexLinks(
        input.decisions.relationCaseLinks,
        '/decisions/relationCaseLinks',
      ),
    },
  };
}

function pathsForRefs<T>(index: RefPlanLocationIndex<T>, refs: readonly string[]): string[] {
  const entries = new Map<string, IndexedPlanValue<T>>();
  for (const ref of refs) {
    for (const entry of index.byRef.get(ref) ?? []) entries.set(entry.path, entry);
  }
  return [...entries.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.path);
}

export function linkEntriesForPlanRefs<T extends { relationRef: string; caseRef: string }>(
  index: LinkPlanLocationIndex<T>,
  refs: readonly string[],
): IndexedPlanValue<T>[] {
  const refSet = new Set(refs);
  const entries = new Map<string, IndexedPlanValue<T>>();
  for (const ref of refSet) {
    for (const entry of index.byRef.get(ref) ?? []) {
      if (refSet.has(entry.value.relationRef) && refSet.has(entry.value.caseRef)) {
        entries.set(entry.path, entry);
      }
    }
  }
  return [...entries.values()].sort((left, right) => left.index - right.index);
}

export function decisionPathsForPlanIssue(
  index: AiImportPlanLocationIndex,
  entityType: AiCaptureQualityEntityType,
  refs: readonly string[],
): string[] {
  switch (entityType) {
    case 'event':
      return pathsForRefs(index.decisions.atomicEvents, refs);
    case 'case':
      return pathsForRefs(index.decisions.concreteCases, refs);
    case 'relation':
      return pathsForRefs(index.decisions.causalRelations, refs);
    case 'link':
      return linkEntriesForPlanRefs(index.decisions.relationCaseLinks, refs).map(
        (entry) => entry.path,
      );
    case 'batch':
      return ['/decisions'];
  }
}
