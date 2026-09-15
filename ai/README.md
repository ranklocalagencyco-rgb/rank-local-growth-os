# AI engineering library

Canonical, vendor-neutral guidance for any coding agent working on Rank Local Growth OS. Everything here is plain Markdown, shell and Node with no tool-specific syntax, so Claude Code, Codex, Cursor, Windsurf, Gemini and future agents consume the same files.

The constitution lives in `AGENTS.md` (non-negotiable rules, source-of-truth docs, ticket workflow). This library holds the *procedures* that implement the constitution.

## Layout

| Path | Contents |
|---|---|
| `skills/<name>/SKILL.md` | One reusable procedure each: purpose, when to use, non-negotiables, steps, verification, references, anti-patterns |
| `rules/` | Standing contracts that are always true (job queue contract, no LLM in crawler paths) |
| `checklists/` | Short review lists to run before declaring work done |
| `examples/` | Verified snippets and templates referenced by skills |
| `scripts/` | Runnable helpers used by the skills (quality gate, migration validation, LLM-import scan) |

## Skills

| Skill | Load it when you are… |
|---|---|
| `rank-local-architecture` | Changing anything under `src/`, `app/`, `supabase/` or `docs/`; starting any ticket |
| `ssrf-safe-http` | Writing or reviewing outbound HTTP, crawling, website verification or audit fetching |
| `validate-migration` | Adding or editing `supabase/migrations/*.sql` |
| `quality-gate` | Finishing a change, before reporting completion |
| `provider-adapter` | Adding or changing a discovery/enrichment/data provider integration |

Rules: `rules/jobs-contract.md` applies to every background job; `rules/no-llm-in-crawler.md` is enforced by `node scripts/check-llm-imports.mjs --scan`, which every agent runs through the quality gate. Claude Code additionally calls the same script from an optional PreToolUse hook; that hook is a convenience, never the authority.

## Skill file format

```yaml
---
name: skill-name
description: One sentence, used by agents to decide relevance.
version: 1
applies_to: ["src/discovery/**", "supabase/migrations/**"]   # path globs
triggers: ["migration", "RLS"]                                 # keywords
related: ["quality-gate"]
---
```
Body sections, in order: Purpose · When to use · Non-negotiables · Procedure · Verification · References · Anti-patterns. Keep each skill under ~150 lines; move long material to `examples/` or `checklists/`.

## How each agent consumes the library

- **Claude Code**: root `CLAUDE.md` is auto-loaded, imports `AGENTS.md`, and points here. `.claude/skills/<name>/SKILL.md` are thin wrappers that only say "read `ai/skills/<name>/SKILL.md`". `.claude/settings.json` wires an optional hook that runs `scripts/check-llm-imports.mjs --hook` on edits; the authoritative check remains the `--scan` mode run by the quality gate.
- **Codex**: reads `AGENTS.md` natively; its "AI engineering library" section lists the skills and when to load each.
- **Cursor / Windsurf**: add a rule file (`.cursor/rules/*.mdc`, `.windsurf/rules/*.md`) whose only content is "Read AGENTS.md, then the relevant `ai/skills/*/SKILL.md`". Not created yet.
- **Gemini CLI**: `GEMINI.md` with the same pointer. Not created yet.

Adapters must never duplicate skill content. Edit the canonical file; adapters do not change.

## Scripts

```bash
bash ai/scripts/quality-gate.sh                 # npm test, typecheck, lint, build, LLM-import scan
bash ai/scripts/quality-gate.sh --with-migrations
bash ai/scripts/validate-migration.sh           # Docker Postgres 16: apply 001..N + seed, re-apply N
node ai/scripts/check-llm-imports.mjs --scan    # repo-wide scan of protected paths
```

## Versioning

Bump `version` in a skill's frontmatter when its procedure changes materially, and note the change at the bottom of the file. Skills reference repo paths; when files move, update the References section in the same commit.
