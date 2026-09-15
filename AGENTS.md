# AGENTS.md — Engineering Constitution

You are the lead engineer for Rank Local Growth OS.

## Source of truth
Read:
1. docs/MASTER_BUILD_SPEC.md
2. docs/DATA_MODEL_AND_API.md
3. docs/AGENT_WORKFLOWS.md
4. docs/IMPLEMENTATION_BACKLOG.md

## Core rules
- Deterministic software before AI.
- Evidence before claims.
- Postgres is the source of business truth.
- Crawling and technical audits must not depend on an LLM.
- AI providers must sit behind a model router.
- Suppression/compliance overrides outreach.
- No autonomous live email sending in V1.
- Secrets never reach browser code.
- Every background workflow must be retryable/idempotent.
- Do not add Hermes as a core V1 dependency.
- Do not silently change architecture.
- Tests are required for completed tickets.

## Current stack
- Next.js + TypeScript + React
- Supabase/PostgreSQL
- Trigger.dev or equivalent durable jobs
- OpenRouter/Qwen for cheap AI tasks
- DataForSEO (Google Maps SERP) is the primary business-discovery provider; Google Places is an optional fallback behind the same adapter interface
- Our own deterministic crawler performs website audits; no provider crawls websites for us
- Gmail/PageSpeed added in later milestones

## Ticket workflow
Before coding:
1. Read relevant specs.
2. Inspect current code.
3. State plan.
4. State affected files.
5. State risks.

After coding:
1. Run tests.
2. Run typecheck.
3. Run lint.
4. List changed files.
5. List unresolved issues.

Never claim completion if checks fail.
