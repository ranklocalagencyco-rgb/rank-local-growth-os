"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getRuntimeConfig } from "@/config/env";
import { getSupabaseAdminClient } from "@/db/client";
import { DiscoveryRequestError, requestDiscoveryRun } from "@/discovery/run";
import { getWorkspaceContext } from "@/domain/workspaces";
import { runJobBatch } from "@/jobs/app-registry";

function campaignIdFrom(formData: FormData): string {
  const value = formData.get("campaignId");
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid campaign id");
  return value;
}

function back(campaignId: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}${query ? `?${query}` : ""}`);
}

export async function runDiscoveryAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdFrom(formData);
  const client = getSupabaseAdminClient();
  if (!client) back(campaignId, { error: "Supabase service role configuration is required to run discovery." });

  const context = getWorkspaceContext();
  try {
    await requestDiscoveryRun(client, { workspaceId: context.workspaceId, campaignId, userId: context.userId });
  } catch (error) {
    if (error instanceof DiscoveryRequestError) back(campaignId, { error: error.message });
    back(campaignId, { error: "Unable to queue the discovery run. Check the server logs and that migration 004 has been applied." });
  }
  back(campaignId, { notice: "Discovery run queued." });
}

/** Local-only convenience: process one bounded batch of jobs without a separate worker process. */
export async function processJobsNowAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdFrom(formData);
  if (getRuntimeConfig().appEnv !== "local") back(campaignId, { error: "Manual job processing is only available in the local environment." });

  try {
    const result = await runJobBatch({ workerId: "local-ui", limit: 10, timeBudgetMs: 20_000 });
    if (!result) back(campaignId, { error: "Supabase service role configuration is required to process jobs." });
    back(campaignId, { notice: `Processed ${result.claimed} job${result.claimed === 1 ? "" : "s"}: ${result.completed} completed, ${result.continued} continued, ${result.failed} failed, ${result.deadLettered} dead-lettered.` });
  } catch (error) {
    back(campaignId, { error: error instanceof Error ? error.message : "Unable to process jobs." });
  }
}
