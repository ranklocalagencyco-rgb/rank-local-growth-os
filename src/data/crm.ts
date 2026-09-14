import { getSupabaseAdminClient } from "@/db/client";
import type { ActivityEvent, Campaign, Prospect, ProspectSourceRef, Suppression } from "@/db/types";

export async function getCampaigns(workspaceId: string): Promise<Campaign[]> {
  const client = getSupabaseAdminClient();
  if (!client) return [];

  const { data, error } = await client.from("campaigns").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (error) throw new Error(`Unable to load campaigns: ${error.message}`);
  return data ?? [];
}

export async function getProspects(workspaceId: string): Promise<Prospect[]> {
  const client = getSupabaseAdminClient();
  if (!client) return [];

  const { data, error } = await client.from("prospects").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
  if (error) throw new Error(`Unable to load prospects: ${error.message}`);
  return data ?? [];
}

export async function getProspectDetail(workspaceId: string, prospectId: string): Promise<{
  prospect: Prospect | null;
  sourceRefs: ProspectSourceRef[];
  activity: ActivityEvent[];
  suppressions: Suppression[];
}> {
  const client = getSupabaseAdminClient();
  if (!client) return { prospect: null, sourceRefs: [], activity: [], suppressions: [] };

  const [prospectResult, sourceResult, activityResult, suppressionResult] = await Promise.all([
    client.from("prospects").select("*").eq("workspace_id", workspaceId).eq("id", prospectId).maybeSingle(),
    client.from("prospect_source_refs").select("*").eq("workspace_id", workspaceId).eq("prospect_id", prospectId).order("first_seen_at", { ascending: false }),
    client.from("activity_events").select("*").eq("workspace_id", workspaceId).eq("prospect_id", prospectId).order("created_at", { ascending: false }),
    client.from("suppressions").select("*").eq("workspace_id", workspaceId).eq("prospect_id", prospectId).order("created_at", { ascending: false }),
  ]);

  if (prospectResult.error) throw new Error(`Unable to load prospect: ${prospectResult.error.message}`);
  if (sourceResult.error) throw new Error(`Unable to load source references: ${sourceResult.error.message}`);
  if (activityResult.error) throw new Error(`Unable to load activity: ${activityResult.error.message}`);
  if (suppressionResult.error) throw new Error(`Unable to load suppressions: ${suppressionResult.error.message}`);

  return {
    prospect: prospectResult.data,
    sourceRefs: sourceResult.data ?? [],
    activity: activityResult.data ?? [],
    suppressions: suppressionResult.data ?? [],
  };
}
