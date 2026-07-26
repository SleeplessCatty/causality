import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { env, pipeline } from '@huggingface/transformers';

import {
  evaluateQualityRankings,
  validateQualityFixture,
  type QualityCase,
  type RankedDocument,
} from './qualityBenchmark.js';

interface ResearchCandidate {
  code: string;
  repository: string;
  revision: string;
  dimensions: number;
  pooling: 'mean' | 'cls';
  maxTokens: number;
  queryPrefix: string;
  documentPrefix: string;
}

const candidates = {
  'multilingual-e5-small': {
    code: 'multilingual-e5-small',
    repository: 'Xenova/multilingual-e5-small',
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    dimensions: 384,
    pooling: 'mean',
    maxTokens: 512,
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
  },
  'bge-small-zh-v1.5': {
    code: 'bge-small-zh-v1.5',
    repository: 'Xenova/bge-small-zh-v1.5',
    revision: '75c43b069aac4d136ba6bc1122f995fedcfd2781',
    dimensions: 512,
    pooling: 'cls',
    maxTokens: 512,
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    documentPrefix: '',
  },
  'bge-small-zh-v1.5-no-instruction': {
    code: 'bge-small-zh-v1.5-no-instruction',
    repository: 'Xenova/bge-small-zh-v1.5',
    revision: '75c43b069aac4d136ba6bc1122f995fedcfd2781',
    dimensions: 512,
    pooling: 'cls',
    maxTokens: 512,
    queryPrefix: '',
    documentPrefix: '',
  },
  'granite-embedding-97m-multilingual-r2': {
    code: 'granite-embedding-97m-multilingual-r2',
    repository: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
    revision: '536a9f241cb3f02a9c5995a1e708c784bd274859',
    dimensions: 384,
    pooling: 'cls',
    maxTokens: 512,
    queryPrefix: '',
    documentPrefix: '',
  },
} as const satisfies Record<string, ResearchCandidate>;

type CandidateCode = keyof typeof candidates;

interface FeatureExtractionOutput {
  data: ArrayLike<number>;
  dims: number[];
  dispose(): void;
}

interface FeatureExtractionPipeline {
  (
    text: string | string[],
    options: {
      pooling: 'mean' | 'cls';
      normalize: true;
      truncation: true;
      max_length: number;
    },
  ): Promise<FeatureExtractionOutput>;
  dispose(): Promise<void>;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!;
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

function copyVectors(
  output: FeatureExtractionOutput,
  count: number,
  dimensions: number,
): number[][] {
  if (
    output.dims.length !== 2 ||
    output.dims[0] !== count ||
    output.dims[1] !== dimensions ||
    output.data.length !== count * dimensions
  ) {
    throw new Error(`Expected ${count}x${dimensions}, received ${output.dims.join('x')}`);
  }
  return Array.from({ length: count }, (_, itemIndex) =>
    Array.from(
      { length: dimensions },
      (_, dimension) => output.data[itemIndex * dimensions + dimension]!,
    ),
  );
}

function resultAtZeroThreshold(
  cases: readonly QualityCase[],
  rankings: ReadonlyMap<string, readonly RankedDocument[]>,
) {
  const fixture = {
    documents: [],
    cases: [...cases],
  };
  return evaluateQualityRankings(fixture, Number.NEGATIVE_INFINITY, rankings);
}

async function main(): Promise<void> {
  const requested = process.argv[2] as CandidateCode | undefined;
  if (!requested || !(requested in candidates)) {
    throw new Error(`Candidate must be one of: ${Object.keys(candidates).join(', ')}`);
  }
  const candidate = candidates[requested];
  const fixturePath = resolve(
    process.env.CAUSALITY_QUALITY_FIXTURE ??
      'apps/semantic-worker/test/fixtures/semantic-quality-zh-finance.json',
  );
  const fixture = validateQualityFixture(JSON.parse(await readFile(fixturePath, 'utf8')));

  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  env.useFSCache = true;
  env.cacheDir = resolve(
    process.env.CAUSALITY_RESEARCH_MODEL_CACHE ?? '/private/tmp/causality-research-model-cache',
  );

  const loadStartedAt = performance.now();
  const extractor = (await pipeline('feature-extraction', candidate.repository, {
    revision: candidate.revision,
    dtype: 'q8',
    session_options: {
      enableCpuMemArena: false,
      enableMemPattern: false,
      executionMode: 'sequential',
      interOpNumThreads: 1,
      intraOpNumThreads: 2,
    },
  })) as unknown as FeatureExtractionPipeline;
  const loadMilliseconds = performance.now() - loadStartedAt;
  let peakRssBytes = process.memoryUsage.rss();

  const embed = async (text: string | string[], prefix: string): Promise<number[][]> => {
    const values = Array.isArray(text) ? text : [text];
    const output = await extractor(
      values.map((value) => `${prefix}${value}`),
      {
        pooling: candidate.pooling,
        normalize: true,
        truncation: true,
        max_length: candidate.maxTokens,
      },
    );
    try {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss());
      return copyVectors(output, values.length, candidate.dimensions);
    } finally {
      output.dispose();
    }
  };

