import type {
  ImportBatchSummary,
  ImportOutcome,
  ImportRecordText,
  ImportRecordType,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import { planFileRecords } from './importPlanner.js';
import type { ParsedImportRecord } from './dataTransferTypes.js';

export type ImportErrorCode =
  'CSV_NO_VALID_RECORDS' | 'IMPORT_CONFLICT_RETRY' | 'IMPORT_CANCELLED' | 'IMPORT_TIMEOUT';

export class ImportError extends Error {
  public constructor(
    public readonly code: ImportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ImportError';
  }
}

export interface ImportRepository {
  commit(command: ImportCommitCommand): Promise<ImportCommitResult>;
}

export interface ImportCommitCommand {
  filename: string;
  records: ParsedImportRecord[];
  signal: AbortSignal;
}

export interface ImportCommitResult {
  batch: ImportBatchSummary;
}

interface RepositoryOptions {
  statementTimeoutMs?: number;
}

interface ExistingIdRow {
  key: string;
  id: string;
}

interface RelationIdRow {
  cause_event_id: string;
  effect_event_id: string;
  id: string;
}

interface LinkRow {
  causal_relation_id: string;
  concrete_case_id: string;
}

interface AuditRecord {
  sourceSequence: number;
  itemSequence: number;
  recordType: ImportRecordType;
  outcome: ImportOutcome;
  primaryRecordId: string;
  relatedRecordId: string | null;
  textSnapshot: ImportRecordText;
}

interface EventOccurrence {
  sourceSequence: number;
  itemSequence: number;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
}

interface CaseOccurrence {
  sourceSequence: number;
  itemSequence: number;
  content: string;
}

interface RelationOccurrence {
  sourceSequence: number;
  itemSequence: number;
  causeEventName: string;
  effectEventName: string;
  confidence: number;
  description: string | null;
  caseContents: string[];
  causeId: string;
  effectId: string;
}

interface LinkOccurrence {
  sourceSequence: number;
  itemSequence: number;
  causeEventName: string;
  effectEventName: string;
  caseContent: string;
  relationId: string;
  caseId: string;
}

interface CountPair {
  created: number;
  reused: number;
}

interface PgErrorLike {
  code?: string;
  message?: string;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 5 * 60 * 1000;

function groupIds(rows: ExistingIdRow[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const ids = groups.get(row.key);
    if (ids) ids.push(row.id);
    else groups.set(row.key, [row.id]);
  }
  return groups;
}

function relationKey(causeId: string, effectId: string): string {
  return `${causeId}\u0000${effectId}`;
}

function linkKey(relationId: string, caseId: string): string {
  return `${relationId}\u0000${caseId}`;
}

function firstByKey<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = keyOf(value);
    if (!result.has(key)) result.set(key, value);
  }
  return result;
}

function countAudit(records: readonly AuditRecord[], type: ImportRecordType): CountPair {
  let created = 0;
  let reused = 0;
  for (const record of records) {
    if (record.recordType !== type) continue;
    if (record.outcome === 'created') created += 1;
    else reused += 1;
  }
  return { created, reused };
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ImportError('IMPORT_CANCELLED', '导入任务已取消');
  }
}

function isPgError(error: unknown): error is PgErrorLike {
  return typeof error === 'object' && error !== null;
}

function mapTransactionError(error: unknown, signal: AbortSignal): unknown {
  if (error instanceof ImportError) return error;
  if (!isPgError(error)) return error;
  if (error.code === '40001') {
    return new ImportError('IMPORT_CONFLICT_RETRY', '数据已被并发修改，请重新导入', {
      cause: error,
    });
  }
  if (error.code === '57014') {
    return new ImportError(
      signal.aborted ? 'IMPORT_CANCELLED' : 'IMPORT_TIMEOUT',
      signal.aborted ? '导入任务已取消' : '导入处理超时',
      { cause: error },
    );
  }
  return error;
}

async function insertJsonRows(
  client: PoolClient,
  sql: string,
  rows: readonly unknown[],
): Promise<void> {
  if (rows.length === 0) return;
  await client.query(sql, [JSON.stringify(rows)]);
}

export class PostgresImportRepository implements ImportRepository {
  private readonly statementTimeoutMs: number;

