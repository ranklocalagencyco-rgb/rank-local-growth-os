import { z } from "zod";

import { enqueueScoreJob, PERFORMANCE_AUDIT_JOB } from "@/audit/follow-up";
import type { SiteSummary } from "@/audit/findings";
import { AUDIT_SCORE_VERSION } from "@/audit/score/rules";
import type { RuntimeConfig } from "@/config/env";
import type { WebsitePerformanceObservation } from "@/db/types";
import { NonRetryableJobError, type JobContext, type JobOutcome, type JobRegistry } from "@/jobs/processor";
import { isAnalysableUrl, PerformanceProviderError, type PerformanceProvider, type PerformanceStrategy } from "@/performance/provider";
import type { PerformanceStore } from "@/performance/store";

// Performance evidence job (RL-058). Follows ai/rules/jobs-contract.md:
// - one provider request per invocation (a request can take most of a batch), then `continue`; the pending rows are the cursor;
// - idempotent: deterministic observation ids, terminal rows never rewritten, a finished run is a no-op;
// - bounded: homepage only, configured strategies only, MAX_ATTEMPTS_PER_STRATEGY per row and performanceMaxRequestsPerRun per run.
//   `continue` and hand-backs reset job.attempts, so these bounds are counted on the rows, not on the job;
// - safe against concurrent execution: every request is preceded by an atomic claim on the row;
// - a provider failure never touches the website audit's own status, and never blocks the score: the score job is enqueued
//   whenever every row is terminal, with performance marked not evaluated where a measurement is missing.
// Deterministic end to end; no LLM anywhere in this path (ai/rules/no-llm-in-crawler.md).

export const performanceAuditPayloadSchema = z.object({ auditRunId: z.string().uuid(), prospectId: z.string().uuid() });
export type PerformanceAuditPayload = z.infer<typeof performanceAuditPayloadSchema>;

export const MAX_ATTEMPTS_PER_STRATEGY = 2;
/** Declared to the processor: the job is only started when a whole provider request fits the batch (src/jobs/processor.ts). */
export const PERFORMANCE_JOB_BUDGET_MS = 42_000;
/** Below this there is no point starting an analysis that typically needs 15-40 s; yield for a fresh invocation instead. */
export const MIN_USEFUL_TIMEOUT_MS = 10_000;
const DEADLINE_MARGIN_MS = 3_000;
const STRATEGY_ORDER: PerformanceStrategy[] = ["mobile", "desktop"];

export type PerformanceJobDependencies = {
  store: PerformanceStore;
  /** Null when performance collection is switched off. */
  getProvider: () => PerformanceProvider | null;
  config: Pick<RuntimeConfig, "performanceStrategies" | "performanceMaxRequestsPerRun" | "performanceRequestTimeoutMs">;
};