  try {
    await embed('预热查询', candidate.queryPrefix);
    const documentVectors = new Map<string, number[]>();
    const documentStartedAt = performance.now();
    for (let offset = 0; offset < fixture.documents.length; offset += 4) {
      const batch = fixture.documents.slice(offset, offset + 4);
      const vectors = await embed(
        batch.map((document) => document.text),
        candidate.documentPrefix,
      );
      batch.forEach((document, index) => documentVectors.set(document.id, vectors[index]!));
    }
    const documentMilliseconds = performance.now() - documentStartedAt;

    const rankings = new Map<string, RankedDocument[]>();
    const queryLatencies: number[] = [];
    for (const qualityCase of fixture.cases) {
      const queryStartedAt = performance.now();
      const [queryVector] = await embed(qualityCase.query, candidate.queryPrefix);
      queryLatencies.push(performance.now() - queryStartedAt);
      rankings.set(
        qualityCase.query,
        fixture.documents
          .filter((document) => document.entityType === qualityCase.entityType)
          .map((document) => ({
            id: document.id,
            similarity: cosine(queryVector!, documentVectors.get(document.id)!),
          }))
          .sort(
            (left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id),
          ),
      );
    }

    const overall = resultAtZeroThreshold(fixture.cases, rankings);
    const noMatchMaximumScores: number[] = [];
    for (const noMatchCase of fixture.noMatchCases ?? []) {
      const queryStartedAt = performance.now();
      const [queryVector] = await embed(noMatchCase.query, candidate.queryPrefix);
      queryLatencies.push(performance.now() - queryStartedAt);
      const maximumScore = Math.max(
        ...fixture.documents
          .filter((document) => document.entityType === noMatchCase.entityType)
          .map((document) => cosine(queryVector!, documentVectors.get(document.id)!)),
      );
      noMatchMaximumScores.push(maximumScore);
    }
    const thresholdResults = Array.from({ length: 100 }, (_, threshold) => {
      const result = evaluateQualityRankings(fixture, threshold / 100, rankings);
      const noMatchFalsePositiveRate =
        noMatchMaximumScores.length === 0
          ? 0
          : noMatchMaximumScores.filter((score) => score >= threshold / 100).length /
            noMatchMaximumScores.length;
      return { threshold, result, noMatchFalsePositiveRate };
    });
    const bestThreshold = thresholdResults
      .filter(
        ({ result, noMatchFalsePositiveRate }) =>
          result.top10HitRate >= 0.95 &&
          result.top1HitRate >= 0.85 &&
          result.meanReciprocalRank >= 0.9 &&
          noMatchFalsePositiveRate <= 0.05,
      )
      .sort(
        (left, right) =>
          left.noMatchFalsePositiveRate - right.noMatchFalsePositiveRate ||
          left.result.irrelevantResultRate - right.result.irrelevantResultRate ||
          left.result.emptyResultQueries - right.result.emptyResultQueries ||
          right.threshold - left.threshold,
      )[0];
    const relevantScores = fixture.cases.flatMap((qualityCase) => {
      const ranking = rankings.get(qualityCase.query) ?? [];
      return ranking
        .filter((item) => qualityCase.relevantDocumentIds.includes(item.id))
        .map((item) => item.similarity);
    });
    const confusingScores = fixture.cases.flatMap((qualityCase) => {
      const ranking = rankings.get(qualityCase.query) ?? [];
      return ranking
        .filter((item) => qualityCase.confusingDocumentIds.includes(item.id))
        .map((item) => item.similarity);
    });
    const capabilityResults = [...new Set(fixture.cases.map((item) => item.capability))]
      .filter((value): value is string => Boolean(value))
      .sort()
      .map((capability) => {
        const cases = fixture.cases.filter((item) => item.capability === capability);
        const result = resultAtZeroThreshold(cases, rankings);
        return {
          capability,
          queries: cases.length,
          top1HitRate: result.top1HitRate,
          meanReciprocalRank: result.meanReciprocalRank,
          hardNegativeOutrankRate: result.hardNegativeOutrankRate,
        };
      });
    const failures = fixture.cases
      .map((qualityCase) => {
        const ranking = rankings.get(qualityCase.query) ?? [];
        const bestRelevantRank = ranking.findIndex((item) =>
          qualityCase.relevantDocumentIds.includes(item.id),
        );
        const bestConfusingRank = ranking.findIndex((item) =>
          qualityCase.confusingDocumentIds.includes(item.id),
        );
        return {
          query: qualityCase.query,
          capability: qualityCase.capability,
          firstId: ranking[0]?.id,
          bestRelevantRank: bestRelevantRank + 1,
          bestConfusingRank: bestConfusingRank + 1,
        };
      })
      .filter(
        (item) => item.bestRelevantRank !== 1 || item.bestConfusingRank < item.bestRelevantRank,
      );

    process.stdout.write(
      `${JSON.stringify(
        {
          candidate,
          fixture: {
            documents: fixture.documents.length,
            queries: fixture.cases.length,
            noMatchQueries: fixture.noMatchCases?.length ?? 0,
          },
          quality: {
            top10HitRate: overall.top10HitRate,
            top1HitRate: overall.top1HitRate,
            meanReciprocalRank: overall.meanReciprocalRank,
            hardNegativeOutrankRate: overall.hardNegativeOutrankRate,
            scoreDistribution: {
              relevantP05: percentile(relevantScores, 0.05),
              relevantP50: percentile(relevantScores, 0.5),
              relevantP95: percentile(relevantScores, 0.95),
              confusingP05: percentile(confusingScores, 0.05),
              confusingP50: percentile(confusingScores, 0.5),
              confusingP95: percentile(confusingScores, 0.95),
              noMatchMaximumP50: percentile(noMatchMaximumScores, 0.5),
              noMatchMaximumP95: percentile(noMatchMaximumScores, 0.95),
            },
            bestThreshold:
              bestThreshold === undefined
                ? null
                : {
                    threshold: bestThreshold.threshold,
                    top10HitRate: bestThreshold.result.top10HitRate,
                    top1HitRate: bestThreshold.result.top1HitRate,
                    meanReciprocalRank: bestThreshold.result.meanReciprocalRank,
                    irrelevantResultRate: bestThreshold.result.irrelevantResultRate,
                    hardNegativeOutrankRate: bestThreshold.result.hardNegativeOutrankRate,
                    noMatchFalsePositiveRate: bestThreshold.noMatchFalsePositiveRate,
                    emptyResultQueries: bestThreshold.result.emptyResultQueries,
                  },
          },
          performance: {
            loadMilliseconds,
            documentMilliseconds,
            documentsPerSecond: fixture.documents.length / (documentMilliseconds / 1_000),
            queryP50Milliseconds: percentile(queryLatencies, 0.5),
            queryP95Milliseconds: percentile(queryLatencies, 0.95),
            peakRssBytes,
          },
          capabilityResults,
          failures,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await extractor.dispose();
  }
}

await main();
