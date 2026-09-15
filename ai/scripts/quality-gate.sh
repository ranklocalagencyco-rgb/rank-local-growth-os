#!/usr/bin/env bash
# Repository quality gate. Runs from the repo with no AI tooling: tests, typecheck, lint, build, LLM-import scan.
# Usage: bash ai/scripts/quality-gate.sh [--with-migrations]
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
status=0
results=()

run() {
  local label="$1"; shift
  echo; echo "== $label"
  if "$@"; then results+=("PASS  $label"); else results+=("FAIL  $label"); status=1; fi
}

run "npm test" npm test --silent
run "npm run typecheck" npm run typecheck --silent
run "npm run lint" npm run lint --silent
run "npm run build" npm run build --silent
run "LLM-import scan (ai/rules/no-llm-in-crawler.md)" node ai/scripts/check-llm-imports.mjs --scan
if [ "${1:-}" = "--with-migrations" ]; then run "migration validation (Docker Postgres)" bash ai/scripts/validate-migration.sh; fi

echo; echo "== Summary"
printf '%s\n' "${results[@]}"
if [ "$status" -eq 0 ]; then echo "QUALITY GATE PASSED"; else echo "QUALITY GATE FAILED"; fi
exit "$status"
