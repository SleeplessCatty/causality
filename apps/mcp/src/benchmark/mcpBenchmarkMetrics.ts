export interface McpBenchmarkScenarioMetric {
  name: string;
  coldMilliseconds: number;
  repeatedMilliseconds: number;
  responseBytes: number;
  resultCount: number;
  truncated: boolean;
  peakRssDeltaBytes: number;
  failures: number;
}

export interface McpBenchmarkSummary {
  schemaVersion: 1;
  generatedAt: string;
  dataset: { events: 10_000; relations: 30_000; cases: 100_000; seed: 20260731 };
  catalog: { tools: 15; prompts: 5; resources: 4 };
  scenarios: McpBenchmarkScenarioMetric[];
}

export interface McpBenchmarkActionResult {
  resultCount: number;
  truncated: boolean;
  [key: string]: unknown;
}

interface MeasurementDependencies {
  rss(): number;
  setInterval(callback: () => void, milliseconds: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

export interface McpBenchmarkCorrectnessChecks {
  paginationIds?: string[];
  expectedPaginationCount?: number;
  boundedResultCount?: number;
  boundedLimit?: number;
  reachedLimit?: boolean;
  truncated?: boolean;
}

const defaultDependencies: MeasurementDependencies = {
  rss: () => process.memoryUsage().rss,
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle),
};

export class McpBenchmarkMeasurementError extends Error {
  public constructor(
    public readonly metric: McpBenchmarkScenarioMetric,
    cause: unknown,
  ) {
    super(`MCP benchmark scenario failed: ${metric.name}`, { cause });
    this.name = 'McpBenchmarkMeasurementError';
  }
}

async function measuredCall(
  action: () => Promise<McpBenchmarkActionResult>,
  dependencies: MeasurementDependencies,
) {
  const startingRss = dependencies.rss();
  let peakRss = startingRss;
  const sample = () => {
    peakRss = Math.max(peakRss, dependencies.rss());
  };
  const sampler = dependencies.setInterval(sample, 20);
  const started = performance.now();
  try {
    const result = await action();
    sample();
    return {
      result,
      milliseconds: Math.max(0, performance.now() - started),
      peakRssDeltaBytes: Math.max(0, peakRss - startingRss),
    };
  } finally {
    dependencies.clearInterval(sampler);
  }
}

export async function measureMcpScenario(
  name: string,
  action: () => Promise<McpBenchmarkActionResult>,
  dependencies: MeasurementDependencies = defaultDependencies,
): Promise<McpBenchmarkScenarioMetric> {
  const emptyMetric: McpBenchmarkScenarioMetric = {
    name,
    coldMilliseconds: 0,
    repeatedMilliseconds: 0,
    responseBytes: 0,
    resultCount: 0,
    truncated: false,
    peakRssDeltaBytes: 0,
    failures: 0,
  };
  try {
    const cold = await measuredCall(action, dependencies);
    const repeated = await measuredCall(action, dependencies);
    return {
      name,
      coldMilliseconds: cold.milliseconds,
      repeatedMilliseconds: repeated.milliseconds,
      responseBytes: Buffer.byteLength(JSON.stringify(repeated.result), 'utf8'),
      resultCount: repeated.result.resultCount,
      truncated: repeated.result.truncated,
      peakRssDeltaBytes: Math.max(cold.peakRssDeltaBytes, repeated.peakRssDeltaBytes),
      failures: 0,
    };
  } catch (error) {
    throw new McpBenchmarkMeasurementError({ ...emptyMetric, failures: 1 }, error);
  }
}

export function assertMcpBenchmarkCorrectness(
  summary: McpBenchmarkSummary,
  checks: McpBenchmarkCorrectnessChecks = {},
): void {
  if (
    summary.dataset.events !== 10_000 ||
    summary.dataset.relations !== 30_000 ||
    summary.dataset.cases !== 100_000 ||
    summary.dataset.seed !== 20260731
  ) {
    throw new Error('MCP benchmark dataset does not match the reviewed fixed dataset');
  }
  if (
    summary.catalog.tools !== 15 ||
    summary.catalog.prompts !== 5 ||
    summary.catalog.resources !== 4
  ) {
    throw new Error('MCP benchmark catalog is not 15/5/4');
  }
  for (const scenario of summary.scenarios) {
    if (scenario.failures !== 0) throw new Error(`Scenario failed: ${scenario.name}`);
    for (const value of [
      scenario.coldMilliseconds,
      scenario.repeatedMilliseconds,
      scenario.responseBytes,
      scenario.resultCount,
      scenario.peakRssDeltaBytes,
    ]) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid metric: ${scenario.name}`);
    }
  }
  if (checks.paginationIds !== undefined) {
    if (new Set(checks.paginationIds).size !== checks.paginationIds.length) {
      throw new Error('Pagination contains duplicate IDs');
    }
    if (
      checks.expectedPaginationCount !== undefined &&
      checks.paginationIds.length !== checks.expectedPaginationCount
    ) {
      throw new Error('Pagination is missing IDs');
    }
  }
  if (
    checks.boundedResultCount !== undefined &&
    checks.boundedLimit !== undefined &&
    checks.boundedResultCount > checks.boundedLimit
  ) {
    throw new Error('Bounded result exceeds Tool limit');
  }
  if (checks.reachedLimit === true && checks.truncated !== true) {
    throw new Error('A response that reached its limit must report truncation');
  }
}
