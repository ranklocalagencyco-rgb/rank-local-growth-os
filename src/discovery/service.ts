import type { SupabaseClient } from "@supabase/supabase-js";

import { getRuntimeConfig, type RuntimeConfig } from "@/config/env";
import type { Campaign, CampaignRun, Database, DiscoveryCandidate } from "@/db/types";
import { normalizeBusinessName } from "@/domain/crm";
import { hashValue, normalizePhone } from "@/domain/identifiers";
import { dedupeReferences } from "@/discovery/dedupe";
import { planSearches } from "@/discovery/planner";
import { DiscoveryProviderError, type DiscoveryProvider, type DiscoveryProviderName, type DiscoveryReference } from "@/discovery/provider";
import { resolveCandidate, type ProspectMatchRepository, type ResolutionDecision } from "@/discovery/resolver";
import { computeExpiry, getRetentionRule } from "@/discovery/retention";
import type { JobQueue } from "@/jobs/queue";
import { NonRetryableJobError } from "@/jobs/worker";
import type { WebsiteVerificationResult } from "@/verification/website-verifier";

export const DISCOVERY_RUN_JOB = "discovery.run";
export const CANDIDATE_RESOLVE_JOB = "candidate.resolve";

export type DiscoveryRunPayload = { runId: string; campaignId: string; workspaceId: string };
export type CandidateResolvePayload = { candidateId: string; runId: string; workspaceId: string };

export function discoveryRunJobKey(runId: string): string {
  return `${DISCOVERY_RUN_JOB}:${runId}`;
}

export function candidateResolveJobKey(candidateId: string, runId: string): string {
  return `${CANDIDATE_RESOLVE_JOB}:${candidateId}:${runId}`;
}

type Client = SupabaseClient<Database>;

export class DiscoveryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryRequestError";
  }
}

/** Called from the web request. Only writes a run row and enqueues a job; the provider is never called here. */
export async function startDiscoveryRun(client: Client, queue: JobQueue, input: { workspaceId: string; campaignId: string; triggerSource?: string }): Promise<{ runId: string }> {
  const campaign = await client.from("campaigns").select("*").eq("workspace_id", input.workspaceId).eq("id", input.campaignId).maybeSingle();
  if (campaign.error) throw new Error(`Unable to load campaign: ${campaign.error.message}`);
  if (!campaign.data) throw new DiscoveryRequestError("Campaign not found in this workspace.");
  if (campaign.data.target_categories.length === 0 || campaign.data.target_locations.length === 0) {
    throw new DiscoveryRequestError("Add at least one category and one location before running discovery.");
  }

  const active = await client.from("campaign_runs").select("id").eq("campaign_id", input.campaignId).in("status", ["queued", "running"]).limit(1);
  if (active.error) throw new Error(`Unable to check active runs: ${active.error.message}`);
  if (active.data && active.data.length > 0) throw new DiscoveryRequestError("A discovery run is already queued or running for this campaign.");

  const run = await client.from("campaign_runs").insert({ campaign_id: input.campaignId, workspace_id: input.workspaceId, status: "queued", trigger_source: input.triggerSource ?? "operator" }).select("id").single();
  if (run.error) throw new Error(`Unable to create campaign run: ${run.error.message}`);

  const payload: DiscoveryRunPayload = { runId: run.data.id, campaignId: input.campaignId, workspaceId: input.workspaceId };
  await queue.enqueue({ workspaceId: input.workspaceId, jobType: DISCOVERY_RUN_JOB, idempotencyKey: discoveryRunJobKey(run.data.id), payload, maxAttempts: 3 });
  return { runId: run.data.id };
}

