import type { Campaign, CampaignRun, DiscoveryCandidate, LocalRankObservation, ProspectFieldEvidence } from "@/db/types";
import type { ExistingProspectMatch, ResolutionLookup } from "@/discovery/resolver";
import type { AttachProspectInput, CampaignRunPatch, CandidateInsert, CandidatePatch, CreateProspectInput, DiscoveryStore, RankObservationInsert } from "@/discovery/store";
import type { WebsiteVerification } from "@/discovery/website/verify";
import { deterministicUuid, valueHash } from "@/domain/deterministic-id";
import { normalizeLocality } from "@/domain/identifiers";
import { enqueueJob, type DbClient } from "@/jobs/queue";

// Supabase-backed DiscoveryStore. Every write is idempotent (deterministic ids + on-conflict ignore)
// so a retried job never duplicates CRM records.

const PROVIDER_CONTENT_RETENTION = "provider_restricted_data";

function candidateLocation(input: CandidateInsert["input"]): string | null {
  return [input.locality, input.postcode].filter(Boolean).join(", ") || input.formattedAddress;
}

function runPatchToRow(patch: CampaignRunPatch): Partial<CampaignRun> {
  const row: Partial<CampaignRun> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt;
  if (patch.cursor !== undefined) row.cursor_json = patch.cursor;
  if (patch.candidatesSeen !== undefined) row.candidates_seen = patch.candidatesSeen;
  if (patch.searchUnitsTotal !== undefined) row.search_units_total = patch.searchUnitsTotal;
  if (patch.searchUnitsCompleted !== undefined) row.search_units_completed = patch.searchUnitsCompleted;
  if (patch.providerRequests !== undefined) row.provider_requests = patch.providerRequests;
  if (patch.providerCostUsd !== undefined) row.provider_cost_usd = Math.round(patch.providerCostUsd * 1_000_000) / 1_000_000;
  if (patch.provider !== undefined) row.provider = patch.provider;
  if (patch.providerMode !== undefined) row.provider_mode = patch.providerMode;
  if (patch.errorSummary !== undefined) row.error_summary = patch.errorSummary;
  return row;
}

/** Deterministic id so a retried page never records the same observation twice. */
export function rankObservationId(row: Pick<RankObservationInsert, "campaignRunId" | "provider" | "providerRef" | "category" | "location">): string {
  return deterministicUuid("rank_observation", `${row.campaignRunId}:${row.provider}:${row.providerRef}:${row.category}:${row.location}`);
}

function rankObservationRow(row: RankObservationInsert): Partial<LocalRankObservation> {
  return {
    id: rankObservationId(row),
    workspace_id: row.workspaceId,
    campaign_id: row.campaignId,
    campaign_run_id: row.campaignRunId,
    candidate_id: row.candidateId,
    prospect_id: row.prospectId,
    provider: row.provider,
    provider_ref: row.providerRef,
    search_category: row.category,
    search_location: row.location,
    country_code: row.countryCode,
    rank_position: row.position,
    rank_absolute: row.absolutePosition,
    rating: row.rating,
    review_count: row.reviewCount,
    observed_at: row.observedAt,
  };
}

function candidatePatchToRow(patch: CandidatePatch): Partial<DiscoveryCandidate> {
  const row: Partial<DiscoveryCandidate> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.resolutionStatus !== undefined) row.resolution_status = patch.resolutionStatus;
  if (patch.resolutionConfidence !== undefined) row.resolution_confidence = patch.resolutionConfidence;
  if (patch.resolutionNotes !== undefined) row.resolution_notes_json = patch.resolutionNotes;
  if (patch.resolvedProspectId !== undefined) row.resolved_prospect_id = patch.resolvedProspectId;
  if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
  if (patch.websiteHintState !== undefined) row.candidate_website_state = patch.websiteHintState;
  if (patch.summary !== undefined) {
    row.candidate_summary_json = patch.summary as unknown as Record<string, unknown>;
    row.candidate_name = patch.summary.displayName;
    row.candidate_category = patch.summary.primaryCategory;
    row.candidate_location = candidateLocation(patch.summary);
    row.content_purged_at = null;
  }
  return row;
}

type FieldEvidenceInput = { field: string; value: string | null; sourceType: string; retention: string; confidence: number };

function fieldEvidenceRows(input: { workspaceId: string; prospectId: string; sourceRefId: string | null; observedAt: string; fields: FieldEvidenceInput[] }): Partial<ProspectFieldEvidence>[] {
  return input.fields
    .filter((field): field is FieldEvidenceInput & { value: string } => Boolean(field.value))
    .map((field) => {
      const hash = valueHash(field.value);
      return {
        id: deterministicUuid("field_evidence", `${input.prospectId}:${field.field}:${hash}`),
        workspace_id: input.workspaceId,
        prospect_id: input.prospectId,
        field_name: field.field,
        value_hash: hash,
        display_value: field.value,
        source_type: field.sourceType,
        source_ref_id: input.sourceRefId,
        observed_at: input.observedAt,
        confidence: field.confidence,
        retention_class: field.retention,
        is_current: true,
      };
    });
}

