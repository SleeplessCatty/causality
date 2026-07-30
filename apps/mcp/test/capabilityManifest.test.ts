import { describe, expect, it } from 'vitest';

import {
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

    expect(tools).toHaveLength(15);
    expect(new Set(tools).size).toBe(15);
    expect(prompts).toEqual([
      'causality_capture',
      'causality_analyze_event',
      'causality_trace_path',
      'causality_review_chain',
    ]);
    expect(resources).toEqual([
      'causality://rules/domain-model',
      'causality://rules/capture',
      'causality://capabilities',
      'causality://system/status',
    ]);
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
    });
  });
});
