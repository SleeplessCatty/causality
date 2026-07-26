#!/usr/bin/env bash
set -euo pipefail

readonly E2E_DATABASE_NAME="causality_e2e_test_$$"
readonly -a E2E_COMPOSE=(docker compose -f compose.yaml -f compose.dev.yaml)

if ! [[ "$E2E_DATABASE_NAME" =~ ^causality_e2e_test_[0-9]+$ ]]; then
  echo "Refusing to manage a non-allowlisted E2E database: $E2E_DATABASE_NAME" >&2
  exit 1
fi

drop_test_database() {
  "${E2E_COMPOSE[@]}" exec -T postgres \
    psql --username causality --dbname postgres --set ON_ERROR_STOP=1 \
    --command "DROP DATABASE IF EXISTS \"$E2E_DATABASE_NAME\" WITH (FORCE);"
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  if ! drop_test_database; then
    echo "Failed to remove $E2E_DATABASE_NAME" >&2
    exit 1
  fi
  exit "$exit_code"
}

corepack pnpm --filter @causality/contracts build
"${E2E_COMPOSE[@]}" up -d --wait postgres

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

drop_test_database
"${E2E_COMPOSE[@]}" exec -T postgres \
  psql --username causality --dbname postgres --set ON_ERROR_STOP=1 \
  --command "CREATE DATABASE \"$E2E_DATABASE_NAME\";"

export DATABASE_URL="postgresql://causality:causality@127.0.0.1:5432/$E2E_DATABASE_NAME"
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm exec playwright test "$@"
