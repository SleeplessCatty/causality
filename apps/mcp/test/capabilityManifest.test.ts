import { describe, expect, it } from 'vitest';

import {
  MCP_CAPABILITY_COUNTS,
  MCP_CAPABILITY_MANIFEST,
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
} from '../src/capabilities/capabilityManifest.js';

describe('MCP capability manifest', () => {
  it('defines the final unique capability names', () => {
    const tools = Object.values(MCP_TOOL_NAMES);
    const prompts = Object.values(MCP_PROMPT_NAMES);
    const resources = Object.values(MCP_RESOURCE_URIS);

    expect(tools).toHaveLength(MCP_CAPABILITY_COUNTS.tools);
    expect(new Set(tools).size).toBe(15);
    expect(prompts).toEqual([
      'causality_capture',
      'causality_analyze_event',
      'causality_trace_path',
      'causality_review_chain',
      'causality_infer_outcomes',
    ]);
    expect(resources).toEqual([
      'causality://rules/domain-model',
      'causality://rules/capture',
      'causality://capabilities',
      'causality://system/status',
    ]);
    expect(prompts).toHaveLength(MCP_CAPABILITY_COUNTS.prompts);
    expect(resources).toHaveLength(MCP_CAPABILITY_COUNTS.resources);
  });

  it('defines complete registration metadata for every Tool', () => {
    for (const tool of MCP_CAPABILITY_MANIFEST.tools) {
      expect(tool.title.trim()).not.toBe('');
      expect(tool.description).toMatch(/只读工具|受控写入工具|受控事务写入工具/u);
      expect(tool.description).toMatch(/最多|上限|最长|有效/u);
      expect(tool.description).toMatch(/使用|取得|继续|检查|提交|处理|输出/u);
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
    }
  });

  it('classifies only plan preparation and commit as controlled writes', () => {
    expect(
      MCP_CAPABILITY_MANIFEST.tools
        .filter((tool) => tool.access === 'controlled_write')
        .map((tool) => tool.name),
    ).toEqual(['prepare_knowledge_changes', 'commit_knowledge_changes']);
  });

  it('publishes the exact stable analysis limits', () => {
    expect(MCP_CAPABILITY_MANIFEST.limits).toEqual({
      eventAnalysisInspectedRelations: 100,
      eventAnalysisDisplayedRelations: 5,
      casesPerDisplayedRelation: 3,
      pathDefaultDepth: 5,
      pathMaximumDepth: 10,
      pathQueryLimit: 10,
      pathDisplayedLimit: 3,
      pathExpandedStateLimit: 10_000,
      chainSegmentLimit: 10,
      outcomeInferenceDefaultDepth: 3,
      outcomeInferenceDisplayedResults: 5,
      outcomeInferenceNodeLimits: [20, 50, 100],
      outcomeInferencePathQueryLimit: 10,
      outcomeInferenceDisplayedPathsPerResult: 3,
      outcomeInferenceCasesPerRelation: 3,
    });
  });
});
