import type { ImportOutcome } from '@causality/contracts';

import type { ParsedImportRecord } from './dataTransferTypes.js';

type EventRecord = Extract<ParsedImportRecord, { type: 'event' }>;
type CaseRecord = Extract<ParsedImportRecord, { type: 'case' }>;
type RelationRecord = Extract<ParsedImportRecord, { type: 'relation' }>;

export interface PlannedOccurrence {
  sourceSequence: number;
  itemSequence: number;
  provisionalOutcome: ImportOutcome;
}

export interface PlannedEvent {
  key: string;
  creator: EventRecord;
  occurrences: PlannedOccurrence[];
}

export interface PlannedCase {
  key: string;
  creator: CaseRecord;
  occurrences: PlannedOccurrence[];
}

export interface PlannedRelation {
  key: string;
  causeEventKey: string;
  effectEventKey: string;
  creator: RelationRecord;
  occurrences: PlannedOccurrence[];
}

export interface PlannedRelationCase {
  key: string;
  relationKey: string;
  caseKey: string;
  causeEventName: string;
  effectEventName: string;
  caseContent: string;
  occurrences: PlannedOccurrence[];
}

export interface FileImportPlan {
  records: ParsedImportRecord[];
  events: PlannedEvent[];
  cases: PlannedCase[];
  relations: PlannedRelation[];
  relationCases: PlannedRelationCase[];
}

function eventKey(name: string): string {
  return name.trim().toLowerCase();
}

function caseKey(content: string): string {
  return content.trim();
}

function occurrence(
  sourceSequence: number,
  itemSequence: number,
  reused: boolean,
): PlannedOccurrence {
  return {
    sourceSequence,
    itemSequence,
    provisionalOutcome: reused ? 'reused' : 'created',
  };
}

export function planFileRecords(records: readonly ParsedImportRecord[]): FileImportPlan {
  const orderedRecords = [...records].sort((left, right) => left.sequence - right.sequence);
  const eventMap = new Map<string, PlannedEvent>();
  const caseMap = new Map<string, PlannedCase>();
  const relationMap = new Map<string, PlannedRelation>();
  const relationCaseMap = new Map<string, PlannedRelationCase>();

  const addCase = (
    record: CaseRecord,
    sourceSequence: number,
    itemSequence: number,
  ): PlannedCase => {
    const key = caseKey(record.content);
    const existing = caseMap.get(key);
    if (existing) {
      existing.occurrences.push(occurrence(sourceSequence, itemSequence, true));
      return existing;
    }

    const planned: PlannedCase = {
      key,
      creator: record,
      occurrences: [occurrence(sourceSequence, itemSequence, false)],
    };
    caseMap.set(key, planned);
    return planned;
  };

  for (const record of orderedRecords) {
    if (record.type === 'event') {
      const key = eventKey(record.name);
      const existing = eventMap.get(key);
      if (existing) {
        existing.occurrences.push(occurrence(record.sequence, 1, true));
      } else {
        eventMap.set(key, {
          key,
          creator: record,
          occurrences: [occurrence(record.sequence, 1, false)],
        });
      }
      continue;
    }

    if (record.type === 'case') {
      addCase(record, record.sequence, 1);
      continue;
    }

    const causeEventKey = eventKey(record.causeEventName);
    const effectEventKey = eventKey(record.effectEventName);
    if (causeEventKey === effectEventKey) continue;

    const key = `${causeEventKey}\u0000${effectEventKey}`;
    const existingRelation = relationMap.get(key);
    if (existingRelation) {
      existingRelation.occurrences.push(occurrence(record.sequence, 1, true));
    } else {
      relationMap.set(key, {
        key,
        causeEventKey,
        effectEventKey,
        creator: record,
        occurrences: [occurrence(record.sequence, 1, false)],
      });
    }

    record.caseContents.forEach((content, index) => {
      const caseItemSequence = 2 + index * 2;
      const relationCaseItemSequence = caseItemSequence + 1;
      const plannedCase = addCase(
        {
          type: 'case',
          sequence: record.sequence,
          content,
        },
        record.sequence,
        caseItemSequence,
      );
      const relationCaseKey = `${key}\u0000${plannedCase.key}`;
      const existingRelationCase = relationCaseMap.get(relationCaseKey);
      if (existingRelationCase) {
        existingRelationCase.occurrences.push(
          occurrence(record.sequence, relationCaseItemSequence, true),
        );
      } else {
        relationCaseMap.set(relationCaseKey, {
          key: relationCaseKey,
          relationKey: key,
          caseKey: plannedCase.key,
          causeEventName: record.causeEventName,
          effectEventName: record.effectEventName,
          caseContent: content,
          occurrences: [occurrence(record.sequence, relationCaseItemSequence, false)],
        });
      }
    });
  }

  return {
    records: orderedRecords,
    events: [...eventMap.values()],
    cases: [...caseMap.values()],
    relations: [...relationMap.values()],
    relationCases: [...relationCaseMap.values()],
  };
}
