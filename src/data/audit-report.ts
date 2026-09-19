import { getSupabaseAdminClient } from "@/db/client";
import type { AuditReportData, ReportPageRow } from "@/report/model";

// Everything the client-facing audit report needs, in two round trips: the run, then the five dependent reads in parallel.
// Read-only. Every query is scoped to the caller's workspace, so a run id from another workspace is indistinguishable from a
// missing one. Components never query; they receive the model built from this result (src/report/model.ts).

export type AuditReportLoad = { status: "not_configured" } | { status: "not_found" } | { status: "ok"; data: AuditReportData };

/** Postgres / PostgREST codes for "relation does not exist": migration 008 has not been applied yet. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getAuditReportData(workspaceId: string, auditRunId: string): Promise<AuditReportLoad> {
  const client = getSupabaseAdminClient();
  if (!client) return { status: "not_configured" };
  // A malformed id would make Postgres raise instead of returning no row.
  if (!UUID.test(auditRunId)) return { status: "not_found" };

  const run = await client.from("website_audit_runs").select("*").eq("workspace_id", workspaceId).eq("id", auditRunId).maybeSingle();
  if (run.error) throw new Error(`Unable to load audit run: ${run.error.message}`);
  if (!run.data) return { status: "not_found" };

  const [prospect, pages, findings, observations, score] = await Promise.all([
    client.from("prospects").select("id,display_name,canonical_domain,website_url").eq("workspace_id", workspaceId).eq("id", run.data.prospect_id).maybeSingle(),
    // Only what the report reads. Of the page evidence it needs the challenge provenance alone, not the stored links, NAP or schema.
    client.from("website_audit_pages").select("id,path,requested_url,page_role,fetch_ok,http_status,content_type,challenge:evidence_json->challenge").eq("workspace_id", workspaceId).eq("audit_run_id", run.data.id).order("fetched_at", { ascending: true }),
    client.from("website_audit_findings").select("*").eq("workspace_id", workspaceId).eq("audit_run_id", run.data.id),
    client.from("website_performance_observations").select("*").eq("workspace_id", workspaceId).eq("audit_run_id", run.data.id),
    client.from("website_audit_scores").select("*").eq("workspace_id", workspaceId).eq("audit_run_id", run.data.id).order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (prospect.error) throw new Error(`Unable to load prospect: ${prospect.error.message}`);
  if (pages.error) throw new Error(`Unable to load audit pages: ${pages.error.message}`);
  if (findings.error) throw new Error(`Unable to load audit findings: ${findings.error.message}`);
  if (observations.error && !isMissingTable(observations.error)) throw new Error(`Unable to load performance observations: ${observations.error.message}`);
  if (score.error && !isMissingTable(score.error)) throw new Error(`Unable to load audit score: ${score.error.message}`);

  const pageRows = ((pages.data ?? []) as unknown as (Omit<ReportPageRow, "evidence_json"> & { challenge: unknown })[]).map(({ challenge, ...row }): ReportPageRow => ({ ...row, evidence_json: challenge ? { challenge } : {} }));
  return { status: "ok", data: { run: run.data, prospect: prospect.data ?? null, pages: pageRows, findings: findings.data ?? [], observations: observations.error ? [] : observations.data ?? [], score: score.error ? null : score.data ?? null } };
}
