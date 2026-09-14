import type { SupabaseClient } from "@supabase/supabase-js";

import { getRuntimeConfig } from "@/config/env";
import type { Database, DiscoveryCandidate } from "@/db/types";
import type { DiscoveryProviderName } from "@/discovery/provider";
import { getDiscoveryProvider } from "@/discovery/providers/registry";
import { CANDIDATE_RESOLVE_JOB, DISCOVERY_RUN_JOB, executeCandidateResolution, executeDiscoveryRun, markCandidateFailed, markRunFailed, type CandidateResolvePayload, type DiscoveryRunPayload } from "@/discovery/service";
import { SupabaseProspectMatchRepository } from "@/discovery/supabase-repository";
import type { JobQueue } from "@/jobs/queue";
import { NonRetryableJobError, type HandlerRegistry } from "@/jobs/worker";
import { HttpWebsiteFetcher } from "@/verification/fetcher";
import { WebsiteVerifier } from "@/verification/website-verifier";

export function createJobHandlers(client: SupabaseClient<Database>, queue: JobQueue): HandlerRegistry {
  const verifier = new WebsiteVerifier({ fetcher: new HttpWebsiteFetcher() });
  const repository = new SupabaseProspectMatchRepository(client);

  const verify = (candidate: DiscoveryCandidate) => {
    const summary = candidate.candidate_summary_json as { countryCode?: string | null };
    return verifier.verify({
      provider: candidate.provider as DiscoveryProviderName,
      externalRef: candidate.provider_ref,
      businessName: candidate.candidate_name,
      phone: candidate.candidate_phone,
      locality: candidate.candidate_locality,
      postcode: candidate.candidate_postcode,
      countryCode: summary.countryCode ?? "GB",
      websiteHint: candidate.candidate_website_hint,
      websiteHintState: candidate.candidate_website_state,
    });
  };

  return {
    [DISCOVERY_RUN_JOB]: async (payload, context) => {
      const input = payload as DiscoveryRunPayload;
      try {
        const provider = getDiscoveryProvider(getRuntimeConfig());
        const result = await executeDiscoveryRun({ client, queue, provider }, input);
        context.logger.info("discovery.run.searched", result);
      } catch (error) {
        const finalAttempt = context.job.attempts >= context.job.max_attempts;
        if (error instanceof NonRetryableJobError || finalAttempt || (typeof error === "object" && error !== null && "retryable" in error && (error as { retryable?: boolean }).retryable === false)) {
          await markRunFailed(client, input.runId, error instanceof Error ? error.message : "Discovery failed");
        }
        throw error;
      }
    },
    [CANDIDATE_RESOLVE_JOB]: async (payload, context) => {
      const input = payload as CandidateResolvePayload;
      try {
        const decision = await executeCandidateResolution({ client, repository, verify }, input);
        context.logger.info("candidate.resolved", { resolution: decision?.resolution ?? "skipped" });
      } catch (error) {
        if (error instanceof NonRetryableJobError || context.job.attempts >= context.job.max_attempts) {
          await markCandidateFailed(client, input.candidateId, input.runId, error instanceof Error ? error.message : "Resolution failed");
        }
        throw error;
      }
    },
  };
}