export async function markRunFailed(client: Client, runId: string, message: string): Promise<void> {
  await client.from("campaign_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_summary: message.slice(0, 500) }).eq("id", runId).in("status", ["queued", "running"]);
}

type RunDependencies = { client: Client; queue: JobQueue; provider: DiscoveryProvider; config?: RuntimeConfig; now?: () => Date };

/** Worker-side: search the provider, dedupe, persist candidates, and fan out resolution jobs. Safe to retry. */
export async function executeDiscoveryRun(deps: RunDependencies, payload: DiscoveryRunPayload): Promise<{ candidatesSeen: number; enqueued: number }> {
  const { client, queue, provider } = deps;
  const config = deps.config ?? getRuntimeConfig();
  const now = deps.now ?? (() => new Date());

  const runResult = await client.from("campaign_runs").select("*").eq("id", payload.runId).maybeSingle();
  if (runResult.error) throw new Error(`Unable to load run: ${runResult.error.message}`);
  const run = runResult.data;
  if (!run) throw new NonRetryableJobError("Campaign run no longer exists");
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return { candidatesSeen: run.candidates_seen, enqueued: 0 };

  const campaignResult = await client.from("campaigns").select("*").eq("id", payload.campaignId).eq("workspace_id", payload.workspaceId).maybeSingle();
  if (campaignResult.error) throw new Error(`Unable to load campaign: ${campaignResult.error.message}`);
  const campaign = campaignResult.data;
  if (!campaign) throw new NonRetryableJobError("Campaign no longer exists");

  await client.from("campaign_runs").update({ status: "running", started_at: run.started_at ?? now().toISOString() }).eq("id", run.id);

  const plan = planSearches({
    categories: campaign.target_categories,
    locations: campaign.target_locations,
    countryCode: campaign.country_code,
    maxProviderRequests: config.discoveryMaxProviderRequestsPerRun,
    maxCandidates: campaign.daily_candidate_cap ?? config.discoveryMaxCandidatesPerRun,
  });

  const collected: Array<{ reference: DiscoveryReference; query: { category: string; location: string } }> = [];
  let requests = 0;
  let stoppedReason: string | null = null;

  try {
    outer: for (const query of plan.queries) {
      let cursor: string | null = null;
      do {
        if (requests >= plan.maxProviderRequests) { stoppedReason = "request_budget"; break outer; }
        if (collected.length >= plan.maxCandidates) { stoppedReason = "candidate_cap"; break outer; }
        const page = await provider.searchCandidates({ category: query.category, location: query.location, countryCode: campaign.country_code, cursor });
        requests += page.requestCount;
        for (const reference of page.references) collected.push({ reference, query });
        cursor = page.nextCursor;
      } while (cursor);
    }
  } catch (error) {
    if (error instanceof DiscoveryProviderError && !error.retryable) {
      await markRunFailed(client, run.id, `${error.code}: ${error.message}`);
      throw new NonRetryableJobError(error.message);
    }
    await client.from("campaign_runs").update({ search_requests: requests, error_summary: error instanceof Error ? error.message.slice(0, 500) : "Provider error" }).eq("id", run.id);
    throw error;
  }

  const deduped = dedupeReferences(collected.map((entry) => entry.reference));
  const unique = deduped.unique.slice(0, plan.maxCandidates);
  const queryByRef = new Map(collected.map((entry) => [entry.reference.externalRef, entry.query]));
  const retention = getRetentionRule(provider.name, config.discoveryCandidateTtlDays);
  const seenAt = now().toISOString();

  const rows = unique.map((reference) => {
    const query = queryByRef.get(reference.externalRef);
    return {
      workspace_id: payload.workspaceId,
      campaign_id: campaign.id,
      campaign_run_id: run.id,
      provider: reference.provider,
      provider_ref: reference.externalRef,
      status: "active" as const,
      candidate_name: reference.displayName,
      candidate_category: reference.category ?? query?.category ?? null,
      candidate_location: reference.formattedAddress ?? query?.location ?? null,
      candidate_locality: reference.locality,
      candidate_postcode: reference.postcode,
      candidate_phone: reference.phone,
      candidate_website_hint: reference.websiteHint,
      candidate_website_state: reference.websiteHintState,
      candidate_summary_json: { businessStatus: reference.businessStatus, countryCode: reference.countryCode, observedAt: reference.observedAt, attribution: retention.attribution },
      search_query_json: query ?? {},
      retention_class: retention.contentRetention,
      last_seen_at: seenAt,
      expires_at: computeExpiry(retention, now()),
    };
  });

  if (rows.length > 0) {
    const upsert = await client.from("discovery_candidates").upsert(rows, { onConflict: "workspace_id,campaign_id,provider,provider_ref" });
    if (upsert.error) throw new Error(`Unable to store candidates: ${upsert.error.message}`);
  }

  await client
    .from("campaign_runs")
    .update({
      candidates_seen: unique.length,
      search_requests: requests,
      cursor_json: { queriesPlanned: plan.queries.length, stoppedReason, duplicatesCollapsed: deduped.duplicates.length, truncated: deduped.unique.length - unique.length },
    })
    .eq("id", run.id);

  const pending = await client.from("discovery_candidates").select("id").eq("workspace_id", payload.workspaceId).eq("campaign_id", campaign.id).eq("resolution_status", "pending").eq("status", "active");
  if (pending.error) throw new Error(`Unable to list pending candidates: ${pending.error.message}`);

  let enqueued = 0;
  for (const candidate of pending.data ?? []) {
    const resolvePayload: CandidateResolvePayload = { candidateId: candidate.id, runId: run.id, workspaceId: payload.workspaceId };
    const result = await queue.enqueue({ workspaceId: payload.workspaceId, jobType: CANDIDATE_RESOLVE_JOB, idempotencyKey: candidateResolveJobKey(candidate.id, run.id), payload: resolvePayload, maxAttempts: 3 });
    if (result.created) enqueued += 1;
  }

  if ((pending.data ?? []).length === 0) await finalizeRunIfComplete(client, run.id);
  return { candidatesSeen: unique.length, enqueued };
}

type ResolveDependencies = {
  client: Client;
  repository: ProspectMatchRepository;
  verify: (candidate: DiscoveryCandidate) => Promise<WebsiteVerificationResult>;
  now?: () => Date;
};

/** Worker-side: verify website, resolve into a prospect, persist provenance. Idempotent per candidate. */
export async function executeCandidateResolution(deps: ResolveDependencies, payload: CandidateResolvePayload): Promise<ResolutionDecision | null> {
  const { client, repository } = deps;
  const now = deps.now ?? (() => new Date());

  const candidateResult = await client.from("discovery_candidates").select("*").eq("id", payload.candidateId).eq("workspace_id", payload.workspaceId).maybeSingle();
  if (candidateResult.error) throw new Error(`Unable to load candidate: ${candidateResult.error.message}`);
  const candidate = candidateResult.data;
  if (!candidate) throw new NonRetryableJobError("Candidate no longer exists");
  if (candidate.resolution_status !== "pending") return null;

  const provider = candidate.provider as DiscoveryProviderName;
  const summary = candidate.candidate_summary_json as { businessStatus?: string; countryCode?: string | null };
  const countryCode = summary.countryCode ?? "GB";
  const verification = await deps.verify(candidate);

  const decision = await resolveCandidate(
    {
      workspaceId: payload.workspaceId,
      provider,
      externalRef: candidate.provider_ref,
      displayName: candidate.candidate_name,
      phone: candidate.candidate_phone,
      locality: candidate.candidate_locality,
      postcode: candidate.candidate_postcode,
      countryCode,
      businessStatus: (summary.businessStatus as "operational" | "closed_temporarily" | "closed_permanently" | "unknown" | undefined) ?? "unknown",
    },
    verification,
    repository,
  );

  const timestamp = now().toISOString();
  const retention = getRetentionRule(provider);
  let prospectId: string | null = decision.prospectId;

  if (decision.resolution === "created") {
    const displayName = candidate.candidate_name as string;
    const insert = await client
      .from("prospects")
      .insert({
        workspace_id: payload.workspaceId,
        display_name: displayName,
        normalized_name: normalizeBusinessName(displayName),
        canonical_domain: verification.state === "verified_website" ? verification.canonicalDomain : null,
        primary_phone: normalizePhone(candidate.candidate_phone, countryCode),
        country_code: countryCode,
        city: candidate.candidate_locality,
        postcode: candidate.candidate_postcode,
        status: "new",
        pipeline_stage: "new",
      })
      .select("id")
      .single();
    if (insert.error) throw new Error(`Unable to create prospect: ${insert.error.message}`);
    prospectId = insert.data.id;
  }

  if (prospectId) {
    const sourceRef = await client
      .from("prospect_source_refs")
      .upsert(
        {
          workspace_id: payload.workspaceId,
          prospect_id: prospectId,
          provider,
          external_id: candidate.provider_ref,
          source_url: provider === "google_places" ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(candidate.provider_ref)}` : null,
          last_seen_at: timestamp,
          retention_class: retention.referenceRetention,
          metadata: { campaign_id: candidate.campaign_id, last_run_id: payload.runId },
        },
        { onConflict: "workspace_id,provider,external_id" },
      )
      .select("id")
      .single();
    if (sourceRef.error) throw new Error(`Unable to store source reference: ${sourceRef.error.message}`);

    if (decision.resolution === "created") {
      const evidence: Database["public"]["Tables"]["prospect_field_evidence"]["Insert"][] = [];
      evidence.push({ workspace_id: payload.workspaceId, prospect_id: prospectId, field_name: "display_name", value_hash: hashValue(candidate.candidate_name as string), display_value: candidate.candidate_name, source_type: provider, source_ref_id: sourceRef.data.id, observed_at: candidate.last_seen_at, confidence: 0.8, retention_class: retention.contentRetention });
      const phone = normalizePhone(candidate.candidate_phone, countryCode);
      if (phone) evidence.push({ workspace_id: payload.workspaceId, prospect_id: prospectId, field_name: "primary_phone", value_hash: hashValue(phone), display_value: phone, source_type: provider, source_ref_id: sourceRef.data.id, observed_at: candidate.last_seen_at, confidence: 0.8, retention_class: retention.contentRetention });
      if (verification.state === "verified_website" && verification.canonicalDomain) {
        evidence.push({ workspace_id: payload.workspaceId, prospect_id: prospectId, field_name: "canonical_domain", value_hash: hashValue(verification.canonicalDomain), display_value: verification.canonicalDomain, source_type: "website_verification", source_ref_id: null, observed_at: verification.checkedAt, confidence: verification.confidence, retention_class: "canonical_business_data" });
      }
      const evidenceInsert = await client.from("prospect_field_evidence").insert(evidence);
      if (evidenceInsert.error) throw new Error(`Unable to store field evidence: ${evidenceInsert.error.message}`);
    } else if (verification.state === "verified_website" && verification.canonicalDomain) {
      const existing = await client.from("prospects").select("canonical_domain").eq("id", prospectId).single();
      if (!existing.error && !existing.data.canonical_domain) {
        await client.from("prospects").update({ canonical_domain: verification.canonicalDomain }).eq("id", prospectId);
        await client.from("prospect_field_evidence").insert({ workspace_id: payload.workspaceId, prospect_id: prospectId, field_name: "canonical_domain", value_hash: hashValue(verification.canonicalDomain), display_value: verification.canonicalDomain, source_type: "website_verification", observed_at: verification.checkedAt, confidence: verification.confidence, retention_class: "canonical_business_data" });
      }
    }

    await client.from("website_verifications").update({ is_current: false }).eq("prospect_id", prospectId).eq("is_current", true);
  }

  const verificationInsert = await client.from("website_verifications").insert({
    workspace_id: payload.workspaceId,
    prospect_id: prospectId,
    candidate_id: candidate.id,
    state: verification.state,
    verified_url: verification.verifiedUrl,
    canonical_domain: verification.canonicalDomain,
    confidence: verification.confidence,
    evidence_json: verification.evidence,
    method_version: verification.methodVersion,
    is_current: true,
    checked_at: verification.checkedAt,
  });
  if (verificationInsert.error) throw new Error(`Unable to store website verification: ${verificationInsert.error.message}`);

  if (prospectId) {
    await client.from("activity_events").insert({
      workspace_id: payload.workspaceId,
      prospect_id: prospectId,
      campaign_id: candidate.campaign_id,
      event_type: decision.resolution === "created" ? "prospect.created" : "prospect.rediscovered",
      actor_type: "system",
      summary: decision.resolution === "created" ? `Prospect created from ${provider} discovery (website: ${verification.state.replace(/_/g, " ")})` : `Candidate matched to existing prospect via ${decision.matchedIdentifiers.join(", ")}`,
      metadata: { candidate_id: candidate.id, run_id: payload.runId, confidence: decision.confidence, website_state: verification.state },
    });
  }

  const candidateUpdate = await client
    .from("discovery_candidates")
    .update({
      resolution_status: decision.resolution,
      resolved_prospect_id: prospectId,
      resolution_json: { confidence: decision.confidence, matchedIdentifiers: decision.matchedIdentifiers, warnings: decision.warnings, ...("candidateProspectIds" in decision ? { candidateProspectIds: decision.candidateProspectIds } : {}), ...("reasonCode" in decision ? { reasonCode: decision.reasonCode } : {}) },
      resolved_at: timestamp,
    })
    .eq("id", candidate.id)
    .eq("resolution_status", "pending");
  if (candidateUpdate.error) throw new Error(`Unable to update candidate: ${candidateUpdate.error.message}`);

  await finalizeRunIfComplete(client, payload.runId);
  return decision;
}

export async function markCandidateFailed(client: Client, candidateId: string, runId: string, message: string): Promise<void> {
  await client.from("discovery_candidates").update({ resolution_status: "failed", resolution_json: { error: message.slice(0, 300) }, resolved_at: new Date().toISOString() }).eq("id", candidateId).eq("resolution_status", "pending");
  await finalizeRunIfComplete(client, runId);
}

export async function finalizeRunIfComplete(client: Client, runId: string): Promise<boolean> {
  const runResult = await client.from("campaign_runs").select("id, campaign_id, status").eq("id", runId).maybeSingle();
  if (runResult.error || !runResult.data || runResult.data.status !== "running") return false;

  const candidates = await client.from("discovery_candidates").select("resolution_status").eq("campaign_id", runResult.data.campaign_id).eq("campaign_run_id", runId).eq("status", "active");
  if (candidates.error) return false;
  const rows = candidates.data ?? [];
  if (rows.some((row) => row.resolution_status === "pending")) return false;

  const created = rows.filter((row) => row.resolution_status === "created").length;
  const failed = rows.filter((row) => row.resolution_status === "failed").length;
  await client
    .from("campaign_runs")
    .update({ status: "completed", finished_at: new Date().toISOString(), prospects_created: created, error_summary: failed > 0 ? `${failed} candidate${failed === 1 ? "" : "s"} failed resolution` : null })
    .eq("id", runId)
    .eq("status", "running");
  return true;
}

export type CampaignRunSummary = Pick<CampaignRun, "id" | "status" | "candidates_seen" | "prospects_created" | "error_summary">;
export type CampaignSummary = Pick<Campaign, "id" | "name">;
