import { AUDIT_CRAWLER_VERSION } from "@/audit/extract";
import { AUDIT_RULES_VERSION } from "@/audit/findings";
import { auditJobIdempotencyKey, isAuditEligible, WEBSITE_AUDIT_JOB } from "@/audit/jobs";
import { deterministicUuid } from "@/domain/deterministic-id";
import { normalizeDomain } from "@/domain/identifiers";
import { enqueueJob, type DbClient } from "@/jobs/queue";
import { createTraceId } from "@/logging/logger";

export class AuditRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditRequestError";
  }
}

export type AuditRunRequest = { workspaceId: string; prospectId: string; userId: string };

/** Creates an audit run for an eligible prospect and enqueues the durable job. Returns immediately. */
export async function requestWebsiteAudit(client: DbClient, request: AuditRunRequest): Promise<{ runId: string; jobId: string }> {
  const prospect = await client.from("prospects").select("id,workspace_id,display_name,website_state,website_url,canonical_domain").eq("workspace_id", request.workspaceId).eq("id", request.prospectId).maybeSingle();
  if (prospect.error) throw new Error(`Unable to load prospect: ${prospect.error.message}`);
  if (!prospect.data) throw new AuditRequestError("Prospect not found in this workspace.");
  if (!isAuditEligible(prospect.data)) throw new AuditRequestError("Only prospects with a verified website can be audited.");

  const websiteUrl = prospect.data.website_url as string;
  const canonicalDomain = normalizeDomain(websiteUrl) ?? prospect.data.canonical_domain;
  if (!canonicalDomain) throw new AuditRequestError("The prospect website has no usable domain.");

  const active = await client.from("website_audit_runs").select("id").eq("prospect_id", prospect.data.id).in("status", ["queued", "running"]).limit(1);
  if (active.error) throw new Error(`Unable to check existing audits: ${active.error.message}`);
  if (active.data && active.data.length > 0) throw new AuditRequestError("An audit is already queued or running for this prospect.");

  const traceId = createTraceId();
  const run = await client
    .from("website_audit_runs")
    .insert({ workspace_id: request.workspaceId, prospect_id: prospect.data.id, requested_by: request.userId, status: "queued", website_url: websiteUrl, canonical_domain: canonicalDomain, crawler_version: AUDIT_CRAWLER_VERSION, rules_version: AUDIT_RULES_VERSION })
    .select("id")
    .single();
  if (run.error) {
    if (run.error.code === "23505") throw new AuditRequestError("An audit is already queued or running for this prospect.");
    throw new Error(`Unable to create audit run: ${run.error.message}`);
  }

  const { job } = await enqueueJob(client, { workspaceId: request.workspaceId, type: WEBSITE_AUDIT_JOB, idempotencyKey: auditJobIdempotencyKey(run.data.id), payload: { auditRunId: run.data.id, prospectId: prospect.data.id }, maxAttempts: 4, traceId });
  const link = await client.from("website_audit_runs").update({ job_id: job.id }).eq("id", run.data.id);
  if (link.error) throw new Error(`Unable to link audit run to job: ${link.error.message}`);

  await client.from("activity_events").upsert(
    { id: deterministicUuid("activity_event", `audit.requested:${run.data.id}`), workspace_id: request.workspaceId, campaign_id: null, prospect_id: prospect.data.id, event_type: "audit.requested", actor_type: "user", actor_id: request.userId, summary: `Website audit requested for ${canonicalDomain}.`, metadata: { auditRunId: run.data.id, jobId: job.id } },
    { onConflict: "id", ignoreDuplicates: true },
  );
  await client.from("domain_events").upsert(
    { workspace_id: request.workspaceId, aggregate_type: "website_audit_run", aggregate_id: run.data.id, event_type: "audit.requested", idempotency_key: `audit.requested:${run.data.id}`, payload: { prospectId: prospect.data.id, jobId: job.id, websiteUrl } },
    { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true },
  );
  return { runId: run.data.id, jobId: job.id };
}
