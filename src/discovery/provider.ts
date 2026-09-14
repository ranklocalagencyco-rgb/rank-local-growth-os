// Provider-neutral business discovery contract (RL-030).
// The application depends only on this module; concrete adapters live in ./providers.

export type DiscoveryProviderName = "google_places";

export type WebsiteHintState = "present" | "absent" | "unknown";

export type BusinessStatusHint = "operational" | "closed_temporarily" | "closed_permanently" | "unknown";

export type DiscoverySearchQuery = {
  category: string;
  location: string;
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  countryCode: string;
  languageCode?: string;
  pageToken?: string | null;
  pageSize?: number;
};

/**
 * Minimal, provider-neutral description of a discovered business.
 * Everything except `providerRef` is treated as short-lived provider content
 * and is subject to the provider's retention rules.
 */
export type DiscoveryCandidateInput = {
  provider: DiscoveryProviderName;
  /** Durable provider reference (e.g. Google place ID). */
  providerRef: string;
  displayName: string | null;
  formattedAddress: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  countryCode: string | null;
  primaryCategory: string | null;
  categories: string[];
  websiteHint: string | null;
  websiteHintState: WebsiteHintState;
  phoneHint: string | null;
  businessStatus: BusinessStatusHint;
  /** Attribution text that must accompany any display of provider content. */
  attribution: string;
  observedAt: string;
};

export type DiscoverySearchResult = {
  candidates: DiscoveryCandidateInput[];
  nextPageToken: string | null;
  requestCount: number;
};

export type DiscoveryProviderRetentionPolicy = {
  /** Provider references may be stored durably as source identifiers. */
  referenceRetention: "indefinite";
  /** All other returned content must expire from our storage. */
  contentRetention: "expiring";
  attributionRequired: boolean;
  attributionText: string;
};

export interface DiscoveryProvider {
  readonly name: DiscoveryProviderName;
  readonly retention: DiscoveryProviderRetentionPolicy;
  searchCandidates(query: DiscoverySearchQuery): Promise<DiscoverySearchResult>;
  getReferenceDetails(providerRef: string): Promise<DiscoveryCandidateInput | null>;
}

export type DiscoveryProviderErrorCode = "not_configured" | "auth" | "quota" | "invalid_request" | "unavailable" | "unknown";

export class DiscoveryProviderError extends Error {
  readonly code: DiscoveryProviderErrorCode;
  readonly retryable: boolean;

  constructor(message: string, code: DiscoveryProviderErrorCode, retryable: boolean) {
    super(message);
    this.name = "DiscoveryProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function candidateDedupeKey(candidate: Pick<DiscoveryCandidateInput, "provider" | "providerRef">): string {
  return `${candidate.provider}:${candidate.providerRef}`;
}
