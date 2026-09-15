import { describe, expect, it } from "vitest";

import type { Campaign, CampaignRun, DiscoveryCandidate } from "@/db/types";
import { CANDIDATE_RESOLVE_JOB, resolveCandidate, runDiscovery, verifyCandidateWebsite } from "@/discovery/jobs";
import type { DiscoveryCandidateInput, DiscoveryProvider, DiscoverySearchQuery, DiscoverySearchResult } from "@/discovery/provider";
import { buildResolutionLookup, decideResolution, type ExistingProspectMatch, type ResolutionLookup } from "@/discovery/resolver";
import type { AttachProspectInput, CandidateInsert, CreateProspectInput, DiscoveryStore, RankObservationInsert } from "@/discovery/store";
import type { HttpProbeResult } from "@/discovery/website/http-probe";
import type { WebsiteVerification } from "@/discovery/website/verify";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const at = "2026-09-14T10:00:00.000Z";

function input(overrides: Partial<DiscoveryCandidateInput> = {}): DiscoveryCandidateInput {
  return {
    provider: "google_places",
    providerRef: "place-1",
    displayName: "A&B Roofing Ltd",
    formattedAddress: "12 High St, Uxbridge UB8 1AA",
    locality: "Uxbridge",
    postcode: "UB8 1AA",
    region: "Greater London",
    countryCode: "GB",
    primaryCategory: "roofing contractor",
    categories: ["roofing contractor"],
    websiteHint: "https://www.abroofing.co.uk/",
    websiteHintState: "present",
    phoneHint: "01895 123456",
    businessStatus: "operational",
    attribution: "Google",
    observedAt: at,
    enrichedAt: at,
    ...overrides,
  };
}

/** A candidate exactly as Stage 1 discovery stores it: identity only, contact fields not yet requested. */
function stageOne(overrides: Partial<DiscoveryCandidateInput> = {}): DiscoveryCandidateInput {
  return input({ websiteHint: null, websiteHintState: "unknown", phoneHint: null, enrichedAt: null, ...overrides });
}

/** Provider fake that counts Stage 2 calls and answers each reference with enriched details. */
function enrichingProvider(answer: (ref: string) => DiscoveryCandidateInput | null = (ref) => input({ providerRef: ref })): DiscoveryProvider & { detailCalls: string[]; searchCalls: number } {
  const fake = {
    name: "google_places" as const,
    retention: { referenceRetention: "indefinite" as const, contentRetention: "expiring" as const, attributionRequired: true, attributionText: "Google" },
    detailCalls: [] as string[],
    searchCalls: 0,
    async searchCandidates(): Promise<DiscoverySearchResult> { fake.searchCalls += 1; throw new Error("search must not run during resolution"); },
    async getReferenceDetails(ref: string) { fake.detailCalls.push(ref); return answer(ref); },
  };
  return fake;
}

function verified(overrides: Partial<WebsiteVerification> = {}): WebsiteVerification {
  return { state: "verified_website", websiteUrl: "https://www.abroofing.co.uk", canonicalDomain: "abroofing.co.uk", confidence: 0.95, signals: [], reasons: [], verifierVersion: "v1", ...overrides };
}

describe("resolution decisions", () => {
  const candidate = { displayName: "A&B Roofing Ltd", businessStatus: "operational" as const };

  it("matches on strong identifiers in priority order", () => {
    expect(decideResolution({ candidate, matches: [{ prospectId: "p1", matchedBy: "source_ref" }] })).toMatchObject({ resolution: "matched", prospectId: "p1", confidence: 0.99 });
    expect(decideResolution({ candidate, matches: [{ prospectId: "p1", matchedBy: "domain" }] })).toMatchObject({ resolution: "matched", confidence: 0.9 });
    expect(decideResolution({ candidate, matches: [{ prospectId: "p1", matchedBy: "phone" }] })).toMatchObject({ resolution: "matched", confidence: 0.85 });
  });

  it("never merges on a similar name alone", () => {
    const decision = decideResolution({ candidate, matches: [{ prospectId: "p1", matchedBy: "name_locality" }] });
    expect(decision.resolution).toBe("ambiguous");
    expect(decision.prospectId).toBeNull();
    expect(decision).toMatchObject({ candidateProspectIds: ["p1"], warnings: ["name_locality_only"] });
  });

  it("flags conflicting strong identifiers for human review instead of picking one", () => {
    const decision = decideResolution({ candidate, matches: [{ prospectId: "p1", matchedBy: "domain" }, { prospectId: "p2", matchedBy: "phone" }] });
    expect(decision.resolution).toBe("ambiguous");
    expect(decision.warnings).toContain("conflicting_identifiers");
  });

  it("creates when nothing matches and rejects closed or nameless businesses", () => {
    expect(decideResolution({ candidate, matches: [] }).resolution).toBe("create");
    expect(decideResolution({ candidate: { ...candidate, businessStatus: "closed_permanently" }, matches: [] })).toMatchObject({ resolution: "rejected", reason: "closed_permanently" });
    expect(decideResolution({ candidate: { displayName: null, businessStatus: "operational" }, matches: [] })).toMatchObject({ resolution: "rejected", reason: "missing_business_name" });
  });

  it("only uses the domain as an identity key once the website is verified", () => {
    expect(buildResolutionLookup({ workspaceId, candidate: input(), verification: verified() }).canonicalDomain).toBe("abroofing.co.uk");
    expect(buildResolutionLookup({ workspaceId, candidate: input(), verification: verified({ state: "unverified", confidence: 0.4 }) }).canonicalDomain).toBeNull();
    expect(buildResolutionLookup({ workspaceId, candidate: input(), verification: verified() })).toMatchObject({ normalizedPhone: "+441895123456", normalizedName: "a b roofing ltd", locality: "uxbridge" });
  });
});

