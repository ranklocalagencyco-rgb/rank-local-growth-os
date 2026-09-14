import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Prospect } from "@/db/types";
import type { DiscoveryProviderName } from "@/discovery/provider";
import type { ProspectMatch, ProspectMatchRepository } from "@/discovery/resolver";

function toMatch(row: Pick<Prospect, "id" | "display_name" | "normalized_name" | "canonical_domain" | "primary_phone" | "city" | "postcode">): ProspectMatch {
  return { id: row.id, displayName: row.display_name, normalizedName: row.normalized_name, canonicalDomain: row.canonical_domain, primaryPhone: row.primary_phone, city: row.city, postcode: row.postcode };
}

const MATCH_COLUMNS = "id, display_name, normalized_name, canonical_domain, primary_phone, city, postcode";

export class SupabaseProspectMatchRepository implements ProspectMatchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findBySourceRef(workspaceId: string, provider: DiscoveryProviderName, externalRef: string): Promise<ProspectMatch | null> {
    const ref = await this.client.from("prospect_source_refs").select("prospect_id").eq("workspace_id", workspaceId).eq("provider", provider).eq("external_id", externalRef).maybeSingle();
    if (ref.error) throw new Error(`Unable to look up source reference: ${ref.error.message}`);
    if (!ref.data) return null;
    const prospect = await this.client.from("prospects").select(MATCH_COLUMNS).eq("workspace_id", workspaceId).eq("id", ref.data.prospect_id).maybeSingle();
    if (prospect.error) throw new Error(`Unable to load prospect: ${prospect.error.message}`);
    return prospect.data ? toMatch(prospect.data) : null;
  }

  async findByDomain(workspaceId: string, domain: string): Promise<ProspectMatch[]> {
    const { data, error } = await this.client.from("prospects").select(MATCH_COLUMNS).eq("workspace_id", workspaceId).eq("canonical_domain", domain).neq("status", "archived");
    if (error) throw new Error(`Unable to match by domain: ${error.message}`);
    return (data ?? []).map(toMatch);
  }

  async findByPhone(workspaceId: string, phone: string): Promise<ProspectMatch[]> {
    const { data, error } = await this.client.from("prospects").select(MATCH_COLUMNS).eq("workspace_id", workspaceId).eq("primary_phone", phone).neq("status", "archived");
    if (error) throw new Error(`Unable to match by phone: ${error.message}`);
    return (data ?? []).map(toMatch);
  }

  async findByNormalizedName(workspaceId: string, normalizedName: string): Promise<ProspectMatch[]> {
    const { data, error } = await this.client.from("prospects").select(MATCH_COLUMNS).eq("workspace_id", workspaceId).eq("normalized_name", normalizedName).neq("status", "archived");
    if (error) throw new Error(`Unable to match by name: ${error.message}`);
    return (data ?? []).map(toMatch);
  }
}
