import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  CAUSALITY_MCP_VERSION,
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
} from '../capabilities/capabilityManifest.js';
import type { McpCheckOptions } from '../config/checkConfig.js';
import type { McpCheckItem, McpCheckReport } from './mcpCheckTypes.js';

interface NamedItem {
  name: string;
}

interface UriItem {
  uri: string;
}

export interface McpCheckConnection {
  listTools(): Promise<{ tools: NamedItem[] }>;
  listPrompts(): Promise<{ prompts: NamedItem[] }>;
  listResources(): Promise<{ resources: UriItem[] }>;
  getPrompt(input: { name: string }): Promise<unknown>;
  readResource(input: { uri: string }): Promise<unknown>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpCheckDependencies {
  checkEndpoint(options: McpCheckOptions): Promise<void>;
  checkUnauthorized(options: McpCheckOptions): Promise<boolean>;
  connect(options: McpCheckOptions): Promise<McpCheckConnection>;
  now?: () => Date;
}

const requiredItems = [
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
] as const;

const labels: Record<(typeof requiredItems)[number], string> = {
  endpoint_reachable: '服务端点可访问',
  unauthorized_rejected: '未授权请求被拒绝',
  initialize: 'MCP 初始化',
  tools_catalog: 'Tool 目录',
  prompts_catalog: 'Prompt 目录',
  resources_catalog: 'Resource 目录',
  prompt_read: '读取 Prompt',
  resource_read: '读取 Resource',
  readonly_search: '只读搜索 Tool',
  structured_error: '结构化业务错误',
  session_close: '关闭 MCP 会话',
};

const defaultDependencies: McpCheckDependencies = {
  async checkEndpoint(options) {
    if (options.transport === 'stdio') return;
    const endpoint = new URL(options.endpoint!);
    const response = await fetch(new URL('/health', endpoint));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  },
  async checkUnauthorized(options) {
    if (options.transport === 'stdio') return true;
    const response = await fetch(options.endpoint!, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'mcp-check-unauthorized',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'causality-mcp-check', version: CAUSALITY_MCP_VERSION },
        },
      }),
    });
    return response.status === 401;
  },
  async connect(options) {
    const client = new Client({ name: 'causality-mcp-check', version: CAUSALITY_MCP_VERSION });
    if (options.transport === 'streamable-http') {
      const transport = new StreamableHTTPClientTransport(new URL(options.endpoint!), {
        requestInit: { headers: { Authorization: `Bearer ${options.token!}` } },
      });
      await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
      return connectionFromClient(client, async () => {
        try {
          await transport.terminateSession();
        } finally {
          await client.close();
        }
      });
    }

    const transport = new StdioClientTransport({
      command: 'pnpm',
      args: ['stdio'],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        CAUSALITY_API_URL: options.apiUrl,
        CAUSALITY_MCP_TOKEN: options.token!,
      },
      stderr: 'inherit',
    });
    await client.connect(transport);
    return connectionFromClient(client, () => client.close());
  },
};

