import { getRuntimeConfig } from "@/config/env";
import { createSupabaseDiscoveryStore } from "@/data/discovery-store";
import { getSupabaseAdminClient } from "@/db/client";
import { registerDiscoveryJobs } from "@/discovery/jobs";
import { getDiscoveryProvider } from "@/discovery/providers/registry";
import { JobRegistry, processJobs, type ProcessJobsSummary } from "@/jobs/processor";
import type { DbClient } from "@/jobs/queue";

/** Wires every background job type the application knows about. */
export function createAppJobRegistry(client: DbClient): JobRegistry {
  const config = getRuntimeConfig();
  const registry = new JobRegistry();
  registerDiscoveryJobs(registry, { store: createSupabaseDiscoveryStore(client), getProvider: getDiscoveryProvider, config });
  return registry;
}

export type JobBatchResult = ProcessJobsSummary & { purgedCandidates: number };

/** Runs one bounded batch of queued jobs. Returns null when the database is not configured. */
export async function runJobBatch(options: { workerId: string; limit?: number; timeBudgetMs?: number }): Promise<JobBatchResult | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;

  const purge = await client.rpc("purge_expired_discovery_content", {});
  const purgedCandidates = purge.error ? 0 : purge.data ?? 0;

  const summary = await processJobs({ client, registry: createAppJobRegistry(client), workerId: options.workerId, limit: options.limit, timeBudgetMs: options.timeBudgetMs });
  return { ...summary, purgedCandidates };
}
