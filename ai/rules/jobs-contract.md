# Rule: background job contract

Applies to every handler registered in `src/jobs/app-registry.ts`. The queue is the Postgres `jobs` table (migration 004), claimed atomically by `claim_jobs()` with `FOR UPDATE SKIP LOCKED`; there is no external queue in V1.

## Enqueue

- Use `enqueueJob()` from `src/jobs/queue.ts` with a colon-namespaced idempotency key: `<type>:<entity id>` (e.g. `discovery.run:<campaignRunId>`, `candidate.resolve:<candidateId>`). Enqueueing twice with the same key returns the existing job.
- Job type names are `<aggregate>.<verb>`: `discovery.run`, `candidate.resolve`. Domain events use the documented names (`campaign.run_requested`, `candidate.discovered`, `prospect.created`, `audit.requested`, …) and are written separately.
- Payloads are validated with a zod schema at registration; keep them to ids, never secrets or provider content.
- Set `maxAttempts` deliberately (discovery uses 5). Retry backoff is `retryDelaySeconds(attempt)` in `queue.ts`.

## Handler outcomes

- Return `{ status: "completed" }` when done.
- Return `{ status: "continue", delaySeconds }` after persisting progress when work remains or an external task is pending. The processor re-queues the job and resets its retry budget.
- Throw `NonRetryableJobError` (or a provider error with `retryable: false`) for failures retrying cannot fix: bad config, invalid payload, rejected credentials, unknown entity. The job dead-letters and the owning run must be marked failed with a safe error summary first.
- Throw any other error for transient failures (network, 5xx, rate limit). The job retries with backoff and dead-letters after `max_attempts`.

## Deadline and progress

- `context.deadline` is an epoch-ms budget (25 s per job, 45 s per batch by default). Check `Date.now() > context.deadline - 3_000` inside loops and return `continue` before doing more work.
- A handler that wraps one slow external call it cannot yield inside (e.g. `audit.performance`) registers with `{ budgetMs }`. The processor gives it that budget and hands the job back untouched when the batch has less than that left. Such a handler makes one call per invocation, sizes the call's timeout from `context.deadline`, and counts its retries on its own rows because `continue` and hand-backs reset `job.attempts`.
- Persist a cursor after every unit of work (`campaign_runs.cursor_json` is the template: unit index, page token, pending provider task). A retry must resume from the cursor, never restart.

## Idempotency of writes

- Every insert uses a deterministic id (`deterministicUuid(namespace, key)` in `src/domain/deterministic-id.ts`) or a natural unique key, with `upsert(..., { ignoreDuplicates: true })`.
- Activity and domain events carry an idempotency key; writing the same event twice is a no-op.
- Re-running a completed job must be a no-op: check the run/entity status first and return `completed` if already terminal.

## Status transitions

Runs move `queued → running → completed | failed`. Record `started_at`, `finished_at`, counters and `error_summary` on the run row; never leave a run `running` after a non-retryable failure.

## Batch hygiene

- `runJobBatch()` calls `purge_expired_discovery_content()` at the start of every batch; purge functions must be cheap and idempotent.
- Workers: `npm run worker` polls `POST /api/jobs/run` with `JOB_RUNNER_SECRET`. Never run two workers against the same database in local testing; kill by PID and check `pgrep -af worker.mjs` afterwards.

## Tests

Every job handler has tests against an in-memory store (see `MemoryStore` in `tests/discovery/candidate-resolution.test.ts`) covering: idempotent retry, deadline yield and resume, non-retryable failure marks the run failed, transient failure rethrows.
