import { describe, expect, it } from "vitest";

import type { WebsiteAuditRun, WebsitePerformanceObservation } from "@/db/types";
import { NonRetryableJobError } from "@/jobs/processor";
import { MAX_ATTEMPTS_PER_STRATEGY, PERFORMANCE_JOB_BUDGET_MS, runPerformanceAudit, type PerformanceJobDependencies } from "@/performance/jobs";
import { PerformanceProviderError, type PerformanceMeasurement, type PerformanceProvider, type PerformanceRequest } from "@/performance/provider";
import type { PendingObservationInput, PerformanceStore } from "@/performance/store";

// audit.performance against an in-memory store (ai/rules/jobs-contract.md): idempotent retry, resume, transient vs permanent
// failures, request bounds, duplicate concurrent execution, and "a provider failure never blocks the score".

const workspaceId = "11111111-1111-4111-8111-111111111111";
const prospectId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const at = "2026-09-19T10:00:00.000Z";
const homepage = "https://www.example-roofing.co.uk/";

class MemoryPerformanceStore implements PerformanceStore {
  run: WebsiteAuditRun | null;
  observations: WebsitePerformanceObservation[] = [];
  jobs: { type: string; idempotencyKey: string }[] = [];
  activity: string[] = [];
  events: string[] = [];
  /** When set, the next claim is lost, as if another execution had taken the row first. */
  loseNextClaim = false;

  constructor(run: Partial<WebsiteAuditRun> = {}) {
    this.run = { id: runId, workspace_id: workspaceId, prospect_id: prospectId, job_id: "job-1", requested_by: null, status: "completed", website_url: "https://example-roofing.co.uk", canonical_domain: "example-roofing.co.uk", crawler_version: "audit-crawler/v3", rules_version: "audit-rules/v3", started_at: at, completed_at: at, failed_at: null, blocked_at: null, pages_attempted: 5, pages_succeeded: 5, pages_failed: 0, error_summary: null, site_summary_json: { homepageFinalUrl: homepage }, crawl_state_json: {}, retention_class: "audit_evidence", created_at: at, updated_at: at, ...run };
  }
  async getRun() { return this.run; }
  async enqueue(input: { type: string; idempotencyKey: string }) { if (!this.jobs.some((job) => job.idempotencyKey === input.idempotencyKey)) this.jobs.push({ type: input.type, idempotencyKey: input.idempotencyKey }); }
  async recordActivity(input: { idempotencyKey: string }) { if (!this.activity.includes(input.idempotencyKey)) this.activity.push(input.idempotencyKey); }
  async recordDomainEvent(input: { idempotencyKey: string }) { if (!this.events.includes(input.idempotencyKey)) this.events.push(input.idempotencyKey); }
  async ensureObservations(rows: PendingObservationInput[]) {
    for (const row of rows) {
      if (this.observations.some((existing) => existing.audit_run_id === row.auditRunId && existing.provider === row.provider && existing.strategy === row.strategy && existing.requested_url === row.requestedUrl)) continue;
      this.observations.push({ id: `obs-${row.strategy}`, workspace_id: row.workspaceId, prospect_id: row.prospectId, audit_run_id: row.auditRunId, provider: row.provider, provider_version: null, strategy: row.strategy, page_role: "homepage", requested_url: row.requestedUrl, final_url: null, status: "pending", attempts: 0, error_code: null, error_summary: null, performance_score: null, accessibility_score: null, best_practices_score: null, seo_score: null, fcp_ms: null, lcp_ms: null, cls: null, tbt_ms: null, speed_index_ms: null, tti_ms: null, field_data_available: false, field_scope: null, field_lcp_ms: null, field_inp_ms: null, field_cls: null, field_overall_category: null, run_warnings: [], observed_at: null, retention_class: "audit_evidence", created_at: at, updated_at: at });
    }
  }
  async listObservations() { return this.observations.map((observation) => ({ ...observation })); }
  private pending(id: string) { return this.observations.find((observation) => observation.id === id && observation.status === "pending"); }
  async claimAttempt(id: string, seen: number) {
    if (this.loseNextClaim) { this.loseNextClaim = false; return false; }
    const row = this.pending(id);
    if (!row || row.attempts !== seen) return false;
    row.attempts += 1;
    return true;
  }
  async noteTransientFailure(id: string, error: { code: string; summary: string }) { const row = this.pending(id); if (row) Object.assign(row, { error_code: error.code, error_summary: error.summary }); }
  async completeObservation(id: string, measurement: PerformanceMeasurement) { const row = this.pending(id); if (row) Object.assign(row, { status: "succeeded", error_code: null, error_summary: null, performance_score: measurement.scores.performance, lcp_ms: measurement.lab.lcpMs, field_data_available: measurement.field !== null, final_url: measurement.finalUrl, observed_at: measurement.observedAt }); }
  async failObservation(id: string, error: { code: string; summary: string }) { const row = this.pending(id); if (row) Object.assign(row, { status: "failed", error_code: error.code, error_summary: error.summary }); }
  row(strategy: "mobile" | "desktop") { return this.observations.find((observation) => observation.strategy === strategy); }
}

