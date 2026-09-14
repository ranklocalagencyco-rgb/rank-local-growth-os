import type { DiscoveryProviderName } from "@/discovery/provider";

export type RetentionClass =
  | "canonical_business_data"
  | "temporary_discovery_data"
  | "personal_contact_data"
  | "provider_restricted_data"
  | "audit_evidence"
  | "communication_record"
  | "suppression_record"
  | "operational_log"
  | "provider_reference";

export type ProviderRetentionRule = {
  /** Retention class for the durable external reference (e.g. Google place ID). */
  referenceRetention: RetentionClass;
  /** Retention class for provider-returned content (names, addresses, website hints). */
  contentRetention: RetentionClass;
  /** Maximum days provider content may be held before it must be purged or refreshed. */
  contentTtlDays: number;
  /** Attribution text that must accompany provider-derived content in the UI. */
  attribution: string | null;
};

/**
 * Google Places policy: place IDs are exempt from caching restrictions and may be stored;
 * other Places content is subject to short-lived caching limits (30 days at the time of writing).
 * Review against current Google Maps Platform terms before production (MASTER_BUILD_SPEC §9.1).
 */
export const PROVIDER_RETENTION_RULES: Record<DiscoveryProviderName, ProviderRetentionRule> = {
  google_places: {
    referenceRetention: "provider_reference",
    contentRetention: "temporary_discovery_data",
    contentTtlDays: 30,
    attribution: "Business discovery data from Google",
  },
  fake: {
    referenceRetention: "provider_reference",
    contentRetention: "temporary_discovery_data",
    contentTtlDays: 30,
    attribution: null,
  },
};

export function getRetentionRule(provider: DiscoveryProviderName, overrideTtlDays?: number): ProviderRetentionRule {
  const rule = PROVIDER_RETENTION_RULES[provider];
  if (overrideTtlDays === undefined) return rule;
  return { ...rule, contentTtlDays: Math.min(rule.contentTtlDays, overrideTtlDays) };
}

export function computeExpiry(rule: ProviderRetentionRule, now = new Date()): string {
  return new Date(now.getTime() + rule.contentTtlDays * 24 * 60 * 60 * 1000).toISOString();
}
