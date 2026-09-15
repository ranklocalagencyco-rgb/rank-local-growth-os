import type { Campaign, CampaignRun, CandidateResolutionStatus, CandidateStatus, DiscoveryCandidate } from "@/db/types";
import type { DiscoveryCandidateInput } from "@/discovery/provider";
import type { ExistingProspectMatch, NewProspectRecord, ResolutionLookup } from "@/discovery/resolver";
import type { WebsiteVerification } from "@/discovery/website/verify";

// Persistence contract used by the discovery job handlers.
// Implemented by Supabase in src/data/discovery-store.ts and by an in-memory store in tests.

export type CandidateInsert = {
  workspaceId: string;
  campaignId: string;
  campaignRunId: string;
  input: DiscoveryCandidateInput;
  sourceQuery: { category: string; location: string };
  expiresAt: string;
};

export type CandidatePatch = Partial<{
  status: CandidateStatus;
  resolutionStatus: CandidateResolutionStatus;
  resolutionConfidence: number | null;
  resolutionNotes: Record<string, unknown>;
  resolvedProspectId: string | null;
  summary: DiscoveryCandidateInput;
  expiresAt: string;
  websiteHintState: DiscoveryCandidateInput["websiteHintState"];
}>;

export type CampaignRunPatch = Partial<{
  status: CampaignRun["status"];
  startedAt: string | null;
  finishedAt: string | null;
  cursor: Record<string, unknown>;
  candidatesSeen: number;
  searchUnitsTotal: number;
  searchUnitsCompleted: number;
  providerRequests: number;
  providerCostUsd: number;
  provider: string;
  providerMode: string | null;
  errorSummary: string | null;
}>;

/** One ranking observation for a candidate seen on a provider results page. Idempotent per run + unit + reference. */
export type RankObservationInsert = {
  workspaceId: string;
  campaignId: string;
  campaignRunId: string;
  candidateId: string;
  /** Known at insert time when the candidate already resolved on an earlier run; otherwise linked at resolution. */
  prospectId: string | null;
  provider: string;
  providerRef: string;
  category: string;
  location: string;
  countryCode: string;
  position: number;
  absolutePosition: number | null;
  rating: number | null;
  reviewCount: number | null;
  observedAt: string;
};

export type CreateProspectInput = {
  candidate: DiscoveryCandidate;
  details: DiscoveryCandidateInput;
  record: NewProspectRecord;
  verification: WebsiteVerification;
  now: string;
};

export type AttachProspectInput = {
  candidate: DiscoveryCandidate;
  details: DiscoveryCandidateInput;
  prospectId: string;
  /** Null when the candidate matched by source reference before enrichment, so no website check was run. */
  verification: WebsiteVerification | null;
  matchedIdentifiers: string[];
  now: string;
};

export interface DiscoveryStore {
  getCampaign(workspaceId: string, campaignId: string): Promise<Campaign | null>;
  getCampaignRun(workspaceId: string, runId: string): Promise<CampaignRun | null>;
  updateCampaignRun(runId: string, patch: CampaignRunPatch): Promise<void>;

  /** Returns existing candidates for the campaign keyed by dedupe key. */
  findKnownCandidates(campaignId: string, keys: string[]): Promise<Map<string, Pick<DiscoveryCandidate, "id" | "resolution_status" | "resolved_prospect_id">>>;
  insertCandidates(rows: CandidateInsert[]): Promise<Pick<DiscoveryCandidate, "id" | "provider" | "provider_ref">[]>;
  touchCandidates(candidateIds: string[], campaignRunId: string, lastSeenAt: string): Promise<void>;
  getCandidate(workspaceId: string, candidateId: string): Promise<DiscoveryCandidate | null>;
  updateCandidate(candidateId: string, patch: CandidatePatch): Promise<void>;

  /** Stores ranking observations (no-op for providers without ranking context). Must be idempotent. */
  recordRankObservations(rows: RankObservationInsert[]): Promise<void>;

  findMatches(lookup: ResolutionLookup): Promise<ExistingProspectMatch[]>;
  createProspect(input: CreateProspectInput): Promise<{ prospectId: string }>;
  attachToProspect(input: AttachProspectInput): Promise<void>;

  enqueue(input: { workspaceId: string; type: string; idempotencyKey: string; payload: Record<string, unknown>; traceId?: string }): Promise<void>;
  recordActivity(input: { workspaceId: string; campaignId: string | null; prospectId: string | null; eventType: string; summary: string; metadata?: Record<string, unknown>; idempotencyKey: string }): Promise<void>;
  recordDomainEvent(input: { workspaceId: string; aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, unknown>; idempotencyKey: string }): Promise<void>;
}