// ---------------------------------------------------------------------------
// In-memory store used to exercise the job handlers end to end.
// ---------------------------------------------------------------------------

type ProspectRow = { id: string; domain: string | null; phone: string | null; name: string; city: string | null; websiteState: string };

class MemoryStore implements DiscoveryStore {
  campaign: Campaign;
  run: CampaignRun;
  candidates = new Map<string, DiscoveryCandidate>();
  prospects: ProspectRow[] = [];
  sourceRefs: { prospectId: string; provider: string; externalId: string }[] = [];
  jobs: { type: string; key: string; payload: Record<string, unknown> }[] = [];
  activity: string[] = [];
  events: string[] = [];
  created: CreateProspectInput[] = [];
  attached: AttachProspectInput[] = [];
  rankObservations: RankObservationInsert[] = [];
  private sequence = 0;

  constructor(campaign: Partial<Campaign> = {}) {
    this.campaign = { id: campaignId, workspace_id: workspaceId, name: "Test", status: "draft", country_code: "GB", target_categories: ["roofer"], target_locations: ["Uxbridge"], website_filter: "any", minimum_score: null, entity_policy: "manual_review", daily_candidate_cap: null, daily_send_cap: null, approval_mode: "human", settings_json: {}, created_by: null, created_at: at, updated_at: at, ...campaign };
    this.run = { id: runId, campaign_id: campaignId, workspace_id: workspaceId, run_type: "discovery", requested_by: null, job_id: null, provider: null, provider_mode: null, provider_requests: 0, provider_cost_usd: 0, search_units_total: 0, search_units_completed: 0, status: "queued", started_at: null, finished_at: null, cursor_json: {}, candidates_seen: 0, prospects_created: 0, qualified_count: 0, error_summary: null, created_at: at };
  }

  seedCandidate(details: DiscoveryCandidateInput, overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
    const id = overrides.id ?? `cand-${++this.sequence}`;
    const row: DiscoveryCandidate = { id, workspace_id: workspaceId, campaign_id: campaignId, campaign_run_id: runId, provider: details.provider, provider_ref: details.providerRef, status: "new", candidate_name: details.displayName, candidate_category: details.primaryCategory, candidate_location: details.locality, candidate_website_state: details.websiteHintState, candidate_summary_json: details as unknown as Record<string, unknown>, dedupe_key: `${details.provider}:${details.providerRef}`, source_query_json: {}, retention_class: "provider_restricted_data", first_seen_at: at, last_seen_at: at, expires_at: "2999-01-01T00:00:00.000Z", content_purged_at: null, resolution_status: "pending", resolution_confidence: null, resolution_notes_json: {}, resolved_prospect_id: null, created_at: at, updated_at: at, ...overrides };
    this.candidates.set(id, row);
    return row;
  }

  async getCampaign() { return this.campaign; }
  async getCampaignRun() { return this.run; }
  async updateCampaignRun(_id: string, patch: Parameters<DiscoveryStore["updateCampaignRun"]>[1]) {
    if (patch.status !== undefined) this.run.status = patch.status;
    if (patch.startedAt !== undefined) this.run.started_at = patch.startedAt;
    if (patch.finishedAt !== undefined) this.run.finished_at = patch.finishedAt;
    if (patch.cursor !== undefined) this.run.cursor_json = patch.cursor;
    if (patch.candidatesSeen !== undefined) this.run.candidates_seen = patch.candidatesSeen;
    if (patch.searchUnitsTotal !== undefined) this.run.search_units_total = patch.searchUnitsTotal;
    if (patch.searchUnitsCompleted !== undefined) this.run.search_units_completed = patch.searchUnitsCompleted;
    if (patch.providerRequests !== undefined) this.run.provider_requests = patch.providerRequests;
    if (patch.providerCostUsd !== undefined) this.run.provider_cost_usd = patch.providerCostUsd;
    if (patch.provider !== undefined) this.run.provider = patch.provider;
    if (patch.providerMode !== undefined) this.run.provider_mode = patch.providerMode;
    if (patch.errorSummary !== undefined) this.run.error_summary = patch.errorSummary;
  }
  async findKnownCandidates(_campaignId: string, keys: string[]) {
    const known = new Map<string, Pick<DiscoveryCandidate, "id" | "resolution_status" | "resolved_prospect_id">>();
    for (const row of this.candidates.values()) if (keys.includes(row.dedupe_key ?? "")) known.set(row.dedupe_key!, { id: row.id, resolution_status: row.resolution_status, resolved_prospect_id: row.resolved_prospect_id });
    return known;
  }
  async insertCandidates(rows: CandidateInsert[]) {
    return rows.map((row) => { const inserted = this.seedCandidate(row.input, { expires_at: row.expiresAt }); return { id: inserted.id, provider: inserted.provider, provider_ref: inserted.provider_ref }; });
  }
  async touchCandidates(ids: string[], _runId: string, lastSeenAt: string) { for (const id of ids) this.candidates.get(id)!.last_seen_at = lastSeenAt; }
  async getCandidate(_workspaceId: string, id: string) { return this.candidates.get(id) ?? null; }
  async updateCandidate(id: string, patch: Parameters<DiscoveryStore["updateCandidate"]>[1]) {
    const row = this.candidates.get(id)!;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.resolutionStatus !== undefined) row.resolution_status = patch.resolutionStatus;
    if (patch.resolutionConfidence !== undefined) row.resolution_confidence = patch.resolutionConfidence;
    if (patch.resolutionNotes !== undefined) row.resolution_notes_json = patch.resolutionNotes;
    if (patch.resolvedProspectId !== undefined) row.resolved_prospect_id = patch.resolvedProspectId;
    if (patch.summary !== undefined) row.candidate_summary_json = patch.summary as unknown as Record<string, unknown>;
  }
  async recordRankObservations(rows: RankObservationInsert[]) {
    for (const row of rows) {
      const key = `${row.campaignRunId}:${row.provider}:${row.providerRef}:${row.category}:${row.location}`;
      if (!this.rankObservations.some((existing) => `${existing.campaignRunId}:${existing.provider}:${existing.providerRef}:${existing.category}:${existing.location}` === key)) this.rankObservations.push({ ...row });
    }
  }
  private linkRankObservations(candidateId: string, prospectId: string) {
    for (const row of this.rankObservations) if (row.candidateId === candidateId && !row.prospectId) row.prospectId = prospectId;
  }
  async findMatches(lookup: ResolutionLookup): Promise<ExistingProspectMatch[]> {
    const matches: ExistingProspectMatch[] = [];
    for (const ref of this.sourceRefs) if (ref.provider === lookup.provider && ref.externalId === lookup.providerRef) matches.push({ prospectId: ref.prospectId, matchedBy: "source_ref" });
    for (const prospect of this.prospects) {
      if (lookup.canonicalDomain && prospect.domain === lookup.canonicalDomain) matches.push({ prospectId: prospect.id, matchedBy: "domain" });
      if (lookup.normalizedPhone && prospect.phone === lookup.normalizedPhone) matches.push({ prospectId: prospect.id, matchedBy: "phone" });
      if (lookup.locality && prospect.name === lookup.normalizedName && prospect.city?.toLowerCase() === lookup.locality) matches.push({ prospectId: prospect.id, matchedBy: "name_locality" });
    }
    return matches;
  }
  async createProspect(inputRecord: CreateProspectInput) {
    this.created.push(inputRecord);
    const id = `prospect-${this.prospects.length + 1}`;
    this.prospects.push({ id, domain: inputRecord.record.canonicalDomain, phone: inputRecord.record.primaryPhone, name: inputRecord.record.normalizedName, city: inputRecord.record.city, websiteState: inputRecord.record.websiteState });
    this.sourceRefs.push({ prospectId: id, provider: inputRecord.details.provider, externalId: inputRecord.details.providerRef });
    this.linkRankObservations(inputRecord.candidate.id, id);
    return { prospectId: id };
  }
  async attachToProspect(inputRecord: AttachProspectInput) {
    this.attached.push(inputRecord);
    this.sourceRefs.push({ prospectId: inputRecord.prospectId, provider: inputRecord.details.provider, externalId: inputRecord.details.providerRef });
    this.linkRankObservations(inputRecord.candidate.id, inputRecord.prospectId);
  }
  async enqueue(job: { type: string; idempotencyKey: string; payload: Record<string, unknown> }) {
    if (!this.jobs.some((existing) => existing.key === job.idempotencyKey)) this.jobs.push({ type: job.type, key: job.idempotencyKey, payload: job.payload });
  }
  async recordActivity(event: { eventType: string }) { this.activity.push(event.eventType); }
  async recordDomainEvent(event: { eventType: string; idempotencyKey: string }) { if (!this.events.includes(event.idempotencyKey)) this.events.push(event.idempotencyKey); }
}

