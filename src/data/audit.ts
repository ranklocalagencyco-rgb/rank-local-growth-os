import { WEBSITE_AUDIT_JOB } from "@/audit/jobs";
import { getSupabaseAdminClient } from "@/db/client";
import type { JobRow, WebsiteAuditFinding, WebsiteAuditPage, WebsiteAuditRun, WebsiteAuditScore, WebsitePerformanceObservation } from "@/db/types";

export type ProspectAuditDetail = {
  runs: WebsiteAuditRun[];
  latestRun: WebsiteAuditRun | null;
  latestJob: JobRow | null;
  pages: WebsiteAuditPage[];
  findings: WebsiteAuditFinding[];
  /** Performance observations of the latest run (any status). */
  performance: WebsitePerformanceObservation[];
  /** Newest stored score of the latest run. Scores are immutable; a newer scoring version adds a row. */
  score: WebsiteAuditScore | null;
  /** False until migration 008 is applied; the page then hides the score panel instead of failing. */
  scoringAvailable: boolean;
};

const EMPTY: ProspectAuditDetail = { runs: [], latestRun: null, latestJob: null, pages: [], findings: [], performance: [], score: null, scoringAvailable: true };

/** Postgres / PostgREST codes for "relation does not exist": the migration that adds the table has not been applied yet. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** Latest audit runs for a prospect, with the pages and findings of the most recent run. */
export async function getProspectAuditDetail(workspaceId: string, prospectId: string): Promise<ProspectAuditDetail> {
  const client = getSupabaseAdminClient();
  if (!client) return EMPTY;

  const runs = await client.from("website_audit_runs").select("*").eq("workspace_id", workspaceId).eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(5);
  if (runs.error) throw new Error(`Unable to load audit runs: ${runs.error.message}`);
  const latestRun = runs.data?.[0] ?? null;
  if (!latestRun) return { ...EMPTY, runs: [] };

  const [pages, findings, job, performance, score] = await Promise.all([
    client.from("website_audit_pages").select("*").eq("audit_run_id", latestRun.id).order("fetched_at", { ascending: true }),
    client.from("website_audit_findings").select("*").eq("audit_run_id", latestRun.id).order("severity", { ascending: true }),
    latestRun.job_id ? client.from("jobs").select("*").eq("workspace_id", workspaceId).eq("type", WEBSITE_AUDIT_JOB).eq("id", latestRun.job_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    client.from("website_performance_observations").select("*").eq("audit_run_id", latestRun.id).order("strategy", { ascending: false }),
    client.from("website_audit_scores").select("*").eq("audit_run_id", latestRun.id).order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (pages.error) throw new Error(`Unable to load audit pages: ${pages.error.message}`);
  if (findings.error) throw new Error(`Unable to load audit findings: ${findings.error.message}`);
  if (job.error) throw new Error(`Unable to load audit job: ${job.error.message}`);

  const scoringAvailable = !isMissingTable(performance.error) && !isMissingTable(score.error);
  if (scoringAvailable && performance.error) throw new Error(`Unable to load performance observations: ${performance.error.message}`);
  if (scoringAvailable && score.error) throw new Error(`Unable to load audit score: ${score.error.message}`);

  return { runs: runs.data ?? [], latestRun, latestJob: job.data ?? null, pages: pages.data ?? [], findings: findings.data ?? [], performance: scoringAvailable ? performance.data ?? [] : [], score: scoringAvailable ? score.data ?? null : null, scoringAvailable };
}
