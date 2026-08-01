import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { MCP_CAPABILITY_COUNTS, MCP_TOOL_NAMES } from '../capabilities/capabilityManifest.js';
import {
  assertMcpBenchmarkCorrectness,
  measureMcpScenario,
  type McpBenchmarkActionResult,
  type McpBenchmarkScenarioMetric,
  type McpBenchmarkSummary,
} from './mcpBenchmarkMetrics.js';

const DATASET = { events: 10_000, relations: 30_000, cases: 100_000, seed: 20260731 } as const;
const scenarioNames = [
  'event_search_all_pages',
  'case_search_all_pages',
  'relation_search_all_pages',
  'event_case_relation_details',
  'local_graph_20',
  'local_graph_50',
  'local_graph_100',
  'causal_path_depth_10',
  'evidence_bundle',
  'candidate_compare_50_events',
  'prepare_skip_plan_50_events',
  'concurrent_readonly_sessions',
] as const;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('Expected object result');
  return value as Record<string, unknown>;
}

function structured(value: unknown): Record<string, unknown> {
  const result = record(value);
  if (result.isError === true)
    throw new Error(`MCP Tool failed: ${JSON.stringify(result.structuredContent)}`);
  return record(result.structuredContent);
}

async function connect(endpoint: string, token: string, name: string) {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  return {
    client,
    async close() {
      try {
        await transport.terminateSession();
      } finally {
        await client.close();
      }
    },
  };
}

async function allPages(
  client: Client,
  toolName: string,
  query: string,
): Promise<{ ids: string[]; items: Record<string, unknown>[] }> {
  const ids: string[] = [];
  const items: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages: number;
  let expectedTotal: number;
  do {
    const result = structured(
      await client.callTool({
        name: toolName,
        arguments: {
          query,
          page,
          ...(toolName === MCP_TOOL_NAMES.searchCausalRelations
            ? { searchMode: 'standard' }
            : toolName === MCP_TOOL_NAMES.searchAtomicEvents
              ? { searchMode: 'standard' }
              : {}),
        },
      }),
    );
    const pageItems = (result.items as unknown[]).map(record);
    for (const item of pageItems) {
      ids.push(String(item.id));
      items.push(item);
    }
    totalPages = Number(result.totalPages);
    expectedTotal = Number(result.totalItems);
    page += 1;
  } while (page <= totalPages);
  if (ids.length !== expectedTotal || new Set(ids).size !== ids.length) {
    throw new Error(`${toolName} pagination coverage is invalid`);
  }
  return { ids, items };
}