function connectionFromClient(client: Client, close: () => Promise<void>): McpCheckConnection {
  return {
    listTools: () => client.listTools(),
    listPrompts: () => client.listPrompts(),
    listResources: () => client.listResources(),
    getPrompt: (input) => client.getPrompt(input),
    readResource: (input) => client.readResource(input),
    callTool: (input) => client.callTool(input),
    close,
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

function sameValues(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function runMcpCheck(
  options: McpCheckOptions,
  dependencies: Partial<McpCheckDependencies> = {},
): Promise<McpCheckReport> {
  const deps = { ...defaultDependencies, ...dependencies };
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const items: McpCheckItem[] = [];
  const counts = { tools: 0, prompts: 0, resources: 0 };
  let connection: McpCheckConnection | undefined;

  const add = (
    id: (typeof requiredItems)[number],
    status: McpCheckItem['status'],
    durationMs: number,
    message: string,
    suggestedAction: string | null = null,
  ) => items.push({ id, label: labels[id], status, durationMs, message, suggestedAction });

  const run = async (
    id: (typeof requiredItems)[number],
    action: () => Promise<string> | string,
    suggestedAction: string,
  ): Promise<boolean> => {
    const started = performance.now();
    try {
      const message = await action();
      add(id, 'passed', Math.max(0, Math.round(performance.now() - started)), message);
      return true;
    } catch (error) {
      add(
        id,
        'failed',
        Math.max(0, Math.round(performance.now() - started)),
        failureMessage(error),
        suggestedAction,
      );
      return false;
    }
  };

  const skipThroughClose = (from: number, message: string) => {
    for (const id of requiredItems.slice(from)) add(id, 'skipped', 0, message);
  };

  if (options.token === null) {
    add(
      'endpoint_reachable',
      'failed',
      0,
      '未配置 MCP 检查 Token',
      '设置 CAUSALITY_MCP_CHECK_TOKEN 或选择本地检查配置文件',
    );
    skipThroughClose(1, '配置未完成，未发起 MCP 请求');
    return finalReport(options, startedAt, now().toISOString(), counts, items);
  }

  const reachable = await run(
    'endpoint_reachable',
    async () => {
      await deps.checkEndpoint(options);
      return options.transport === 'stdio' ? '将通过本地 stdio 子进程连接' : 'HTTP 端点可访问';
    },
    '检查 MCP 服务是否启动以及地址是否正确',
  );
  if (!reachable) {
    skipThroughClose(1, '端点不可访问，后续检查未执行');
    return finalReport(options, startedAt, now().toISOString(), counts, items);
  }

  if (options.transport === 'stdio') {
    add('unauthorized_rejected', 'skipped', 0, 'stdio 不使用 HTTP Bearer 认证');
  } else {
    await run(
      'unauthorized_rejected',
      async () => {
        if (!(await deps.checkUnauthorized(options))) throw new Error('服务未拒绝未授权请求');
        return '未携带 Token 的请求返回 401';
      },
      '检查 MCP HTTP 认证配置',
    );
  }

  const initialized = await run(
    'initialize',
    async () => {
      connection = await deps.connect(options);
      return 'MCP 客户端初始化成功';
    },
    '检查传输方式、Token、API 服务和 MCP 服务日志',
  );
  if (!initialized || !connection) {
    skipThroughClose(3, 'MCP 初始化失败，后续检查未执行');
    return finalReport(options, startedAt, now().toISOString(), counts, items);
  }

  await run(
    'tools_catalog',
    async () => {
      const result = await connection!.listTools();
      const names = result.tools.map((item) => item.name);
      counts.tools = names.length;
      if (!sameValues(names, Object.values(MCP_TOOL_NAMES)))
        throw new Error('Tool 目录与能力清单不一致');
      return `发现 ${names.length} 个 Tool`;
    },
    '检查 MCP 服务版本和 Tool 注册清单',
  );
  await run(
    'prompts_catalog',
    async () => {
      const result = await connection!.listPrompts();
      const names = result.prompts.map((item) => item.name);
      counts.prompts = names.length;
      if (!sameValues(names, Object.values(MCP_PROMPT_NAMES))) {
        throw new Error('Prompt 目录与能力清单不一致');
      }
      return `发现 ${names.length} 个 Prompt`;
    },
    '检查 MCP 服务版本和 Prompt 注册清单',
  );
  await run(
    'resources_catalog',
    async () => {
      const result = await connection!.listResources();
      const uris = result.resources.map((item) => item.uri);
      counts.resources = uris.length;
      if (!sameValues(uris, Object.values(MCP_RESOURCE_URIS))) {
        throw new Error('Resource 目录与能力清单不一致');
      }
      return `发现 ${uris.length} 个 Resource`;
    },
    '检查 MCP 服务版本和 Resource 注册清单',
  );
  await run(
    'prompt_read',
    async () => {
      await connection!.getPrompt({ name: MCP_PROMPT_NAMES.analyzeEvent });
      return `成功读取 ${MCP_PROMPT_NAMES.analyzeEvent}`;
    },
    '检查 Prompt 是否可被当前客户端读取',
  );
  await run(
    'resource_read',
    async () => {
      await connection!.readResource({ uri: MCP_RESOURCE_URIS.capabilities });
      return `成功读取 ${MCP_RESOURCE_URIS.capabilities}`;
    },
    '检查能力 Resource 的 Schema 和服务端日志',
  );
  await run(
    'readonly_search',
    async () => {
      const result = record(
        await connection!.callTool({
          name: MCP_TOOL_NAMES.searchAtomicEvents,
          arguments: {
            query: '__causality_mcp_check_no_match__',
            page: 1,
            searchMode: 'standard',
          },
        }),
      );
      if (result?.isError === true) throw new Error('只读搜索返回业务错误');
      return '只读搜索成功且未写入数据';
    },
    '检查 API、数据库和 Tool 错误信息',
  );
  await run(
    'structured_error',
    async () => {
      const result = record(
        await connection!.callTool({
          name: MCP_TOOL_NAMES.getAtomicEvent,
          arguments: { eventId: '00000000-0000-4000-8000-000000000000' },
        }),
      );
      const structured = record(result?.structuredContent);
      const error = record(structured?.error);
      if (result?.isError !== true || typeof error?.code !== 'string') {
        throw new Error('缺少标准结构化 Tool 错误');
      }
      return `收到预期结构化错误 ${error.code}`;
    },
    '检查 MCP Tool 错误适配器和 API 错误响应',
  );

  await run(
    'session_close',
    async () => {
      await connection!.close();
      connection = undefined;
      return 'MCP 会话已关闭';
    },
    '手动终止遗留客户端会话并检查服务日志',
  );

  if (connection) {
    try {
      await connection.close();
    } catch {
      // The explicit session_close item owns the user-facing cleanup result.
    }
  }
  return finalReport(options, startedAt, now().toISOString(), counts, items);
}

function finalReport(
  options: McpCheckOptions,
  startedAt: string,
  completedAt: string,
  counts: McpCheckReport['counts'],
  items: McpCheckItem[],
): McpCheckReport {
  return {
    schemaVersion: 1,
    transport: options.transport,
    endpoint: options.endpoint,
    startedAt,
    completedAt,
    success: items.every((item) => item.status !== 'failed'),
    counts,
    items,
  };
}

export function renderMcpCheckText(report: McpCheckReport): string {
  const status = { passed: '通过', failed: '失败', skipped: '跳过' } as const;
  return [
    `Causality MCP 检查（${report.transport}）`,
    ...report.items.map(
      (item) =>
        `[${status[item.status]}] ${item.label}：${item.message}${
          item.suggestedAction ? `；建议：${item.suggestedAction}` : ''
        }（${item.durationMs} ms）`,
    ),
    `能力数量：Tool ${report.counts.tools} / Prompt ${report.counts.prompts} / Resource ${report.counts.resources}`,
    `最终结果：${report.success ? '通过' : '失败'}`,
  ].join('\n');
}
