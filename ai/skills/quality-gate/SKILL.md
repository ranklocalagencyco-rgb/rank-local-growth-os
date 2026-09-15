---
name: quality-gate
description: The checks every change must pass before it is reported complete (tests, typecheck, lint, build, LLM-import scan, optional migration validation), how to run them from the repo without any AI tool, and how to report the result honestly.
version: 1
applies_to: ["**"]
triggers: ["done", "complete", "finished", "ready", "test", "lint", "build", "typecheck"]
related: ["rank-local-architecture", "validate-migration"]
---

# quality-gate

## Purpose
`AGENTS.md`: "Never claim completion if checks fail." This skill makes the gate one command that any agent or human can run.

## When to use
Before reporting any code change as complete, before asking for review, and after resolving a failed check.

## Non-negotiables
1. Run `bash ai/scripts/quality-gate.sh` (add `--with-migrations` when `supabase/migrations/` changed). It runs, in order: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `node ai/scripts/check-llm-imports.mjs --scan`, and optionally `ai/scripts/validate-migration.sh`.
2. Report each step as PASS or FAIL with the failing output. A failed step is never summarised as "mostly passing".
3. Do not weaken a test, widen a lint ignore, or relax a blocklist to turn a FAIL into a PASS. Fix the cause or report the blocker.
4. New behaviour ships with tests; external HTTP is mocked (inject `fetchImpl`/`lookup`), no real network in `npm test`.
5. Leave no stray processes: stop dev servers and workers you started, by PID (`pgrep -af 'next dev|worker.mjs'`), and confirm the port is free.
6. Never print secret values while diagnosing; report variable names only.

## Procedure
1. `bash ai/scripts/quality-gate.sh [--with-migrations]`.
2. On FAIL: read the output, fix, re-run the whole gate (not just the failed step).
3. In the completion report list: checks run and results, changed files (`git status --short`), migration status, unresolved issues.

## Verification
The script prints `QUALITY GATE PASSED` and exits 0.

## References
`ai/scripts/quality-gate.sh`; `ai/scripts/check-llm-imports.mjs`; `ai/checklists/quality-gate.md`; `package.json` scripts; `AGENTS.md` ticket workflow.

## Anti-patterns
Running only the tests that changed; skipping `build` because it is slow; claiming "lint passes" from a partial run; committing to make CI run the checks instead.
