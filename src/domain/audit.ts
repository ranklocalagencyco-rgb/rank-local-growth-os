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
    default:
      return "Other";
  }
}

/** Neutral description of a finding code. */
export function findingLabel(code: string): string {
  switch (code) {
    case "missing_title": return "Page has no title";
    case "missing_meta_description": return "Page has no meta description";
    case "missing_h1": return "Page has no H1";
    case "multiple_h1": return "Page has more than one H1";
    case "missing_canonical": return "Page has no canonical link";
    case "page_noindex": return "Page is set to noindex";
    case "missing_viewport": return "Page has no viewport meta tag";
    case "no_structured_data": return "Page has no structured data";
    case "broken_internal_link": return "Internal link returns 404/410";
    case "no_localbusiness_schema": return "No LocalBusiness schema on crawled pages";
    case "no_contact_page_detected": return "No contact page detected";
    case "no_service_pages_detected": return "No service pages detected";
    case "homepage_not_https": return "Homepage does not resolve to HTTPS";
    case "robots_txt_missing": return "robots.txt not reachable";
    case "sitemap_missing": return "No sitemap found";
    default: return code.replace(/_/g, " ");
  }
}

export function formatDurationMs(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}
