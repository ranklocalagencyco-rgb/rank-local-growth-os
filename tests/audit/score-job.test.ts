import { describe, expect, it } from "vitest";

import { scoreJobIdempotencyKey } from "@/audit/follow-up";
import { runAuditScore } from "@/audit/score/jobs";
import { AUDIT_SCORE_VERSION } from "@/audit/score/rules";
import type { WebsiteAuditPage, WebsiteAuditRun, WebsiteAuditScore, WebsitePerformanceObservation } from "@/db/types";
import { NonRetryableJobError } from "@/jobs/processor";
import type { AuditScoreInsert, ScoreStore } from "@/performance/store";
import { page, scoreInput, strongPerformance, strongTradesSite, weakPerformance } from "./score-fixtures";

// audit.score against an in-memory store: insert-if-absent, version stability, no-op re-run, run-state guards.

const workspaceId = "11111111-1111-4111-8111-111111111111";
const prospectId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const at = "2026-09-19T10:00:00.000Z";

class MemoryScoreStore implements ScoreStore {
  run: WebsiteAuditRun | null;
  scores: WebsiteAuditScore[] = [];
  activity: string[] = [];
  events: string[] = [];

  constructor(public pages: WebsiteAuditPage[], public observations: WebsitePerformanceObservation[], run: Partial<WebsiteAuditRun> = {}) {
    const input = scoreInput(pages, observations);
    this.run = { id: runId, workspace_id: workspaceId, prospect_id: prospectId, job_id: null, requested_by: null, status: "completed", website_url: "https://example-roofing.co.uk", canonical_domain: "example-roofing.co.uk", crawler_version: "audit-crawler/v3", rules_version: "audit-rules/v3", started_at: at, completed_at: at, failed_at: null, blocked_at: null, pages_attempted: pages.length, pages_succeeded: pages.length, pages_failed: 0, error_summary: null, site_summary_json: input.run.site_summary_json, crawl_state_json: {}, retention_class: "audit_evidence", created_at: at, updated_at: at, ...run };
  }
  async getRun() { return this.run; }
  async listPages() { return this.pages; }
  async listObservations() { return this.observations; }
  async getScore(auditRunId: string, version: string) { return this.scores.find((score) => score.audit_run_id === auditRunId && score.scoring_version === version) ?? null; }
  async insertScore(score: AuditScoreInsert) {
    if (await this.getScore(score.audit_run_id, score.scoring_version)) return false;
    this.scores.push({ id: `score-${this.scores.length + 1}`, created_at: at, retention_class: "audit_evidence", ...score });
    return true;
  }
  async recordActivity(input: { idempotencyKey: string }) { if (!this.activity.includes(input.idempotencyKey)) this.activity.push(input.idempotencyKey); }
  async recordDomainEvent(input: { idempotencyKey: string }) { if (!this.events.includes(input.idempotencyKey)) this.events.push(input.idempotencyKey); }
}

const context = () => ({ job: { id: "job-1", workspace_id: workspaceId, type: "audit.score", idempotency_key: "k", payload: {}, status: "running" as const, attempts: 1, max_attempts: 4, run_after: at, locked_at: at, locked_by: "t", last_error: null, trace_id: "trace", created_at: at, updated_at: at, finished_at: null }, logger: { debug() {}, info() {}, warn() {}, error() {} } });
const payload = { auditRunId: runId, prospectId };
const deps = (store: ScoreStore) => ({ store, now: () => new Date(at) });

