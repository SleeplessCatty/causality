#!/usr/bin/env bash
set -euo pipefail

smoke_project="causality-smoke-$$"
smoke_port="${CAUSALITY_SMOKE_PORT:-18080}"
smoke_mcp_port="${CAUSALITY_SMOKE_MCP_PORT:-18081}"
smoke_token_file="$(mktemp)"
chmod 600 "$smoke_token_file"

# Keep the smoke project independent from a developer's root .env file.
export CAUSALITY_SESSION_HMAC_KEY="$(openssl rand -hex 32)"
export CAUSALITY_AUTH_IP_HASH_KEY="$(openssl rand -hex 32)"
export CAUSALITY_INTERNAL_MCP_SECRET="$(openssl rand -hex 32)"
export CAUSALITY_TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"

if [[ ! "$smoke_project" =~ ^causality-smoke-[a-z0-9-]+$ ]]; then
  echo "Unsafe production smoke project name" >&2
  exit 1
fi

pnpm test:mcp-compat

cleanup() {
  rm -f "$smoke_token_file"
  smoke_token=""
  smoke_digest=""
  smoke_ciphertext=""
  smoke_iv=""
  smoke_auth_tag=""
  smoke_account_output=""
  smoke_initial_password=""
  smoke_password=""
  CAUSALITY_WEB_PORT="$smoke_port" \
  CAUSALITY_MCP_PORT="$smoke_mcp_port" \
  docker compose -p "$smoke_project" down --volumes --remove-orphans || true
}
trap cleanup EXIT INT TERM

CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" config --quiet
CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" up -d --build --wait

smoke_username="production-smoke-user"
smoke_password="Changed!Production123"
smoke_account_output="$(
  printf '%s\n' "$smoke_username" | \
    docker compose -p "$smoke_project" exec -T api node dist/commands/userAdmin.js create
)"
smoke_initial_password="$(printf '%s\n' "$smoke_account_output" | sed -n 's/^初始密码：//p')"
if [[ -z "$smoke_initial_password" ]]; then
  echo "Unable to read the initial password from the production user command" >&2
  exit 1
fi
smoke_user_id="$(
  docker compose -p "$smoke_project" exec -T postgres \
    psql -U causality -d causality -Atqc \
    "select id from users where normalized_username = lower('$smoke_username')"
)"
if [[ ! "$smoke_user_id" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "Unable to resolve the production smoke user" >&2
  exit 1
fi

node -e "const { randomBytes } = require('node:crypto'); process.stdout.write('cau_pat_' + randomBytes(32).toString('base64url'))" >"$smoke_token_file"
smoke_digest="$(node -e "const { createHash } = require('node:crypto'); const { readFileSync } = require('node:fs'); process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1], 'utf8')).digest('hex'))" "$smoke_token_file")"
smoke_token_id="$(node -e "process.stdout.write(require('node:crypto').randomUUID())")"
read -r smoke_masked_token smoke_ciphertext smoke_iv smoke_auth_tag < <(
  CAUSALITY_SMOKE_USER_ID="$smoke_user_id" \
  CAUSALITY_SMOKE_TOKEN_ID="$smoke_token_id" \
  node -e "
    const { createCipheriv, randomBytes } = require('node:crypto');
    const { readFileSync } = require('node:fs');
    const token = readFileSync(process.argv[1], 'utf8');
    const key = Buffer.from(process.env.CAUSALITY_TOKEN_ENCRYPTION_KEY, 'base64');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('mcp-token\\0' + process.env.CAUSALITY_SMOKE_USER_ID + '\\0' + process.env.CAUSALITY_SMOKE_TOKEN_ID, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const masked = 'cau_pat_' + token.slice(8, 12) + '••••' + token.slice(-4);
    process.stdout.write([masked, ciphertext.toString('hex'), iv.toString('hex'), cipher.getAuthTag().toString('hex')].join(' ') + '\\n');
  " "$smoke_token_file"
)
CAUSALITY_WEB_PORT="$smoke_port" \
CAUSALITY_MCP_PORT="$smoke_mcp_port" \
docker compose -p "$smoke_project" exec -T postgres psql -U causality -d causality -v ON_ERROR_STOP=1 -c "
  insert into mcp_access_tokens (
    id, user_id, token_digest, name, masked_token,
    token_ciphertext, token_iv, token_auth_tag
  )
  select '$smoke_token_id', id, decode('$smoke_digest', 'hex'), 'production-smoke',
    '$smoke_masked_token', decode('$smoke_ciphertext', 'hex'),
    decode('$smoke_iv', 'hex'), decode('$smoke_auth_tag', 'hex')
  from users where id = '$smoke_user_id';"

PRODUCTION_BASE_URL="http://127.0.0.1:${smoke_port}" \
CAUSALITY_SMOKE_PROJECT="$smoke_project" \
CAUSALITY_SMOKE_PORT="$smoke_port" \
CAUSALITY_SMOKE_MCP_PORT="$smoke_mcp_port" \
CAUSALITY_PRODUCTION_MCP_TOKEN="$(< "$smoke_token_file")" \
CAUSALITY_PRODUCTION_USERNAME="$smoke_username" \
CAUSALITY_PRODUCTION_INITIAL_PASSWORD="$smoke_initial_password" \
CAUSALITY_PRODUCTION_PASSWORD="$smoke_password" \
pnpm exec playwright test --config=playwright.production.config.ts