function websiteSourceType(verification: WebsiteVerification): string {
  return verification.signals.some((signal) => signal.source === "http_probe" && signal.kind === "reachable") ? "http_probe" : "discovery_provider";
}

export function createSupabaseDiscoveryStore(client: DbClient): DiscoveryStore {
  async function upsertSourceRef(input: { workspaceId: string; prospectId: string; provider: string; externalId: string; now: string }): Promise<string> {
    const id = deterministicUuid("source_ref", `${input.workspaceId}:${input.provider}:${input.externalId}`);
    const insert = await client.from("prospect_source_refs").upsert(
      { id, workspace_id: input.workspaceId, prospect_id: input.prospectId, provider: input.provider, external_id: input.externalId, first_seen_at: input.now, last_seen_at: input.now, retention_class: "source_reference", metadata: {} },
      { onConflict: "workspace_id,provider,external_id", ignoreDuplicates: true },
    );
    if (insert.error) throw new Error(`Unable to record source reference: ${insert.error.message}`);

    const existing = await client.from("prospect_source_refs").select("id").eq("workspace_id", input.workspaceId).eq("provider", input.provider).eq("external_id", input.externalId).single();
    if (existing.error) throw new Error(`Unable to load source reference: ${existing.error.message}`);
    await client.from("prospect_source_refs").update({ last_seen_at: input.now }).eq("id", existing.data.id);
    return existing.data.id;
  }

  /** Points every observation recorded for a candidate at the prospect it resolved to. */
  async function linkRankObservations(candidateId: string, prospectId: string): Promise<void> {
    const { error } = await client.from("local_rank_observations").update({ prospect_id: prospectId }).eq("candidate_id", candidateId).is("prospect_id", null);
    if (error) throw new Error(`Unable to link ranking observations: ${error.message}`);
  }

  async function recordVerification(input: { workspaceId: string; prospectId: string; candidateId: string; verification: WebsiteVerification; now: string }): Promise<void> {
    const { verification } = input;
    const retire = await client.from("prospect_website_verifications").update({ is_current: false }).eq("prospect_id", input.prospectId).eq("is_current", true);
    if (retire.error) throw new Error(`Unable to retire previous verification: ${retire.error.message}`);

    const insert = await client.from("prospect_website_verifications").upsert(
      {
        id: deterministicUuid("website_verification", `${input.prospectId}:${input.candidateId}:${verification.verifierVersion}`),
        workspace_id: input.workspaceId,
        prospect_id: input.prospectId,
        candidate_id: input.candidateId,
        state: verification.state,
        website_url: verification.websiteUrl,
        canonical_domain: verification.canonicalDomain,
        confidence: verification.confidence,
        signals_json: verification.signals,
        verifier_version: verification.verifierVersion,
        verified_at: input.now,
        is_current: true,
      },
      { onConflict: "id" },
    );
    if (insert.error) throw new Error(`Unable to record website verification: ${insert.error.message}`);

    const update = await client
      .from("prospects")
      .update({ website_state: verification.state, website_url: verification.websiteUrl, website_verified_at: input.now, ...(verification.state === "verified_website" && verification.canonicalDomain ? { canonical_domain: verification.canonicalDomain } : {}) })
      .eq("id", input.prospectId);
    if (update.error) throw new Error(`Unable to update prospect website state: ${update.error.message}`);
  }

  return {
    async getCampaign(workspaceId, campaignId): Promise<Campaign | null> {
      const { data, error } = await client.from("campaigns").select("*").eq("workspace_id", workspaceId).eq("id", campaignId).maybeSingle();
      if (error) throw new Error(`Unable to load campaign: ${error.message}`);
      return data;
    },

    async getCampaignRun(workspaceId, runId) {
      const { data, error } = await client.from("campaign_runs").select("*").eq("workspace_id", workspaceId).eq("id", runId).maybeSingle();
      if (error) throw new Error(`Unable to load campaign run: ${error.message}`);
      return data;
    },

    async updateCampaignRun(runId, patch) {
      const { error } = await client.from("campaign_runs").update(runPatchToRow(patch)).eq("id", runId);
      if (error) throw new Error(`Unable to update campaign run: ${error.message}`);
    },

    async findKnownCandidates(campaignId, keys) {
      const known = new Map<string, Pick<DiscoveryCandidate, "id" | "resolution_status" | "resolved_prospect_id">>();
      if (keys.length === 0) return known;
      const refs = keys.map((key) => key.slice(key.indexOf(":") + 1));
      const { data, error } = await client.from("discovery_candidates").select("id,provider,provider_ref,resolution_status,resolved_prospect_id").eq("campaign_id", campaignId).in("provider_ref", refs);
      if (error) throw new Error(`Unable to load known candidates: ${error.message}`);
      for (const row of data ?? []) known.set(`${row.provider}:${row.provider_ref}`, { id: row.id, resolution_status: row.resolution_status, resolved_prospect_id: row.resolved_prospect_id });
      return known;
    },

    async insertCandidates(rows) {
      if (rows.length === 0) return [];
      const { data, error } = await client
        .from("discovery_candidates")
        .upsert(
          rows.map((row) => ({
            workspace_id: row.workspaceId,
            campaign_id: row.campaignId,
            campaign_run_id: row.campaignRunId,
            provider: row.input.provider,
            provider_ref: row.input.providerRef,
            status: "new" as const,
            candidate_name: row.input.displayName,
            candidate_category: row.input.primaryCategory,
            candidate_location: candidateLocation(row.input),
            candidate_website_state: row.input.websiteHintState,
            candidate_summary_json: row.input as unknown as Record<string, unknown>,
            dedupe_key: `${row.input.provider}:${row.input.providerRef}`,
            source_query_json: row.sourceQuery,
            retention_class: PROVIDER_CONTENT_RETENTION,
            first_seen_at: row.input.observedAt,
            last_seen_at: row.input.observedAt,
            expires_at: row.expiresAt,
          })),
          { onConflict: "campaign_id,provider,provider_ref", ignoreDuplicates: true },
        )
        .select("id,provider,provider_ref");
      if (error) throw new Error(`Unable to store discovery candidates: ${error.message}`);
      return data ?? [];
    },

    async touchCandidates(candidateIds, campaignRunId, lastSeenAt) {
      if (candidateIds.length === 0) return;
      const { error } = await client.from("discovery_candidates").update({ last_seen_at: lastSeenAt }).in("id", candidateIds);
      if (error) throw new Error(`Unable to update candidate sightings: ${error.message}`);
      void campaignRunId;
    },

    async getCandidate(workspaceId, candidateId) {
      const { data, error } = await client.from("discovery_candidates").select("*").eq("workspace_id", workspaceId).eq("id", candidateId).maybeSingle();
      if (error) throw new Error(`Unable to load candidate: ${error.message}`);
      return data;
    },

    async updateCandidate(candidateId, patch) {
      const { error } = await client.from("discovery_candidates").update(candidatePatchToRow(patch)).eq("id", candidateId);
      if (error) throw new Error(`Unable to update candidate: ${error.message}`);
    },

    async recordRankObservations(rows) {
      if (rows.length === 0) return;
      const { error } = await client.from("local_rank_observations").upsert(rows.map(rankObservationRow), { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Unable to record ranking observations: ${error.message}`);
    },

    async findMatches(lookup: ResolutionLookup): Promise<ExistingProspectMatch[]> {
      const matches: ExistingProspectMatch[] = [];

      const sourceRefs = await client.from("prospect_source_refs").select("prospect_id").eq("workspace_id", lookup.workspaceId).eq("provider", lookup.provider).eq("external_id", lookup.providerRef);
      if (sourceRefs.error) throw new Error(`Unable to match source references: ${sourceRefs.error.message}`);
      for (const row of sourceRefs.data ?? []) matches.push({ prospectId: row.prospect_id, matchedBy: "source_ref" });

      if (lookup.canonicalDomain) {
        const byDomain = await client.from("prospects").select("id").eq("workspace_id", lookup.workspaceId).eq("canonical_domain", lookup.canonicalDomain);
        if (byDomain.error) throw new Error(`Unable to match domains: ${byDomain.error.message}`);
        for (const row of byDomain.data ?? []) matches.push({ prospectId: row.id, matchedBy: "domain" });
      }

      if (lookup.normalizedPhone) {
        const byPhone = await client.from("prospects").select("id").eq("workspace_id", lookup.workspaceId).eq("primary_phone", lookup.normalizedPhone);
        if (byPhone.error) throw new Error(`Unable to match phones: ${byPhone.error.message}`);
        for (const row of byPhone.data ?? []) matches.push({ prospectId: row.id, matchedBy: "phone" });
      }

      if (lookup.normalizedName && lookup.locality) {
        const byName = await client.from("prospects").select("id,city").eq("workspace_id", lookup.workspaceId).eq("normalized_name", lookup.normalizedName);
        if (byName.error) throw new Error(`Unable to match names: ${byName.error.message}`);
        for (const row of byName.data ?? []) {
          if (normalizeLocality(row.city) === lookup.locality) matches.push({ prospectId: row.id, matchedBy: "name_locality" });
        }
      }

      return matches;
    },

    async createProspect(input: CreateProspectInput) {
      const { candidate, details, record, verification, now } = input;
      const prospectId = deterministicUuid("prospect", candidate.id);

      const insert = await client.from("prospects").upsert(
        {
          id: prospectId,
          workspace_id: record.workspaceId,
          display_name: record.displayName,
          normalized_name: record.normalizedName,
          canonical_domain: record.canonicalDomain,
          primary_phone: record.primaryPhone,
          country_code: record.countryCode,
          region: record.region,
          city: record.city,
          postcode: record.postcode,
          website_state: record.websiteState,
          website_url: record.websiteUrl,
          website_verified_at: now,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (insert.error) throw new Error(`Unable to create prospect: ${insert.error.message}`);

      const sourceRefId = await upsertSourceRef({ workspaceId: record.workspaceId, prospectId, provider: details.provider, externalId: details.providerRef, now });

      const evidence = fieldEvidenceRows({
        workspaceId: record.workspaceId,
        prospectId,
        sourceRefId,
        observedAt: now,
        fields: [
          { field: "display_name", value: record.displayName, sourceType: details.provider, retention: PROVIDER_CONTENT_RETENTION, confidence: 0.7 },
          { field: "primary_phone", value: record.primaryPhone, sourceType: details.provider, retention: PROVIDER_CONTENT_RETENTION, confidence: 0.7 },
          { field: "city", value: record.city, sourceType: details.provider, retention: PROVIDER_CONTENT_RETENTION, confidence: 0.7 },
          { field: "postcode", value: record.postcode, sourceType: details.provider, retention: PROVIDER_CONTENT_RETENTION, confidence: 0.7 },
          { field: "region", value: record.region, sourceType: details.provider, retention: PROVIDER_CONTENT_RETENTION, confidence: 0.6 },
          { field: "canonical_domain", value: record.canonicalDomain, sourceType: websiteSourceType(verification), retention: "canonical_business_data", confidence: verification.confidence },
          { field: "website_url", value: record.websiteUrl, sourceType: websiteSourceType(verification), retention: "canonical_business_data", confidence: verification.confidence },
        ],
      });
      if (evidence.length) {
        const evidenceInsert = await client.from("prospect_field_evidence").upsert(evidence, { onConflict: "id", ignoreDuplicates: true });
        if (evidenceInsert.error) throw new Error(`Unable to record field provenance: ${evidenceInsert.error.message}`);
      }

      await recordVerification({ workspaceId: record.workspaceId, prospectId, candidateId: candidate.id, verification, now });
      await linkRankObservations(candidate.id, prospectId);

      await this.recordActivity({
        workspaceId: record.workspaceId,
        campaignId: candidate.campaign_id,
        prospectId,
        eventType: "prospect.created",
        summary: `Prospect created from ${details.provider.replace(/_/g, " ")} discovery (${verification.state.replace(/_/g, " ")}).`,
        metadata: { candidateId: candidate.id, websiteState: verification.state, confidence: verification.confidence },
        idempotencyKey: `prospect.created:${prospectId}`,
      });

      return { prospectId };
    },

    async attachToProspect(input: AttachProspectInput) {
      const { candidate, details, prospectId, verification, now } = input;
      await upsertSourceRef({ workspaceId: candidate.workspace_id, prospectId, provider: details.provider, externalId: details.providerRef, now });

      if (verification) {
        const prospect = await client.from("prospects").select("website_state").eq("id", prospectId).single();
        if (prospect.error) throw new Error(`Unable to load matched prospect: ${prospect.error.message}`);
        const upgrade = prospect.data.website_state === "unknown" || (verification.state === "verified_website" && prospect.data.website_state !== "verified_website");
        if (upgrade) await recordVerification({ workspaceId: candidate.workspace_id, prospectId, candidateId: candidate.id, verification, now });
      }
      await linkRankObservations(candidate.id, prospectId);

      await this.recordActivity({
        workspaceId: candidate.workspace_id,
        campaignId: candidate.campaign_id,
        prospectId,
        eventType: "prospect.candidate_matched",
        summary: `Discovery candidate matched this prospect by ${input.matchedIdentifiers.join(", ").replace(/_/g, " ")}.`,
        metadata: { candidateId: candidate.id, websiteState: verification?.state ?? null },
        idempotencyKey: `prospect.candidate_matched:${candidate.id}`,
      });
    },

    async enqueue(input) {
      await enqueueJob(client, { workspaceId: input.workspaceId, type: input.type, idempotencyKey: input.idempotencyKey, payload: input.payload, traceId: input.traceId });
    },

    async recordActivity(input) {
      const { error } = await client.from("activity_events").upsert(
        { id: deterministicUuid("activity_event", input.idempotencyKey), workspace_id: input.workspaceId, campaign_id: input.campaignId, prospect_id: input.prospectId, event_type: input.eventType, actor_type: "system", summary: input.summary, metadata: input.metadata ?? {} },
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