const reachable = async (url: string): Promise<HttpProbeResult> => ({ ok: true, url, finalUrl: url + "/", statusCode: 200 });
const config = { discoveryCandidateTtlHours: 24, discoveryMaxPagesPerQuery: 2, discoveryDefaultCandidateCap: 60 };
const context = (deadlineOffsetMs = 60_000) => ({
  job: { id: "job-1", workspace_id: workspaceId, type: "x", idempotency_key: "k", payload: {}, status: "running" as const, attempts: 1, max_attempts: 3, run_after: at, locked_at: at, locked_by: "t", last_error: null, trace_id: "trace", created_at: at, updated_at: at, finished_at: null },
  deadline: Date.now() + deadlineOffsetMs,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});
const failingProvider = (): DiscoveryProvider => { throw new Error("provider should not be needed"); };

describe("candidate resolution job", () => {
  it("creates a canonical prospect with a verified website and records provenance events", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(input());

    const outcome = await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: failingProvider, probe: reachable, config });

    expect(outcome).toEqual({ status: "completed" });
    expect(store.created).toHaveLength(1);
    expect(store.created[0].record).toMatchObject({ displayName: "A&B Roofing Ltd", normalizedName: "a b roofing ltd", canonicalDomain: "abroofing.co.uk", primaryPhone: "+441895123456", city: "Uxbridge", postcode: "UB8 1AA", websiteState: "verified_website", websiteUrl: "https://www.abroofing.co.uk" });
    expect(store.created[0].verification.signals.map((signal) => `${signal.source}:${signal.kind}`)).toEqual(["discovery_provider:website_url_present", "http_probe:reachable"]);
    expect(store.candidates.get(candidate.id)).toMatchObject({ status: "resolved", resolution_status: "created", resolved_prospect_id: "prospect-1" });
    expect(store.events).toContain("prospect.created:prospect-1");
  });

  it("is idempotent: a retried job does not create a second prospect", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(input());
    const deps = { store, getProvider: failingProvider, probe: reachable, config };
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), deps);
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), deps);
    expect(store.created).toHaveLength(1);
    expect(store.prospects).toHaveLength(1);
  });

  it("matches an existing prospect by source reference and attaches instead of creating", async () => {
    const store = new MemoryStore();
    store.prospects.push({ id: "existing", domain: null, phone: null, name: "a b roofing ltd", city: "Uxbridge", websiteState: "unknown" });
    store.sourceRefs.push({ prospectId: "existing", provider: "google_places", externalId: "place-1" });
    const candidate = store.seedCandidate(input());

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: failingProvider, probe: reachable, config });

    expect(store.created).toHaveLength(0);
    expect(store.attached).toHaveLength(1);
    expect(store.attached[0].matchedIdentifiers).toEqual(["source_ref"]);
    expect(store.candidates.get(candidate.id)).toMatchObject({ resolution_status: "matched", resolved_prospect_id: "existing", resolution_confidence: 0.99 });
  });

  it("does not merge on name and locality alone; it flags the candidate for review", async () => {
    const store = new MemoryStore();
    store.prospects.push({ id: "lookalike", domain: "other-roofers.co.uk", phone: "+441895999999", name: "a b roofing ltd", city: "Uxbridge", websiteState: "verified_website" });
    const candidate = store.seedCandidate(input({ providerRef: "place-2", websiteHint: null, websiteHintState: "absent", phoneHint: null }));

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: failingProvider, probe: reachable, config });

    expect(store.created).toHaveLength(0);
    expect(store.attached).toHaveLength(0);
    expect(store.candidates.get(candidate.id)).toMatchObject({ resolution_status: "ambiguous", resolved_prospect_id: null });
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ candidateProspectIds: ["lookalike"], websiteState: "likely_no_website" });
    expect(store.activity).toContain("candidate.ambiguous");
  });

  it("stores likely_no_website, not verified_no_website, when only the provider says there is no site", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(input({ websiteHint: null, websiteHintState: "absent" }));
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: failingProvider, probe: reachable, config });
    expect(store.created[0].record).toMatchObject({ websiteState: "likely_no_website", canonicalDomain: null, websiteUrl: null });
  });

  it("keeps an unreachable website as unverified and does not use the domain as an identity key", async () => {
    const store = new MemoryStore();
    store.prospects.push({ id: "same-domain", domain: "abroofing.co.uk", phone: null, name: "someone else", city: "Hayes", websiteState: "verified_website" });
    const candidate = store.seedCandidate(input({ phoneHint: null }));
    const unreachable = async (url: string): Promise<HttpProbeResult> => ({ ok: false, url, reason: "timeout" });

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: failingProvider, probe: unreachable, config });

    expect(store.attached).toHaveLength(0);
    expect(store.created[0].record).toMatchObject({ websiteState: "unverified", canonicalDomain: null, websiteUrl: "https://www.abroofing.co.uk" });
  });

  it("rejects permanently closed businesses", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(input({ businessStatus: "closed_permanently" }));
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: failingProvider, probe: reachable, config });
    expect(store.candidates.get(candidate.id)).toMatchObject({ resolution_status: "rejected" });
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ reason: "closed_permanently" });
  });

  it("re-fetches provider details with a single Stage 2 call when the stored content has been purged", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(input(), { candidate_summary_json: {}, candidate_name: null, content_purged_at: at });
    const provider = enrichingProvider();

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });

    expect(provider.detailCalls).toEqual(["place-1"]);
    expect(store.created).toHaveLength(1);
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ enrichment: "fetched" });
  });

  it("builds website signals from the provider hint and probe", async () => {
    const verification = await verifyCandidateWebsite(input({ websiteHint: "https://www.facebook.com/abroofing" }), reachable, at);
    expect(verification.state).toBe("likely_no_website");
  });
});

