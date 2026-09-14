import { discoveryRunIdempotencyKey, DISCOVERY_RUN_JOB } from "@/discovery/jobs";
import { buildSearchUnits } from "@/discovery/search-plan";
import { deterministicUuid } from "@/domain/deterministic-id";
import { enqueueJob, type DbClient } from "@/jobs/queue";
import { createTraceId } from "@/logging/logger";

export class DiscoveryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryRequestError";
  }
}

export type DiscoveryRunRequest = { workspaceId: string; campaignId: string; userId: string };

/** Creates a campaign run and enqueues the durable discovery job. Returns immediately. */
export async function requestDiscoveryRun(client: DbClient, request: DiscoveryRunRequest): Promise<{ runId: string; jobId: string }> {
  const campaign = await client.from("campaigns").select("*").eq("workspace_id", request.workspaceId).eq("id", request.campaignId).maybeSingle();
  if (campaign.error) throw new Error(`Unable to load campaign: ${campaign.error.message}`);
  if (!campaign.data) throw new DiscoveryRequestError("Campaign not found in this workspace.");

  const units = buildSearchUnits(campaign.data);
  if (units.length === 0) throw new DiscoveryRequestError("Add at least one category and one location to the campaign before running discovery.");

  const active = await client.from("campaign_runs").select("id").eq("campaign_id", campaign.data.id).in("status", ["queued", "running"]).limit(1);
  if (active.error) throw new Error(`Unable to check existing runs: ${active.error.message}`);
  if (active.data && active.data.length > 0) throw new DiscoveryRequestError("A discovery run is already queued or running for this campaign.");

  const traceId = createTraceId();
  const run = await client
    .from("campaign_runs")
    .insert({ campaign_id: campaign.data.id, workspace_id: request.workspaceId, run_type: "discovery", requested_by: request.userId, status: "queued", search_units_total: units.length, cursor_json: {} })
    .select("id")
    .single();
  if (run.error) throw new Error(`Unable to create campaign run: ${run.error.message}`);

  const { job } = await enqueueJob(client, {
    workspaceId: request.workspaceId,
    type: DISCOVERY_RUN_JOB,
    idempotencyKey: discoveryRunIdempotencyKey(run.data.id),
    payload: { campaignRunId: run.data.id, campaignId: campaign.data.id },
    maxAttempts: 5,
    traceId,
  });

  const link = await client.from("campaign_runs").update({ job_id: job.id }).eq("id", run.data.id);
  if (link.error) throw new Error(`Unable to link run to job: ${link.error.message}`);

  await client.from("activity_events").upsert(
    { id: deterministicUuid("activity_event", `campaign.run_requested:${run.data.id}`), workspace_id: request.workspaceId, campaign_id: campaign.data.id, prospect_id: null, event_type: "campaign.run_requested", actor_type: "user", actor_id: request.userId, summary: `Discovery run requested (${units.length} search unit${units.length === 1 ? "" : "s"}).`, metadata: { campaignRunId: run.data.id, jobId: job.id } },
    { onConflict: "id", ignoreDuplicates: true },
  );
  await client.from("domain_events").upsert(
    { workspace_id: request.workspaceId, aggregate_type: "campaign", aggregate_id: campaign.data.id, event_type: "campaign.run_requested", idempotency_key: `campaign.run_requested:${run.data.id}`, payload: { campaignRunId: run.data.id, jobId: job.id } },
    { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true },
  );

  return { runId: run.data.id, jobId: job.id };
}
