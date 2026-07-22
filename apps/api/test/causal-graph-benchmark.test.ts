import { describe, expect, it } from 'vitest';

import {
  assertBenchmarkTarget,
  assertInstalledHubDegree,
  benchmarkScenariosForCenter,
  percentile95,
  summarizeDurations,
} from '../src/database/benchmark/causalGraphBenchmark.js';

describe('causal graph benchmark statistics', () => {
  it('calculates the nearest-rank P95 without mutating samples', () => {
    const durations = [50, 10, 40, 20, 30];

    expect(percentile95(durations)).toBe(50);
    expect(durations).toEqual([50, 10, 40, 20, 30]);
  });

  it('summarizes average, P95, and maximum durations', () => {
    expect(summarizeDurations([10, 20, 30])).toEqual({
      samples: 3,
      averageMilliseconds: 20,
      p95Milliseconds: 30,
      maximumMilliseconds: 30,
    });
  });

  it('rejects empty duration collections', () => {
    expect(() => percentile95([])).toThrow('Benchmark requires at least one duration');
    expect(() => summarizeDurations([])).toThrow('Benchmark requires at least one duration');
  });

  it('accepts the threshold boundary and rejects a slower P95', () => {
    expect(() => assertBenchmarkTarget({ p95Milliseconds: 2_000 }, 2_000)).not.toThrow();
    expect(() => assertBenchmarkTarget({ p95Milliseconds: 2_001 }, 2_000)).toThrow(
      'Causal graph benchmark P95 2001ms exceeds 2000ms',
    );
  });

  it('covers bounded and filtered queries for the 10,000-degree hub', () => {
    expect(benchmarkScenariosForCenter('hub')).toEqual([
      {
        name: 'both-limit-20',
        query: { direction: 'both', limit: 20, minConfidence: 0, minCaseCount: 0 },
      },
      {
        name: 'both-limit-100',
        query: { direction: 'both', limit: 100, minConfidence: 0, minCaseCount: 0 },
      },
      {
        name: 'combined',
        query: { direction: 'both', limit: 100, minConfidence: 75, minCaseCount: 1 },
      },
    ]);
  });

  it('rejects a hub whose installed database degree does not match the request', () => {
    expect(() => assertInstalledHubDegree(10_000, 10_001, 10_000)).toThrow(
      'Benchmark hub expected degree 10000 with 10000 distinct neighbors, found degree 10001 with 10000 distinct neighbors',
    );
  });
});
