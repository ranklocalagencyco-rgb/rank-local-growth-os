#!/usr/bin/env bash
# Validates supabase/migrations/*.sql against a throwaway Docker Postgres.
# Applies Supabase stubs, every migration in order, seed.sql, then re-applies the newest migration to prove idempotency.
# Usage: bash ai/scripts/validate-migration.sh [--keep]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="${PG_CONTAINER:-rlgos-migration-check}"
IMAGE="${PG_IMAGE:-postgres:16}"
KEEP="${1:-}"
LOG="$(mktemp)"

command -v docker >/dev/null || { echo "docker is required"; exit 1; }
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=pg "$IMAGE" >/dev/null
cleanup() { [ "$KEEP" = "--keep" ] || docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f "$LOG"; }
trap cleanup EXIT

for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$NAME" pg_isready -U postgres >/dev/null || { echo "postgres did not become ready"; exit 1; }

psql_run() { docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }
apply() {
  local file="$1" label="$2"
  if ! psql_run < "$file" > "$LOG" 2>&1; then echo "FAILED $label"; cat "$LOG"; exit 1; fi
  grep -v '^NOTICE' "$LOG" || true
  echo "applied $label"
}

apply "$ROOT/ai/scripts/supabase-stubs.sql" "supabase stubs"
mapfile -t MIGRATIONS < <(ls "$ROOT"/supabase/migrations/*.sql | sort)
[ "${#MIGRATIONS[@]}" -gt 0 ] || { echo "no migrations found"; exit 1; }
for file in "${MIGRATIONS[@]}"; do apply "$file" "$(basename "$file")"; done
[ -f "$ROOT/supabase/seed.sql" ] && apply "$ROOT/supabase/seed.sql" "seed.sql"

NEWEST="${MIGRATIONS[${#MIGRATIONS[@]}-1]}"
echo "re-applying $(basename "$NEWEST") to prove idempotency"
apply "$NEWEST" "$(basename "$NEWEST") (second run)"

echo "tables:"
psql_run -Atc "select table_name from information_schema.tables where table_schema = 'public' order by 1" | sed 's/^/  /'
echo "MIGRATION VALIDATION PASSED"
