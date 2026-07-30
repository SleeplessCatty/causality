---
name: causality-review-chain
description: Use when the user asks Causality to review the evidence supporting each segment of a proposed causal chain in the current conversation.
---

# Causality Review Chain

1. Resolve the Causality repository root, then read `prompts/causality-review-chain.md` completely and follow it exactly.
2. Use the connected `causality` MCP tools required by that Prompt. Codex does not expose MCP Prompts as invocable commands, so do not try to invoke `causality_review_chain` first.
3. Keep this workflow read-only. Do not start capture or import unless the user separately requests it.
4. If the Prompt file or the `causality` MCP server is unavailable, stop and identify the missing dependency. Do not reconstruct the workflow from memory.