async function main(): Promise<void> {
  const apiUrl = process.env.CAUSALITY_MCP_BENCHMARK_API_URL;
  const endpoint = process.env.CAUSALITY_MCP_BENCHMARK_ENDPOINT;
  const batchId = process.env.CAUSALITY_MCP_BENCHMARK_BATCH_ID;
  const output = process.env.CAUSALITY_MCP_BENCHMARK_OUTPUT;
  const token = process.env.CAUSALITY_MCP_BENCHMARK_TOKEN;
  const selectedScenarios = process.env.CAUSALITY_MCP_BENCHMARK_ONLY
    ? process.env.CAUSALITY_MCP_BENCHMARK_ONLY.split(',').filter(Boolean)
    : [];
  for (const selected of selectedScenarios) {
    if (!scenarioNames.includes(selected as (typeof scenarioNames)[number])) {
      throw new Error(`Unknown MCP benchmark scenario: ${selected}`);
    }
  }
  if (!apiUrl || !endpoint || !batchId || !output || !token)
    throw new Error('MCP benchmark environment is incomplete');
  const primary = await connect(endpoint, token, 'mcp-capacity-primary');
  const query = `SIM-${batchId}`;
  const metrics: McpBenchmarkScenarioMetric[] = [];
  try {
    const [tools, prompts, resources] = await Promise.all([
      primary.client.listTools(),
      primary.client.listPrompts(),
      primary.client.listResources(),
    ]);
    const catalog = {
      tools: tools.tools.length,
      prompts: prompts.prompts.length,
      resources: resources.resources.length,
    };
    if (
      catalog.tools !== MCP_CAPABILITY_COUNTS.tools ||
      catalog.prompts !== MCP_CAPABILITY_COUNTS.prompts ||
      catalog.resources !== MCP_CAPABILITY_COUNTS.resources
    ) {
      throw new Error('Benchmark MCP catalog mismatch');
    }

    const [eventFirstPage, caseFirstPage, relationFirstPage] = await Promise.all([
      primary.client.callTool({
        name: MCP_TOOL_NAMES.searchAtomicEvents,
        arguments: { query, page: 1, searchMode: 'standard' },
      }),
      primary.client.callTool({
        name: MCP_TOOL_NAMES.searchConcreteCases,
        arguments: { query, page: 1 },
      }),
      primary.client.callTool({
        name: MCP_TOOL_NAMES.searchCausalRelations,
        arguments: { query, page: 1, searchMode: 'standard' },
      }),
    ]);
    let eventRows = structured(eventFirstPage).items as Record<string, unknown>[];
    let caseRows = structured(caseFirstPage).items as Record<string, unknown>[];
    let relationRows = structured(relationFirstPage).items as Record<string, unknown>[];
    const scenario = async (
      name: (typeof scenarioNames)[number],
      action: () => Promise<McpBenchmarkActionResult>,
    ) => {
      if (selectedScenarios.length > 0 && !selectedScenarios.includes(name)) return;
      metrics.push(await measureMcpScenario(name, action));
    };

    await scenario('event_search_all_pages', async () => {
      const result = await allPages(primary.client, MCP_TOOL_NAMES.searchAtomicEvents, query);
      eventRows = result.items;
      if (result.ids.length !== DATASET.events) throw new Error('Event count mismatch');
      return { resultCount: result.ids.length, truncated: false, ids: result.ids };
    });
    await scenario('case_search_all_pages', async () => {
      const result = await allPages(primary.client, MCP_TOOL_NAMES.searchConcreteCases, query);
      caseRows = result.items;
      if (result.ids.length !== DATASET.cases) throw new Error('Case count mismatch');
      return { resultCount: result.ids.length, truncated: false, ids: result.ids };
    });
    await scenario('relation_search_all_pages', async () => {
      const result = await allPages(primary.client, MCP_TOOL_NAMES.searchCausalRelations, query);
      relationRows = result.items;
      if (result.ids.length !== DATASET.relations) throw new Error('Relation count mismatch');
      return { resultCount: result.ids.length, truncated: false, ids: result.ids };
    });

    const eventId = String(eventRows[0]!.id);
    const caseId = String(caseRows[0]!.id);
    const relationId = String(relationRows[0]!.id);
    await scenario('event_case_relation_details', async () => {
      const results = await Promise.all([
        primary.client.callTool({ name: MCP_TOOL_NAMES.getAtomicEvent, arguments: { eventId } }),
        primary.client.callTool({ name: MCP_TOOL_NAMES.getConcreteCase, arguments: { caseId } }),
        primary.client.callTool({
          name: MCP_TOOL_NAMES.getCausalRelation,
          arguments: { relationId },
        }),
      ]);
      results.forEach(structured);
      return { resultCount: 3, truncated: false, responses: results };
    });
    for (const limit of [20, 50, 100] as const) {
      await scenario(`local_graph_${limit}`, async () => {
        const graph = structured(
          await primary.client.callTool({
            name: MCP_TOOL_NAMES.queryLocalCausalGraph,
            arguments: {
              centerEventId: eventId,
              direction: 'both',
              limit,
              minConfidence: 0,
              minCaseCount: 0,
            },
          }),
        );
        const meta = record(graph.meta);
        const count = Number(meta.nodeCount);
        // The graph limit bounds expanded neighbors; the center event is returned in addition.
        if (count > limit + 1) throw new Error('Graph exceeds center plus node limit');
        return {
          resultCount: count,
          truncated: String(meta.stopReason) !== 'exhausted',
          response: graph,
        };
      });
    }

    const cause = record(relationRows[0]!.causeEvent);
    const effect = record(relationRows[0]!.effectEvent);
    await scenario('causal_path_depth_10', async () => {
      const paths = structured(
        await primary.client.callTool({
          name: MCP_TOOL_NAMES.findCausalPaths,
          arguments: {
            sourceEventId: String(cause.id),
            targetEventId: String(effect.id),
            maxDepth: 10,
            pathLimit: 10,
            minConfidence: 0,
            minCaseCount: 0,
          },
        }),
      );
      return {
        resultCount: (paths.paths as unknown[]).length,
        truncated: paths.truncated === true,
        response: paths,
      };
    });
    await scenario('evidence_bundle', async () => {
      const bundle = structured(
        await primary.client.callTool({
          name: MCP_TOOL_NAMES.getCausalEvidenceBundle,
          arguments: { relationIds: [relationId], caseLimitPerRelation: 5 },
        }),
      );
      return {
        resultCount: (bundle.relations as unknown[]).length,
        truncated: false,
        response: bundle,
      };
    });

    const candidateEvents = eventRows.slice(0, 50).map((event, index) => ({
      ref: `event-${index + 1}`,
      name: String(event.name),
      description: null,
      aliases: [],
      keywords: [],
    }));
    const candidateRelations = Array.from({ length: 25 }, (_, index) => ({
      ref: `relation-${index + 1}`,
      causeEventRef: candidateEvents[index * 2]!.ref,
      effectEventRef: candidateEvents[index * 2 + 1]!.ref,
      description: null,
    }));
    const candidates = {
      topic: 'MCP 容量基准',
      clientName: 'mcp-capacity-benchmark',
      atomicEvents: candidateEvents,
      concreteCases: [],
      causalRelations: candidateRelations,
      relationCaseLinks: [],
    };
    let comparison: Record<string, unknown> | undefined;
    await scenario('candidate_compare_50_events', async () => {
      comparison = structured(
        await primary.client.callTool({
          name: MCP_TOOL_NAMES.compareKnowledgeCandidates,
          arguments: candidates,
        }),
      );
      return {
        resultCount: (comparison.atomicEvents as unknown[]).length,
        truncated: false,
        response: comparison,
      };
    });
    await scenario('prepare_skip_plan_50_events', async () => {
      const plan = structured(
        await primary.client.callTool({
          name: MCP_TOOL_NAMES.prepareKnowledgeChanges,
          arguments: {
            candidates,
            comparison,
            decisions: {
              atomicEvents: candidates.atomicEvents.map((event) => ({
                ref: event.ref,
                action: 'skip',
                reason: '容量基准不写入知识数据',
              })),
              concreteCases: [],
              causalRelations: candidateRelations.map((relation) => ({
                ref: relation.ref,
                action: 'skip',
                reason: '容量基准不写入知识数据',
              })),
              relationCaseLinks: [],
            },
          },
        }),
      );
      const summary = record(plan.summary);
      if (Object.values(summary).some((value) => Number(value) !== 0)) {
        throw new Error('Skip plan unexpectedly writes business data');
      }
      return { resultCount: 50, truncated: false, response: plan };
    });
    await scenario('concurrent_readonly_sessions', async () => {
      const connections = await Promise.all(
        Array.from({ length: 4 }, (_, index) => connect(endpoint, token, `mcp-capacity-${index}`)),
      );
      try {
        await Promise.all(
          connections.map((connection) =>
            connection.client.callTool({
              name: MCP_TOOL_NAMES.searchAtomicEvents,
              arguments: { query, page: 1, searchMode: 'standard' },
            }),
          ),
        );
      } finally {
        await Promise.all(connections.map((connection) => connection.close()));
      }
      return { resultCount: 4, truncated: false };
    });

    const summary: McpBenchmarkSummary = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dataset: DATASET,
      catalog: { tools: 15, prompts: 5, resources: 4 },
      scenarios: metrics,
    };
    const expectedScenarios = selectedScenarios.length > 0 ? selectedScenarios : scenarioNames;
    if (metrics.map((metric) => metric.name).join('|') !== expectedScenarios.join('|')) {
      throw new Error('Benchmark scenario coverage mismatch');
    }
    assertMcpBenchmarkCorrectness(summary);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await primary.close();
  }
}

function formatError(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error) {
      messages.push(current.stack ?? current.message);
      current = current.cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages.join('\nCaused by:\n');
}

await main().catch((error: unknown) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
