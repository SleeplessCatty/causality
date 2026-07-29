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
    expect(prompt).toContain('以下步骤自动连续执行，不逐步询问用户');
    expect(prompt).toContain('无法可靠判断时必须选择 skip');
    expect(prompt).toContain('每次修改都重新自检受影响候选');
    expect(prompt).toContain('只有用户明确确认最新完整方案');
    expect(prompt).toContain('数据错误');
    expect(prompt).toContain('重新生成完整方案');
    expect(prompt).toContain('系统错误');
    expect(prompt).toContain('停止并等待用户');
    expect(prompt).toContain('[Causality-Capture: <historyId>]');
  });

  it('defines contextual atomic events without forcing away real subjects or qualifiers', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('规则版本：V2');
    expect(prompt).toContain('原子性由当前讨论语境和知识建模目的决定');
    expect(prompt).toContain('阿里巴巴美股股价上升');
    expect(prompt).toContain('特斯拉汽车销量下滑');
    expect(prompt).toContain('国内融资成本上升');
    expect(prompt).toContain('主体或范围 + 单一状态、动作或变化方向');
    expect(prompt).toContain('必须拆成两个原子事件并用因果关系连接');
    expect(prompt).toContain('不要在名称中堆叠一次真实发生记录的时间、地点和过程细节');
    expect(prompt).toContain('说明只解释同一事件的边界，不得加入第二个事件');
    expect(prompt).not.toContain('必须是可复用的抽象原子事件');
  });

  it('keeps candidates on the topic path and distinguishes facts from background', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('先在内部确定一个简短的主题锚点');
    expect(prompt).toContain('原因、结果还是双向链路');
    expect(prompt).toContain('每个准备新增或复用的原子事件至少是一个有效候选关系的端点');
    expect(prompt).toContain('每个具体案例至少支持一个有效候选关系');
    expect(prompt).toContain('具体案例是已经真实发生的一次事件记录');
    expect(prompt).toContain('不得编造缺失的日期、数字、地点、来源或时间间隔');
    expect(prompt).toContain('同一真实发生记录的不同措辞视为复用候选');
  });

  it('requires grounded causal direction and preserves explicit intermediate events', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('仅有时间先后、共同出现、相关性或常识上的可能性不足以建立关系');
    expect(prompt).toContain('信息只支持 `A → B → C` 时，只建立 `A → B` 和 `B → C`');
    expect(prompt).toContain('存在独立依据证明 A 直接导致 C');
    expect(prompt).toContain('不得自行发明中间事件');
    expect(prompt).toContain('应省略该关系，不得将其放入候选集合');
    expect(prompt).not.toContain('应省略该关系或使用 skip');
    expect(prompt).toContain('原因和结果不得引用同一个原子事件');
    expect(prompt).toContain('已有反向关系不是同一关系');
  });

  it('requires a complete preflight and schema-shaped tool arguments', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('调用对比工具前的完整自检');
    expect(prompt).toContain('批次去重');
    expect(prompt).toContain('引用完整');
    expect(prompt).toContain('无孤立候选');
    expect(prompt).toContain('严格使用 MCP 工具实时发布的 JSON Schema');
    expect(prompt).toContain('不把 JSON 包装成 Markdown、字符串或 CSV');
    expect(prompt).toContain('原子事件始终显式提供 `aliases` 和 `keywords` 数组');
    expect(prompt).toContain('`event-001`、`case-001`、`relation-001`');
    expect(prompt).toContain('为进入候选集合的原子事件、具体案例和因果关系分配');
    expect(prompt).not.toContain('为每条候选分配本批次内稳定且唯一的 `ref`');
    expect(prompt).toContain('对比结果必须原样随候选集合交给方案生成工具');
    expect(prompt).toContain('依赖项被 skip 时，其关系或案例关联也必须同步 skip');
  });

  it('uses semantic matches as evidence rather than automatic reuse decisions', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('语义候选只是判断依据，不自动等于同一事件');
    expect(prompt).toContain('主体、范围、状态、方向和粒度一致时优先复用');
    expect(prompt).toContain('主体、范围、状态或动作、变化方向或有效粒度不同并改变因果含义时新增');
    expect(prompt).toContain('替换说明不能改变已有事件含义');
    expect(prompt).toContain('明确是同一次真实发生记录时复用');
    expect(prompt).toContain('综合比较主体、发生时间、动作和结果');
    expect(prompt).toContain('相同原因端点、结果端点和方向的已有关系复用');
  });

  it('keeps the complete plan readable and repairs schema errors without bypassing review', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('主题和采集范围');
    expect(prompt).toContain('原子事件、具体案例、因果关系和案例关联分别列出');
    expect(prompt).toContain('MCP Schema 解析失败时，根据字段路径修正完整参数对象');
    expect(prompt).toContain('不通过改写业务数据规避系统或配置错误');
    expect(prompt).toContain('不得在工具失败、响应不明或方案失效时宣称入库成功');
    expect(prompt).toContain('重新自检受影响候选');
  });

  it('automatically classifies every extracted item before asking the user to review', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('首次完整方案生成之前，所有提取、检查、对比和决策都由 AI 自动完成');
    expect(prompt).toContain('将全部提取结果分为三类');
    expect(prompt).toContain('**确信数据**');
    expect(prompt).toContain('默认采用 create 或 reuse');
    expect(prompt).toContain('**存疑数据**');
    expect(prompt).toContain('默认采用 skip');
    expect(prompt).toContain('**忽略数据**');
    expect(prompt).toContain('不进入候选写入集合，但必须在用户可读方案中列出');
    expect(prompt).toContain('用户直接确认时，只提交确信数据');
    expect(prompt).toContain('询问用户是修改方案还是确认最新方案');
  });

  it('repairs server quality reports before producing the first plan', () => {
    const prompt = buildCausalityCapturePrompt();

    expect(prompt).toContain('服务端质量报告优先于 AI 自检结论');
    expect(prompt).toContain('报告状态为 blocked');
    expect(prompt).toContain('必须重新提交完整候选集合');
    expect(prompt).toContain('无法修复的内容移入忽略数据');
    expect(prompt).toContain('报告状态为 warning');
    expect(prompt).toContain('默认归入存疑数据并使用 skip');
    expect(prompt).toContain('不得根据 topicRelevance 单独建立或否定因果关系');
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
