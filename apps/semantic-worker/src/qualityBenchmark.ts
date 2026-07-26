import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import {
  MODEL_CATALOG,
  semanticModelCodes,
  type SemanticModelCode,
} from '@causality/semantic-core';
import type { SemanticEntityType } from '@causality/contracts';

import { PinnedModelDownloader } from './model/modelDownloader.js';
import { TransformersEmbeddingRuntime } from './model/transformersRuntime.js';

export interface QualityDocument {
  id: string;
  entityType: SemanticEntityType;
  text: string;
}

export interface QualityCase {
  entityType: SemanticEntityType;
  query: string;
  capability?: string;
  relevantDocumentIds: string[];
  confusingDocumentIds: string[];
}

export interface QualityNoMatchCase {
  entityType: SemanticEntityType;
  query: string;
  capability?: string;
}

export interface QualityFixture {
  documents: QualityDocument[];
  cases: QualityCase[];
  noMatchCases?: QualityNoMatchCase[];
}

export interface RankedDocument {
  id: string;
  similarity: number;
}

export interface QualityResult {
  queryCount: number;
  ordinaryQueryHits: number;
  ordinaryHitRate: number;
  noMatchQueryCount: number;
  noMatchFalsePositives: number;
  noMatchFalsePositiveRate: number;
  relevantCount: number;
  relevantTop10Hits: number;
  top10HitRate: number;
  queryTop1Hits: number;
  top1HitRate: number;
  meanReciprocalRank: number;
  confusingCount: number;
  confusingReturned: number;
  irrelevantResultRate: number;
  hardNegativeOutrankCount: number;
  hardNegativeOutrankRate: number;
  emptyResultQueries: number;
}

function isEntityType(value: unknown): value is SemanticEntityType {
  return value === 'event' || value === 'relation' || value === 'case';
}

export function validateQualityFixture(input: unknown): QualityFixture {
  if (!input || typeof input !== 'object') throw new Error('Invalid semantic quality fixture');
  const fixture = input as Partial<QualityFixture>;
  if (!Array.isArray(fixture.documents) || !Array.isArray(fixture.cases)) {
    throw new Error('Invalid semantic quality fixture collections');
  }
  if (fixture.noMatchCases !== undefined && !Array.isArray(fixture.noMatchCases)) {
    throw new Error('Invalid semantic quality no-match collection');
  }

  const ids = new Map<string, SemanticEntityType>();
  for (const document of fixture.documents) {
    if (
      !document ||
      typeof document.id !== 'string' ||
      !document.id ||
      !isEntityType(document.entityType) ||
      typeof document.text !== 'string' ||
      !document.text.trim() ||
      ids.has(document.id)
    ) {
      throw new Error('Invalid semantic quality fixture document');
    }
    ids.set(document.id, document.entityType);
  }

  for (const qualityCase of fixture.cases) {
    if (
      !qualityCase ||
      !isEntityType(qualityCase.entityType) ||
      typeof qualityCase.query !== 'string' ||
      !qualityCase.query.trim() ||
      (qualityCase.capability !== undefined &&
        (typeof qualityCase.capability !== 'string' || !qualityCase.capability.trim())) ||
      !Array.isArray(qualityCase.relevantDocumentIds) ||
      qualityCase.relevantDocumentIds.length === 0 ||
      !Array.isArray(qualityCase.confusingDocumentIds)
    ) {
      throw new Error('Invalid semantic quality fixture case');
    }
    for (const id of [...qualityCase.relevantDocumentIds, ...qualityCase.confusingDocumentIds]) {
      if (ids.get(id) !== qualityCase.entityType) {
        throw new Error('Invalid semantic quality fixture reference');
      }
    }
  }
  for (const noMatchCase of fixture.noMatchCases ?? []) {
    if (
      !noMatchCase ||
      !isEntityType(noMatchCase.entityType) ||
      typeof noMatchCase.query !== 'string' ||
      !noMatchCase.query.trim() ||
      (noMatchCase.capability !== undefined &&
        (typeof noMatchCase.capability !== 'string' || !noMatchCase.capability.trim()))
    ) {
      throw new Error('Invalid semantic quality no-match case');
    }
  }

  const typeCounts = new Map<SemanticEntityType, number>();
  for (const qualityCase of fixture.cases) {
    typeCounts.set(qualityCase.entityType, (typeCounts.get(qualityCase.entityType) ?? 0) + 1);
  }
  if (
    fixture.cases.length < 30 ||
    typeCounts.get('event') !== typeCounts.get('relation') ||
    typeCounts.get('event') !== typeCounts.get('case')
  ) {
    throw new Error('Semantic quality fixture must contain 30+ evenly split cases');
  }
  return fixture as QualityFixture;
}

