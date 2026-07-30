---
name: causality-trace-path
description: Launch the read-only Causality directed causal path tracing workflow for the current visible conversation.
---

# Causality Trace Path

1. Prefer invoking the connected Causality MCP Prompt named `causality_trace_path`.
2. If the client cannot discover or invoke MCP Prompts, load `prompts/causality-trace-path.md` from the Causality repository and follow it exactly.
3. Keep this workflow read-only. Do not start capture or import unless the user separately requests it.
4. If neither entry is available, stop and tell the user how to enable the Causality MCP server or provide the Prompt file.
