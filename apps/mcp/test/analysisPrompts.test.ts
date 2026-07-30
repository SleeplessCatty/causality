import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { MCP_PROMPT_NAMES } from '../src/capabilities/capabilityManifest.js';
import {
  ANALYSIS_DENIED_TOOL_NAMES,
  ANALYSIS_READ_TOOL_NAMES,
  buildDomainModelRules,
} from '../src/prompts/analysisPolicy.js';
import { buildAnalyzeEventPrompt } from '../src/prompts/analyzeEventPrompt.js';
import { registerCapturePrompt } from '../src/prompts/capturePrompt.js';
import { registerAnalysisPrompts } from '../src/prompts/registerAnalysisPrompts.js';
import { buildReviewChainPrompt } from '../src/prompts/reviewChainPrompt.js';
import { buildTracePathPrompt } from '../src/prompts/tracePathPrompt.js';

const prompts = [buildAnalyzeEventPrompt(), buildTracePathPrompt(), buildReviewChainPrompt()];
const workspaceRoot = resolve(import.meta.dirname, '../../..');

describe('canonical causal analysis prompts', () => {
  it('defines the reusable domain evidence boundary', () => {
    const rules = buildDomainModelRules();

    expect(rules).toContain('语境化原子事件');
    expect(rules).toContain('真实发生记录');
    expect(rules).toContain('直接关系');
    expect(rules).toContain('间接路径');
    expect(rules).toContain('路径最低置信度');
    expect(rules).toContain('无案例依据');
    expect(rules).toContain('数据库事实');
    expect(rules).toContain('外部信息');
  });

  it('keeps every analysis prompt database-first and read-only', () => {
    for (const prompt of prompts) {
      expect(prompt).toContain('从当前可见会话');
      expect(prompt).toContain('无法可靠匹配时停止数据库分析');
      expect(prompt).toContain('外部信息');
      expect(prompt).toContain('无案例依据');
      expect(prompt).toContain('不得调用采集工具');
      expect(prompt).toContain('不计算整体发生概率');
      expect(prompt).toContain('默认不显示数据库 UUID');
      expect(prompt).toContain('不直接展示工具 JSON');
      expect(prompt).toContain('增强查询不可用');
      expect(prompt).toContain('重新查询路径一次');
      expect(prompt).toContain('案例证据未加载');
      expect(prompt).toContain('不得自动写入数据库');
    }
  });

  it('publishes the exact read-tool allowlist and capture-tool denylist', () => {
    expect(ANALYSIS_READ_TOOL_NAMES).toEqual([
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
    ]);
    expect(ANALYSIS_DENIED_TOOL_NAMES).toEqual([
      'compare_knowledge_candidates',
      'prepare_knowledge_changes',
      'get_import_plan_status',
      'commit_knowledge_changes',
      'get_import_result',
    ]);
    for (const prompt of prompts) {
      for (const name of ANALYSIS_READ_TOOL_NAMES) expect(prompt).toContain(name);
      for (const name of ANALYSIS_DENIED_TOOL_NAMES) expect(prompt).toContain(name);
    }
  });

  it('defines bounded direct event analysis and progressive expansion', () => {
    const prompt = buildAnalyzeEventPrompt();

    expect(prompt).toContain('最多检查 100 条直接关系');
    expect(prompt).toContain('首次展示前 5 条');
    expect(prompt).toContain('每条最多 3 个案例');
    expect(prompt).toContain('案例数降序');
    expect(prompt).toContain('置信度降序');
    expect(prompt).toContain('不自动展示第二层');
    expect(prompt).toContain('用户追问后');
    expect(prompt).toContain('未展开数量');
  });

  it('defines bounded path ranking, evidence expansion, and truncation language', () => {
    const prompt = buildTracePathPrompt();

    expect(prompt).toContain('maxDepth = 5');
    expect(prompt).toContain('pathLimit = 10');
    expect(prompt).toContain('最多展示 3 条路径');
    expect(prompt).toContain('完整展开排名第一的路径');
    expect(prompt).toContain('每段最多 3 个案例');
    expect(prompt).toContain('10,000 个扩展状态');
    expect(prompt).toContain('当前受限查询尚未找到路径');
    expect(prompt).toContain('仍可能存在未展开路径');
  });

  it('reviews ten chain segments with five evidence classifications', () => {
    const prompt = buildReviewChainPrompt();

    expect(prompt).toContain('单次最多审查 10 个相邻关系段');
    expect(prompt).toContain('库内有直接关系与案例依据');
    expect(prompt).toContain('库内有直接关系，但无案例依据');
    expect(prompt).toContain('仅有间接路径支持');
    expect(prompt).toContain('只存在反向关系');
    expect(prompt).toContain('库内未找到支持');
    expect(prompt).toContain('A → X → B');
    expect(prompt).toContain('不生成整条链的真假评分');
  });

  it('registers all four canonical prompts without arguments', async () => {
    const server = new McpServer({ name: 'analysis-prompt-test', version: '1.0.0' });
    registerCapturePrompt(server);
    registerAnalysisPrompts(server);
    const client = new Client({ name: 'analysis-prompt-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listPrompts();
      expect(listed.prompts.map((prompt) => prompt.name)).toEqual(Object.values(MCP_PROMPT_NAMES));
      for (const prompt of listed.prompts) expect(prompt.arguments ?? []).toEqual([]);

      const result = await client.getPrompt({ name: MCP_PROMPT_NAMES.analyzeEvent });
      expect(result.messages).toEqual([
        {
          role: 'user',
          content: { type: 'text', text: buildAnalyzeEventPrompt() },
        },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('keeps every portable Markdown prompt byte-identical to its canonical builder', async () => {
    const expected = [
      ['prompts/causality-analyze-event.md', buildAnalyzeEventPrompt()],
      ['prompts/causality-trace-path.md', buildTracePathPrompt()],
      ['prompts/causality-review-chain.md', buildReviewChainPrompt()],
    ] as const;

    for (const [path, content] of expected) {
      await expect(readFile(resolve(workspaceRoot, path), 'utf8')).resolves.toBe(content);
    }
  });

  it('keeps analysis Skills as thin launchers without copied workflow rules', async () => {
    const skills = [
      ['skills/causality-analyze-event/SKILL.md', MCP_PROMPT_NAMES.analyzeEvent],
      ['skills/causality-trace-path/SKILL.md', MCP_PROMPT_NAMES.tracePath],
      ['skills/causality-review-chain/SKILL.md', MCP_PROMPT_NAMES.reviewChain],
    ] as const;

    for (const [path, promptName] of skills) {
      const skill = await readFile(resolve(workspaceRoot, path), 'utf8');
      expect(skill).toContain(promptName);
      expect(skill).toContain(path.replace('skills/', 'prompts/').replace('/SKILL.md', '.md'));
      expect(skill).not.toContain('最多检查 100');
      expect(skill).not.toContain('10,000');
      expect(skill).not.toContain('库内有直接关系与案例依据');
    }
  });
});