describe("two-stage enrichment", () => {
  it("enriches a Stage 1 candidate exactly once, stores the enriched content, then verifies and creates the prospect", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(stageOne());
    const provider = enrichingProvider();

    const outcome = await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });

    expect(outcome).toEqual({ status: "completed" });
    expect(provider.detailCalls).toEqual(["place-1"]);
    expect(provider.searchCalls).toBe(0);
    expect(store.candidates.get(candidate.id)!.candidate_summary_json).toMatchObject({ websiteHint: "https://www.abroofing.co.uk/", websiteHintState: "present", phoneHint: "01895 123456", enrichedAt: at });
    expect(store.created).toHaveLength(1);
    expect(store.created[0].record).toMatchObject({ canonicalDomain: "abroofing.co.uk", primaryPhone: "+441895123456", websiteState: "verified_website" });
    expect(store.created[0].verification.signals.map((signal) => `${signal.source}:${signal.kind}`)).toEqual(["discovery_provider:website_url_present", "http_probe:reachable"]);
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ enrichment: "fetched", websiteState: "verified_website" });
  });

  it("never treats a Stage 1 'unknown' website hint as evidence of no website", async () => {
    const verification = await verifyCandidateWebsite(stageOne(), reachable, at);
    expect(verification.signals).toEqual([]);
    expect(verification.state).toBe("unverified");
    expect(verification.reasons).toEqual(["no_signals"]);
  });

  it("makes no enrichment call for candidates rejected on Stage 1 data", async () => {
    const store = new MemoryStore();
    const closed = store.seedCandidate(stageOne({ providerRef: "closed", businessStatus: "closed_permanently" }));
    const nameless = store.seedCandidate(stageOne({ providerRef: "nameless", displayName: null }));
    const provider = enrichingProvider();

    await resolveCandidate({ candidateId: closed.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });
    await resolveCandidate({ candidateId: nameless.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });

    expect(provider.detailCalls).toEqual([]);
    expect(store.candidates.get(closed.id)).toMatchObject({ resolution_status: "rejected" });
    expect(store.candidates.get(closed.id)!.resolution_notes_json).toMatchObject({ reason: "closed_permanently", enrichment: "skipped" });
    expect(store.candidates.get(nameless.id)!.resolution_notes_json).toMatchObject({ reason: "missing_business_name", enrichment: "skipped" });
  });

  it("attaches a place already linked to a prospect by source reference without an enrichment call", async () => {
    const store = new MemoryStore();
    store.prospects.push({ id: "existing", domain: "abroofing.co.uk", phone: "+441895123456", name: "a b roofing ltd", city: "Uxbridge", websiteState: "verified_website" });
    store.sourceRefs.push({ prospectId: "existing", provider: "google_places", externalId: "place-1" });
    const candidate = store.seedCandidate(stageOne());
    const provider = enrichingProvider();

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });

    expect(provider.detailCalls).toEqual([]);
    expect(store.created).toHaveLength(0);
    expect(store.attached).toHaveLength(1);
    expect(store.attached[0].verification).toBeNull();
    expect(store.attached[0].matchedIdentifiers).toEqual(["source_ref"]);
    expect(store.candidates.get(candidate.id)).toMatchObject({ resolution_status: "matched", resolved_prospect_id: "existing", resolution_confidence: 0.99 });
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ enrichment: "skipped", websiteState: null });
  });

  it("still enriches when only a weak name-and-locality match exists, then flags for review", async () => {
    const store = new MemoryStore();
    store.prospects.push({ id: "lookalike", domain: "other-roofers.co.uk", phone: "+441895999999", name: "a b roofing ltd", city: "Uxbridge", websiteState: "verified_website" });
    const candidate = store.seedCandidate(stageOne({ providerRef: "place-2" }));
    const provider = enrichingProvider((ref) => input({ providerRef: ref, websiteHint: null, websiteHintState: "absent", phoneHint: null }));

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });

    expect(provider.detailCalls).toEqual(["place-2"]);
    expect(store.candidates.get(candidate.id)).toMatchObject({ resolution_status: "ambiguous" });
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ candidateProspectIds: ["lookalike"], websiteState: "likely_no_website", enrichment: "fetched" });
  });

  it("does not re-enrich on retry once enriched content is stored", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(input());
    const provider = enrichingProvider();

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });

    expect(provider.detailCalls).toEqual([]);
    expect(store.created).toHaveLength(1);
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ enrichment: "stored" });
  });

  it("rejects a Stage 1 candidate whose reference has disappeared by enrichment time", async () => {
    const store = new MemoryStore();
    const candidate = store.seedCandidate(stageOne());
    const provider = enrichingProvider(() => null);

    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });

    expect(provider.detailCalls).toEqual(["place-1"]);
    expect(store.created).toHaveLength(0);
    expect(store.candidates.get(candidate.id)).toMatchObject({ resolution_status: "rejected" });
    expect(store.candidates.get(candidate.id)!.resolution_notes_json).toMatchObject({ reason: "reference_no_longer_available" });
  });

  it("returns the candidate to the queue when enrichment fails transiently and fails it when the provider rejects the key", async () => {
    const { DiscoveryProviderError } = await import("@/discovery/provider");
    const store = new MemoryStore();
    const transient = store.seedCandidate(stageOne({ providerRef: "transient" }));
    const fatal = store.seedCandidate(stageOne({ providerRef: "fatal" }));
    const provider = enrichingProvider((ref) => { throw new DiscoveryProviderError(ref === "fatal" ? "bad key" : "quota", ref === "fatal" ? "auth" : "quota", ref !== "fatal"); });

    await expect(resolveCandidate({ candidateId: transient.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config })).rejects.toMatchObject({ code: "quota" });
    expect(store.candidates.get(transient.id)).toMatchObject({ status: "new", resolution_status: "pending" });

    await expect(resolveCandidate({ candidateId: fatal.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config })).rejects.toMatchObject({ name: "NonRetryableJobError" });
    expect(store.candidates.get(fatal.id)).toMatchObject({ status: "failed", resolution_status: "failed" });
    expect(provider.detailCalls).toEqual(["transient", "fatal"]);
  });
});

