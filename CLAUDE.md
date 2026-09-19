# Rank Local Growth OS — Claude Code entry point

This file only wires Claude Code to the repository's canonical guidance. The constitution is `AGENTS.md`; the procedures live under `ai/`. Do not add rules here; add them there so every coding agent sees the same thing.

@AGENTS.md

## Before changing anything
1. Read the source-of-truth docs named in `AGENTS.md`: `docs/MASTER_BUILD_SPEC.md`, `docs/DATA_MODEL_AND_API.md`, `docs/AGENT_WORKFLOWS.md`, `docs/IMPLEMENTATION_BACKLOG.md`, plus `README.md` for the current discovery and migration workflow.
2. Canonical, model-agnostic AI skills live in `ai/` (index: `ai/README.md`). Load the relevant skill and follow it before editing:

| Working on | Read first |
|---|---|
| Any ticket; anything under `src/`, `app/`, `supabase/`, `docs/` | `ai/skills/rank-local-architecture/SKILL.md` |
| Outbound HTTP, crawling, website verification or audit fetching | `ai/skills/ssrf-safe-http/SKILL.md` |
| `supabase/migrations/**` or `src/db/types.ts` | `ai/skills/validate-migration/SKILL.md` |
| A provider or external API adapter | `ai/skills/provider-adapter/SKILL.md` |
| Finishing a change | `ai/skills/quality-gate/SKILL.md` |

3. Rules always in force: `ai/rules/working-tree-ownership.md` (load before implementing; one active implementation owner per slice, reviewers read-only), `ai/rules/jobs-contract.md` (every background job) and `ai/rules/no-llm-in-crawler.md` (no LLM imports under `src/discovery/website/`, `src/audit/`, `src/crawler/`, `src/performance/`).
4. Before reporting completion run `bash ai/scripts/quality-gate.sh` (add `--with-migrations` when migrations changed) and report each step's result. Never claim completion if a check fails.
5. `.env.local` may be edited when necessary; never print, log, commit or expose its values. Report variable names only.

## Claude-specific adapters
- `.claude/skills/*/SKILL.md` are thin wrappers so `/skill-name` works; each only points to the canonical file under `ai/skills/`.
- `.claude/settings.json` registers one optional PreToolUse hook that runs `ai/scripts/check-llm-imports.mjs --hook` on edits. It is an early warning; the authoritative check is the `--scan` mode inside the quality gate, which every agent runs.
