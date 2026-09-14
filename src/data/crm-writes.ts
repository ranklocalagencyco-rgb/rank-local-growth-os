import { revalidatePath } from "next/cache";

import { getSupabaseAdminClient } from "@/db/client";
import { normalizeBusinessName, parseCampaignForm, parseProspectForm } from "@/domain/crm";

export async function createCampaign(workspaceId: string, formData: FormData): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase service role configuration is required to create records");

  const input = parseCampaignForm(formData);
  const { error } = await client.from("campaigns").insert({
    workspace_id: workspaceId,
    name: input.name,
    target_categories: input.targetCategories,
    target_locations: input.targetLocations,
    website_filter: input.websiteFilter,
    created_by: null,
  });

  if (error) throw new Error(`Unable to create campaign: ${error.message}`);
  revalidatePath("/");
  revalidatePath("/campaigns");
}

export async function createProspect(workspaceId: string, formData: FormData): Promise<void> {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase service role configuration is required to create records");

  const input = parseProspectForm(formData);
  const { error } = await client.from("prospects").insert({
    workspace_id: workspaceId,
    display_name: input.displayName,
    normalized_name: normalizeBusinessName(input.displayName),
    canonical_domain: input.canonicalDomain,
    primary_phone: input.primaryPhone,
    primary_email: input.primaryEmail,
    country_code: input.countryCode,
    region: input.region,
    city: input.city,
    postcode: input.postcode,
  });

  if (error) throw new Error(`Unable to create prospect: ${error.message}`);
  revalidatePath("/");
  revalidatePath("/prospects");
}
