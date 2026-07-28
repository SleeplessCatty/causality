import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCausalityCapturePrompt,
  CAUSALITY_CAPTURE_PROMPT_NAME,
  registerCapturePrompt,
} from '../src/prompts/capturePrompt.js';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

describe('causality capture prompt', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'capture-prompt-test', version: '1.0.0' });
    registerCapturePrompt(server);
    client = new Client({ name: 'capture-prompt-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('registers the canonical MCP prompt', async () => {
    const listed = await client.listPrompts();
    const result = await client.getPrompt({ name: CAUSALITY_CAPTURE_PROMPT_NAME });

    expect(listed.prompts.map((prompt) => prompt.name)).toEqual([CAUSALITY_CAPTURE_PROMPT_NAME]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toEqual({
      type: 'text',
      text: buildCausalityCapturePrompt(),
    });
  });

  it('defines every safety and workflow decision in one canonical source', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('只有用户明确发起采集与入库指令');
    expect(prompt).toContain('自动查找当前可见会话中最后一个成功标记');
    expect(prompt).toContain('最多 50 条原子事件');
    expect(prompt).toContain('只提取与用户问题和追溯主线直接相关');
    expect(prompt).toContain('生成方案之前的步骤自动连续执行');
    expect(prompt).toContain('无法可靠判断时必须选择 skip');
    expect(prompt).toContain('每次修改都重新生成一份完整方案');
    expect(prompt).toContain('只有用户明确确认最新完整方案');
    expect(prompt).toContain('数据错误');
    expect(prompt).toContain('重新生成完整方案');
    expect(prompt).toContain('系统错误');
    expect(prompt).toContain('停止并等待用户');
    expect(prompt).toContain('[Causality-Capture: <historyId>]');
  });

  it('keeps the portable Markdown prompt byte-identical to the canonical source', async () => {
    const portable = await readFile(resolve(workspaceRoot, 'prompts/causality-capture.md'), 'utf8');

    expect(portable).toBe(buildCausalityCapturePrompt());
  });

  it('keeps the Skill as a thin launcher without copying workflow rules', async () => {
    const skill = await readFile(
      resolve(workspaceRoot, 'skills/causality-capture/SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('causality_capture');
    expect(skill).toContain('prompts/causality-capture.md');
    expect(skill).not.toContain('最多 50 条原子事件');
    expect(skill).not.toContain('无法可靠判断时必须选择 skip');
  });
});
