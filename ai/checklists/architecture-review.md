# Architecture review checklist

Run against the diff before reporting completion. Every "no" needs a written reason in the report.

- [ ] Postgres remains the only store of business truth; no facts live solely in provider payloads, job payloads or caches.
- [ ] DataForSEO remains the default discovery provider; Google Places is still optional and unrequired at boot.
- [ ] No provider crawls websites; verification/audit fetching is our own code.
- [ ] Deterministic evidence is stored before any interpretation; nothing under crawler/audit paths imports an LLM SDK (`node ai/scripts/check-llm-imports.mjs --scan`).
- [ ] Provider adapters only touch `src/discovery/providers/**` and the neutral interface.
- [ ] Every new table has RLS enabled, a workspace policy, and a service-role grant in the same migration.
- [ ] No secret is read outside `src/config`, no `NEXT_PUBLIC_` secret, no value printed in logs or reports.
- [ ] `SEND_MODE` default unchanged (`disabled`); no outreach, Gmail or Hermes code added.
- [ ] New jobs follow `ai/rules/jobs-contract.md` (idempotency key, cursor, deadline yield, non-retryable vs retryable).
- [ ] Provenance and retention metadata preserved on stored facts; names alone never merge prospects.
- [ ] Docs updated in the same change: README, `docs/DATA_MODEL_AND_API.md`, backlog ticket, `.env.example`.
- [ ] Tests added for new behaviour with mocked HTTP.
