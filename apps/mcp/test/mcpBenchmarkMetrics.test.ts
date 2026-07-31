import { describe, expect, it, vi } from 'vitest';

import {
  assertMcpBenchmarkCorrectness,
  McpBenchmarkMeasurementError,
  measureMcpScenario,
  type McpBenchmarkSummary,
} from '../src/benchmark/mcpBenchmarkMetrics.js';

function validSummary(): McpBenchmarkSummary {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-31T00:00:00.000Z',
    dataset: { events: 10_000, relations: 30_000, cases: 100_000, seed: 20260731 },
    catalog: { tools: 15, prompts: 5, resources: 4 },
    scenarios: [
      {
        name: 'event_search_all_pages',
        coldMilliseconds: 10,
        repeatedMilliseconds: 5,
        responseBytes: 100,
        resultCount: 50,
        truncated: false,
        peakRssDeltaBytes: 1024,
        failures: 0,
      },
    ],
  };
}

describe('MCP benchmark metrics', () => {
  it('measures two calls, samples RSS, response bytes, and always clears the sampler', async () => {
    const clearInterval = vi.fn();
    const setInterval = vi.fn((callback: () => void) => {
      callback();
      return 7 as unknown as NodeJS.Timeout;
    });
    let rss = 1_000;
    const metric = await measureMcpScenario(
      'sample',
      async () => ({ payload: '结果', resultCount: 2, truncated: false }),
      {
        rss: () => (rss += 200),
        setInterval,
        clearInterval,
      },
    );

    expect(metric.resultCount).toBe(2);
    expect(metric.responseBytes).toBe(
      Buffer.byteLength(JSON.stringify({ payload: '结果', resultCount: 2, truncated: false })),
    );
    expect(metric.peakRssDeltaBytes).toBeGreaterThanOrEqual(0);
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(clearInterval).toHaveBeenCalledTimes(2);
  });

  it('retains the metric and original cause when a measured action fails', async () => {
    const original = new Error('original benchmark failure');
    let thrown: unknown;
    try {
      await measureMcpScenario('failure', async () => {
        throw original;
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(McpBenchmarkMeasurementError);
    expect((thrown as McpBenchmarkMeasurementError).cause).toBe(original);
    expect((thrown as McpBenchmarkMeasurementError).metric.failures).toBe(1);
  });

  it('rejects invalid datasets, catalogs, metrics, pagination, and bounds', () => {
    const invalidCases: Array<[McpBenchmarkSummary, object | undefined]> = [
      [
        {
          ...validSummary(),
          dataset: { ...validSummary().dataset, events: 9_999 },
        } as unknown as McpBenchmarkSummary,
        undefined,
      ],
      [
        {
          ...validSummary(),
          catalog: { tools: 14, prompts: 5, resources: 4 },
        } as unknown as McpBenchmarkSummary,
        undefined,
      ],
      [
        {
          ...validSummary(),
          scenarios: [{ ...validSummary().scenarios[0]!, failures: 1 }],
        },
        undefined,
      ],
      [
        {
          ...validSummary(),
          scenarios: [{ ...validSummary().scenarios[0]!, coldMilliseconds: -1 }],
        },
        undefined,
      ],
      [validSummary(), { paginationIds: ['a', 'a'], expectedPaginationCount: 2 }],
      [validSummary(), { paginationIds: ['a'], expectedPaginationCount: 2 }],
      [validSummary(), { boundedResultCount: 21, boundedLimit: 20, reachedLimit: false }],
      [
        validSummary(),
        { boundedResultCount: 20, boundedLimit: 20, reachedLimit: true, truncated: false },
      ],
    ];

    for (const [summary, checks] of invalidCases) {
      expect(() => assertMcpBenchmarkCorrectness(summary, checks)).toThrow();
    }
  });
});
