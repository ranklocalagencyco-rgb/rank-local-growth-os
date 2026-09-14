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
  provider: string;
  errorSummary: string | null;
}>;

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
  verification: WebsiteVerification;
  matchedIdentifiers: string[];
  now: string;
};

export interface DiscoveryStore {
  getCampaign(workspaceId: string, campaignId: string): Promise<Campaign | null>;
  getCampaignRun(workspaceId: string, runId: string): Promise<CampaignRun | null>;
  updateCampaignRun(runId: string, patch: CampaignRunPatch): Promise<void>;

  /** Returns existing candidates for the campaign keyed by dedupe key. */
  findKnownCandidates(campaignId: string, keys: string[]): Promise<Map<string, Pick<DiscoveryCandidate, "id" | "resolution_status">>>;
  insertCandidates(rows: CandidateInsert[]): Promise<Pick<DiscoveryCandidate, "id" | "provider" | "provider_ref">[]>;
  touchCandidates(candidateIds: string[], campaignRunId: string, lastSeenAt: string): Promise<void>;
  getCandidate(workspaceId: string, candidateId: string): Promise<DiscoveryCandidate | null>;
  updateCandidate(candidateId: string, patch: CandidatePatch): Promise<void>;

  findMatches(lookup: ResolutionLookup): Promise<ExistingProspectMatch[]>;
  createProspect(input: CreateProspectInput): Promise<{ prospectId: string }>;
  attachToProspect(input: AttachProspectInput): Promise<void>;

  enqueue(input: { workspaceId: string; type: string; idempotencyKey: string; payload: Record<string, unknown>; traceId?: string }): Promise<void>;
  recordActivity(input: { workspaceId: string; campaignId: string | null; prospectId: string | null; eventType: string; summary: string; metadata?: Record<string, unknown>; idempotencyKey: string }): Promise<void>;
  recordDomainEvent(input: { workspaceId: string; aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, unknown>; idempotencyKey: string }): Promise<void>;
}
