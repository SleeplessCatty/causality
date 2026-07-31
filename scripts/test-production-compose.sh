#!/usr/bin/env bash
set -euo pipefail

smoke_project="causality-smoke-$$"
smoke_port="${CAUSALITY_SMOKE_PORT:-18080}"
smoke_mcp_port="${CAUSALITY_SMOKE_MCP_PORT:-18081}"

if [[ ! "$smoke_project" =~ ^causality-smoke-[a-z0-9-]+$ ]]; then
  echo "Unsafe production smoke project name" >&2
  exit 1
fi

pnpm test:mcp-compat

cleanup() {
  CAUSALITY_WEB_PORT="$smoke_port" \
  CAUSALITY_MCP_PORT="$smoke_mcp_port" \
  docker compose -p "$smoke_project" down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM

CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" config --quiet
CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" up -d --build --wait

PRODUCTION_BASE_URL="http://127.0.0.1:${smoke_port}" \
CAUSALITY_SMOKE_PROJECT="$smoke_project" \
CAUSALITY_SMOKE_PORT="$smoke_port" \
CAUSALITY_SMOKE_MCP_PORT="$smoke_mcp_port" \
pnpm exec playwright test --config=playwright.production.config.ts
