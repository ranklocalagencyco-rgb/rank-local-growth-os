import { z } from "zod";

import { buildPageOutcome, discoverSitemaps, enqueueFrontier, initialCrawlState, nextFrontierEntry, parseCrawlState, siteDomainOf, siteOrigin, summariseSite, type CrawlState } from "@/audit/crawler";
import { AUDIT_CRAWLER_VERSION } from "@/audit/extract";
import { AUDIT_RULES_VERSION, pageFindings, siteFindings, type FindingInput } from "@/audit/findings";
import type { SafeFetcher, SafeFetchReason, SafeFetchResult } from "@/audit/safe-fetch";
import { normalizeAuditUrl } from "@/audit/url";
import type { AuditFindingInsert, AuditProspect, AuditStore } from "@/audit/store";
import type { RuntimeConfig } from "@/config/env";
import type { WebsiteAuditRun } from "@/db/types";
import { NonRetryableJobError, type JobContext, type JobOutcome, type JobRegistry } from "@/jobs/processor";

// Website audit job (RL-051/061/062). Follows ai/rules/jobs-contract.md: idempotent, cursor persisted per page,
// yields at the deadline, non-retryable failures mark the run failed, transient failures retry then fail on the last attempt.
// Deterministic end to end; no LLM anywhere in this path (ai/rules/no-llm-in-crawler.md).

export const WEBSITE_AUDIT_JOB = "audit.run";
export const websiteAuditPayloadSchema = z.object({ auditRunId: z.string().uuid(), prospectId: z.string().uuid() });
export type WebsiteAuditPayload = z.infer<typeof websiteAuditPayloadSchema>;

export type AuditJobDependencies = {
  store: AuditStore;
  /** One fetcher per invocation; closed when the invocation ends so pinned hosts never outlive the crawl. */
  createFetcher: () => SafeFetcher;
  config: Pick<RuntimeConfig, "auditMaxPages">;
  now?: () => Date;
};

export function auditJobIdempotencyKey(auditRunId: string): string {
  return `${WEBSITE_AUDIT_JOB}:${auditRunId}`;
}

/** A prospect qualifies for an audit only with a verified official website. */
export function isAuditEligible(prospect: Pick<AuditProspect, "website_state" | "website_url">): boolean {
  return prospect.website_state === "verified_website" && typeof prospect.website_url === "string" && prospect.website_url.length > 0;
}

const TRANSIENT_REASONS = new Set<SafeFetchReason>(["timeout", "network_error", "dns_error"]);

/** Error class for homepage failures that retrying may fix. */
export class TransientAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientAuditError";
  }
}

