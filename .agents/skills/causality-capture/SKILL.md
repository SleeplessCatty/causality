---
name: causality-capture
description: Use when the user explicitly asks to collect causal knowledge from the current conversation, compare it with Causality, review an import plan, or commit a plan they approved.
---

# Causality Capture

## Run the canonical workflow

1. Resolve the Causality repository root, then read `prompts/causality-capture.md` completely and follow it exactly.
2. Use the connected `causality` MCP tools required by that Prompt. Codex does not expose MCP Prompts as invocable commands, so do not try to invoke `causality_capture` first.
3. Do not start the capture workflow unless the user explicitly asks to collect or import the conversation.
4. Keep the canonical Prompt active through the complete review and commit loop. Do not replace it with an improvised workflow.

## Missing integration

If the Prompt file or the `causality` MCP server is unavailable, stop and identify the missing dependency. Never reconstruct the workflow from memory.
