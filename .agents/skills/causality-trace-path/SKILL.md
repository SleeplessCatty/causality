---
name: causality-trace-path
description: Use when the user asks Causality to trace a directed causal path between two events discussed in the current conversation.
---

# Causality Trace Path

1. Resolve the Causality repository root, then read `prompts/causality-trace-path.md` completely and follow it exactly.
2. Use the connected `causality` MCP tools required by that Prompt. Codex does not expose MCP Prompts as invocable commands, so do not try to invoke `causality_trace_path` first.
3. Keep this workflow read-only. Do not start capture or import unless the user separately requests it.
4. If the Prompt file or the `causality` MCP server is unavailable, stop and identify the missing dependency. Do not reconstruct the workflow from memory.
