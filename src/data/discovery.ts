import { getSupabaseAdminClient } from "@/db/client";
import type { Campaign, CampaignRun, DiscoveryCandidate, JobRow, LocalRankObservation, Prospect } from "@/db/types";
import { CANDIDATE_RESOLVE_JOB, DISCOVERY_RUN_JOB } from "@/discovery/jobs";

export type ResolvedProspectSummary = Pick<Prospect, "id" | "display_name" | "website_state" | "website_url" | "canonical_domain">;

export type ResolveJobCounts = { queued: number; running: number; failed: number; deadLetter: number };

export type CampaignDetail = {
  databaseConfigured: boolean;
  campaign: Campaign | null;
  runs: CampaignRun[];
  candidates: DiscoveryCandidate[];
  prospectsById: Map<string, ResolvedProspectSummary>;
  runJobsById: Map<string, JobRow>;
  /** Most recent ranking observation per candidate, when the provider reported one. */
  rankByCandidateId: Map<string, LocalRankObservation>;
  resolveJobs: ResolveJobCounts;
};

const EMPTY_DETAIL: CampaignDetail = { databaseConfigured: false, campaign: null, runs: [], candidates: [], prospectsById: new Map(), runJobsById: new Map(), rankByCandidateId: new Map(), resolveJobs: { queued: 0, running: 0, failed: 0, deadLetter: 0 } };

export async function getCampaignDetail(workspaceId: string, campaignId: string): Promise<CampaignDetail> {
  const client = getSupabaseAdminClient();
  if (!client) return EMPTY_DETAIL;

  const campaignResult = await client.from("campaigns").select("*").eq("workspace_id", workspaceId).eq("id", campaignId).maybeSingle();
  if (campaignResult.error) throw new Error(`Unable to load campaign: ${campaignResult.error.message}`);
  if (!campaignResult.data) return { ...EMPTY_DETAIL, databaseConfigured: true };

  const [runsResult, candidatesResult, resolveJobsResult] = await Promise.all([
    client.from("campaign_runs").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(10),
    client.from("discovery_candidates").select("*").eq("workspace_id", workspaceId).eq("campaign_id", campaignId).order("first_seen_at", { ascending: false }).limit(200),
    client.from("jobs").select("id,status").eq("workspace_id", workspaceId).eq("type", CANDIDATE_RESOLVE_JOB).eq("payload->>campaignId", campaignId).in("status", ["queued", "running", "failed", "dead_letter"]),
  ]);
  if (runsResult.error) throw new Error(`Unable to load campaign runs: ${runsResult.error.message}`);
  if (candidatesResult.error) throw new Error(`Unable to load discovery candidates: ${candidatesResult.error.message}`);
  if (resolveJobsResult.error) throw new Error(`Unable to load resolution jobs: ${resolveJobsResult.error.message}`);

  const runs = runsResult.data ?? [];
  const candidates = candidatesResult.data ?? [];

  const prospectIds = [...new Set(candidates.map((candidate) => candidate.resolved_prospect_id).filter((id): id is string => Boolean(id)))];
  const runJobIds = runs.map((run) => run.job_id).filter((id): id is string => Boolean(id));

  const candidateIds = candidates.map((candidate) => candidate.id);

  const [prospectsResult, runJobsResult, ranksResult] = await Promise.all([
    prospectIds.length ? client.from("prospects").select("id,display_name,website_state,website_url,canonical_domain").eq("workspace_id", workspaceId).in("id", prospectIds) : Promise.resolve({ data: [] as ResolvedProspectSummary[], error: null }),
    runJobIds.length ? client.from("jobs").select("*").eq("workspace_id", workspaceId).eq("type", DISCOVERY_RUN_JOB).in("id", runJobIds) : Promise.resolve({ data: [] as JobRow[], error: null }),
    candidateIds.length ? client.from("local_rank_observations").select("*").eq("workspace_id", workspaceId).in("candidate_id", candidateIds).order("observed_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [] as LocalRankObservation[], error: null }),
  ]);
  if (prospectsResult.error) throw new Error(`Unable to load resolved prospects: ${prospectsResult.error.message}`);
  if (runJobsResult.error) throw new Error(`Unable to load discovery jobs: ${runJobsResult.error.message}`);
  if (ranksResult.error) throw new Error(`Unable to load ranking observations: ${ranksResult.error.message}`);

  // Rows arrive newest first, so the first observation per candidate is the latest.
  const rankByCandidateId = new Map<string, LocalRankObservation>();
  for (const observation of ranksResult.data ?? []) {
    if (observation.candidate_id && !rankByCandidateId.has(observation.candidate_id)) rankByCandidateId.set(observation.candidate_id, observation);
  }

  const resolveJobs: ResolveJobCounts = { queued: 0, running: 0, failed: 0, deadLetter: 0 };
  for (const job of resolveJobsResult.data ?? []) {
    if (job.status === "queued") resolveJobs.queued += 1;
    else if (job.status === "running") resolveJobs.running += 1;
    else if (job.status === "failed") resolveJobs.failed += 1;
    else if (job.status === "dead_letter") resolveJobs.deadLetter += 1;
  }

  return {
    databaseConfigured: true,
    campaign: campaignResult.data,
    runs,
    candidates,
    prospectsById: new Map((prospectsResult.data ?? []).map((prospect) => [prospect.id, prospect])),
    runJobsById: new Map((runJobsResult.data ?? []).map((job) => [job.id, job])),
    rankByCandidateId,
    resolveJobs,
  };
}

export async function getCandidateCounts(workspaceId: string, campaignIds: string[]): Promise<Map<string, number>> {
  const client = getSupabaseAdminClient();
  const counts = new Map<string, number>();
  if (!client || campaignIds.length === 0) return counts;

  const { data, error } = await client.from("discovery_candidates").select("campaign_id").eq("workspace_id", workspaceId).in("campaign_id", campaignIds);
  if (error) throw new Error(`Unable to count candidates: ${error.message}`);
  for (const row of data ?? []) counts.set(row.campaign_id, (counts.get(row.campaign_id) ?? 0) + 1);
  return counts;
}
