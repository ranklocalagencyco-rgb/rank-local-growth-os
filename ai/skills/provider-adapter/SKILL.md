---
name: provider-adapter
description: How to add or change an external data/API provider (discovery, enrichment, later PageSpeed) behind the existing provider abstraction: interface first, injected I/O, error classification, billable-request accounting, queued-task continuation, retention metadata, optional credentials, mocked tests.
version: 1
applies_to: ["src/discovery/providers/**", "src/discovery/provider.ts", "src/discovery/providers/registry.ts", "src/config/**"]
triggers: ["provider", "adapter", "API", "DataForSEO", "Google Places", "PageSpeed", "credentials", "rate limit"]
related: ["rank-local-architecture", "ssrf-safe-http", "quality-gate"]
---

# provider-adapter

## Purpose
Providers are swappable and optional. The application depends on `src/discovery/provider.ts`; adapters translate one vendor into that contract without leaking vendor shapes, costs or credentials elsewhere.

## When to use
Adding a provider, changing an endpoint or execution mode, or adding a provider for a new capability (define a new small interface in the same style rather than widening the discovery one).

## Non-negotiables
1. Interface first. Extend the contract with optional, provider-neutral fields (`rank`, `rating`, `pending`, `costUsd`); never add vendor-named fields to shared types.
2. Constructor takes credentials and options; all I/O is injectable (`fetchImpl`, `lookup`, `now`, `baseUrl`) so tests never hit the network.
3. Credentials come from `src/config/server-env.ts` (optional in the schema), selection from `src/config/env.ts`, readiness from `getDiscoveryProviderReadiness()` in `src/discovery/providers/registry.ts` reporting missing variable *names*. The adapter is constructed only when selected; missing credentials for an unselected provider never break boot.
4. Errors map to `DiscoveryProviderError(code, retryable)`: `auth`/`not_configured`/`invalid_request` non-retryable; `quota` retryable only for rate limits; `unavailable` retryable. Messages never contain secrets or full request bodies.
5. `requestCount` counts billable requests only; free polls count zero. Report `costUsd` when the vendor returns it; the run accumulates it.
6. Bounded by design: per-request result limits clamped to vendor maxima, no implicit pagination, honour the run's request cap. Queued vendors return `pending` with a task reference and rely on the caller's cursor (`ai/rules/jobs-contract.md`).
7. Retention and attribution declared on the adapter (`retention`, `attribution`); provider references durable, content expiring.
8. Output normalised identically across vendor modes; the resolver must not know which mode produced a candidate.
9. Document in `.env.example` (comments with cost and mode semantics) and README (endpoints, pricing pattern, caps); update `docs/IMPLEMENTATION_BACKLOG.md` ticket bullets.

## Procedure
1. Read the vendor docs for the exact endpoint, fields, pagination and pricing; record them in the adapter header comment.
2. Start from `ai/examples/provider-adapter-skeleton.md`; implement mapping as a pure exported function (`mapXItemToCandidate`) so it is unit-testable.
3. Wire selection in the registry switch and the zod enum; add env vars to `env.ts`/`server-env.ts`.
4. Tests (mock HTTP): mapping incl. null/absent fields, auth header without leaking secrets, HTTP and task-level error classification, pagination/continuation contract, result caps, both execution modes if any, registry selection with and without credentials.
5. If the vendor is called from job code, confirm the jobs contract (deadline yield, cursor persistence) still holds.
6. Manual smoke test with real credentials in a bounded run (one request, low caps), reporting request count and cost, never values.

## Verification
`npm test` covers the new adapter; `bash ai/scripts/quality-gate.sh` passes; `ai/checklists/provider-adapter.md` ticked.

## References
`src/discovery/provider.ts`; `src/discovery/providers/dataforseo.ts` (live + queued modes, cost, rank mapping); `src/discovery/providers/google-places.ts` (field masks, two-stage cost control); `src/discovery/providers/registry.ts`; `tests/discovery/dataforseo-provider.test.ts`; `README.md` discovery providers section.

## Anti-patterns
Reading `process.env` in the adapter; throwing raw `fetch` errors; storing whole vendor payloads; counting free polls as billable; hard-coding a country/location without an override; adding a "hybrid" mode without a merge policy and tests.
