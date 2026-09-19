import { readChallengeEvidence, type ChallengeKind } from "@/audit/challenge-detection";
import { FINDING_TEXT } from "@/audit/findings";
import { CATEGORY_ORDER, CATEGORY_WEIGHTS, type ScoreCategoryKey } from "@/audit/score/rules";
import type { AuditFindingSeverity, AuditPageRole, AuditScoreStatus, JobRow, WebsiteAuditRun, WebsiteAuditScore, WebsitePerformanceObservation } from "@/db/types";

// Presentation helpers for website audits. Pure functions; labels describe evidence, never judgement.

export function auditStatusLabel(run: WebsiteAuditRun | null, job: JobRow | null): { headline: string; detail: string | null; tone: "good" | "warn" | "neutral" | "bad" } {
  if (!run) return { headline: "Not audited", detail: "Run a website audit to crawl the verified site and store evidence.", tone: "neutral" };
  if (run.status === "completed") return { headline: "Completed", detail: `${run.pages_succeeded} of ${run.pages_attempted} pages fetched.`, tone: "good" };
  if (run.status === "blocked") return { headline: "Audit blocked", detail: "The site returned a browser verification/challenge page, so content-based audit checks were not evaluated.", tone: "warn" };
  if (run.status === "failed") return { headline: "Failed", detail: run.error_summary ?? job?.last_error ?? "The audit job failed.", tone: "bad" };
  if (run.status === "running") return { headline: "Running", detail: `${run.pages_attempted} page${run.pages_attempted === 1 ? "" : "s"} attempted so far.${job?.status === "failed" ? ` Last attempt failed and will retry: ${job.last_error ?? "unknown error"}.` : ""}`, tone: "neutral" };
  if (job?.status === "dead_letter") return { headline: "Failed", detail: job.last_error ?? "The audit job could not be started.", tone: "bad" };
  return { headline: "Queued", detail: "Waiting for a worker (npm run worker or POST /api/jobs/run).", tone: "neutral" };
}

const CHALLENGE_KIND_LABELS: Record<ChallengeKind, string> = { bot_challenge: "Bot challenge / browser verification", access_block: "Access blocked", interstitial: "Holding / interstitial page" };

/** What the crawler recorded about a blocked run: detected type, URL and the signal codes. Null unless the run is blocked. Never HTML. */
export function auditBlockedDetail(run: WebsiteAuditRun | null): { kindLabel: string; url: string; title: string | null; reason: string; signals: string[] } | null {
  if (!run || run.status !== "blocked") return null;
  const challenge = readChallengeEvidence(run.site_summary_json?.challenge);
  if (!challenge) return { kindLabel: "Challenge page", url: run.website_url, title: null, reason: "No detection detail was stored.", signals: [] };
  return { kindLabel: challenge.kind ? CHALLENGE_KIND_LABELS[challenge.kind] : "Challenge page", url: challenge.url || run.website_url, title: challenge.title, reason: `HTTP ${challenge.httpStatus ?? "?"} · ${challenge.wordCount} word${challenge.wordCount === 1 ? "" : "s"} · ${challenge.internalLinkCount} internal link${challenge.internalLinkCount === 1 ? "" : "s"} · rule ${challenge.rule ?? "unknown"} (${challenge.confidence} confidence)`, signals: challenge.signals };
}

export function severityTone(severity: AuditFindingSeverity): "good" | "warn" | "neutral" | "bad" {
  switch (severity) {
    case "high":
      return "bad";
    case "medium":
    case "low":
      return "warn";
    default:
      return "neutral";
  }
}

export function pageRoleLabel(role: AuditPageRole): string {
  switch (role) {
    case "homepage":
      return "Homepage";
    case "service":
      return "Service";
    case "location":
      return "Location";
    case "about":
      return "About";
    case "contact":
      return "Contact";
    case "testimonials":
      return "Testimonials";
    case "gallery":
      return "Gallery";
    case "blog":
      return "Blog";
    default:
      return "Other";
  }
}

/** Static title of a finding code, owned by the rule catalogue. Unknown codes fall back to the code itself. */
export function findingLabel(code: string): string {
  return FINDING_TEXT[code]?.title ?? code.replace(/_/g, " ");
}

/** Static one-sentence description of a finding code, owned by the rule catalogue. */
export function findingSummary(code: string): string {
  return FINDING_TEXT[code]?.summary ?? "No description is registered for this finding code.";
}

