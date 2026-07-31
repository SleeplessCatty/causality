import { readFile as nodeReadFile } from 'node:fs/promises';

import type { McpCheckTransport } from '../diagnostics/mcpCheckTypes.js';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8081/mcp';
const DEFAULT_API_URL = 'http://127.0.0.1:3000';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export interface McpCheckOptions {
  transport: McpCheckTransport;
  endpoint: string | null;
  token: string | null;
  apiUrl: string;
  json: boolean;
  help: boolean;
}

type ReadFile = (path: string, encoding: 'utf8') => Promise<string>;

interface CheckConfigFile {
  url?: string;
  token?: string;
}

function validHttpUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL 无效`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} URL 只支持 http 或 https`);
  }
  return url.toString().replace(/\/$/, '');
}

function configFile(value: unknown): CheckConfigFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('MCP 检查配置必须是 JSON 对象');
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== 'url' && key !== 'token');
  if (unknownKeys.length > 0)
    throw new Error(`MCP 检查配置包含未知字段：${unknownKeys.join('、')}`);
  if (record.url !== undefined && typeof record.url !== 'string') {
    throw new Error('MCP 检查配置的 url 必须是字符串');
  }
  if (record.token !== undefined && typeof record.token !== 'string') {
    throw new Error('MCP 检查配置的 Token 必须是字符串');
  }
  return {
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
    ...(typeof record.token === 'string' ? { token: record.token } : {}),
  };
}

export async function loadMcpCheckOptions(
  rawArgs: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  readFile: ReadFile = nodeReadFile,
): Promise<McpCheckOptions> {
  let transport: McpCheckTransport = 'streamable-http';
  let json = false;
  let help = false;
  let configPath = env.CAUSALITY_MCP_CHECK_CONFIG;

  for (const argument of rawArgs.filter((value) => value !== '--')) {
    if (argument === '--json') json = true;
    else if (argument === '--help') help = true;
    else if (argument.startsWith('--transport=')) {
      const value = argument.slice('--transport='.length);
      if (value !== 'streamable-http' && value !== 'stdio') {
        throw new Error('transport 只支持 streamable-http 或 stdio');
      }
      transport = value;
    } else if (argument.startsWith('--config=')) {
      configPath = argument.slice('--config='.length);
      if (!configPath) throw new Error('config 路径不能为空');
    } else if (argument === '--token' || argument.startsWith('--token=')) {
      throw new Error('禁止通过命令行参数传递 Token');
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  let file: CheckConfigFile = {};
  if (configPath) {
    let text: string;
    try {
      text = await readFile(configPath, 'utf8');
    } catch {
      throw new Error(`无法读取 MCP 检查配置：${configPath}`);
    }
    try {
      file = configFile(JSON.parse(text) as unknown);
    } catch (error) {
      throw new Error(
        `无法解析 MCP 检查配置：${error instanceof Error ? error.message : 'JSON 无效'}`,
        { cause: error },
      );
    }
  }

  const token = env.CAUSALITY_MCP_CHECK_TOKEN ?? file.token ?? null;
  if (token !== null && !TOKEN_PATTERN.test(token)) {
    throw new Error('MCP 检查 Token 必须是 64 位小写十六进制字符串');
  }
  const apiUrl = validHttpUrl(env.CAUSALITY_API_URL ?? DEFAULT_API_URL, 'Causality API');
  return {
    transport,
    endpoint:
      transport === 'stdio'
        ? null
        : validHttpUrl(env.CAUSALITY_MCP_CHECK_URL ?? file.url ?? DEFAULT_ENDPOINT, 'MCP'),
    token,
    apiUrl,
    json,
    help,
  };
}