export async function runWebsiteAudit(payload: WebsiteAuditPayload, context: Pick<JobContext, "deadline" | "job" | "logger">, deps: AuditJobDependencies): Promise<JobOutcome> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const workspaceId = context.job.workspace_id;

  const run = await store.getRun(workspaceId, payload.auditRunId);
  if (!run) throw new NonRetryableJobError("Audit run not found");
  if (run.status === "completed" || run.status === "failed") return { status: "completed" };

  const failRun = async (message: string): Promise<never> => {
    await store.updateRun(run.id, { status: "failed", failedAt: now().toISOString(), errorSummary: message });
    await store.recordActivity({ workspaceId, prospectId: run.prospect_id, eventType: "audit.failed", summary: `Website audit failed: ${message}`, metadata: { auditRunId: run.id }, idempotencyKey: `audit.failed:${run.id}` });
    await store.recordDomainEvent({ workspaceId, aggregateType: "website_audit_run", aggregateId: run.id, eventType: "audit.failed", payload: { prospectId: run.prospect_id, error: message }, idempotencyKey: `audit.failed:${run.id}` });
    throw new NonRetryableJobError(message);
  };

  const prospect = await store.getProspect(workspaceId, payload.prospectId);
  if (!prospect || prospect.id !== run.prospect_id) return failRun("Prospect not found for this audit run.");
  if (!isAuditEligible(prospect)) return failRun(`Prospect website is not eligible for audit (state ${prospect.website_state}).`);

  if (run.status === "queued") {
    await store.updateRun(run.id, { status: "running", startedAt: run.started_at ?? now().toISOString(), errorSummary: null });
  }

  const state = parseCrawlState(run.crawl_state_json);
  const counters = { attempted: run.pages_attempted, succeeded: run.pages_succeeded, failed: run.pages_failed };
  const persist = async (extra: Parameters<AuditStore["updateRun"]>[1] = {}) => {
    await store.updateRun(run.id, { crawlState: state as unknown as Record<string, unknown>, pagesAttempted: counters.attempted, pagesSucceeded: counters.succeeded, pagesFailed: counters.failed, ...extra });
  };
  const outOfTime = () => Date.now() > context.deadline - 3_000;

  const fetcher = deps.createFetcher();
  try {
    if (state.phase === "start") {
      const outcome = await startCrawl(run, state, fetcher, deps, context, counters, now);
      if (outcome.kind === "fail") return failRun(outcome.message);
      if (outcome.kind === "transient") {
        // Last attempt: fail the run so it never stays "running" after the job dead-letters.
        if (context.job.attempts >= context.job.max_attempts) return failRun(outcome.message);
        await persist({ errorSummary: `Retrying after ${outcome.message}` });
        throw new TransientAuditError(outcome.message);
      }
      state.phase = "crawl";
      await persist({ errorSummary: null });
    }

    if (state.phase === "crawl") {
      while (counters.attempted < deps.config.auditMaxPages && state.frontier.length > 0) {
        if (outOfTime()) {
          await persist();
          return { status: "continue", delaySeconds: 1 };
        }
        const entry = nextFrontierEntry(state);
        if (!entry) break;
        const result = await fetcher.fetch(entry.url, { sameSiteDomain: state.siteDomain });
        counters.attempted += 1;
        const outcome = buildPageOutcome({ workspaceId, runId: run.id, prospectId: run.prospect_id, entry, result, state, fetchedAt: now().toISOString() });
        if (outcome.page) {
          await store.insertPage(outcome.page);
          if (outcome.page.fetch_ok && (outcome.page.http_status ?? 0) < 400) counters.succeeded += 1;
          else counters.failed += 1;
          if (outcome.evidence) enqueueFrontier(state, outcome.evidence.internalLinks.map((url) => ({ url, via: "link" as const, from: entry.url })));
        }
        context.logger.info("audit.page", { auditRunId: run.id, url: entry.url, status: result.status, reason: result.reason, attempted: counters.attempted, frontier: state.frontier.length });
        await persist();
      }
      state.phase = "finalize";
      await persist();
    }

    // Finalise from stored rows so a retry recomputes exactly the same findings.
    const pages = await store.listPages(run.id);
    const summary = summariseSite(state, pages);
    const findings: FindingInput[] = [...pages.flatMap((page) => pageFindings(page)), ...siteFindings(summary, pages)];
    const rows: AuditFindingInsert[] = findings.map((finding) => ({ workspaceId, auditRunId: run.id, prospectId: run.prospect_id, pageId: finding.pageId, scope: finding.scope, code: finding.code, severity: finding.severity, evidence: finding.evidence, ruleVersion: AUDIT_RULES_VERSION }));
    await store.insertFindings(rows);
    await store.updateRun(run.id, { status: "completed", completedAt: now().toISOString(), errorSummary: null, siteSummary: summary as unknown as Record<string, unknown>, crawlState: { ...state, frontier: [] } as unknown as Record<string, unknown>, pagesAttempted: counters.attempted, pagesSucceeded: counters.succeeded, pagesFailed: counters.failed });
    await store.recordActivity({ workspaceId, prospectId: run.prospect_id, eventType: "audit.completed", summary: `Website audit completed: ${summary.pagesCrawled} page${summary.pagesCrawled === 1 ? "" : "s"} crawled, ${findings.length} finding${findings.length === 1 ? "" : "s"}.${summary.renderedContentEvaluated ? "" : " Rendered content was not evaluated (client-rendered site)."}`, metadata: { auditRunId: run.id, pagesCrawled: summary.pagesCrawled, findings: findings.length, renderedContentEvaluated: summary.renderedContentEvaluated }, idempotencyKey: `audit.completed:${run.id}` });
    await store.recordDomainEvent({ workspaceId, aggregateType: "website_audit_run", aggregateId: run.id, eventType: "audit.completed", payload: { prospectId: run.prospect_id, pagesCrawled: summary.pagesCrawled, findings: findings.length, crawlerVersion: AUDIT_CRAWLER_VERSION, rulesVersion: AUDIT_RULES_VERSION }, idempotencyKey: `audit.completed:${run.id}` });
    context.logger.info("audit.completed", { auditRunId: run.id, pagesCrawled: summary.pagesCrawled, findings: findings.length, renderedContentEvaluated: summary.renderedContentEvaluated });
    return { status: "completed" };
  } finally {
    await fetcher.close();
  }
}

