---
name: causality-review-chain
description: Launch the read-only Causality causal chain review workflow for the current visible conversation.
---

# Causality Review Chain

1. Prefer invoking the connected Causality MCP Prompt named `causality_review_chain`.
2. If the client cannot discover or invoke MCP Prompts, load `prompts/causality-review-chain.md` from the Causality repository and follow it exactly.
3. Keep this workflow read-only. Do not start capture or import unless the user separately requests it.
4. If neither entry is available, stop and tell the user how to enable the Causality MCP server or provide the Prompt file.
