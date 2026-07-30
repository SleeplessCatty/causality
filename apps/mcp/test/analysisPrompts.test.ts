import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { MCP_PROMPT_NAMES } from '../src/capabilities/capabilityManifest.js';
import {
  ANALYSIS_DENIED_TOOL_NAMES,
  ANALYSIS_READ_TOOL_NAMES,
  buildDomainModelRules,
  buildSharedAnalysisPolicy,
} from '../src/prompts/analysisPolicy.js';
import { buildAnalyzeEventPrompt } from '../src/prompts/analyzeEventPrompt.js';
import { registerCapturePrompt } from '../src/prompts/capturePrompt.js';
import {
  buildInferOutcomesPrompt,
  OUTCOME_INFERENCE_READ_TOOL_NAMES,
} from '../src/prompts/inferOutcomesPrompt.js';
import { registerAnalysisPrompts } from '../src/prompts/registerAnalysisPrompts.js';
import { buildReviewChainPrompt } from '../src/prompts/reviewChainPrompt.js';
import { buildTracePathPrompt } from '../src/prompts/tracePathPrompt.js';

const existingAnalysisPrompts = [
  buildAnalyzeEventPrompt(),
  buildTracePathPrompt(),
  buildReviewChainPrompt(),
];
const prompts = [...existingAnalysisPrompts, buildInferOutcomesPrompt()];
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
    for (const prompt of existingAnalysisPrompts) {
      for (const name of ANALYSIS_READ_TOOL_NAMES) expect(prompt).toContain(name);
      for (const name of ANALYSIS_DENIED_TOOL_NAMES) expect(prompt).toContain(name);
    }
  });

  it('narrows the shared read-tool list without weakening capture-tool denial', () => {
    const policy = buildSharedAnalysisPolicy({
      readToolNames: ['search_atomic_events', 'get_atomic_event'],
    });

    expect(policy).toContain('`search_atomic_events`');
    expect(policy).toContain('`get_atomic_event`');
    expect(policy).not.toContain('`search_concrete_cases`');
    expect(policy).not.toContain('`search_causal_relations`');
    for (const name of ANALYSIS_DENIED_TOOL_NAMES) expect(policy).toContain(`\`${name}\``);
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

  it('defines bounded single-event downstream outcome inference', () => {
    expect(OUTCOME_INFERENCE_READ_TOOL_NAMES).toEqual([
      'search_atomic_events',
      'get_atomic_event',
      'query_local_causal_graph',
      'get_causal_relation',
      'get_relation_cases',
      'get_concrete_case',
      'find_causal_paths',
      'get_causal_evidence_bundle',
    ]);

    const prompt = buildInferOutcomesPrompt();
    expect(prompt).toContain('规则版本：V1');
    expect(prompt).toContain('只支持一个起始事件');
    expect(prompt).toContain('searchMode = standard');
    expect(prompt).toContain('searchMode = enhanced');
    expect(prompt).toContain('direction = downstream');
    expect(prompt).toContain('默认只保留 3 层以内');
    expect(prompt).toContain('20 → 50 → 100');
    expect(prompt).toContain('最多展示 5 个候选结果');
    expect(prompt).toContain('maxDepth = 3');
    expect(prompt).toContain('pathLimit = 10');
    expect(prompt).toContain('同一结果最多展示 3 条路径');
    expect(prompt).toContain('每段关系最多展示 3 个案例');
    expect(prompt).toContain('无案例依据');
    expect(prompt).toContain('不计算综合证据等级');
    expect(prompt).toContain('不计算平均置信度、关系置信度乘积或结果发生概率');
    expect(prompt).toContain('结果摘要');
    expect(prompt).toContain('候选结果详情');
    expect(prompt).toContain('查询结果可能不完整');
    expect(prompt).toContain('重新启动 `causality_capture`');
    expect(prompt).not.toContain('`search_concrete_cases`');
    expect(prompt).not.toContain('`search_causal_relations`');
    for (const name of ANALYSIS_DENIED_TOOL_NAMES) expect(prompt).toContain(`\`${name}\``);
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

  it('registers all five canonical prompts without arguments', async () => {
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

      const inferred = await client.getPrompt({ name: MCP_PROMPT_NAMES.inferOutcomes });
      expect(inferred.messages).toEqual([
        {
          role: 'user',
          content: { type: 'text', text: buildInferOutcomesPrompt() },
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
      [
        '.agents/skills/causality-analyze-event/SKILL.md',
        MCP_PROMPT_NAMES.analyzeEvent,
        'prompts/causality-analyze-event.md',
      ],
      [
        '.agents/skills/causality-trace-path/SKILL.md',
        MCP_PROMPT_NAMES.tracePath,
        'prompts/causality-trace-path.md',
      ],
      [
        '.agents/skills/causality-review-chain/SKILL.md',
        MCP_PROMPT_NAMES.reviewChain,
        'prompts/causality-review-chain.md',
      ],
    ] as const;

    for (const [path, promptName, promptPath] of skills) {
      const skill = await readFile(resolve(workspaceRoot, path), 'utf8');
      expect(skill).toContain(promptName);
      expect(skill).toContain(promptPath);
      expect(skill.indexOf(promptPath)).toBeLessThan(skill.indexOf(promptName));
      expect(skill).toContain('Codex does not expose MCP Prompts as invocable commands');
      expect(skill).toContain(`do not try to invoke \`${promptName}\` first`);
      expect(skill).not.toContain('最多检查 100');
      expect(skill).not.toContain('10,000');
      expect(skill).not.toContain('库内有直接关系与案例依据');
    }
  });

  it('publishes concise Codex UI metadata for event analysis', async () => {
    const metadataText = await readFile(
      resolve(workspaceRoot, '.agents/skills/causality-analyze-event/agents/openai.yaml'),
      'utf8',
    ).catch(() => null);

    expect(metadataText).not.toBeNull();
    expect(parseYaml(metadataText!)).toEqual({
      interface: {
        display_name: 'Causality Analyze Event',
        short_description: '分析事件的直接原因和结果',
        default_prompt: '使用 $causality-analyze-event 分析当前关注事件的直接原因和结果。',
      },
      policy: { allow_implicit_invocation: true },
    });
  });

  it('publishes concise Codex UI metadata for causal chain review', async () => {
    const metadataText = await readFile(
      resolve(workspaceRoot, '.agents/skills/causality-review-chain/agents/openai.yaml'),
      'utf8',
    ).catch(() => null);

    expect(metadataText).not.toBeNull();
    expect(parseYaml(metadataText!)).toEqual({
      interface: {
        display_name: 'Causality Review Chain',
        short_description: '核对一条因果链的关系和案例依据',
        default_prompt: '使用 $causality-review-chain 核对当前讨论中的因果链。',
      },
      policy: { allow_implicit_invocation: true },
    });
  });

  it('publishes concise Codex UI metadata for directed path tracing', async () => {
    const metadataText = await readFile(
      resolve(workspaceRoot, '.agents/skills/causality-trace-path/agents/openai.yaml'),
      'utf8',
    ).catch(() => null);

    expect(metadataText).not.toBeNull();
    expect(parseYaml(metadataText!)).toEqual({
      interface: {
        display_name: 'Causality Trace Path',
        short_description: '查找两个事件之间的有向因果路径',
        default_prompt: '使用 $causality-trace-path 查找当前讨论中两个事件之间的因果路径。',
      },
      policy: { allow_implicit_invocation: true },
    });
  });
});
