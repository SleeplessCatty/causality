---
name: causality-capture
description: Launch the Causality conversation capture workflow when the user explicitly asks to collect the current AI conversation, compare extracted causal knowledge with the Causality database, review a complete import plan, or commit an approved plan. Use the MCP Prompt when the client supports prompts; otherwise load the repository's portable Markdown Prompt.
---

# Causality Capture

## Run the canonical workflow

1. Prefer invoking the connected Causality MCP Prompt named `causality_capture`.
2. If the client cannot discover or invoke MCP Prompts, load `prompts/causality-capture.md` from the Causality repository and follow it exactly.
3. Do not start the capture workflow unless the user explicitly asks to collect or import the conversation.
4. Keep the canonical Prompt active through the complete review and commit loop. Do not replace it with an improvised workflow.

## Missing integration

If neither the MCP Prompt nor the portable Markdown Prompt is available, stop and tell the user how to enable the Causality MCP server or provide the Prompt file. Never reconstruct the workflow from memory.