const measurement = (request: PerformanceRequest): PerformanceMeasurement => ({ provider: "pagespeed", providerVersion: "12.6.0", strategy: request.strategy, requestedUrl: request.url, finalUrl: request.url, observedAt: at, scores: { performance: request.strategy === "mobile" ? 61 : 93, accessibility: 90, bestPractices: 100, seo: 92 }, lab: { fcpMs: 1800, lcpMs: 3100, cls: 0.02, tbtMs: 150, speedIndexMs: 3000, ttiMs: 4000 }, field: null, warnings: [] });

/** Scripted provider: each call consumes the next outcome; "ok" returns a measurement, an error is thrown. */
function scriptedProvider(script: ("ok" | Error)[]): PerformanceProvider & { requests: PerformanceRequest[] } {
  const requests: PerformanceRequest[] = [];
  return {
    name: "pagespeed",
    requests,
    async measure(request) {
      requests.push(request);
      const next = script.shift() ?? "ok";
      if (next !== "ok") throw next;
      return { measurement: measurement(request), requestCount: 1, costUsd: null };
    },
  };
}

const transient = () => new PerformanceProviderError("PageSpeed Insights rate limit reached.", "quota", true);
const permanent = () => new PerformanceProviderError("PageSpeed Insights could not analyse the page.", "target_unanalyzable", false);

const context = (attempts = 1, deadlineOffsetMs = PERFORMANCE_JOB_BUDGET_MS) => ({
  job: { id: "job-1", workspace_id: workspaceId, type: "audit.performance", idempotency_key: "k", payload: {}, status: "running" as const, attempts, max_attempts: 4, run_after: at, locked_at: at, locked_by: "t", last_error: null, trace_id: "trace", created_at: at, updated_at: at, finished_at: null },
  deadline: Date.now() + deadlineOffsetMs,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});
const deps = (store: PerformanceStore, provider: PerformanceProvider | null, config: Partial<PerformanceJobDependencies["config"]> = {}): PerformanceJobDependencies => ({ store, getProvider: () => provider, config: { performanceStrategies: ["mobile", "desktop"], performanceMaxRequestsPerRun: 4, performanceRequestTimeoutMs: 35_000, ...config } });
const payload = { auditRunId: runId, prospectId };

/** Drives the job the way the queue would: `continue` re-invokes, a thrown retryable error re-invokes with attempts + 1. */
async function drive(store: PerformanceStore, provider: PerformanceProvider | null, config: Partial<PerformanceJobDependencies["config"]> = {}) {
  let attempts = 1;
  for (let invocation = 1; invocation <= 12; invocation += 1) {
    try {
      const outcome = await runPerformanceAudit(payload, context(attempts), deps(store, provider, config));
      if (outcome.status === "completed") return invocation;
      attempts = 1;
    } catch (error) {
      if (!(error instanceof PerformanceProviderError) || !error.retryable) throw error;
      attempts += 1;
    }
  }
  throw new Error("job did not finish");
}

