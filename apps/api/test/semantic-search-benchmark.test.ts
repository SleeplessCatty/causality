import { describe, expect, it } from 'vitest';

import {
  assertSemanticBenchmarkCorrectness,
  summarizeSemanticBenchmark,
} from '../src/database/benchmark/semanticSearchBenchmark.js';

describe('semantic search benchmark contract', () => {
  it('keeps hardware timings informational while enforcing data and result correctness', () => {
    const summary = summarizeSemanticBenchmark({
      semanticRecordCount: 100_000,
      candidateCount: 100,
      expectedFirstId: 'expected',
      actualFirstId: 'expected',
      retrievedSimilarity: 0.999,
      timings: {
        ordinarySearchDuringIndexing: 12.3456,
        candidateRetrieval: 23.4567,
        e5WarmServiceQuery: 34.5678,
        bgeWarmServiceQuery: 45.6789,
        restartRecovery: 56.7891,
      },
    });

    expect(summary.timings.candidateRetrieval).toBe(23.46);
    expect(() => assertSemanticBenchmarkCorrectness(summary)).not.toThrow();
  });

  it('rejects an incomplete dataset, excess candidates, or changed first result', () => {
    const valid = summarizeSemanticBenchmark({
      semanticRecordCount: 99_999,
      candidateCount: 101,
      expectedFirstId: 'expected',
      actualFirstId: 'different',
      retrievedSimilarity: 0.5,
      timings: {
        ordinarySearchDuringIndexing: 1,
        candidateRetrieval: 1,
        e5WarmServiceQuery: 1,
        bgeWarmServiceQuery: 1,
        restartRecovery: 1,
      },
    });
    expect(() => assertSemanticBenchmarkCorrectness(valid)).toThrow(/100,000/);
  });
});
