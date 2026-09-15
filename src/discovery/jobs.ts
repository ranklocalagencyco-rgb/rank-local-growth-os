import { z } from "zod";

import type { RuntimeConfig } from "@/config/env";
import { dedupeCandidates, partitionAgainstKnown } from "@/discovery/dedupe";
import { candidateDedupeKey, DiscoveryProviderError, isEnrichedCandidate, type DiscoveryCandidateInput, type DiscoveryProvider } from "@/discovery/provider";
import { buildNewProspectRecord, buildResolutionLookup, decideResolution, type ResolutionDecision } from "@/discovery/resolver";
import { advanceCursor, buildSearchUnits, isCursorFinished, parseCursor } from "@/discovery/search-plan";
import type { DiscoveryStore } from "@/discovery/store";
import { probeWebsite, type HttpProbeResult } from "@/discovery/website/http-probe";
import { evaluateWebsiteSignals, officialUrlToProbe, signalsFromWebsiteHint, type WebsiteSignal, type WebsiteVerification } from "@/discovery/website/verify";
import { NonRetryableJobError, type JobContext, type JobOutcome, type JobRegistry } from "@/jobs/processor";

export const DISCOVERY_RUN_JOB = "discovery.run";
export const CANDIDATE_RESOLVE_JOB = "candidate.resolve";

export const discoveryRunPayloadSchema = z.object({ campaignRunId: z.string().uuid(), campaignId: z.string().uuid() });
export const candidateResolvePayloadSchema = z.object({ candidateId: z.string().uuid(), campaignId: z.string().uuid() });

export type DiscoveryRunPayload = z.infer<typeof discoveryRunPayloadSchema>;
export type CandidateResolvePayload = z.infer<typeof candidateResolvePayloadSchema>;

export type DiscoveryJobDependencies = {
  store: DiscoveryStore;
  getProvider: () => DiscoveryProvider;
  probe?: (url: string) => Promise<HttpProbeResult>;
  config: Pick<RuntimeConfig, "discoveryCandidateTtlHours" | "discoveryMaxPagesPerQuery" | "discoveryDefaultCandidateCap"> & Partial<Pick<RuntimeConfig, "discoveryMaxRequestsPerRun" | "discoveryTaskTimeoutMinutes">>;
  now?: () => Date;
};

/** Defaults for the optional cost-control settings, mirroring src/config/env.ts. */
const DEFAULT_MAX_REQUESTS_PER_RUN = 50;
const DEFAULT_TASK_TIMEOUT_MINUTES = 120;

