import type { AuditFindingInsert, AuditPageInsert, AuditRunPatch, AuditStore } from "@/audit/store";
import type { WebsiteAuditRun } from "@/db/types";
import { deterministicUuid } from "@/domain/deterministic-id";
import { enqueueJob, type DbClient } from "@/jobs/queue";

// Supabase-backed AuditStore. Every write is idempotent (deterministic ids + on-conflict ignore) so a retried job never duplicates evidence.

export function auditPageId(runId: string, requestedUrl: string): string {
  return deterministicUuid("audit_page", `${runId}:${requestedUrl}`);
}

export function auditFindingId(runId: string, pageId: string | null, code: string): string {
  return deterministicUuid("audit_finding", `${runId}:${pageId ?? "site"}:${code}`);
}

function runPatchToRow(patch: AuditRunPatch): Partial<WebsiteAuditRun> {
  const row: Partial<WebsiteAuditRun> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.jobId !== undefined) row.job_id = patch.jobId;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  if (patch.failedAt !== undefined) row.failed_at = patch.failedAt;
  if (patch.pagesAttempted !== undefined) row.pages_attempted = patch.pagesAttempted;
  if (patch.pagesSucceeded !== undefined) row.pages_succeeded = patch.pagesSucceeded;
  if (patch.pagesFailed !== undefined) row.pages_failed = patch.pagesFailed;
  if (patch.errorSummary !== undefined) row.error_summary = patch.errorSummary;
  if (patch.siteSummary !== undefined) row.site_summary_json = patch.siteSummary;
  if (patch.crawlState !== undefined) row.crawl_state_json = patch.crawlState;
  return row;
}

export function createSupabaseAuditStore(client: DbClient): AuditStore {
  return {
    async getRun(workspaceId, runId) {
      const { data, error } = await client.from("website_audit_runs").select("*").eq("workspace_id", workspaceId).eq("id", runId).maybeSingle();
      if (error) throw new Error(`Unable to load audit run: ${error.message}`);
      return data;
    },

    async getProspect(workspaceId, prospectId) {
      const { data, error } = await client.from("prospects").select("id,workspace_id,display_name,website_state,website_url,canonical_domain").eq("workspace_id", workspaceId).eq("id", prospectId).maybeSingle();
      if (error) throw new Error(`Unable to load prospect: ${error.message}`);
      return data;
    },

    async updateRun(runId, patch) {
      const { error } = await client.from("website_audit_runs").update(runPatchToRow(patch)).eq("id", runId);
      if (error) throw new Error(`Unable to update audit run: ${error.message}`);
    },

    async insertPage(page: AuditPageInsert) {
      const id = auditPageId(page.audit_run_id, page.requested_url);
      const { error } = await client.from("website_audit_pages").upsert({ id, ...page }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Unable to store audit page: ${error.message}`);
      return { id };
    },

    async listPages(runId) {
      const { data, error } = await client.from("website_audit_pages").select("*").eq("audit_run_id", runId).order("fetched_at", { ascending: true });
      if (error) throw new Error(`Unable to load audit pages: ${error.message}`);
      return data ?? [];
    },

    async insertFindings(rows: AuditFindingInsert[]) {
      if (rows.length === 0) return;
      const { error } = await client.from("website_audit_findings").upsert(
        rows.map((row) => ({ id: auditFindingId(row.auditRunId, row.pageId, row.code), workspace_id: row.workspaceId, audit_run_id: row.auditRunId, prospect_id: row.prospectId, page_id: row.pageId, scope: row.scope, code: row.code, severity: row.severity, evidence_json: row.evidence, rule_version: row.ruleVersion })),
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`Unable to store audit findings: ${error.message}`);
    },

    async enqueue(input) {
      await enqueueJob(client, input);
    },

    async recordActivity(input) {
      const { error } = await client.from("activity_events").upsert(
        { id: deterministicUuid("activity_event", input.idempotencyKey), workspace_id: input.workspaceId, campaign_id: null, prospect_id: input.prospectId, event_type: input.eventType, actor_type: "system", summary: input.summary, metadata: input.metadata ?? {} },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`Unable to record activity: ${error.message}`);
    },

    async recordDomainEvent(input) {
      const { error } = await client.from("domain_events").upsert(
        { workspace_id: input.workspaceId, aggregate_type: input.aggregateType, aggregate_id: input.aggregateId, event_type: input.eventType, idempotency_key: input.idempotencyKey, payload: input.payload },
        { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true },
      );
      if (error) throw new Error(`Unable to record domain event: ${error.message}`);
    },
  };
}
