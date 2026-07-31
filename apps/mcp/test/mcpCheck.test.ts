import { describe, expect, it, vi } from 'vitest';

import { loadMcpCheckOptions } from '../src/config/checkConfig.js';
import {
  renderMcpCheckText,
  runMcpCheck,
  type McpCheckConnection,
} from '../src/diagnostics/mcpCheck.js';

const token = 'd'.repeat(64);

describe('MCP compatibility diagnostic', () => {
  it('loads the default HTTP endpoint and explicit environment credentials', async () => {
    const defaults = await loadMcpCheckOptions([], {}, async () => '');
    const explicit = await loadMcpCheckOptions(
      ['--json'],
      {
        CAUSALITY_MCP_CHECK_URL: 'http://127.0.0.1:9000/mcp',
        CAUSALITY_MCP_CHECK_TOKEN: token,
      },
      async () => '',
    );

    expect(defaults).toMatchObject({
      transport: 'streamable-http',
      endpoint: 'http://127.0.0.1:8081/mcp',
      token: null,
      json: false,
    });
    expect(explicit).toMatchObject({
      endpoint: 'http://127.0.0.1:9000/mcp',
      token,
      json: true,
    });
  });

  it('loads a selected config while environment values retain priority', async () => {
    const readFile = vi.fn(async () =>
      JSON.stringify({ url: 'http://127.0.0.1:7000/mcp', token: 'e'.repeat(64) }),
    );
    const options = await loadMcpCheckOptions(
      ['--config=/tmp/mcp-check.json'],
      { CAUSALITY_MCP_CHECK_URL: 'http://127.0.0.1:7100/mcp' },
      readFile,
    );

    expect(readFile).toHaveBeenCalledWith('/tmp/mcp-check.json', 'utf8');
    expect(options.endpoint).toBe('http://127.0.0.1:7100/mcp');
    expect(options.token).toBe('e'.repeat(64));
  });

  it('accepts stdio and rejects unsafe or malformed CLI configuration', async () => {
    await expect(
      loadMcpCheckOptions(['--transport=stdio', '--json'], {}, async () => ''),
    ).resolves.toMatchObject({ transport: 'stdio', endpoint: null, json: true });
    await expect(loadMcpCheckOptions(['--token=secret'], {}, async () => '')).rejects.toThrow(
      'Token',
    );
    await expect(loadMcpCheckOptions(['--unknown'], {}, async () => '')).rejects.toThrow(
      '未知参数',
    );
    await expect(
      loadMcpCheckOptions([], { CAUSALITY_MCP_CHECK_URL: 'invalid' }, async () => ''),
    ).rejects.toThrow('URL');
    await expect(
      loadMcpCheckOptions([], { CAUSALITY_MCP_CHECK_TOKEN: 'short' }, async () => ''),
    ).rejects.toThrow('Token');
    await expect(
      loadMcpCheckOptions(['--config=/missing.json'], {}, async () => {
        throw new Error('ENOENT');
      }),
    ).rejects.toThrow('无法读取');
  });

  it('runs every read-only check in order and always closes the connection', async () => {
    const calls: string[] = [];
    const close = vi.fn(async () => undefined);
    const connection: McpCheckConnection = {
      listTools: async () => ({ tools: toolNames().map((name) => ({ name })) }),
      listPrompts: async () => ({ prompts: promptNames().map((name) => ({ name })) }),
      listResources: async () => ({ resources: resourceUris().map((uri) => ({ uri })) }),
      getPrompt: async ({ name }) => {
        calls.push(`prompt:${name}`);
        return {};
      },
      readResource: async ({ uri }) => {
        calls.push(`resource:${uri}`);
        return {};
      },
      callTool: async ({ name }) => {
        calls.push(`tool:${name}`);
        return name === 'get_atomic_event'
          ? { isError: true, structuredContent: { error: { code: 'EVENT_NOT_FOUND' } } }
          : { isError: false };
      },
      close,
    };
    const report = await runMcpCheck(
      {
        transport: 'streamable-http',
        endpoint: 'http://127.0.0.1:8081/mcp',
        token,
        json: false,
        help: false,
        apiUrl: 'http://127.0.0.1:3000',
      },
      {
        checkEndpoint: async () => undefined,
        checkUnauthorized: async () => true,
        connect: async () => connection,
        now: () => new Date('2026-07-31T00:00:00.000Z'),
      },
    );

    expect(report.success).toBe(true);
    expect(report.counts).toEqual({ tools: 15, prompts: 5, resources: 4 });
    expect(report.items.map((item) => item.id)).toEqual([
      'endpoint_reachable',
      'unauthorized_rejected',
      'initialize',
      'tools_catalog',
      'prompts_catalog',
      'resources_catalog',
      'prompt_read',
      'resource_read',
      'readonly_search',
      'structured_error',
      'session_close',
    ]);
    expect(calls).toEqual([
      'prompt:causality_analyze_event',
      'resource:causality://capabilities',
      'tool:search_atomic_events',
      'tool:get_atomic_event',
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(renderMcpCheckText(report)).not.toContain(token);
  });

  it('reports connection failure and still closes a partially opened connection', async () => {
    const close = vi.fn(async () => undefined);
    const report = await runMcpCheck(
      {
        transport: 'streamable-http',
        endpoint: 'http://127.0.0.1:8081/mcp',
        token,
        json: false,
        help: false,
        apiUrl: 'http://127.0.0.1:3000',
      },
      {
        checkEndpoint: async () => undefined,
        checkUnauthorized: async () => true,
        connect: async () => {
          const connection = { close } as unknown as McpCheckConnection;
          await connection.close();
          throw new Error('connection refused');
        },
      },
    );

    expect(report.success).toBe(false);
    expect(report.items.find((item) => item.id === 'initialize')).toMatchObject({
      status: 'failed',
    });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain(token);
  });
});

function toolNames(): string[] {
  return [
    'search_atomic_events',
    'get_atomic_event',
    'search_concrete_cases',
    'get_causal_relation',
    'get_relation_cases',
    'query_local_causal_graph',
    'get_concrete_case',
    'search_causal_relations',
    'find_causal_paths',
    'get_causal_evidence_bundle',
    'compare_knowledge_candidates',
    'prepare_knowledge_changes',
    'get_import_plan_status',
    'commit_knowledge_changes',
    'get_import_result',
  ];
}

function promptNames(): string[] {
  return [
    'causality_capture',
    'causality_analyze_event',
    'causality_trace_path',
    'causality_review_chain',
    'causality_infer_outcomes',
  ];
}

function resourceUris(): string[] {
  return [
    'causality://rules/domain-model',
    'causality://rules/capture',
    'causality://capabilities',
    'causality://system/status',
  ];
}
