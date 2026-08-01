#!/usr/bin/env bash
set -euo pipefail
set -m

benchmark_temp_dir="$(mktemp -d)"
benchmark_api_port="${CAUSALITY_MCP_BENCHMARK_API_PORT:-19080}"
benchmark_mcp_port="${CAUSALITY_MCP_BENCHMARK_PORT:-19081}"
benchmark_ready_file="$benchmark_temp_dir/ready.json"
benchmark_output="$PWD/test-results/mcp-benchmark-summary.json"
benchmark_api_pid=""
benchmark_mcp_pid=""

for value in "$benchmark_api_port" "$benchmark_mcp_port"; do
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1024 || value > 65535 )); then
    echo "MCP benchmark ports must be numeric values between 1024 and 65535" >&2
    exit 1
  fi
done
if [[ "$benchmark_api_port" == "$benchmark_mcp_port" ]]; then
  echo "MCP benchmark API and MCP ports must differ" >&2
  exit 1
fi

stop_group() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  stop_group "$benchmark_mcp_pid"
  stop_group "$benchmark_api_pid"
  rm -rf "$benchmark_temp_dir"
  local leaked
  leaked="$(docker ps -aq --filter label=causality.mcp-benchmark=true)"
  if [[ -n "$leaked" ]]; then
    docker rm -f $leaked >/dev/null
    echo "Removed leaked MCP benchmark Testcontainer" >&2
  fi
}
trap cleanup EXIT INT TERM

export DOCKER_HOST="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="${TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE:-/var/run/docker.sock}"

(
  unset DATABASE_URL
  CAUSALITY_MCP_BENCHMARK_READY_FILE="$benchmark_ready_file" \
  CAUSALITY_MCP_BENCHMARK_PORT="$benchmark_mcp_port" \
  exec apps/api/node_modules/.bin/tsx apps/api/src/database/benchmark/mcpBenchmarkApi.ts \
    --port="$benchmark_api_port" \
    --events=10000 \
    --relations=30000 \
    --cases=100000 \
    --seed=20260731
) >"$benchmark_temp_dir/api.log" 2>&1 &
benchmark_api_pid="$!"

deadline=$((SECONDS + 600))
while [[ ! -s "$benchmark_ready_file" ]]; do
  if ! kill -0 "$benchmark_api_pid" 2>/dev/null; then
    tail -n 100 "$benchmark_temp_dir/api.log" >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "Timed out waiting for MCP benchmark API" >&2
    exit 1
  fi
  sleep 1
done

ready_values="$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (value.inserted.events !== 10000 || value.inserted.relations !== 30000 || value.inserted.cases !== 100000 || !/^cau_pat_[A-Za-z0-9_-]{43}$/.test(value.token)) process.exit(2);
  process.stdout.write([value.apiUrl, value.batchId, value.token].join("\t"));
' "$benchmark_ready_file")"
IFS=$'\t' read -r benchmark_api_url benchmark_batch_id benchmark_token <<<"$ready_values"

(
  unset DATABASE_URL
  HOST=127.0.0.1 \
  PORT="$benchmark_mcp_port" \
  CAUSALITY_API_URL="$benchmark_api_url" \
  exec apps/mcp/node_modules/.bin/tsx apps/mcp/src/http.ts
) >"$benchmark_temp_dir/mcp.log" 2>&1 &
benchmark_mcp_pid="$!"

deadline=$((SECONDS + 60))
until curl --silent --fail --max-time 2 "http://127.0.0.1:${benchmark_mcp_port}/health" >/dev/null; do
  if ! kill -0 "$benchmark_mcp_pid" 2>/dev/null; then
    tail -n 100 "$benchmark_temp_dir/mcp.log" >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "Timed out waiting for MCP benchmark server" >&2
    exit 1
  fi
  sleep 1
done

CAUSALITY_MCP_BENCHMARK_API_URL="$benchmark_api_url" \
CAUSALITY_MCP_BENCHMARK_ENDPOINT="http://127.0.0.1:${benchmark_mcp_port}/mcp" \
CAUSALITY_MCP_BENCHMARK_BATCH_ID="$benchmark_batch_id" \
CAUSALITY_MCP_BENCHMARK_OUTPUT="$benchmark_output" \
CAUSALITY_MCP_BENCHMARK_TOKEN="$benchmark_token" \
apps/mcp/node_modules/.bin/tsx apps/mcp/src/benchmark/mcpBenchmarkClient.ts

echo "MCP benchmark summary: $benchmark_output"