describe("performance audit job", () => {
  it("measures mobile then desktop with exactly one bounded request each, then enqueues the score", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([]);

    expect(await runPerformanceAudit(payload, context(), deps(store, provider))).toEqual({ status: "continue", delaySeconds: 1 });
    expect(provider.requests.map((request) => request.strategy)).toEqual(["mobile"]);
    expect(store.jobs).toEqual([]);

    expect(await runPerformanceAudit(payload, context(), deps(store, provider))).toEqual({ status: "continue", delaySeconds: 1 });
    expect(await runPerformanceAudit(payload, context(), deps(store, provider))).toEqual({ status: "completed" });

    expect(provider.requests.map((request) => [request.strategy, request.url])).toEqual([["mobile", homepage], ["desktop", homepage]]);
    expect(provider.requests.every((request) => request.timeoutMs <= 35_000 && request.timeoutMs >= 10_000)).toBe(true);
    expect(store.observations.map((observation) => [observation.strategy, observation.status, observation.attempts, observation.performance_score])).toEqual([["mobile", "succeeded", 1, 61], ["desktop", "succeeded", 1, 93]]);
    expect(store.jobs).toEqual([{ type: "audit.score", idempotencyKey: `audit.score:${runId}:audit-score/v2` }]);
    expect(store.activity).toEqual([`audit.performance_completed:${runId}`]);
  });

  it("is a no-op when re-run after completion: no requests, no duplicate rows, jobs or events", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([]);
    await drive(store, provider);
    expect(await runPerformanceAudit(payload, context(), deps(store, provider))).toEqual({ status: "completed" });
    expect(provider.requests).toHaveLength(2);
    expect(store.observations).toHaveLength(2);
    expect(store.jobs).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  it("resumes at desktop when mobile already succeeded", async () => {
    const store = new MemoryPerformanceStore();
    const first = scriptedProvider([]);
    await runPerformanceAudit(payload, context(), deps(store, first));
    // A new worker process picks the job up: only the pending strategy is requested.
    const second = scriptedProvider([]);
    await drive(store, second);
    expect(second.requests.map((request) => request.strategy)).toEqual(["desktop"]);
    expect(store.row("mobile")).toMatchObject({ status: "succeeded", attempts: 1 });
  });

  it("rethrows a transient failure for queue backoff, keeps the row pending, then succeeds on the retry", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([transient()]);
    await expect(runPerformanceAudit(payload, context(), deps(store, provider))).rejects.toMatchObject({ code: "quota", retryable: true });
    expect(store.row("mobile")).toMatchObject({ status: "pending", attempts: 1, error_code: "quota" });
    expect(store.jobs).toEqual([]);

    await drive(store, provider);
    expect(store.row("mobile")).toMatchObject({ status: "succeeded", attempts: 2, error_code: null });
    expect(provider.requests).toHaveLength(3);
  });

  it("gives a strategy at most two attempts, records the failure and still scores", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([transient(), transient()]);
    await drive(store, provider);
    expect(store.row("mobile")).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS_PER_STRATEGY, error_code: "quota" });
    expect(store.row("desktop")).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(provider.requests).toHaveLength(3);
    expect(store.jobs.map((job) => job.type)).toEqual(["audit.score"]);
  });

  it("records a permanent failure without retrying and moves on", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([permanent(), permanent()]);
    await drive(store, provider);
    expect(store.observations.map((observation) => [observation.status, observation.attempts, observation.error_code])).toEqual([["failed", 1, "target_unanalyzable"], ["failed", 1, "target_unanalyzable"]]);
    expect(provider.requests).toHaveLength(2);
    expect(store.jobs.map((job) => job.type)).toEqual(["audit.score"]);
    expect(store.run?.status).toBe("completed");
  });

  it("never exceeds the per-run request cap", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([transient(), transient(), transient(), transient()]);
    await drive(store, provider, { performanceMaxRequestsPerRun: 2 });
    expect(provider.requests).toHaveLength(2);
    expect(store.row("mobile")).toMatchObject({ status: "failed", attempts: 2 });
    expect(store.row("desktop")).toMatchObject({ status: "failed", attempts: 0, error_code: "request_budget_exhausted" });
    expect(store.jobs.map((job) => job.type)).toEqual(["audit.score"]);
  });

  it("fails the row instead of rethrowing on the job's last attempt, so the score is never blocked", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([transient()]);
    expect(await runPerformanceAudit(payload, context(4), deps(store, provider))).toEqual({ status: "continue", delaySeconds: 1 });
    expect(store.row("mobile")).toMatchObject({ status: "failed", error_code: "quota" });
  });

  it("makes no request when another execution claimed the row first", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([]);
    store.loseNextClaim = true;
    expect(await runPerformanceAudit(payload, context(), deps(store, provider))).toEqual({ status: "continue", delaySeconds: 5 });
    expect(provider.requests).toHaveLength(0);
    expect(store.row("mobile")).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("yields without a request when too little of the invocation is left for an analysis", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([]);
    expect(await runPerformanceAudit(payload, context(1, 9_000), deps(store, provider))).toEqual({ status: "continue", delaySeconds: 1 });
    expect(provider.requests).toHaveLength(0);
  });

  it("honours PERFORMANCE_STRATEGIES", async () => {
    const store = new MemoryPerformanceStore();
    const provider = scriptedProvider([]);
    await drive(store, provider, { performanceStrategies: ["mobile"] });
    expect(provider.requests.map((request) => request.strategy)).toEqual(["mobile"]);
    expect(store.observations).toHaveLength(1);
  });

  it("goes straight to the score when no provider is enabled", async () => {
    const store = new MemoryPerformanceStore();
    expect(await runPerformanceAudit(payload, context(), deps(store, null))).toEqual({ status: "completed" });
    expect(store.observations).toEqual([]);
    expect(store.jobs.map((job) => job.type)).toEqual(["audit.score"]);
  });

  it("measures a blocked audit like a completed one: the provider, not our crawler, fetches the page, then the score is enqueued once", async () => {
    const provider = scriptedProvider(["ok", "ok"]);
    const store = new MemoryPerformanceStore({ status: "blocked", site_summary_json: { homepageUrl: "https://example-roofing.co.uk", homepageFinalUrl: "https://example-roofing.co.uk/", homepageStatus: 200, crawlBlocked: true } });
    let outcome = await runPerformanceAudit(payload, context(), deps(store, provider));
    while (outcome.status === "continue") outcome = await runPerformanceAudit(payload, context(), deps(store, provider));
    expect(outcome).toEqual({ status: "completed" });
    expect(provider.requests.map((request) => [request.strategy, request.url])).toEqual([["mobile", "https://example-roofing.co.uk/"], ["desktop", "https://example-roofing.co.uk/"]]);
    expect(store.observations.map((observation) => observation.status)).toEqual(["succeeded", "succeeded"]);
    expect(store.jobs).toEqual([{ type: "audit.score", idempotencyKey: `audit.score:${runId}:audit-score/v2` }]);
    expect(store.run?.status).toBe("blocked");
  });

  it("does nothing for a failed audit, retries while the audit is unfinished, and rejects an unknown run", async () => {
    const provider = scriptedProvider([]);
    const failedAudit = new MemoryPerformanceStore({ status: "failed" });
    expect(await runPerformanceAudit(payload, context(), deps(failedAudit, provider))).toEqual({ status: "completed" });
    expect(failedAudit.jobs).toEqual([]);

    await expect(runPerformanceAudit(payload, context(), deps(new MemoryPerformanceStore({ status: "running" }), provider))).rejects.toThrow("not completed");

    const missing = new MemoryPerformanceStore();
    missing.run = null;
    await expect(runPerformanceAudit(payload, context(), deps(missing, provider))).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(provider.requests).toHaveLength(0);
  });

  it("records an unusable homepage URL as a failed observation without calling the provider", async () => {
    const store = new MemoryPerformanceStore({ website_url: "https://user:secret@example.co.uk/", site_summary_json: {} });
    const provider = scriptedProvider([]);
    await drive(store, provider);
    expect(provider.requests).toHaveLength(0);
    expect(store.observations.every((observation) => observation.status === "failed" && observation.error_code === "invalid_request")).toBe(true);
    expect(store.observations.every((observation) => !observation.requested_url.includes("secret"))).toBe(true);
    expect(store.jobs.map((job) => job.type)).toEqual(["audit.score"]);
  });
});
