import type { CampaignRun, CandidateResolutionStatus, DiscoveryCandidate, JobRow, LocalRankObservation, WebsiteState } from "@/db/types";

// Presentation helpers for discovery state. Pure functions; no data access.

/** Human-readable provider name for a stored provider id. */
export function discoveryProviderLabel(provider: string | null | undefined): string {
  switch (provider) {
    case "dataforseo":
      return "DataForSEO";
    case "google_places":
      return "Google Places";
    case null:
    case undefined:
    case "":
      return "Not set";
    default:
      return provider.replace(/_/g, " ");
  }
}

export function discoveryModeLabel(mode: string | null | undefined): string | null {
  switch (mode) {
    case "standard":
      return "standard queue";
    case "priority":
      return "priority queue";
    case "live":
      return "live";
    default:
      return mode ? mode.replace(/_/g, " ") : null;
  }
}

/** Formats a provider-reported USD cost; null when nothing was charged or reported. */
export function formatProviderCost(costUsd: number | null | undefined): string | null {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd <= 0) return null;
  return `$${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

/** "#3 · 4.8 (120 reviews)" style summary of a ranking observation. */
export function rankObservationLabel(observation: Pick<LocalRankObservation, "rank_position" | "rating" | "review_count"> | null | undefined): string | null {
  if (!observation) return null;
  const parts = [`#${observation.rank_position}`];
  if (typeof observation.rating === "number") {
    const reviews = typeof observation.review_count === "number" ? ` (${observation.review_count} review${observation.review_count === 1 ? "" : "s"})` : "";
    parts.push(`${Number(observation.rating).toFixed(1)}${reviews}`);
  }
  return parts.join(" · ");
}

export function websiteStateLabel(state: WebsiteState | null | undefined): string {
  switch (state) {
    case "verified_website":
      return "Verified website";
    case "unverified":
      return "Website unverified";
    case "likely_no_website":
      return "Likely no website";
    case "verified_no_website":
      return "Verified no website";
    default:
      return "Unknown";
  }
}

export function websiteStateTone(state: WebsiteState | null | undefined): "good" | "warn" | "neutral" | "bad" {
  switch (state) {
    case "verified_website":
      return "good";
    case "unverified":
      return "warn";
    case "likely_no_website":
      return "warn";
    case "verified_no_website":
      return "bad";
    default:
      return "neutral";
  }
}

export function candidateHintLabel(hint: DiscoveryCandidate["candidate_website_state"]): string {
  switch (hint) {
    case "present":
      return "Provider lists a URL";
    case "absent":
      return "No URL from provider";
    default:
      return "Unknown";
  }
}

export function resolutionStatusLabel(status: CandidateResolutionStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "created":
      return "Prospect created";
    case "matched":
      return "Matched existing";
    case "ambiguous":
      return "Needs review";
    case "rejected":
      return "Rejected";
    case "failed":
      return "Failed";
  }
}

export function resolutionTone(status: CandidateResolutionStatus): "good" | "warn" | "neutral" | "bad" {
  switch (status) {
    case "created":
    case "matched":
      return "good";
    case "ambiguous":
      return "warn";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

export type DiscoveryStatusSummary = {
  phase: "never_run" | "queued" | "running" | "completed" | "failed";
  headline: string;
  detail: string | null;
};

export function summariseDiscoveryStatus(run: CampaignRun | null, job: JobRow | null): DiscoveryStatusSummary {
  if (!run) return { phase: "never_run", headline: "Not run yet", detail: "Run discovery to search the configured categories and locations." };

  if (run.status === "failed") return { phase: "failed", headline: "Failed", detail: run.error_summary ?? job?.last_error ?? "The discovery job failed." };

  if (run.status === "completed") {
    return { phase: "completed", headline: "Completed", detail: run.error_summary ?? `${run.search_units_completed} of ${run.search_units_total} search units searched.` };
  }

  if (run.status === "running") {
    const jobNote = job?.status === "failed" ? ` Last attempt failed and will retry: ${job.last_error ?? "unknown error"}.` : "";
    return { phase: "running", headline: "Running", detail: `${run.search_units_completed} of ${run.search_units_total} search units searched, ${run.candidates_seen} candidates so far.${jobNote}` };
  }

  if (job?.status === "dead_letter") return { phase: "failed", headline: "Failed", detail: job.last_error ?? "The discovery job could not be started." };
  if (job?.status === "failed") return { phase: "queued", headline: "Queued (retrying)", detail: job.last_error ?? "The last attempt failed; the job will retry." };
  return { phase: "queued", headline: "Queued", detail: "Waiting for a worker to pick up the job. Start the worker with npm run worker or trigger POST /api/jobs/run." };
}

export function countByResolution(candidates: Pick<DiscoveryCandidate, "resolution_status">[]): Record<CandidateResolutionStatus, number> {
  const counts: Record<CandidateResolutionStatus, number> = { pending: 0, created: 0, matched: 0, ambiguous: 0, rejected: 0, failed: 0 };
  for (const candidate of candidates) counts[candidate.resolution_status] += 1;
  return counts;
}