type StartOutcome = { kind: "ok" } | { kind: "fail"; message: string } | { kind: "transient"; message: string };

/** Homepage fetch, robots/sitemap discovery and initial frontier. The homepage must succeed or no useful audit can continue. */
async function startCrawl(run: WebsiteAuditRun, state: CrawlState, fetcher: SafeFetcher, deps: AuditJobDependencies, context: Pick<JobContext, "job" | "logger">, counters: { attempted: number; succeeded: number; failed: number }, now: () => Date): Promise<StartOutcome> {
  const result: SafeFetchResult = await fetcher.fetch(run.website_url);
  if (!result.ok) {
    if (result.reason && TRANSIENT_REASONS.has(result.reason)) return { kind: "transient", message: `homepage ${result.reason}` };
    return { kind: "fail", message: `Homepage could not be fetched safely (${result.reason ?? "unknown"}).` };
  }
  if (result.status === null || result.status >= 400) return { kind: "fail", message: `Homepage returned HTTP ${result.status ?? "unknown"}.` };
  if (!result.isHtml || result.body === null) return { kind: "fail", message: `Homepage is not an HTML document (${result.contentType ?? "unknown content type"}).` };

  const siteDomain = siteDomainOf(result.finalUrl) ?? siteDomainOf(run.website_url);
  const origin = siteOrigin(result.finalUrl ?? run.website_url);
  if (!siteDomain || !origin) return { kind: "fail", message: "Homepage URL has no usable public domain." };

  Object.assign(state, initialCrawlState(), { phase: "start", siteDomain });
  // The homepage is crawled here, outside the frontier. Record its keys so a sitemap or link back to it is never fetched twice.
  for (const url of [run.website_url, result.finalUrl]) {
    const key = url ? normalizeAuditUrl(url)?.key : undefined;
    if (key && !state.visited.includes(key)) state.visited.push(key);
  }
  state.summary = { homepageUrl: run.website_url, homepageFinalUrl: result.finalUrl, homepageStatus: result.status, homepageRedirectChain: result.redirectChain };

  const workspaceId = context.job.workspace_id;
  const outcome = buildPageOutcome({ workspaceId, runId: run.id, prospectId: run.prospect_id, entry: { url: result.finalUrl ?? run.website_url, via: "homepage", from: null }, result, state, fetchedAt: now().toISOString() });
  counters.attempted += 1;
  if (outcome.page) {
    await deps.store.insertPage(outcome.page);
    counters.succeeded += 1;
  }

  const sitemaps = await discoverSitemaps(fetcher, origin, state);
  Object.assign(state.summary, { robotsTxtReachable: sitemaps.robotsTxtReachable, robotsDisallowAll: sitemaps.robotsDisallowAll, sitemapReachable: sitemaps.sitemapReachable, sitemapUrlsDiscovered: sitemaps.sitemapUrlsDiscovered, sitemapUrlsSameSite: sitemaps.sitemapUrlsSameSite });

  enqueueFrontier(state, sitemaps.urls.map((url) => ({ url, via: "sitemap" as const, from: null })));
  if (outcome.evidence) enqueueFrontier(state, outcome.evidence.internalLinks.map((url) => ({ url, via: "link" as const, from: result.finalUrl ?? run.website_url })));
  context.logger.info("audit.start", { auditRunId: run.id, siteDomain, sitemapUrls: sitemaps.sitemapUrlsSameSite, frontier: state.frontier.length });
  return { kind: "ok" };
}

export function registerAuditJobs(registry: JobRegistry, deps: AuditJobDependencies): JobRegistry {
  registry.register(WEBSITE_AUDIT_JOB, websiteAuditPayloadSchema, (payload, context) => runWebsiteAudit(payload, context, deps));
  return registry;
}
