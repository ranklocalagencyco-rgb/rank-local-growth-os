# Rule: no LLM dependency inside crawler / audit fetch and parse paths

**Status:** enforced in tooling. The authoritative, model-agnostic check is `node ai/scripts/check-llm-imports.mjs --scan` (run by `ai/scripts/quality-gate.sh`); it must pass before any change is reported complete. Claude Code additionally runs the same script in `--hook` mode from an optional PreToolUse hook (`.claude/settings.json`) to reject the edit early. Other agents rely on the scan.

## Protected paths

- `src/discovery/website/**` (website probe and verifier)
- `src/audit/**` (website audit crawler, parsers, findings, and the deterministic audit score under `src/audit/score/`)
- `src/crawler/**` (reserved for future crawl infrastructure)
- `src/performance/**` (performance provider adapters and the `audit.performance` job)

## Forbidden inside protected paths

Any import or require of an LLM provider SDK, gateway or model router, including but not limited to: `@anthropic-ai/*`, `anthropic`, `openai`, `openrouter`, `@google/generative-ai`, `@google/genai`, `@mistralai/*`, `cohere-ai`, `ollama`, `langchain*`, `@ai-sdk/*`, `ai` (Vercel AI SDK), and the project's own `@/ai/model-router`.

## Why

- `AGENTS.md`: "Crawling and technical audits must not depend on an LLM" and "Deterministic software before AI".
- `docs/MASTER_BUILD_SPEC.md` §2.1: evidence is measured and parsed; the model must not invent audit findings.
- Determinism makes audits reproducible, cheap, testable with mocked HTTP, and free of prompt-injection from crawled pages.

## What is allowed

AI interpretation of *stored* evidence, implemented outside the protected paths and behind the model router, in a later milestone.

## Residual limitation

The Claude hook sees Edit/Write tool calls only; files written through shell commands are caught by the scan, not the hook. The scan matches import/require/dynamic-import statements, not indirect usage through a wrapper module, so reviewers must still check that protected code has no transitive LLM dependency (see `ai/checklists/ssrf-review.md`).