describe("discovery run job", () => {
  function fakeProvider(pages: Record<string, DiscoverySearchResult>): DiscoveryProvider & { queries: DiscoverySearchQuery[]; detailCalls: number } {
    const queries: DiscoverySearchQuery[] = [];
    const fake = {
      name: "google_places" as const,
      retention: { referenceRetention: "indefinite" as const, contentRetention: "expiring" as const, attributionRequired: true, attributionText: "Google" },
      queries,
      detailCalls: 0,
      async searchCandidates(query: DiscoverySearchQuery) { queries.push(query); return pages[`${query.category}|${query.location}|${query.pageToken ?? ""}`] ?? { candidates: [], nextPageToken: null, requestCount: 1 }; },
      async getReferenceDetails() { fake.detailCalls += 1; return null; },
    };
    return fake;
  }

  it("resolves DataForSEO candidates, which arrive enriched, without a single enrichment call", async () => {
    const store = new MemoryStore({ target_categories: ["roofer"], target_locations: ["Uxbridge"] });
    const enriched = (ref: string, overrides: Partial<DiscoveryCandidateInput> = {}) => input({ provider: "dataforseo", providerRef: ref, attribution: "Google Maps data via DataForSEO", businessStatus: "unknown", ...overrides });
    const second = enriched("ChIJ2", { displayName: "Uxbridge Roof Care", websiteHint: "https://www.uxbridgeroofcare.co.uk", phoneHint: "01895 654321" });
    const provider = fakeProvider({ "roofer|Uxbridge|": { candidates: [enriched("ChIJ1"), second, enriched("ChIJ1")], nextPageToken: null, requestCount: 1, costUsd: 0.002 } });

    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });
    expect(store.run).toMatchObject({ status: "completed", candidates_seen: 2, provider_requests: 1, search_units_completed: 1 });
    expect([...store.candidates.values()].every((row) => row.candidate_website_state === "present")).toBe(true);

    for (const row of [...store.candidates.values()]) {
      await resolveCandidate({ candidateId: row.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });
    }

    expect(provider.detailCalls).toBe(0);
    expect(store.created).toHaveLength(2);
    expect(store.sourceRefs.map((ref) => `${ref.provider}:${ref.externalId}`).sort()).toEqual(["dataforseo:ChIJ1", "dataforseo:ChIJ2"]);
    expect([...store.candidates.values()].map((row) => row.resolution_notes_json)).toEqual([expect.objectContaining({ enrichment: "stored", websiteState: "verified_website" }), expect.objectContaining({ enrichment: "stored", websiteState: "verified_website" })]);
  });

  it("searches every unit, pages, dedupes across pages, enqueues one resolve job per candidate and completes", async () => {
    const store = new MemoryStore({ target_categories: ["roofer"], target_locations: ["Uxbridge", "Hayes"] });
    const provider = fakeProvider({
      "roofer|Uxbridge|": { candidates: [stageOne({ providerRef: "p1" }), stageOne({ providerRef: "p2" }), stageOne({ providerRef: "p2" })], nextPageToken: "next", requestCount: 1 },
      "roofer|Uxbridge|next": { candidates: [stageOne({ providerRef: "p1" }), stageOne({ providerRef: "p3" })], nextPageToken: null, requestCount: 1 },
      "roofer|Hayes|": { candidates: [stageOne({ providerRef: "p3" }), stageOne({ providerRef: "p4" })], nextPageToken: null, requestCount: 1 },
    });

    const outcome = await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });

    expect(outcome).toEqual({ status: "completed" });
    expect(provider.queries.map((query) => query.pageToken ?? null)).toEqual([null, "next", null]);
    expect(provider.detailCalls).toBe(0);
    expect([...store.candidates.values()].map((row) => row.provider_ref).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect([...store.candidates.values()].every((row) => row.candidate_website_state === "unknown" && (row.candidate_summary_json as { enrichedAt: unknown }).enrichedAt === null)).toBe(true);
    expect(store.jobs.filter((job) => job.type === CANDIDATE_RESOLVE_JOB)).toHaveLength(4);
    expect(store.run).toMatchObject({ status: "completed", candidates_seen: 4, provider_requests: 3, search_units_total: 2, search_units_completed: 2 });
    expect(store.events.filter((key) => key.startsWith("candidate.discovered:"))).toHaveLength(4);
    expect(store.activity).toContain("campaign.discovery_completed");
  });

  it("stops at the candidate cap and says so", async () => {
    const store = new MemoryStore({ daily_candidate_cap: 1, target_locations: ["Uxbridge", "Hayes"] });
    const provider = fakeProvider({ "roofer|Uxbridge|": { candidates: [input({ providerRef: "p1" }), input({ providerRef: "p2" })], nextPageToken: null, requestCount: 1 } });
    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });
    expect(store.candidates.size).toBe(1);
    expect(store.run.status).toBe("completed");
    expect(store.run.error_summary).toContain("candidate cap");
    expect(provider.queries).toHaveLength(1);
  });

  it("yields with a persisted cursor when the time budget is exhausted, then resumes where it left off", async () => {
    const store = new MemoryStore({ target_locations: ["Uxbridge", "Hayes"] });
    const provider = fakeProvider({
      "roofer|Uxbridge|": { candidates: [input({ providerRef: "p1" })], nextPageToken: null, requestCount: 1 },
      "roofer|Hayes|": { candidates: [input({ providerRef: "p2" })], nextPageToken: null, requestCount: 1 },
    });

    const first = await runDiscovery({ campaignRunId: runId, campaignId }, context(0), { store, getProvider: () => provider, config });
    expect(first).toEqual({ status: "continue", delaySeconds: 1 });
    expect(store.run.status).toBe("running");
    expect(provider.queries).toHaveLength(0);

    const second = await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });
    expect(second).toEqual({ status: "completed" });
    expect(provider.queries.map((query) => query.location)).toEqual(["Uxbridge", "Hayes"]);
    expect(store.run.cursor_json).toEqual({ unitIndex: 2, pageToken: null, pagesFetched: 0 });
  });

  it("fails the run and dead-letters the job when the provider rejects the credentials", async () => {
    const store = new MemoryStore();
    const { DiscoveryProviderError } = await import("@/discovery/provider");
    const provider: DiscoveryProvider = { ...fakeProvider({}), async searchCandidates() { throw new DiscoveryProviderError("bad key", "auth", false); } };
    await expect(runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config })).rejects.toMatchObject({ name: "NonRetryableJobError" });
    expect(store.run).toMatchObject({ status: "failed", error_summary: "bad key" });
  });

  it("fails cleanly when the campaign has no search units", async () => {
    const store = new MemoryStore({ target_categories: [] });
    const outcome = await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: failingProvider, config });
    expect(outcome).toEqual({ status: "completed" });
    expect(store.run.status).toBe("failed");
    expect(store.run.error_summary).toContain("at least one category");
  });

  // ---------------------------------------------------------------------------
  // DataForSEO-shaped behaviour: ranked, enriched candidates; caps; cost; queued tasks.
  // ---------------------------------------------------------------------------

  const ranked = (ref: string, position: number, overrides: Partial<DiscoveryCandidateInput> = {}): DiscoveryCandidateInput =>
    input({ provider: "dataforseo", providerRef: ref, attribution: "Google Maps data via DataForSEO", businessStatus: "unknown", rank: { position, absolutePosition: position + 1 }, rating: { value: 4.5, reviewCount: 10 * position }, coordinates: { latitude: 51.5, longitude: -0.47 }, ...overrides });

  function dataForSeoProvider(pages: Record<string, DiscoverySearchResult>, mode = "live"): DiscoveryProvider & { queries: DiscoverySearchQuery[]; detailCalls: number } {
    return { ...fakeProvider(pages), name: "dataforseo" as const, mode, retention: { referenceRetention: "indefinite" as const, contentRetention: "expiring" as const, attributionRequired: false, attributionText: "Google Maps data via DataForSEO" } };
  }

  it("records the provider, mode and accumulated cost on the run and captures a ranking observation per ranked candidate", async () => {
    const store = new MemoryStore({ target_categories: ["roofer"], target_locations: ["Uxbridge", "Hayes"] });
    const provider = dataForSeoProvider({
      "roofer|Uxbridge|": { candidates: [ranked("ChIJ1", 1), ranked("ChIJ2", 2), ranked("ChIJ3", 3, { rank: null, rating: null })], nextPageToken: null, requestCount: 1, costUsd: 0.002 },
      "roofer|Hayes|": { candidates: [ranked("ChIJ2", 1), ranked("ChIJ4", 2)], nextPageToken: null, requestCount: 1, costUsd: 0.002 },
    });

    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });

    expect(store.run).toMatchObject({ status: "completed", provider: "dataforseo", provider_mode: "live", provider_requests: 2, candidates_seen: 4, search_units_completed: 2 });
    expect(store.run.provider_cost_usd).toBeCloseTo(0.004, 6);
    // ChIJ3 has no rank, ChIJ2 is ranked in both units (re-seen, not re-created).
    expect(store.candidates.size).toBe(4);
    expect(store.rankObservations.map((row) => `${row.providerRef}@${row.location}#${row.position}`).sort()).toEqual(["ChIJ1@Uxbridge#1", "ChIJ2@Hayes#1", "ChIJ2@Uxbridge#2", "ChIJ4@Hayes#2"]);
    expect(store.rankObservations[0]).toMatchObject({ campaignRunId: runId, category: "roofer", countryCode: "GB", absolutePosition: 2, rating: 4.5, reviewCount: 10, observedAt: at });
    const stored = [...store.candidates.values()].find((row) => row.provider_ref === "ChIJ1")!.candidate_summary_json as DiscoveryCandidateInput;
    expect(stored.rank).toEqual({ position: 1, absolutePosition: 2 });
    expect(stored.coordinates).toEqual({ latitude: 51.5, longitude: -0.47 });
  });

  it("links ranking observations to the prospect once the candidate resolves", async () => {
    const store = new MemoryStore();
    const provider = dataForSeoProvider({ "roofer|Uxbridge|": { candidates: [ranked("ChIJ1", 3)], nextPageToken: null, requestCount: 1, costUsd: 0.002 } });
    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });
    const [candidate] = [...store.candidates.values()];
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });
    expect(store.rankObservations).toEqual([expect.objectContaining({ candidateId: candidate.id, prospectId: "prospect-1", position: 3 })]);
  });

  it("does not re-create prospects or candidates on a repeat run but does add a fresh ranking observation", async () => {
    const store = new MemoryStore();
    const other = { displayName: "Uxbridge Roof Care", websiteHint: "https://www.uxbridgeroofcare.co.uk", phoneHint: "01895 654321" };
    const provider = dataForSeoProvider({ "roofer|Uxbridge|": { candidates: [ranked("ChIJ1", 2), ranked("ChIJ2", 5, other)], nextPageToken: null, requestCount: 1, costUsd: 0.002 } });

    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });
    for (const row of [...store.candidates.values()]) await resolveCandidate({ candidateId: row.id, campaignId }, context(), { store, getProvider: () => provider, probe: reachable, config });
    expect(store.created).toHaveLength(2);
    expect(store.rankObservations).toHaveLength(2);

    // Second run: same listings, new positions.
    const secondRunId = "55555555-5555-4555-8555-555555555555";
    store.run = { ...store.run, id: secondRunId, status: "queued", cursor_json: {}, candidates_seen: 0, provider_requests: 0, provider_cost_usd: 0, search_units_completed: 0, error_summary: null, finished_at: null };
    const again = dataForSeoProvider({ "roofer|Uxbridge|": { candidates: [ranked("ChIJ2", 1, other), ranked("ChIJ1", 4)], nextPageToken: null, requestCount: 1, costUsd: 0.002 } });
    await runDiscovery({ campaignRunId: secondRunId, campaignId }, context(), { store, getProvider: () => again, config });
    for (const row of [...store.candidates.values()]) await resolveCandidate({ candidateId: row.id, campaignId }, context(), { store, getProvider: () => again, probe: reachable, config });

    expect(store.candidates.size).toBe(2);
    expect(store.created).toHaveLength(2);
    expect(store.prospects).toHaveLength(2);
    expect(store.run).toMatchObject({ status: "completed", candidates_seen: 0, provider_requests: 1 });
    expect(store.rankObservations.filter((row) => row.campaignRunId === secondRunId).map((row) => `${row.providerRef}#${row.position}`).sort()).toEqual(["ChIJ1#4", "ChIJ2#1"]);
    expect(store.rankObservations.every((row) => row.prospectId)).toBe(true);
    expect(store.jobs.filter((job) => job.type === CANDIDATE_RESOLVE_JOB)).toHaveLength(2);
  });

  it("stops at the provider request cap (environment ceiling, campaign may only lower it) and says so", async () => {
    const pages = Object.fromEntries(["Uxbridge", "Hayes", "Ruislip"].map((location, index) => [`roofer|${location}|`, { candidates: [ranked(`ChIJ${index}`, 1)], nextPageToken: null, requestCount: 1, costUsd: 0.002 }]));

    const store = new MemoryStore({ target_locations: ["Uxbridge", "Hayes", "Ruislip"], settings_json: { max_requests_per_run: 2 } });
    const provider = dataForSeoProvider(pages);
    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config: { ...config, discoveryMaxRequestsPerRun: 50 } });
    expect(provider.queries).toHaveLength(2);
    expect(store.run).toMatchObject({ status: "completed", provider_requests: 2, search_units_completed: 2 });
    expect(store.run.error_summary).toContain("provider request cap (2)");

    const ceiling = new MemoryStore({ target_locations: ["Uxbridge", "Hayes", "Ruislip"], settings_json: { max_requests_per_run: 500 } });
    const second = dataForSeoProvider(pages);
    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store: ceiling, getProvider: () => second, config: { ...config, discoveryMaxRequestsPerRun: 1 } });
    expect(second.queries).toHaveLength(1);
    expect(ceiling.run.error_summary).toContain("provider request cap (1)");
  });

  it("standard mode: persists the queued task in the cursor, continues after the poll delay without spending the request cap, then processes the retrieved page", async () => {
    const store = new MemoryStore({ target_locations: ["Uxbridge", "Hayes"] });
    let phase = 0;
    const queries: DiscoverySearchQuery[] = [];
    const provider: DiscoveryProvider = {
      ...dataForSeoProvider({}, "standard"),
      async searchCandidates(query) {
        queries.push(query);
        if (query.location === "Hayes") return { candidates: [ranked("ChIJ9", 1)], nextPageToken: null, requestCount: 1, costUsd: 0.0006 };
        phase += 1;
        if (phase === 1) { expect(query.pendingTaskRef).toBeNull(); return { candidates: [], nextPageToken: null, requestCount: 1, costUsd: 0.0006, pending: { taskRef: "task-1", retryAfterSeconds: 60 } }; }
        expect(query.pendingTaskRef).toBe("task-1");
        if (phase === 2) return { candidates: [], nextPageToken: null, requestCount: 0, costUsd: null, pending: { taskRef: "task-1", retryAfterSeconds: 60 } };
        return { candidates: [ranked("ChIJ1", 1), ranked("ChIJ2", 2)], nextPageToken: null, requestCount: 0, costUsd: null };
      },
    };
    const deps = { store, getProvider: () => provider, config: { ...config, discoveryMaxRequestsPerRun: 2 } };

    const posted = await runDiscovery({ campaignRunId: runId, campaignId }, context(), deps);
    expect(posted).toEqual({ status: "continue", delaySeconds: 60 });
    expect(store.run).toMatchObject({ status: "running", provider_mode: "standard", provider_requests: 1, candidates_seen: 0 });
    expect(store.run.cursor_json).toMatchObject({ unitIndex: 0, pendingTask: { taskRef: "task-1", polls: 0 } });

    const stillQueued = await runDiscovery({ campaignRunId: runId, campaignId }, context(), deps);
    expect(stillQueued).toEqual({ status: "continue", delaySeconds: 60 });
    expect(store.run.provider_requests).toBe(1);
    expect(store.run.cursor_json).toMatchObject({ pendingTask: { taskRef: "task-1", polls: 1 } });

    const finished = await runDiscovery({ campaignRunId: runId, campaignId }, context(), deps);
    expect(finished).toEqual({ status: "completed" });
    expect(queries.map((query) => `${query.location}:${query.pendingTaskRef ?? ""}`)).toEqual(["Uxbridge:", "Uxbridge:task-1", "Uxbridge:task-1", "Hayes:"]);
    expect(store.run).toMatchObject({ status: "completed", provider_requests: 2, candidates_seen: 3, search_units_completed: 2, error_summary: null });
    expect(store.run.provider_cost_usd).toBeCloseTo(0.0012, 6);
    expect(store.run.cursor_json).toEqual({ unitIndex: 2, pageToken: null, pagesFetched: 0 });
    expect(store.rankObservations).toHaveLength(3);
  });

  it("fails the run when a queued task never completes within the timeout", async () => {
    const store = new MemoryStore();
    store.run.status = "running";
    store.run.cursor_json = { unitIndex: 0, pageToken: null, pagesFetched: 0, pendingTask: { taskRef: "task-old", postedAt: "2026-09-14T00:00:00.000Z", polls: 40 } };
    const provider = dataForSeoProvider({}, "standard");
    await expect(runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config: { ...config, discoveryTaskTimeoutMinutes: 120 }, now: () => new Date("2026-09-14T03:00:00.000Z") })).rejects.toMatchObject({ name: "NonRetryableJobError" });
    expect(store.run.status).toBe("failed");
    expect(store.run.error_summary).toContain("task-old");
    expect(provider.queries).toHaveLength(0);
  });

  it("website-missing: a DataForSEO listing without a URL becomes likely_no_website, never verified_no_website, from the single provider signal", async () => {
    const store = new MemoryStore();
    const provider = dataForSeoProvider({ "roofer|Uxbridge|": { candidates: [ranked("ChIJ1", 1, { websiteHint: null, websiteHintState: "absent" })], nextPageToken: null, requestCount: 1 } });
    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });
    const [candidate] = [...store.candidates.values()];
    expect(candidate.candidate_website_state).toBe("absent");

    const probe = async (): Promise<HttpProbeResult> => { throw new Error("nothing to probe"); };
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe, config });
    expect(provider.detailCalls).toBe(0);
    expect(store.created).toHaveLength(1);
    expect(store.created[0].verification).toMatchObject({ state: "likely_no_website", confidence: 0.5, reasons: ["single_source_no_website"] });
    expect(store.created[0].record.websiteState).toBe("likely_no_website");
  });

  it("website-present: a DataForSEO URL is normalised, probed by our own verifier and stored as provider-sourced evidence", async () => {
    const store = new MemoryStore();
    const provider = dataForSeoProvider({ "roofer|Uxbridge|": { candidates: [ranked("ChIJ1", 1, { websiteHint: "HTTP://WWW.ABRoofing.co.uk" })], nextPageToken: null, requestCount: 1 } });
    await runDiscovery({ campaignRunId: runId, campaignId }, context(), { store, getProvider: () => provider, config });
    const [candidate] = [...store.candidates.values()];
    expect(candidate.candidate_website_state).toBe("present");

    const probed: string[] = [];
    const probe = async (url: string): Promise<HttpProbeResult> => { probed.push(url); return { ok: true, url, finalUrl: "https://www.abroofing.co.uk/", statusCode: 200 }; };
    await resolveCandidate({ candidateId: candidate.id, campaignId }, context(), { store, getProvider: () => provider, probe, config });
    expect(probed).toEqual(["http://www.abroofing.co.uk"]);
    expect(store.created[0].verification).toMatchObject({ state: "verified_website", canonicalDomain: "abroofing.co.uk" });
    expect(store.created[0].verification.signals[0]).toMatchObject({ source: "discovery_provider", kind: "website_url_present" });
    expect(store.created[0].details.provider).toBe("dataforseo");
  });
});
