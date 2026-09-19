import { FINDING_TEXT } from "@/audit/findings";
import type { AuditFindingSeverity, AuditPageRole, JobRow, WebsiteAuditRun } from "@/db/types";

// Presentation helpers for website audits. Pure functions; labels describe evidence, never judgement.

export function auditStatusLabel(run: WebsiteAuditRun | null, job: JobRow | null): { headline: string; detail: string | null; tone: "good" | "warn" | "neutral" | "bad" } {
  if (!run) return { headline: "Not audited", detail: "Run a website audit to crawl the verified site and store evidence.", tone: "neutral" };
  if (run.status === "completed") return { headline: "Completed", detail: `${run.pages_succeeded} of ${run.pages_attempted} pages fetched.`, tone: "good" };
  if (run.status === "failed") return { headline: "Failed", detail: run.error_summary ?? job?.last_error ?? "The audit job failed.", tone: "bad" };
  if (run.status === "running") return { headline: "Running", detail: `${run.pages_attempted} page${run.pages_attempted === 1 ? "" : "s"} attempted so far.${job?.status === "failed" ? ` Last attempt failed and will retry: ${job.last_error ?? "unknown error"}.` : ""}`, tone: "neutral" };
  if (job?.status === "dead_letter") return { headline: "Failed", detail: job.last_error ?? "The audit job could not be started.", tone: "bad" };
  return { headline: "Queued", detail: "Waiting for a worker (npm run worker or POST /api/jobs/run).", tone: "neutral" };
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