describe("audit score job", () => {
  it("stores one versioned score with category columns, status, coverage and the full breakdown", async () => {
    const store = new MemoryScoreStore(strongTradesSite(), strongPerformance(true));
    expect(await runAuditScore(payload, context(), deps(store))).toEqual({ status: "completed" });
    expect(store.scores).toHaveLength(1);
    expect(store.scores[0]).toMatchObject({ workspace_id: workspaceId, prospect_id: prospectId, audit_run_id: runId, scoring_version: "audit-score/v2", score_status: "complete", overall_score: 99.49, technical_score: 25, local_seo_score: 25, content_structure_score: 20, performance_score: 19.49, crawl_score: 10, evaluated_weight: 100, evidence_coverage: 100, calculated_at: at });
    const breakdown = store.scores[0].breakdown_json as { scoringVersion: string; categories: Record<string, { rules: Record<string, { status: string; points: number; max: number }> }>; inputs: { observationIds: string[] } };
    expect(breakdown.scoringVersion).toBe("audit-score/v2");
    expect(breakdown.categories.technical.rules.https).toMatchObject({ status: "pass", points: 4, max: 4 });
    expect(breakdown.inputs.observationIds).toEqual(["obs-desktop", "obs-mobile"]);
    expect(store.activity).toEqual([`audit.scored:${runId}:audit-score/v2`]);
    expect(scoreJobIdempotencyKey(runId, AUDIT_SCORE_VERSION)).toBe(`audit.score:${runId}:audit-score/v2`);
  });

  it("is a no-op when re-run: the stored score is never recalculated, even if the evidence rows changed since", async () => {
    const store = new MemoryScoreStore(strongTradesSite(), strongPerformance(true));
    await runAuditScore(payload, context(), deps(store));
    const stored = JSON.stringify(store.scores[0]);
    store.observations = weakPerformance();
    expect(await runAuditScore(payload, context(), deps(store))).toEqual({ status: "completed" });
    expect(store.scores).toHaveLength(1);
    expect(JSON.stringify(store.scores[0])).toBe(stored);
    expect(store.events).toHaveLength(1);
  });

  it("leaves a stored audit-score/v1 row byte-identical and adds the audit-score/v2 row beside it", async () => {
    const store = new MemoryScoreStore(strongTradesSite(), strongPerformance(true));
    const older: WebsiteAuditScore = { id: "score-old", workspace_id: workspaceId, prospect_id: prospectId, audit_run_id: runId, scoring_version: "audit-score/v1", score_status: "complete", overall_score: 12.34, technical_score: 1, local_seo_score: 2, content_structure_score: 3, performance_score: 4, crawl_score: 2.34, evaluated_weight: 100, evidence_coverage: 100, breakdown_json: { scoringVersion: "audit-score/v0" }, calculated_at: "2026-01-01T00:00:00.000Z", retention_class: "audit_evidence", created_at: "2026-01-01T00:00:00.000Z" };
    store.scores.push(older);
    const before = JSON.stringify(older);
    await runAuditScore(payload, context(), deps(store));
    expect(store.scores.map((score) => score.scoring_version)).toEqual(["audit-score/v1", "audit-score/v2"]);
    expect(JSON.stringify(store.scores[0])).toBe(before);
  });

  it("loses an insert race quietly without duplicate events", async () => {
    const store = new MemoryScoreStore(strongTradesSite(), []);
    store.insertScore = async () => false;
    expect(await runAuditScore(payload, context(), deps(store))).toEqual({ status: "completed" });
    expect(store.activity).toEqual([]);
  });

  it("stores insufficient evidence as a status with no overall number", async () => {
    const store = new MemoryScoreStore([], []);
    await runAuditScore(payload, context(), deps(store));
    expect(store.scores[0]).toMatchObject({ score_status: "insufficient_evidence", overall_score: null, evidence_coverage: 0 });
  });

  it("scores a blocked audit as audit-score/v2 insufficient_evidence with performance evidence only and no overall score", async () => {
    const challenge = { detected: true, kind: "bot_challenge", confidence: "high", rule: "title_tiny_document", markerFamily: null, signals: ["title:one_moment_please"], detectorVersion: "challenge-detector/v1", url: "https://example-roofing.co.uk/", httpStatus: 200, title: "One moment, please...", wordCount: 8, internalLinkCount: 0, h1Count: 0, detectedAt: at };
    const row = page("/", { title: null, meta_description: null, h1_count: 0, word_count: 0, canonical_url: null, has_viewport: false, json_ld_count: 0, schema_types: [], has_structured_data: false }, { renderingMode: "unknown", nap: null, challenge });
    const store = new MemoryScoreStore([row], strongPerformance(false), { status: "blocked", blocked_at: at, completed_at: null, pages_succeeded: 0, pages_failed: 1, site_summary_json: { homepageUrl: "https://example-roofing.co.uk", homepageFinalUrl: "https://example-roofing.co.uk/", homepageStatus: 200, homepageRedirectChain: [], crawlBlocked: true, challenge } });
    expect(await runAuditScore(payload, context(), deps(store))).toEqual({ status: "completed" });
    expect(store.scores).toHaveLength(1);
    expect(store.scores[0]).toMatchObject({ scoring_version: "audit-score/v2", score_status: "insufficient_evidence", overall_score: null, technical_score: null, local_seo_score: null, content_structure_score: null, crawl_score: null, performance_score: 19.36, evaluated_weight: 20, evidence_coverage: 16 });
    expect(store.run?.status).toBe("blocked");
  });

  it("skips failed audits, retries unfinished ones and rejects unknown runs", async () => {
    const failedAudit = new MemoryScoreStore(strongTradesSite(), [], { status: "failed" });
    expect(await runAuditScore(payload, context(), deps(failedAudit))).toEqual({ status: "completed" });
    expect(failedAudit.scores).toEqual([]);
    await expect(runAuditScore(payload, context(), deps(new MemoryScoreStore(strongTradesSite(), [], { status: "running" })))).rejects.toThrow("not completed");
    const missing = new MemoryScoreStore([], []);
    missing.run = null;
    await expect(runAuditScore(payload, context(), deps(missing))).rejects.toBeInstanceOf(NonRetryableJobError);
  });
});