export function formatDurationMs(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

type Tone = "good" | "warn" | "neutral" | "bad";

const CATEGORY_LABELS: Record<ScoreCategoryKey, string> = { technical: "Technical SEO", local_seo: "Local SEO", content_structure: "Content / structure", performance: "Performance", crawl: "Crawl / indexability" };
const CATEGORY_COLUMNS: Record<ScoreCategoryKey, keyof Pick<WebsiteAuditScore, "technical_score" | "local_seo_score" | "content_structure_score" | "performance_score" | "crawl_score">> = { technical: "technical_score", local_seo: "local_seo_score", content_structure: "content_structure_score", performance: "performance_score", crawl: "crawl_score" };

/** How much weight the stored number can bear. A provisional score is for internal use only; an insufficient one has no number at all. */
export function scoreStatusLabel(status: AuditScoreStatus): { headline: string; detail: string; tone: Tone } {
  switch (status) {
    case "complete":
      return { headline: "Complete", detail: "Every category was scored and enough of the audit was measured for the overall score to stand on its own.", tone: "good" };
    case "provisional":
      return { headline: "Provisional · internal only", detail: "Less than 70% of the scoring evidence was measured, or at least one category could not be scored. Do not quote this score externally.", tone: "warn" };
    default:
      return { headline: "Insufficient evidence", detail: "Less than 40% of the scoring evidence was measured, so no overall score is shown.", tone: "neutral" };
  }
}

/** Overall score as displayed. Never shows a bare number for a provisional score, and no number at all without enough evidence. */
export function overallScoreLabel(score: Pick<WebsiteAuditScore, "overall_score" | "score_status">): string {
  if (score.overall_score === null || score.score_status === "insufficient_evidence") return "Not scored";
  return `${score.overall_score} / 100${score.score_status === "provisional" ? " (provisional)" : ""}`;
}

export function categoryScoreRows(score: WebsiteAuditScore): { key: ScoreCategoryKey; label: string; value: string }[] {
  return CATEGORY_ORDER.map((key) => {
    const value = score[CATEGORY_COLUMNS[key]];
    return { key, label: CATEGORY_LABELS[key], value: value === null ? "Not evaluated" : `${value} / ${CATEGORY_WEIGHTS[key]}` };
  });
}

/** One-line state of a performance observation: measured values, or why there are none. */
export function performanceObservationLabel(observation: WebsitePerformanceObservation | undefined): { headline: string; detail: string | null; tone: Tone } {
  if (!observation) return { headline: "Not measured", detail: null, tone: "neutral" };
  if (observation.status === "pending") return { headline: "Pending", detail: observation.attempts > 0 ? `${observation.attempts} request${observation.attempts === 1 ? "" : "s"} so far${observation.error_code ? `; last error ${observation.error_code}` : ""}.` : "Waiting for a worker.", tone: "neutral" };
  if (observation.status === "failed") return { headline: "Unavailable", detail: `${observation.error_code ?? "unknown"}: ${observation.error_summary ?? "The provider request failed."}`, tone: "warn" };
  const tone: Tone = observation.performance_score === null ? "neutral" : observation.performance_score >= 90 ? "good" : observation.performance_score >= 50 ? "warn" : "bad";
  return { headline: observation.performance_score === null ? "Measured" : `${observation.performance_score} / 100`, detail: `LCP ${formatDurationMs(observation.lcp_ms)} · CLS ${observation.cls ?? "—"} · TBT ${formatDurationMs(observation.tbt_ms)} · FCP ${formatDurationMs(observation.fcp_ms)} · Speed Index ${formatDurationMs(observation.speed_index_ms)}`, tone };
}

/** Whether real-user (Core Web Vitals) field data came back. Its absence is normal for small sites and is never scored as a failure. */
export function fieldDataLabel(observations: WebsitePerformanceObservation[]): string {
  const measured = observations.filter((observation) => observation.status === "succeeded");
  if (measured.length === 0) return "Not available (no successful measurement)";
  const withField = measured.filter((observation) => observation.field_data_available);
  if (withField.length === 0) return "Not available for this site (not scored)";
  return withField.map((observation) => `${observation.strategy}: ${observation.field_scope ?? "url"}-level${observation.field_overall_category ? `, ${observation.field_overall_category}` : ""} · LCP ${formatDurationMs(observation.field_lcp_ms)} · INP ${formatDurationMs(observation.field_inp_ms)} · CLS ${observation.field_cls ?? "—"}`).join("; ");
}