export function evaluateQualityRankings(
  fixture: QualityFixture,
  threshold: number,
  rankings: ReadonlyMap<string, readonly RankedDocument[]>,
): QualityResult {
  let relevantCount = 0;
  let relevantTop10Hits = 0;
  let queryTop1Hits = 0;
  let reciprocalRankTotal = 0;
  let confusingCount = 0;
  let confusingReturned = 0;
  let hardNegativeOutrankCount = 0;
  let emptyResultQueries = 0;
  let ordinaryQueryHits = 0;

  for (const qualityCase of fixture.cases) {
    const normalizedQuery = qualityCase.query.trim().toLocaleLowerCase();
    if (
      fixture.documents.some(
        (document) =>
          document.entityType === qualityCase.entityType &&
          qualityCase.relevantDocumentIds.includes(document.id) &&
          document.text.toLocaleLowerCase().includes(normalizedQuery),
      )
    ) {
      ordinaryQueryHits += 1;
    }
    const ranking = rankings.get(qualityCase.query) ?? [];
    const returnedIds = ranking
      .filter((document) => document.similarity >= threshold)
      .slice(0, 10)
      .map((document) => document.id);
    const top10 = new Set(returnedIds);
    const returned = new Set(returnedIds);
    if (returnedIds.length === 0) emptyResultQueries += 1;
    if (returnedIds[0] && qualityCase.relevantDocumentIds.includes(returnedIds[0])) {
      queryTop1Hits += 1;
    }
    const bestRelevantRank = returnedIds.findIndex((id) =>
      qualityCase.relevantDocumentIds.includes(id),
    );
    if (bestRelevantRank >= 0) reciprocalRankTotal += 1 / (bestRelevantRank + 1);
    const bestConfusingRank = returnedIds.findIndex((id) =>
      qualityCase.confusingDocumentIds.includes(id),
    );
    if (bestConfusingRank >= 0 && (bestRelevantRank < 0 || bestConfusingRank < bestRelevantRank)) {
      hardNegativeOutrankCount += 1;
    }
    relevantCount += qualityCase.relevantDocumentIds.length;
    relevantTop10Hits += qualityCase.relevantDocumentIds.filter((id) => top10.has(id)).length;
    confusingCount += qualityCase.confusingDocumentIds.length;
    confusingReturned += qualityCase.confusingDocumentIds.filter((id) => returned.has(id)).length;
  }

  let noMatchFalsePositives = 0;
  for (const noMatchCase of fixture.noMatchCases ?? []) {
    const ranking = rankings.get(noMatchCase.query) ?? [];
    if (ranking.some((document) => document.similarity >= threshold)) {
      noMatchFalsePositives += 1;
    }
  }
  const noMatchQueryCount = fixture.noMatchCases?.length ?? 0;

  return {
    queryCount: fixture.cases.length,
    ordinaryQueryHits,
    ordinaryHitRate: fixture.cases.length === 0 ? 0 : ordinaryQueryHits / fixture.cases.length,
    noMatchQueryCount,
    noMatchFalsePositives,
    noMatchFalsePositiveRate:
      noMatchQueryCount === 0 ? 0 : noMatchFalsePositives / noMatchQueryCount,
    relevantCount,
    relevantTop10Hits,
    top10HitRate: relevantCount === 0 ? 0 : relevantTop10Hits / relevantCount,
    queryTop1Hits,
    top1HitRate: fixture.cases.length === 0 ? 0 : queryTop1Hits / fixture.cases.length,
    meanReciprocalRank: fixture.cases.length === 0 ? 0 : reciprocalRankTotal / fixture.cases.length,
    confusingCount,
    confusingReturned,
    irrelevantResultRate: confusingCount === 0 ? 0 : confusingReturned / confusingCount,
    hardNegativeOutrankCount,
    hardNegativeOutrankRate:
      fixture.cases.length === 0 ? 0 : hardNegativeOutrankCount / fixture.cases.length,
    emptyResultQueries,
  };
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

async function loadFixture(): Promise<QualityFixture> {
  const path =
    process.env.CAUSALITY_QUALITY_FIXTURE ??
    fileURLToPath(new URL('../test/fixtures/semantic-quality-general.json', import.meta.url));
  return validateQualityFixture(JSON.parse(await readFile(path, 'utf8')));
}

function modelsDirectory(): string {
  return resolve(
    process.env.CAUSALITY_MODEL_DIRECTORY ?? join(process.cwd(), '.cache', 'semantic-models'),
  );
}

function selectedModelCodes(): SemanticModelCode[] {
  const configured = process.env.CAUSALITY_QUALITY_MODELS;
  if (!configured) return [...semanticModelCodes];
  const selected = [...new Set(configured.split(',').map((value) => value.trim()))];
  if (
    selected.length === 0 ||
    selected.some((modelCode) => !semanticModelCodes.includes(modelCode as SemanticModelCode))
  ) {
    throw new Error(`CAUSALITY_QUALITY_MODELS must use: ${semanticModelCodes.join(', ')}`);
  }
  return selected as SemanticModelCode[];
}

async function evaluateModel(
  modelCode: SemanticModelCode,
  fixture: QualityFixture,
): Promise<Map<string, RankedDocument[]>> {
  const model = MODEL_CATALOG[modelCode];
  const directory = modelsDirectory();
  const target = join(directory, model.code, model.revision);
  await new PinnedModelDownloader().download(model, target, async () => undefined);

  const runtime = new TransformersEmbeddingRuntime({ modelsDirectory: directory });
  try {
    await runtime.load(model, target);
    const documentVectors = new Map<string, number[]>();
    const batchSize = modelCode === 'bge-m3' ? 1 : 4;
    for (let offset = 0; offset < fixture.documents.length; offset += batchSize) {
      const batch = fixture.documents.slice(offset, offset + batchSize);
      const vectors = await runtime.embedDocuments(batch.map((document) => document.text));
      batch.forEach((document, index) => documentVectors.set(document.id, vectors[index]!));
    }

    const rankings = new Map<string, RankedDocument[]>();
    for (const qualityCase of [...fixture.cases, ...(fixture.noMatchCases ?? [])]) {
      const queryVector = await runtime.embedQuery(qualityCase.query);
      rankings.set(
        qualityCase.query,
        fixture.documents
          .filter((document) => document.entityType === qualityCase.entityType)
          .map((document) => ({
            id: document.id,
            similarity: cosine(queryVector, documentVectors.get(document.id)!),
          }))
          .sort(
            (left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id),
          ),
      );
    }
    return rankings;
  } finally {
    await runtime.dispose();
  }
}

export async function runQualityBenchmark(): Promise<void> {
  const fixture = await loadFixture();
  const results = new Map<SemanticModelCode, QualityResult>();
  for (const modelCode of selectedModelCodes()) {
    const rankings = await evaluateModel(modelCode, fixture);
    const defaultThreshold = MODEL_CATALOG[modelCode].defaultThreshold;
    const thresholds = [...new Set([defaultThreshold, 75, 80, 85, 90, 95])].sort(
      (left, right) => left - right,
    );
    const thresholdResults = thresholds.map((threshold) => ({
      threshold,
      result: evaluateQualityRankings(fixture, threshold / 100, rankings),
    }));
    const result = thresholdResults.find((entry) => entry.threshold === defaultThreshold)!.result;
    results.set(modelCode, result);
    for (const entry of thresholdResults) {
      process.stdout.write(
        [
          `model=${modelCode}`,
          `queries=${entry.result.queryCount}`,
          `ordinary_hit_rate=${(entry.result.ordinaryHitRate * 100).toFixed(1)}%`,
          `no_match_false_positive_rate=${(entry.result.noMatchFalsePositiveRate * 100).toFixed(
            1,
          )}%`,
          `top10_hit_rate=${(entry.result.top10HitRate * 100).toFixed(1)}%`,
          `top1_hit_rate=${(entry.result.top1HitRate * 100).toFixed(1)}%`,
          `mrr_at_10=${entry.result.meanReciprocalRank.toFixed(3)}`,
          `irrelevant_result_rate=${(entry.result.irrelevantResultRate * 100).toFixed(1)}%`,
          `hard_negative_outrank_rate=${(entry.result.hardNegativeOutrankRate * 100).toFixed(1)}%`,
          `empty_queries=${entry.result.emptyResultQueries}`,
          `threshold=${entry.threshold}%`,
          entry.threshold === defaultThreshold ? 'default=true' : 'default=false',
        ].join(' ') + '\n',
      );
    }
  }

  for (const [modelCode, result] of results) {
    if (result.top10HitRate < 0.8) {
      throw new Error(`${modelCode} fell below the reviewed top-10 acceptance floor`);
    }
    if (result.irrelevantResultRate >= 0.5) {
      throw new Error(`${modelCode} returned confusing targets in bulk`);
    }
    if (result.noMatchFalsePositiveRate >= 0.5) {
      throw new Error(`${modelCode} returned unrelated no-match queries in bulk`);
    }
  }
  const e5 = results.get('multilingual-e5-small');
  const bge = results.get('bge-m3');
  if (e5 && bge && bge.top10HitRate + 0.05 < e5.top10HitRate) {
    throw new Error('BGE-M3 top-10 hit rate is more than five points below E5-small');
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  await runQualityBenchmark();
}
