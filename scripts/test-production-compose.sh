#!/usr/bin/env bash
set -euo pipefail

smoke_project="causality-smoke-$$"
smoke_port="${CAUSALITY_SMOKE_PORT:-18080}"
smoke_mcp_port="${CAUSALITY_SMOKE_MCP_PORT:-18081}"
smoke_token_file="$(mktemp)"
chmod 600 "$smoke_token_file"

if [[ ! "$smoke_project" =~ ^causality-smoke-[a-z0-9-]+$ ]]; then
  echo "Unsafe production smoke project name" >&2
  exit 1
fi

pnpm test:mcp-compat

cleanup() {
  CAUSALITY_WEB_PORT="$smoke_port" \
  CAUSALITY_MCP_PORT="$smoke_mcp_port" \
  docker compose -p "$smoke_project" down --volumes --remove-orphans
  rm -f "$smoke_token_file"
}
trap cleanup EXIT INT TERM

CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" config --quiet
CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" up -d --build --wait

smoke_token="$(node -e "const { randomBytes } = require('node:crypto'); process.stdout.write('cau_pat_' + randomBytes(32).toString('base64url'))")"
smoke_digest="$(node -e "const { createHash } = require('node:crypto'); process.stdout.write(createHash('sha256').update(process.argv[1]).digest('hex'))" "$smoke_token")"
printf '%s' "$smoke_token" >"$smoke_token_file"
CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" exec -T postgres psql -U causality -d causality -v ON_ERROR_STOP=1 -c "
  insert into users (username, password_hash, must_change_password) values ('production-smoke-mcp', 'smoke', false)
  on conflict (normalized_username) do nothing;
  insert into mcp_access_tokens (user_id, token_digest, device_name)
  select id, decode('$smoke_digest', 'hex'), 'production-smoke' from users
  where normalized_username = 'production-smoke-mcp';"

PRODUCTION_BASE_URL="http://127.0.0.1:${smoke_port}" \
CAUSALITY_SMOKE_PROJECT="$smoke_project" \
CAUSALITY_SMOKE_PORT="$smoke_port" \
CAUSALITY_SMOKE_MCP_PORT="$smoke_mcp_port" \
CAUSALITY_PRODUCTION_MCP_TOKEN="$(cat "$smoke_token_file")" \
pnpm exec playwright test --config=playwright.production.config.ts
