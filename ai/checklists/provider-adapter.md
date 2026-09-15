# Provider adapter checklist

- [ ] Vendor endpoint, fields, pagination and pricing recorded in the adapter header.
- [ ] Shared interface extended only with provider-neutral optional fields.
- [ ] Constructor accepts injected `fetchImpl`/`lookup`/`now`/`baseUrl`; no `process.env` reads.
- [ ] Credentials optional in `server-env.ts`; readiness reports missing names only; adapter built only when selected.
- [ ] Errors classified into `DiscoveryProviderError` codes with correct `retryable`; no secrets in messages.
- [ ] `requestCount` = billable requests; `costUsd` reported; caps clamped to vendor maxima; no implicit pagination.
- [ ] Queued modes return `pending` and rely on the caller's persisted cursor.
- [ ] Retention/attribution declared; references durable, content expiring.
- [ ] Output identical across execution modes.
- [ ] Tests: mapping, auth header, error classes, continuation, caps, modes, registry selection with/without credentials.
- [ ] `.env.example`, README, backlog updated.
- [ ] Bounded manual smoke test reported with request count and cost, no values.
