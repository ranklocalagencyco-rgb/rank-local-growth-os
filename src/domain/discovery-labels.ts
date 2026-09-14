import type { CampaignRunStatus, CandidateResolutionStatus, WebsiteVerificationRow } from "@/db/types";

export function runStatusLabel(status: CampaignRunStatus): string {
  return { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" }[status];
}

export function runStatusTone(status: CampaignRunStatus): "neutral" | "info" | "success" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "running" || status === "queued") return "info";
  return "neutral";
}

export function resolutionLabel(status: CandidateResolutionStatus): string {
  return { pending: "Pending", created: "Prospect created", matched: "Matched existing", ambiguous: "Needs review", rejected: "Rejected", failed: "Failed" }[status];
}

export function resolutionTone(status: CandidateResolutionStatus): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "created":
    case "matched":
      return "success";
    case "ambiguous":
      return "warning";
    case "failed":
      return "danger";
    case "pending":
      return "info";
    default:
      return "neutral";
  }
}

export type WebsiteStateView = { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; detail: string | null };

export function websiteStateView(verification: Pick<WebsiteVerificationRow, "state" | "verified_url" | "canonical_domain" | "confidence"> | null, hintState: "present" | "absent" | "unknown"): WebsiteStateView {
  if (!verification) {
    const hint = { present: "Provider lists a link", absent: "Provider lists no link", unknown: "No provider signal" }[hintState];
    return { label: "Not verified yet", tone: "neutral", detail: hint };
  }
  const confidence = `${Math.round(Number(verification.confidence) * 100)}% confidence`;
  switch (verification.state) {
    case "verified_website":
      return { label: "Verified website", tone: "success", detail: `${verification.canonical_domain ?? verification.verified_url ?? ""} · ${confidence}` };
    case "verified_no_website":
      return { label: "Verified no website", tone: "warning", detail: confidence };
    case "social_profile_only":
      return { label: "Social/directory profile only", tone: "warning", detail: confidence };
    case "unverified_website":
      return { label: "Link found, unverified", tone: "info", detail: confidence };
    default:
      return { label: "Unknown", tone: "neutral", detail: confidence };
  }
}

export function shortRef(ref: string): string {
  return ref.length > 14 ? `${ref.slice(0, 8)}…${ref.slice(-4)}` : ref;
}
