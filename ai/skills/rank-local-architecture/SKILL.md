---
name: rank-local-architecture
description: Non-negotiable architecture of Rank Local Growth OS and the decision rules for changing it. Load before any ticket that touches src/, app/, supabase/ or docs/.
version: 1
applies_to: ["src/**", "app/**", "supabase/**", "docs/**", "tests/**"]
triggers: ["architecture", "new table", "new provider", "migration", "job", "outreach", "AI", "crawler", "audit"]
related: ["ssrf-safe-http", "validate-migration", "quality-gate", "provider-adapter"]
---

# rank-local-architecture

## Purpose
Encode the rules from `AGENTS.md` and the four source-of-truth docs as concrete decisions, so any agent changes the system the same way.

## When to use
At the start of every ticket. Re-read the Non-negotiables before proposing a plan, and the Decision rules before adding a table, provider, job or outbound request.

## Non-negotiables
1. Supabase/Postgres is the source of business truth. No second store of record; no truth held only in provider payloads, caches or job payloads.
2. DataForSEO (Google Maps SERP) is the primary business-discovery provider. Google Places is optional only: constructed solely when `DISCOVERY_PROVIDER=google_places`, never required to boot.
3. Our own deterministic crawler and HTTP probe audit and verify websites. No provider (DataForSEO included) crawls websites for us.
4. Deterministic evidence before AI. Measurements and parsed facts are stored first; AI may only interpret stored evidence, later, behind the model router.
5. No LLM dependency inside crawler/audit fetch or parse paths (`ai/rules/no-llm-in-crawler.md`, enforced by `ai/scripts/check-llm-imports.mjs`).
6. Provider adapters stay swappable behind `src/discovery/provider.ts`; the application depends only on the interface.
7. Row-level security stays enabled on every table; backend access is the service role with explicit grants. Never disable RLS or grant to `anon`/`authenticated`.
8. Secrets stay server-side: read via `src/config/server-env.ts`, never `NEXT_PUBLIC_*`, never in client components or browser bundles.
9. `.env.local` may be edited when necessary, but its values are never printed, logged, committed or exposed. Report variable names only.
10. `SEND_MODE` stays `disabled` by default; no autonomous live email sending in V1.
11. Background jobs are idempotent and retry-safe (`ai/rules/jobs-contract.md`).
12. Preserve source provenance and retention metadata on every stored fact; names alone never merge prospects.
13. Not in V1 scope unless a ticket says so: outreach, Gmail, Hermes, AI interpretation, Opportunity Score. In scope since RL-058/RL-070: PageSpeed performance evidence behind `src/performance/provider.ts` and the deterministic audit score (`docs/AUDIT_SCORE.md`), which is not the Opportunity Score.

## Layer map
| Layer | Path | Rule |
|---|---|---|
| UI + server actions | `app/**` | Server components read via `src/data`; writes go through server actions calling `src/data/*-writes.ts` or `src/discovery/run.ts`. No secrets, no provider calls. |
| Data access | `src/data/**` | Supabase admin client only; idempotent upserts with deterministic ids. |
| Pure domain | `src/domain/**` | No I/O. Normalisation, ids, labels. |
| Discovery pipeline | `src/discovery/**` | Provider interface, adapters, dedupe, resolver, website verification, jobs. |
| Jobs | `src/jobs/**` | Postgres queue, processor, app registry. |
| Config | `src/config/env.ts`, `server-env.ts` | Every env var is validated with zod and documented in `.env.example`. |
| Schema | `supabase/migrations/NNN_*.sql`, `src/db/types.ts` | Forward-only, idempotent, RLS + grants in the same file. |
| Docs | `docs/*.md`, `README.md` | Update the data model and README in the same change as the code. |

## Decision rules
- **New table or column** → next sequential migration, RLS policy, service-role grant, `src/db/types.ts`, README migration range, then `ai/skills/validate-migration`.
- **New provider or external API** → `ai/skills/provider-adapter`. Credentials optional unless selected; readiness reported without values.
- **Any outbound HTTP** → `ai/skills/ssrf-safe-http`. Reuse `src/discovery/website/http-probe.ts` guards.
- **Long-running work** → a job under `src/jobs/app-registry.ts` following `ai/rules/jobs-contract.md`; the UI never waits synchronously.
- **Versioned logic** (verifier, crawler, rules, scores) → export a version constant (pattern: `WEBSITE_VERIFIER_VERSION` in `src/discovery/website/verify.ts`) and persist it on the rows it produced.
- **Provider content** → expiring, purged by `purge_expired_discovery_content()`; keep only durable references. Our own measurements (rank observations, audit evidence) are retained.
- **Reporting** → follow the `AGENTS.md` ticket workflow: plan, affected files, risks before coding; tests, typecheck, lint, build, changed files, unresolved issues after. Never claim completion when a check fails.

## Verification
Run `ai/checklists/architecture-review.md` against the diff, then `bash ai/scripts/quality-gate.sh`.

## References
`AGENTS.md`; `docs/MASTER_BUILD_SPEC.md` §2 (deterministic before generative), §9 (discovery), §11 (crawl safety), §25 (SSRF); `docs/DATA_MODEL_AND_API.md` §5 (discovery candidates), retention classes; `docs/IMPLEMENTATION_BACKLOG.md`; `README.md` (discovery providers, migrations).

## Anti-patterns
Adding a `hybrid` provider mode without tests; storing raw provider payloads; reading `process.env` outside `src/config`; putting business logic in React components; calling a provider from a request handler; inventing rankings, penalties or scores (the only score is the documented, versioned `audit-score/vN`, computed from stored evidence).