function positiveSetting(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function resolveJobIdempotencyKey(candidateId: string): string {
  return `${CANDIDATE_RESOLVE_JOB}:${candidateId}`;
}

export function discoveryRunIdempotencyKey(campaignRunId: string): string {
  return `${DISCOVERY_RUN_JOB}:${campaignRunId}`;
}

function expiresAt(now: Date, ttlHours: number): string {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
}

function providerFailureIsFatal(error: unknown): boolean {
  return error instanceof DiscoveryProviderError && !error.retryable;
}

/** Runs the territory search for one campaign run, persisting a cursor after every page. */
export async function runDiscovery(payload: DiscoveryRunPayload, context: Pick<JobContext, "deadline" | "job" | "logger">, deps: DiscoveryJobDependencies): Promise<JobOutcome> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const workspaceId = context.job.workspace_id;

  const run = await store.getCampaignRun(workspaceId, payload.campaignRunId);
  if (!run) throw new NonRetryableJobError("Campaign run not found");
  if (run.status === "completed" || run.status === "failed") return { status: "completed" };

  const campaign = await store.getCampaign(workspaceId, payload.campaignId);
  if (!campaign) throw new NonRetryableJobError("Campaign not found");

  const units = buildSearchUnits(campaign);
  if (units.length === 0) {
    await store.updateCampaignRun(run.id, { status: "failed", finishedAt: now().toISOString(), errorSummary: "Campaign needs at least one category and one location." });
    return { status: "completed" };
  }

  let provider: DiscoveryProvider;
  try {
    provider = deps.getProvider();
  } catch (error) {
    await store.updateCampaignRun(run.id, { status: "failed", finishedAt: now().toISOString(), errorSummary: error instanceof Error ? error.message : "Discovery provider unavailable" });
    throw new NonRetryableJobError(error instanceof Error ? error.message : "Discovery provider unavailable");
  }

  const settings = campaign.settings_json as { max_pages_per_query?: unknown; max_requests_per_run?: unknown };
  const maxPages = typeof settings.max_pages_per_query === "number" && settings.max_pages_per_query > 0 ? Math.min(settings.max_pages_per_query, 3) : deps.config.discoveryMaxPagesPerQuery;
  const candidateCap = campaign.daily_candidate_cap ?? deps.config.discoveryDefaultCandidateCap;
  // Campaign settings may tighten the request cap but never exceed the environment-wide ceiling.
  const requestCeiling = deps.config.discoveryMaxRequestsPerRun ?? DEFAULT_MAX_REQUESTS_PER_RUN;
  const maxRequests = Math.min(positiveSetting(settings.max_requests_per_run) ?? requestCeiling, requestCeiling);
  const taskTimeoutMs = (deps.config.discoveryTaskTimeoutMinutes ?? DEFAULT_TASK_TIMEOUT_MINUTES) * 60 * 1000;

  let cursor = parseCursor(run.cursor_json);
  let candidatesSeen = run.candidates_seen;
  let providerRequests = run.provider_requests;
  let providerCostUsd = Number(run.provider_cost_usd ?? 0);
  let unitsCompleted = run.search_units_completed;
  let requestCapReached = false;

  if (run.status === "queued") {
    await store.updateCampaignRun(run.id, { status: "running", startedAt: run.started_at ?? now().toISOString(), provider: provider.name, providerMode: provider.mode ?? null, searchUnitsTotal: units.length });
  }

  const progress = () => ({ cursor, candidatesSeen, providerRequests, providerCostUsd, searchUnitsCompleted: unitsCompleted });

  while (!isCursorFinished(cursor, units.length) && candidatesSeen < candidateCap) {
    if (Date.now() > context.deadline - 3_000) {
      return { status: "continue", delaySeconds: 1 };
    }

    const unit = units[cursor.unitIndex];
    const pendingTask = cursor.pendingTask ?? null;

    // A queued provider task is already paid for, so retrieving it never counts against the request cap.
    if (!pendingTask && providerRequests >= maxRequests) {
      requestCapReached = true;
      break;
    }
    if (pendingTask && now().getTime() - new Date(pendingTask.postedAt).getTime() > taskTimeoutMs) {
      const message = `Provider task ${pendingTask.taskRef} for ${unit.category} in ${unit.location} did not complete within ${Math.round(taskTimeoutMs / 60_000)} minutes.`;
      await store.updateCampaignRun(run.id, { status: "failed", finishedAt: now().toISOString(), errorSummary: message, ...progress() });
      throw new NonRetryableJobError(message);
    }

    let page;
    try {
      page = await provider.searchCandidates({ category: unit.category, location: unit.location, countryCode: campaign.country_code, pageToken: cursor.pageToken, pendingTaskRef: pendingTask?.taskRef ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discovery provider request failed";
      if (providerFailureIsFatal(error)) {
        await store.updateCampaignRun(run.id, { status: "failed", finishedAt: now().toISOString(), errorSummary: message, ...progress() });
        throw new NonRetryableJobError(message);
      }
      await store.updateCampaignRun(run.id, { errorSummary: `Retrying after provider error: ${message}`, ...progress() });
      throw error;
    }
    providerRequests += page.requestCount;
    if (typeof page.costUsd === "number" && page.costUsd > 0) providerCostUsd += page.costUsd;

    if (page.pending) {
      // Standard/priority queue: the search is posted and charged now; the result is retrieved on a later invocation.
      cursor = { ...cursor, pendingTask: { taskRef: page.pending.taskRef, postedAt: pendingTask?.postedAt ?? now().toISOString(), polls: pendingTask ? pendingTask.polls + 1 : 0 } };
      await store.updateCampaignRun(run.id, { ...progress(), errorSummary: null });
      context.logger.info("discovery.pending", { unit, taskRef: page.pending.taskRef, polls: cursor.pendingTask?.polls ?? 0, retryAfterSeconds: page.pending.retryAfterSeconds, providerRequests, costUsd: page.costUsd ?? null });
      return { status: "continue", delaySeconds: Math.max(1, Math.floor(page.pending.retryAfterSeconds)) };
    }

    const { unique } = dedupeCandidates(page.candidates);
    const keys = unique.map((candidate) => candidateDedupeKey(candidate));
    const known = await store.findKnownCandidates(campaign.id, keys);
    const { fresh, known: seenAgain } = partitionAgainstKnown(unique, new Set(known.keys()));

    const remainingCapacity = Math.max(candidateCap - candidatesSeen, 0);
    const toInsert = fresh.slice(0, remainingCapacity);
    const observed = now();
    const inserted = toInsert.length
      ? await store.insertCandidates(toInsert.map((input) => ({ workspaceId, campaignId: campaign.id, campaignRunId: run.id, input, sourceQuery: unit, expiresAt: expiresAt(observed, deps.config.discoveryCandidateTtlHours) })))
      : [];
    candidatesSeen += inserted.length;

    if (seenAgain.length) {
      await store.touchCandidates(seenAgain.map((candidate) => known.get(candidateDedupeKey(candidate))!.id), run.id, observed.toISOString());
    }

    // Every new (or still-pending) candidate gets its own idempotent resolution job.
    const pendingIds = [
      ...inserted.map((row) => row.id),
      ...seenAgain.map((candidate) => known.get(candidateDedupeKey(candidate))!).filter((row) => row.resolution_status === "pending").map((row) => row.id),
    ];
    for (const candidateId of pendingIds) {
      await store.enqueue({ workspaceId, type: CANDIDATE_RESOLVE_JOB, idempotencyKey: resolveJobIdempotencyKey(candidateId), payload: { candidateId, campaignId: campaign.id }, traceId: context.job.trace_id });
    }
    for (const row of inserted) {
      await store.recordDomainEvent({ workspaceId, aggregateType: "discovery_candidate", aggregateId: row.id, eventType: "candidate.discovered", payload: { campaignId: campaign.id, campaignRunId: run.id, provider: row.provider }, idempotencyKey: `candidate.discovered:${row.id}` });
    }

    // Ranking context is recorded for every stored candidate on the page, new or re-seen, so repeat runs
    // build a time series without re-creating candidates. Providers without ranking (Google Places) add nothing.
    const storedRows = new Map<string, { id: string; prospectId: string | null }>([...known].map(([key, row]) => [key, { id: row.id, prospectId: row.resolved_prospect_id ?? null }]));
    for (const row of inserted) storedRows.set(`${row.provider}:${row.provider_ref}`, { id: row.id, prospectId: null });
    const observations = unique.flatMap((candidate) => {
      const stored = storedRows.get(candidateDedupeKey(candidate));
      if (!candidate.rank || !stored) return [];
      return [{ workspaceId, campaignId: campaign.id, campaignRunId: run.id, candidateId: stored.id, prospectId: stored.prospectId, provider: candidate.provider, providerRef: candidate.providerRef, category: unit.category, location: unit.location, countryCode: campaign.country_code, position: candidate.rank.position, absolutePosition: candidate.rank.absolutePosition, rating: candidate.rating?.value ?? null, reviewCount: candidate.rating?.reviewCount ?? null, observedAt: candidate.observedAt }];
    });
    if (observations.length) await store.recordRankObservations(observations);

    const advanced = advanceCursor(cursor, page.nextPageToken, maxPages);
    cursor = advanced.cursor;
    if (advanced.unitCompleted) unitsCompleted += 1;

    await store.updateCampaignRun(run.id, { ...progress(), errorSummary: null });
    context.logger.info("discovery.page", { unit, inserted: inserted.length, seenAgain: seenAgain.length, ranked: observations.length, candidatesSeen, providerRequests: page.requestCount, costUsd: page.costUsd ?? null });
  }

  const unfinished = !isCursorFinished(cursor, units.length);
  const stoppedEarly = requestCapReached && unfinished
    ? `Stopped at the provider request cap (${maxRequests}) before all search units were exhausted.`
    : candidatesSeen >= candidateCap && unfinished
      ? `Stopped at the candidate cap (${candidateCap}) before all search units were exhausted.`
      : null;
  await store.updateCampaignRun(run.id, { status: "completed", finishedAt: now().toISOString(), ...progress(), errorSummary: stoppedEarly });
  await store.recordActivity({ workspaceId, campaignId: campaign.id, prospectId: null, eventType: "campaign.discovery_completed", summary: `Discovery run found ${candidatesSeen} candidate${candidatesSeen === 1 ? "" : "s"}.`, metadata: { campaignRunId: run.id, provider: provider.name, providerMode: provider.mode ?? null, providerRequests, providerCostUsd }, idempotencyKey: `campaign.discovery_completed:${run.id}` });
  return { status: "completed" };
}

export async function verifyCandidateWebsite(details: DiscoveryCandidateInput, probe: (url: string) => Promise<HttpProbeResult>, observedAt: string): Promise<WebsiteVerification> {
  // A Stage 1 candidate has not been asked about its website yet; an "unknown" hint must never count as a negative signal.
  const signals: WebsiteSignal[] = details.websiteHintState === "unknown" ? [] : signalsFromWebsiteHint({ source: "discovery_provider", url: details.websiteHint, observedAt });
  const urlToProbe = officialUrlToProbe(signals);

  if (urlToProbe) {
    const result = await probe(urlToProbe);
    if (result.ok) signals.push({ source: "http_probe", kind: "reachable", url: result.url, finalUrl: result.finalUrl, statusCode: result.statusCode, observedAt });
    else signals.push({ source: "http_probe", kind: "unreachable", url: result.url, reason: result.reason, statusCode: result.statusCode, observedAt });
  }

  return evaluateWebsiteSignals(signals);
}

function summaryHasContent(summary: Record<string, unknown>): summary is Record<string, unknown> & { providerRef: string } {
  return typeof summary.providerRef === "string" && summary.providerRef.length > 0;
}

/** How the candidate's Stage 2 contact fields were obtained for this resolution, recorded in the resolution notes. */
export type EnrichmentOutcome = "stored" | "fetched" | "skipped";

/**
 * Resolves one discovery candidate into a canonical prospect (or flags it).
 *
 * Stage 2 enrichment (website + phone) is the expensive provider call, so it runs at most once per
 * candidate and only after the cheaper checks have failed to settle the outcome:
 *   1. stored enriched content is reused (retries never re-fetch);
 *   2. nameless or permanently closed candidates are rejected on Stage 1 data alone;
 *   3. a place already attached to a prospect by source reference is attached without enrichment;
 *   4. everything else is enriched exactly once, then verified and matched.
 */
export async function resolveCandidate(payload: CandidateResolvePayload, context: Pick<JobContext, "job" | "logger">, deps: DiscoveryJobDependencies): Promise<JobOutcome> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const probe = deps.probe ?? ((url: string) => probeWebsite(url));
  const workspaceId = context.job.workspace_id;

  const candidate = await store.getCandidate(workspaceId, payload.candidateId);
  if (!candidate) throw new NonRetryableJobError("Candidate not found");
  if (candidate.resolution_status !== "pending") return { status: "completed" };

  await store.updateCandidate(candidate.id, { status: "resolving" });

  // The single Stage 2 provider call. Used for enrichment and for re-fetching purged content; never invoked twice in one run.
  const fetchDetails = async (): Promise<DiscoveryCandidateInput | null> => {
    let provider: DiscoveryProvider;
    try {
      provider = deps.getProvider();
    } catch (error) {
      await store.updateCandidate(candidate.id, { status: "failed", resolutionStatus: "failed", resolutionNotes: { reason: error instanceof Error ? error.message : "provider_unavailable" } });
      throw new NonRetryableJobError(error instanceof Error ? error.message : "Discovery provider unavailable");
    }
    try {
      return await provider.getReferenceDetails(candidate.provider_ref);
    } catch (error) {
      if (providerFailureIsFatal(error)) {
        await store.updateCandidate(candidate.id, { status: "failed", resolutionStatus: "failed", resolutionNotes: { reason: error instanceof Error ? error.message : "provider_error" } });
        throw new NonRetryableJobError(error instanceof Error ? error.message : "Discovery provider request failed");
      }
      await store.updateCandidate(candidate.id, { status: "new" });
      throw error;
    }
  };

  const storeDetails = async (details: DiscoveryCandidateInput): Promise<void> => {
    await store.updateCandidate(candidate.id, { summary: details, expiresAt: expiresAt(now(), deps.config.discoveryCandidateTtlHours), websiteHintState: details.websiteHintState });
  };

  const rejectUnavailable = async (): Promise<JobOutcome> => {
    await store.updateCandidate(candidate.id, { status: "resolved", resolutionStatus: "rejected", resolutionConfidence: 1, resolutionNotes: { reason: "reference_no_longer_available" } });
    return { status: "completed" };
  };

  let enrichment: EnrichmentOutcome = "stored";

  // Prefer the short-lived stored content; re-fetch from the provider once it has been purged.
  let details: DiscoveryCandidateInput | null = null;
  const contentFresh = !candidate.content_purged_at && (!candidate.expires_at || new Date(candidate.expires_at) > now()) && summaryHasContent(candidate.candidate_summary_json);
  if (contentFresh) {
    details = candidate.candidate_summary_json as unknown as DiscoveryCandidateInput;
  } else {
    details = await fetchDetails();
    enrichment = "fetched";
    if (details) await storeDetails(details);
  }
  if (!details) return rejectUnavailable();

  // Pre-screen on Stage 1 data: a nameless or permanently closed business never earns an enrichment call.
  const preScreen = decideResolution({ candidate: details, matches: [] });
  if (preScreen.resolution === "rejected") {
    if (!isEnrichedCandidate(details)) enrichment = "skipped";
    await store.updateCandidate(candidate.id, { status: "resolved", resolutionStatus: "rejected", resolutionConfidence: preScreen.confidence, resolutionNotes: { reason: preScreen.reason, warnings: preScreen.warnings, enrichment } });
    context.logger.info("candidate.resolved", { candidateId: candidate.id, resolution: "rejected", reason: preScreen.reason, enrichment });
    return { status: "completed" };
  }

  const observedAt = now().toISOString();

  const recordDecision = async (details: DiscoveryCandidateInput, decision: ResolutionDecision, verification: WebsiteVerification | null): Promise<void> => {
    switch (decision.resolution) {
      case "rejected": {
        await store.updateCandidate(candidate.id, { status: "resolved", resolutionStatus: "rejected", resolutionConfidence: decision.confidence, resolutionNotes: { reason: decision.reason, warnings: decision.warnings, websiteState: verification?.state ?? null, enrichment } });
        break;
      }
      case "ambiguous": {
        await store.updateCandidate(candidate.id, {
          status: "resolved",
          resolutionStatus: "ambiguous",
          resolutionConfidence: decision.confidence,
          resolutionNotes: { matchedIdentifiers: decision.matchedIdentifiers, candidateProspectIds: decision.candidateProspectIds, warnings: decision.warnings, websiteState: verification?.state ?? null, websiteUrl: verification?.websiteUrl ?? null, enrichment },
        });
        await store.recordActivity({ workspaceId, campaignId: candidate.campaign_id, prospectId: null, eventType: "candidate.ambiguous", summary: `Candidate needs manual review: possible match with ${decision.candidateProspectIds.length} existing prospect${decision.candidateProspectIds.length === 1 ? "" : "s"}.`, metadata: { candidateId: candidate.id, candidateProspectIds: decision.candidateProspectIds }, idempotencyKey: `candidate.ambiguous:${candidate.id}` });
        break;
      }
      case "matched": {
        await store.attachToProspect({ candidate, details, prospectId: decision.prospectId, verification, matchedIdentifiers: decision.matchedIdentifiers, now: observedAt });
        await store.updateCandidate(candidate.id, { status: "resolved", resolutionStatus: "matched", resolutionConfidence: decision.confidence, resolvedProspectId: decision.prospectId, resolutionNotes: { matchedIdentifiers: decision.matchedIdentifiers, warnings: decision.warnings, websiteState: verification?.state ?? null, enrichment } });
        break;
      }
      case "create": {
        if (!verification) throw new NonRetryableJobError("Cannot create a prospect before its website has been verified");
        const lookup = buildResolutionLookup({ workspaceId, candidate: details, verification });
        const record = buildNewProspectRecord({ workspaceId, candidate: details, verification, lookup, defaultCountryCode: "GB" });
        const { prospectId } = await store.createProspect({ candidate, details, record, verification, now: observedAt });
        await store.updateCandidate(candidate.id, { status: "resolved", resolutionStatus: "created", resolutionConfidence: decision.confidence, resolvedProspectId: prospectId, resolutionNotes: { warnings: decision.warnings, websiteState: verification.state, enrichment } });
        await store.recordDomainEvent({ workspaceId, aggregateType: "prospect", aggregateId: prospectId, eventType: "prospect.created", payload: { candidateId: candidate.id, campaignId: candidate.campaign_id, websiteState: verification.state }, idempotencyKey: `prospect.created:${prospectId}` });
        break;
      }
    }
    context.logger.info("candidate.resolved", { candidateId: candidate.id, resolution: decision.resolution, websiteState: verification?.state ?? null, enrichment });
  };

  // A place already attached to a prospect by its source reference is a duplicate of that prospect: attach without enrichment.
  if (!isEnrichedCandidate(details)) {
    const identityMatches = await store.findMatches(buildResolutionLookup({ workspaceId, candidate: details, verification: null }));
    if (identityMatches.some((match) => match.matchedBy === "source_ref")) {
      const decision = decideResolution({ candidate: details, matches: identityMatches });
      if (decision.resolution === "matched" || decision.resolution === "ambiguous") {
        enrichment = "skipped";
        await recordDecision(details, decision, null);
        return { status: "completed" };
      }
    }
  }

  // Stage 2: enrich the survivor exactly once, then verify and match with the full identifier set.
  if (!isEnrichedCandidate(details)) {
    const enriched = await fetchDetails();
    enrichment = "fetched";
    if (!enriched) return rejectUnavailable();
    details = enriched;
    await storeDetails(enriched);
  }

  const verification = await verifyCandidateWebsite(details, probe, observedAt);
  const lookup = buildResolutionLookup({ workspaceId, candidate: details, verification });
  const matches = await store.findMatches(lookup);
  await recordDecision(details, decideResolution({ candidate: details, matches }), verification);
  return { status: "completed" };
}

export function registerDiscoveryJobs(registry: JobRegistry, deps: DiscoveryJobDependencies): JobRegistry {
  registry.register(DISCOVERY_RUN_JOB, discoveryRunPayloadSchema, (payload, context) => runDiscovery(payload, context, deps));
  registry.register(CANDIDATE_RESOLVE_JOB, candidateResolvePayloadSchema, (payload, context) => resolveCandidate(payload, context, deps));
  return registry;
}