function withoutCredentials(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

export async function runPerformanceAudit(payload: PerformanceAuditPayload, context: Pick<JobContext, "deadline" | "job" | "logger">, deps: PerformanceJobDependencies): Promise<JobOutcome> {
  const { store, config } = deps;
  const workspaceId = context.job.workspace_id;

  const run = await store.getRun(workspaceId, payload.auditRunId);
  if (!run || run.prospect_id !== payload.prospectId) throw new NonRetryableJobError("Audit run not found");
  // Nothing to measure for a failed crawl. A crawl that is still running retries with backoff, bounded by max_attempts.
  if (run.status === "failed") return { status: "completed" };
  // `blocked` is terminal like `completed`: the crawl is over, and whatever evidence exists (possibly performance only) is scored.
  if (run.status !== "completed" && run.status !== "blocked") throw new Error("Website audit has not completed yet");

  const followUp = { workspaceId, auditRunId: run.id, prospectId: run.prospect_id, traceId: context.job.trace_id };
  const provider = deps.getProvider();
  if (!provider) {
    await enqueueScoreJob(store, followUp, AUDIT_SCORE_VERSION);
    return { status: "completed" };
  }

  const summary = run.site_summary_json as Partial<SiteSummary>;
  const homepageUrl = typeof summary.homepageFinalUrl === "string" && summary.homepageFinalUrl ? summary.homepageFinalUrl : run.website_url;
  const analysable = isAnalysableUrl(homepageUrl);
  // A URL we refuse to send is also never copied into the observation row as-is (it may carry credentials).
  const url = analysable ? homepageUrl : withoutCredentials(homepageUrl);
  const strategies = STRATEGY_ORDER.filter((strategy) => config.performanceStrategies.includes(strategy));
  await store.ensureObservations(strategies.map((strategy) => ({ workspaceId, prospectId: run.prospect_id, auditRunId: run.id, provider: provider.name, strategy, requestedUrl: url })));

  const finish = async (observations: WebsitePerformanceObservation[]): Promise<JobOutcome> => {
    const succeeded = observations.filter((observation) => observation.status === "succeeded");
    const failed = observations.filter((observation) => observation.status === "failed");
    const requests = observations.reduce((total, observation) => total + observation.attempts, 0);
    const label = failed.length === 0 ? "collected" : succeeded.length === 0 ? "unavailable" : "partially collected";
    await store.recordActivity({ workspaceId, prospectId: run.prospect_id, eventType: "audit.performance_completed", summary: `Performance evidence ${label}: ${succeeded.map((observation) => observation.strategy).join(" + ") || "no strategy"} measured${failed.length > 0 ? `, ${failed.map((observation) => `${observation.strategy} failed (${observation.error_code ?? "unknown"})`).join(", ")}` : ""}.`, metadata: { auditRunId: run.id, provider: provider.name, providerRequests: requests, succeeded: succeeded.length, failed: failed.length }, idempotencyKey: `audit.performance_completed:${run.id}` });
    await store.recordDomainEvent({ workspaceId, aggregateType: "website_audit_run", aggregateId: run.id, eventType: "audit.performance_completed", payload: { prospectId: run.prospect_id, provider: provider.name, providerRequests: requests, succeeded: succeeded.map((observation) => observation.strategy), failed: failed.map((observation) => ({ strategy: observation.strategy, errorCode: observation.error_code })) }, idempotencyKey: `audit.performance_completed:${run.id}` });
    await enqueueScoreJob(store, followUp, AUDIT_SCORE_VERSION);
    context.logger.info("performance.completed", { auditRunId: run.id, providerRequests: requests, succeeded: succeeded.length, failed: failed.length });
    return { status: "completed" };
  };

  for (;;) {
    const observations = (await store.listObservations(run.id)).filter((observation) => observation.provider === provider.name && observation.requested_url === url);
    const pending = observations.filter((observation) => observation.status === "pending").sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy));
    const row = pending[0];
    if (!row) return finish(observations);

    const requestsSoFar = observations.reduce((total, observation) => total + observation.attempts, 0);
    const lastError = { code: row.error_code ?? "unknown", summary: row.error_summary ?? "The provider request failed." };
    if (!analysable) {
      await store.failObservation(row.id, { code: "invalid_request", summary: "The audited homepage URL is not a plain http(s) URL and was not sent for analysis." });
      continue;
    }
    if (row.attempts >= MAX_ATTEMPTS_PER_STRATEGY) {
      await store.failObservation(row.id, { code: lastError.code, summary: `${lastError.summary} Gave up after ${row.attempts} attempts.` });
      continue;
    }
    if (requestsSoFar >= config.performanceMaxRequestsPerRun) {
      await store.failObservation(row.id, { code: "request_budget_exhausted", summary: `Not measured: the run's cap of ${config.performanceMaxRequestsPerRun} provider requests was reached.` });
      continue;
    }

    const timeoutMs = Math.min(config.performanceRequestTimeoutMs, context.deadline - Date.now() - DEADLINE_MARGIN_MS);
    if (timeoutMs < MIN_USEFUL_TIMEOUT_MS) return { status: "continue", delaySeconds: 1 };

    // The claim both prevents a concurrent duplicate request and persists the request count before the call is made.
    if (!(await store.claimAttempt(row.id, row.attempts))) return { status: "continue", delaySeconds: 5 };
    const attempt = row.attempts + 1;

    try {
      const result = await provider.measure({ url, strategy: row.strategy, timeoutMs });
      await store.completeObservation(row.id, result.measurement);
      context.logger.info("performance.observation", { auditRunId: run.id, strategy: row.strategy, attempt, performanceScore: result.measurement.scores.performance, fieldData: result.measurement.field !== null });
    } catch (error) {
      if (!(error instanceof PerformanceProviderError)) throw error;
      const failure = { code: error.code, summary: error.message.slice(0, 500) };
      context.logger.warn("performance.request_failed", { auditRunId: run.id, strategy: row.strategy, attempt, code: error.code, retryable: error.retryable });
      const budgetLeft = requestsSoFar + 1 < config.performanceMaxRequestsPerRun;
      const lastJobAttempt = context.job.attempts >= context.job.max_attempts;
      if (error.retryable && attempt < MAX_ATTEMPTS_PER_STRATEGY && budgetLeft && !lastJobAttempt) {
        await store.noteTransientFailure(row.id, failure);
        // Rethrown so the queue applies its backoff before the second and last attempt.
        throw error;
      }
      await store.failObservation(row.id, failure);
    }
    // One provider request per invocation: the next strategy gets a fresh time budget.
    return { status: "continue", delaySeconds: 1 };
  }
}

export function registerPerformanceJobs(registry: JobRegistry, deps: PerformanceJobDependencies): JobRegistry {
  registry.register(PERFORMANCE_AUDIT_JOB, performanceAuditPayloadSchema, (payload, context) => runPerformanceAudit(payload, context, deps), { budgetMs: PERFORMANCE_JOB_BUDGET_MS });
  return registry;
}