  public constructor(
    private readonly pool: Pool,
    options: RepositoryOptions = {},
  ) {
    this.statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  }

  public async commit(command: ImportCommitCommand): Promise<ImportCommitResult> {
    assertNotCancelled(command.signal);
    if (command.records.length === 0) {
      throw new ImportError('CSV_NO_VALID_RECORDS', 'CSV 文件中没有可导入的有效记录');
    }

    const client = await this.pool.connect();
    let transactionStarted = false;
    let backendPid: number | undefined;
    let cancelRequest: Promise<unknown> | undefined;
    const cancel = (): void => {
      if (backendPid === undefined || cancelRequest) return;
      cancelRequest = this.pool
        .query('select pg_cancel_backend($1)', [backendPid])
        .catch(() => undefined);
    };

    command.signal.addEventListener('abort', cancel, { once: true });
    try {
      const pidResult = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
      backendPid = pidResult.rows[0]!.pid;
      assertNotCancelled(command.signal);

      await client.query('begin isolation level serializable');
      transactionStarted = true;
      await client.query(`select set_config('statement_timeout', $1, true)`, [
        String(this.statementTimeoutMs),
      ]);

      const batch = await this.executeTransaction(client, command);
      assertNotCancelled(command.signal);
      await client.query('commit');
      transactionStarted = false;
      return { batch };
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('rollback');
        } catch {
          // The original transaction error is more useful than a rollback failure.
        }
      }
      throw mapTransactionError(error, command.signal);
    } finally {
      command.signal.removeEventListener('abort', cancel);
      await cancelRequest;
      client.release();
    }
  }

  private async executeTransaction(
    client: PoolClient,
    command: ImportCommitCommand,
  ): Promise<ImportBatchSummary> {
    const plan = planFileRecords(command.records);
    const records = plan.records;
    const audit: AuditRecord[] = [];
    const eventRecords = records.filter(
      (record): record is Extract<ParsedImportRecord, { type: 'event' }> => record.type === 'event',
    );
    const relationRecords = records.filter(
      (record): record is Extract<ParsedImportRecord, { type: 'relation' }> =>
        record.type === 'relation',
    );
    const standaloneCases = records.filter(
      (record): record is Extract<ParsedImportRecord, { type: 'case' }> => record.type === 'case',
    );

    const rawEventNames = [
      ...eventRecords.map((record) => record.name),
      ...relationRecords.flatMap((record) => [record.causeEventName, record.effectEventName]),
    ];
    const normalizedRows =
      rawEventNames.length === 0
        ? []
        : (
            await client.query<{ key: string; raw: string }>(
              `select raw, lower(btrim(raw)) as key
               from unnest($1::text[]) as input(raw)`,
              [rawEventNames],
            )
          ).rows;
    const normalizedByRaw = new Map(normalizedRows.map((row) => [row.raw, row.key]));
    const eventKeys = [...new Set(normalizedRows.map((row) => row.key))];

    const existingEventRows =
      eventKeys.length === 0
        ? []
        : (
            await client.query<ExistingIdRow>(
              `select normalized_name as key, id
               from abstract_events
               where normalized_name = any($1::text[])
               order by normalized_name, id`,
              [eventKeys],
            )
          ).rows;
    const existingEvents = groupIds(existingEventRows);
    const eventOccurrences: EventOccurrence[] = eventRecords.map((record) => ({
      sourceSequence: record.sequence,
      itemSequence: 1,
      name: record.name,
      description: record.description,
      aliases: record.aliases,
      keywords: record.keywords,
    }));
    const uniqueEventOccurrences = [
      ...firstByKey(eventOccurrences, (occurrence) =>
        normalizedByRaw.get(occurrence.name)!,
      ).values(),
    ];
    const eventCreators = firstByKey(
      uniqueEventOccurrences.filter((occurrence) => {
        const key = normalizedByRaw.get(occurrence.name)!;
        return (existingEvents.get(key)?.length ?? 0) === 0;
      }),
      (occurrence) => normalizedByRaw.get(occurrence.name)!,
    );

    const createdEventResult =
      eventCreators.size === 0
        ? { rows: [] as ExistingIdRow[] }
        : await client.query<ExistingIdRow>(
            `insert into abstract_events (name, description)
             select input.name, input.description
             from jsonb_to_recordset($1::jsonb)
               as input(name text, description text)
             on conflict do nothing
             returning normalized_name as key, id`,
            [
              JSON.stringify(
                [...eventCreators.values()].map(({ name, description }) => ({
                  name,
                  description,
                })),
              ),
            ],
          );
    if (createdEventResult.rows.length !== eventCreators.size) {
      throw new ImportError('IMPORT_CONFLICT_RETRY', '数据已被并发修改，请重新导入');
    }
    const createdEvents = new Map(createdEventResult.rows.map((row) => [row.key, row.id]));
    const uniqueEvents = new Map<string, string>();
    for (const key of eventKeys) {
      const ids = existingEvents.get(key) ?? [];
      if (ids.length === 1) uniqueEvents.set(key, ids[0]!);
      else if (ids.length === 0 && createdEvents.has(key))
        uniqueEvents.set(key, createdEvents.get(key)!);
    }

    const aliasRows: Array<{ eventId: string; alias: string }> = [];
    const keywordRows: Array<{ eventId: string; keyword: string; position: number }> = [];
    for (const [key, creator] of eventCreators) {
      const eventId = createdEvents.get(key);
      if (!eventId) continue;
      creator.aliases.forEach((alias) => aliasRows.push({ eventId, alias }));
      creator.keywords.forEach((keyword, index) =>
        keywordRows.push({ eventId, keyword, position: index + 1 }),
      );
    }
    await insertJsonRows(
      client,
      `insert into event_aliases (event_id, alias)
       select input.event_id::uuid, input.alias
       from jsonb_to_recordset($1::jsonb) as input(event_id text, alias text)`,
      aliasRows.map((row) => ({ event_id: row.eventId, alias: row.alias })),
    );
    await insertJsonRows(
      client,
      `insert into event_keywords (event_id, keyword, position)
       select input.event_id::uuid, input.keyword, input.position
       from jsonb_to_recordset($1::jsonb)
         as input(event_id text, keyword text, position integer)`,
      keywordRows.map((row) => ({
        event_id: row.eventId,
        keyword: row.keyword,
        position: row.position,
      })),
    );

    for (const occurrence of uniqueEventOccurrences) {
      const key = normalizedByRaw.get(occurrence.name)!;
      const eventId = uniqueEvents.get(key);
      if (!eventId) continue;
      audit.push({
        sourceSequence: occurrence.sourceSequence,
        itemSequence: occurrence.itemSequence,
        recordType: 'event',
        outcome: createdEvents.has(key) ? 'created' : 'reused',
        primaryRecordId: eventId,
        relatedRecordId: null,
        textSnapshot: { type: 'event', eventName: occurrence.name },
      });
    }

    assertNotCancelled(command.signal);
    const relationOccurrences: RelationOccurrence[] = [];
    for (const record of relationRecords) {
      const causeKey = normalizedByRaw.get(record.causeEventName)!;
      const effectKey = normalizedByRaw.get(record.effectEventName)!;
      const causeId = uniqueEvents.get(causeKey);
      const effectId = uniqueEvents.get(effectKey);
      if (!causeId || !effectId || causeId === effectId) continue;
      relationOccurrences.push({
        sourceSequence: record.sequence,
        itemSequence: 1,
        causeEventName: record.causeEventName,
        effectEventName: record.effectEventName,
        confidence: record.confidence,
        description: record.description,
        caseContents: record.caseContents,
        causeId,
        effectId,
      });
    }
    const relationPairKeys = [
      ...new Set(
        relationOccurrences.map((occurrence) =>
          relationKey(occurrence.causeId, occurrence.effectId),
        ),
      ),
    ];
    const existingRelationRows =
      relationPairKeys.length === 0
        ? []
        : (
            await client.query<RelationIdRow>(
              `select relation.cause_event_id, relation.effect_event_id, relation.id
               from causal_relations relation
               join jsonb_to_recordset($1::jsonb)
                 as pair(cause_id text, effect_id text)
                 on relation.cause_event_id = pair.cause_id::uuid
                and relation.effect_event_id = pair.effect_id::uuid
               order by relation.cause_event_id, relation.effect_event_id, relation.id`,
              [
                JSON.stringify(
                  relationPairKeys.map((key) => {
                    const [causeId, effectId] = key.split('\u0000');
                    return { cause_id: causeId, effect_id: effectId };
                  }),
                ),
              ],
            )
          ).rows;
    const existingRelations = new Map<string, string[]>();
    for (const row of existingRelationRows) {
      const key = relationKey(row.cause_event_id, row.effect_event_id);
      const ids = existingRelations.get(key);
      if (ids) ids.push(row.id);
      else existingRelations.set(key, [row.id]);
    }
    const validRelationOccurrences = relationOccurrences.filter((occurrence) => {
      const ids = existingRelations.get(relationKey(occurrence.causeId, occurrence.effectId));
      return (ids?.length ?? 0) <= 1;
    });

    const caseOccurrences: CaseOccurrence[] = standaloneCases.map((record) => ({
      sourceSequence: record.sequence,
      itemSequence: 1,
      content: record.content,
    }));
    for (const relation of validRelationOccurrences) {
      relation.caseContents.forEach((content, index) => {
        caseOccurrences.push({
          sourceSequence: relation.sourceSequence,
          itemSequence: 2 + index * 2,
          content,
        });
      });
    }
    caseOccurrences.sort(
      (left, right) =>
        left.sourceSequence - right.sourceSequence || left.itemSequence - right.itemSequence,
    );
    const uniqueCaseOccurrences = [
      ...firstByKey(caseOccurrences, (occurrence) => occurrence.content).values(),
    ];
    const caseContents = [...new Set(caseOccurrences.map((occurrence) => occurrence.content))];
    const existingCaseRows =
      caseContents.length === 0
        ? []
        : (
            await client.query<ExistingIdRow>(
              `select content as key, id
               from concrete_cases
               where content = any($1::text[])
               order by content, id`,
              [caseContents],
            )
          ).rows;
    const existingCases = groupIds(existingCaseRows);
    const caseCreators = firstByKey(
      uniqueCaseOccurrences.filter(
        (occurrence) => (existingCases.get(occurrence.content)?.length ?? 0) === 0,
      ),
      (occurrence) => occurrence.content,
    );
    const createdCaseResult =
      caseCreators.size === 0
        ? { rows: [] as ExistingIdRow[] }
        : await client.query<ExistingIdRow>(
            `insert into concrete_cases (content)
             select input.content
             from jsonb_to_recordset($1::jsonb) as input(content text)
             on conflict do nothing
             returning content as key, id`,
            [JSON.stringify([...caseCreators.values()].map(({ content }) => ({ content })))],
          );
    if (createdCaseResult.rows.length !== caseCreators.size) {
      throw new ImportError('IMPORT_CONFLICT_RETRY', '数据已被并发修改，请重新导入');
    }
    const createdCases = new Map(createdCaseResult.rows.map((row) => [row.key, row.id]));
    const uniqueCases = new Map<string, string>();
    for (const content of caseContents) {
      const ids = existingCases.get(content) ?? [];
      if (ids.length === 1) uniqueCases.set(content, ids[0]!);
      else if (ids.length === 0 && createdCases.has(content)) {
        uniqueCases.set(content, createdCases.get(content)!);
      }
    }
    for (const occurrence of uniqueCaseOccurrences) {
      const caseId = uniqueCases.get(occurrence.content);
      if (!caseId) continue;
      audit.push({
        sourceSequence: occurrence.sourceSequence,
        itemSequence: occurrence.itemSequence,
        recordType: 'case',
        outcome: createdCases.has(occurrence.content) ? 'created' : 'reused',
        primaryRecordId: caseId,
        relatedRecordId: null,
        textSnapshot: { type: 'case', caseContent: occurrence.content },
      });
    }

    const uniqueRelationOccurrences = [
      ...firstByKey(validRelationOccurrences, (occurrence) =>
        relationKey(occurrence.causeId, occurrence.effectId),
      ).values(),
    ];
    const relationCreators = firstByKey(
      uniqueRelationOccurrences.filter((occurrence) => {
        const ids = existingRelations.get(relationKey(occurrence.causeId, occurrence.effectId));
        return (ids?.length ?? 0) === 0;
      }),
      (occurrence) => relationKey(occurrence.causeId, occurrence.effectId),
    );
    const createdRelationResult =
      relationCreators.size === 0
        ? { rows: [] as RelationIdRow[] }
        : await client.query<RelationIdRow>(
            `insert into causal_relations (
               cause_event_id,
               effect_event_id,
               confidence,
               description
             )
             select input.cause_id::uuid,
                    input.effect_id::uuid,
                    input.confidence,
                    input.description
             from jsonb_to_recordset($1::jsonb)
               as input(cause_id text, effect_id text, confidence smallint, description text)
             on conflict do nothing
             returning cause_event_id, effect_event_id, id`,
            [
              JSON.stringify(
                [...relationCreators.values()].map((occurrence) => ({
                  cause_id: occurrence.causeId,
                  effect_id: occurrence.effectId,
                  confidence: occurrence.confidence,
                  description: occurrence.description,
                })),
              ),
            ],
          );
    if (createdRelationResult.rows.length !== relationCreators.size) {
      throw new ImportError('IMPORT_CONFLICT_RETRY', '数据已被并发修改，请重新导入');
    }
    const createdRelations = new Map(
      createdRelationResult.rows.map((row) => [
        relationKey(row.cause_event_id, row.effect_event_id),
        row.id,
      ]),
    );
    const uniqueRelations = new Map<string, string>();
    for (const key of relationPairKeys) {
      const ids = existingRelations.get(key) ?? [];
      if (ids.length === 1) uniqueRelations.set(key, ids[0]!);
      else if (ids.length === 0 && createdRelations.has(key)) {
        uniqueRelations.set(key, createdRelations.get(key)!);
      }
    }
    for (const occurrence of uniqueRelationOccurrences) {
      const key = relationKey(occurrence.causeId, occurrence.effectId);
      const relationId = uniqueRelations.get(key);
      if (!relationId) continue;
      audit.push({
        sourceSequence: occurrence.sourceSequence,
        itemSequence: occurrence.itemSequence,
        recordType: 'relation',
        outcome: createdRelations.has(key) ? 'created' : 'reused',
        primaryRecordId: relationId,
        relatedRecordId: null,
        textSnapshot: {
          type: 'relation',
          causeEventName: occurrence.causeEventName,
          effectEventName: occurrence.effectEventName,
        },
      });
    }

    const linkOccurrences: LinkOccurrence[] = [];
    for (const relation of validRelationOccurrences) {
      const relationId = uniqueRelations.get(relationKey(relation.causeId, relation.effectId));
      if (!relationId) continue;
      relation.caseContents.forEach((content, index) => {
        const caseId = uniqueCases.get(content);
        if (!caseId) return;
        linkOccurrences.push({
          sourceSequence: relation.sourceSequence,
          itemSequence: 3 + index * 2,
          causeEventName: relation.causeEventName,
          effectEventName: relation.effectEventName,
          caseContent: content,
          relationId,
          caseId,
        });
      });
    }
    const uniqueLinkCandidates = firstByKey(linkOccurrences, (occurrence) =>
      linkKey(occurrence.relationId, occurrence.caseId),
    );
    const existingLinkRows =
      uniqueLinkCandidates.size === 0
        ? []
        : (
            await client.query<LinkRow>(
              `select link.causal_relation_id, link.concrete_case_id
               from causal_relation_cases link
               join jsonb_to_recordset($1::jsonb)
                 as pair(relation_id text, case_id text)
                 on link.causal_relation_id = pair.relation_id::uuid
                and link.concrete_case_id = pair.case_id::uuid`,
              [
                JSON.stringify(
                  [...uniqueLinkCandidates.values()].map((occurrence) => ({
                    relation_id: occurrence.relationId,
                    case_id: occurrence.caseId,
                  })),
                ),
              ],
            )
          ).rows;
    const existingLinks = new Set(
      existingLinkRows.map((row) => linkKey(row.causal_relation_id, row.concrete_case_id)),
    );
    const linksToCreate = [...uniqueLinkCandidates].filter(([key]) => !existingLinks.has(key));
    const createdLinkResult =
      linksToCreate.length === 0
        ? { rows: [] as LinkRow[] }
        : await client.query<LinkRow>(
            `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
             select input.relation_id::uuid, input.case_id::uuid
             from jsonb_to_recordset($1::jsonb)
               as input(relation_id text, case_id text)
             on conflict do nothing
             returning causal_relation_id, concrete_case_id`,
            [
              JSON.stringify(
                linksToCreate.map(([, occurrence]) => ({
                  relation_id: occurrence.relationId,
                  case_id: occurrence.caseId,
                })),
              ),
            ],
          );
    if (createdLinkResult.rows.length !== linksToCreate.length) {
      throw new ImportError('IMPORT_CONFLICT_RETRY', '数据已被并发修改，请重新导入');
    }
    const createdLinks = new Set(
      createdLinkResult.rows.map((row) => linkKey(row.causal_relation_id, row.concrete_case_id)),
    );
    for (const occurrence of uniqueLinkCandidates.values()) {
      const key = linkKey(occurrence.relationId, occurrence.caseId);
      audit.push({
        sourceSequence: occurrence.sourceSequence,
        itemSequence: occurrence.itemSequence,
        recordType: 'relation_case',
        outcome: createdLinks.has(key) ? 'created' : 'reused',
        primaryRecordId: occurrence.relationId,
        relatedRecordId: occurrence.caseId,
        textSnapshot: {
          type: 'relation_case',
          causeEventName: occurrence.causeEventName,
          effectEventName: occurrence.effectEventName,
          caseContent: occurrence.caseContent,
        },
      });
    }

    if (audit.length === 0) {
      throw new ImportError('CSV_NO_VALID_RECORDS', 'CSV 文件中没有可导入的有效记录');
    }
    audit.sort(
      (left, right) =>
        left.sourceSequence - right.sourceSequence || left.itemSequence - right.itemSequence,
    );
    const counts = {
      event: countAudit(audit, 'event'),
      case: countAudit(audit, 'case'),
      relation: countAudit(audit, 'relation'),
      relationCase: countAudit(audit, 'relation_case'),
    };
    const recordTypes = (['event', 'case', 'relation', 'relation_case'] as const).filter((type) =>
      audit.some((record) => record.recordType === type),
    );

    assertNotCancelled(command.signal);
    const batchResult = await client.query<{
      id: string;
      completed_at: Date;
    }>(
      `insert into import_batches (
         filename,
         record_types,
         event_created,
         event_reused,
         case_created,
         case_reused,
         relation_created,
         relation_reused,
         relation_case_created,
         relation_case_reused
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, completed_at`,
      [
        command.filename,
        recordTypes,
        counts.event.created,
        counts.event.reused,
        counts.case.created,
        counts.case.reused,
        counts.relation.created,
        counts.relation.reused,
        counts.relationCase.created,
        counts.relationCase.reused,
      ],
    );
    const batchRow = batchResult.rows[0]!;
    await client.query(
      `insert into import_records (
         batch_id,
         source_sequence,
         item_sequence,
         record_type,
         outcome,
         primary_record_id,
         related_record_id,
         text_snapshot
       )
       select $1::uuid,
              input.source_sequence,
              input.item_sequence,
              input.record_type,
              input.outcome,
              input.primary_record_id::uuid,
              nullif(input.related_record_id, '')::uuid,
              input.text_snapshot
       from jsonb_to_recordset($2::jsonb)
         as input(
           source_sequence integer,
           item_sequence integer,
           record_type text,
           outcome text,
           primary_record_id text,
           related_record_id text,
           text_snapshot jsonb
         )`,
      [
        batchRow.id,
        JSON.stringify(
          audit.map((record) => ({
            source_sequence: record.sourceSequence,
            item_sequence: record.itemSequence,
            record_type: record.recordType,
            outcome: record.outcome,
            primary_record_id: record.primaryRecordId,
            related_record_id: record.relatedRecordId ?? '',
            text_snapshot: record.textSnapshot,
          })),
        ),
      ],
    );

    return {
      id: batchRow.id,
      filename: command.filename,
      completedAt: batchRow.completed_at.toISOString(),
      recordTypes,
      counts,
    };
  }
}
