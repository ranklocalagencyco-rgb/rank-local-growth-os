import { calculateAuditScore, type AuditScoreInput } from "@/audit/score/calculate";
import type { AuditFindingSeverity, WebsiteAuditFinding, WebsiteAuditPage, WebsiteAuditRun, WebsiteAuditScore, WebsitePerformanceObservation } from "@/db/types";
import type { AuditReportData } from "@/report/model";
import { page, scoreInput, type SiteFacts } from "../audit/score-fixtures";

// Builders for the report tests. Scores are produced by the real calculator from the shared audit fixtures, so the report is tested
// against exactly the row shapes the jobs store. Not a test file (no .test suffix).

export const at = "2026-09-19T10:00:00.000Z";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const prospectId = "33333333-3333-4333-8333-333333333333";
export const runId = "44444444-4444-4444-8444-444444444444";

export function runRow(input: AuditScoreInput["run"], overrides: Partial<WebsiteAuditRun> = {}): WebsiteAuditRun {
  return { id: runId, workspace_id: workspaceId, prospect_id: prospectId, job_id: null, requested_by: null, status: "completed", website_url: "https://example-roofing.co.uk", canonical_domain: "example-roofing.co.uk", crawler_version: "audit-crawler/v4", rules_version: "audit-rules/v4", started_at: at, completed_at: at, failed_at: null, blocked_at: null, pages_attempted: input.pages_attempted, pages_succeeded: input.pages_attempted, pages_failed: 0, error_summary: null, site_summary_json: input.site_summary_json, crawl_state_json: {}, retention_class: "audit_evidence", created_at: at, updated_at: at, ...overrides };
}

export function scoreRow(input: AuditScoreInput, overrides: Partial<WebsiteAuditScore> = {}): WebsiteAuditScore {
  const result = calculateAuditScore(input);
  // Round-trip through JSON like Postgres jsonb does, so key order is not something the report can rely on.
  const breakdown = JSON.parse(JSON.stringify(result.breakdown)) as Record<string, unknown>;
  return { id: "score-1", workspace_id: workspaceId, prospect_id: prospectId, audit_run_id: runId, scoring_version: result.scoringVersion, score_status: result.status, overall_score: result.overallScore, technical_score: result.categoryScores.technical, local_seo_score: result.categoryScores.local_seo, content_structure_score: result.categoryScores.content_structure, performance_score: result.categoryScores.performance, crawl_score: result.categoryScores.crawl, evaluated_weight: result.evaluatedWeight, evidence_coverage: result.evidenceCoverage, breakdown_json: breakdown, calculated_at: at, retention_class: "audit_evidence", created_at: at, ...overrides };
}

/** Report input for a completed run, scored by the real calculator. */
export function reportData(pages: WebsiteAuditPage[], observations: WebsitePerformanceObservation[], facts: SiteFacts = {}, overrides: { run?: Partial<WebsiteAuditRun>; score?: Partial<WebsiteAuditScore> | null; findings?: WebsiteAuditFinding[] } = {}): AuditReportData {
  const input = scoreInput(pages, observations, facts);
  return { run: runRow(input.run, overrides.run), prospect: { id: prospectId, display_name: "Example Roofing", canonical_domain: "example-roofing.co.uk", website_url: "https://example-roofing.co.uk" }, pages, findings: overrides.findings ?? [], observations, score: overrides.score === null ? null : scoreRow(input, overrides.score ?? {}) };
}

const challenge = { detected: true, kind: "bot_challenge", confidence: "high", rule: "title_tiny_document", markerFamily: null, signals: ["title:one_moment_please", "text:request_being_verified", "structure:tiny_document"], detectorVersion: "challenge-detector/v1", url: "https://example-roofing.co.uk/", httpStatus: 200, title: "One moment, please...", wordCount: 8, internalLinkCount: 0, h1Count: 0, detectedAt: at };

/** A blocked run exactly as the audit job stores it: one provenance row, the blocked summary, one operational finding. */
export function blockedReportData(observations: WebsitePerformanceObservation[]): AuditReportData {
  const row = page("/", { title: null, meta_description: null, h1_count: 0, h1_text: [], h2_count: 0, canonical_url: null, has_viewport: false, word_count: 0, internal_link_count: 0, json_ld_count: 0, schema_types: [], has_structured_data: false }, { renderingMode: "unknown", nap: null, challenge });
  const input: AuditScoreInput = { run: { crawler_version: "audit-crawler/v4", rules_version: "audit-rules/v4", pages_attempted: 1, site_summary_json: { homepageUrl: "https://example-roofing.co.uk", homepageFinalUrl: "https://example-roofing.co.uk/", homepageStatus: 200, homepageRedirectChain: [], crawlBlocked: true, challenge } }, pages: [row], observations };
  return { run: runRow(input.run, { status: "blocked", blocked_at: at, completed_at: null, pages_succeeded: 0, pages_failed: 1 }), prospect: { id: prospectId, display_name: "Example Roofing", canonical_domain: "example-roofing.co.uk", website_url: "https://example-roofing.co.uk" }, pages: [row], findings: [finding("challenge_page_detected", "info", "page", { path: "/", kind: "bot_challenge" })], observations, score: scoreRow(input) };
}

let findingSeq = 0;
export function finding(code: string, severity: AuditFindingSeverity, scope: "site" | "page", evidence: Record<string, unknown> = {}): WebsiteAuditFinding {
  findingSeq += 1;
  return { id: `finding-${findingSeq}`, workspace_id: workspaceId, audit_run_id: runId, prospect_id: prospectId, page_id: scope === "page" ? `page:${String(evidence.path ?? "/")}` : null, scope, code, severity, evidence_json: evidence, rule_version: "audit-rules/v4", created_at: at };
}
