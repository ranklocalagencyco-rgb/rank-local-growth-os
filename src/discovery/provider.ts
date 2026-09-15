// Provider-neutral business discovery contract (RL-030).
// The application depends only on this module; concrete adapters live in ./providers.
//
// Discovery is a two-stage flow so that broad searches never pay for contact fields:
//   Stage 1 (searchCandidates)     — cheap identity fields only; enough to store, display and dedupe.
//   Stage 2 (getReferenceDetails)  — website + contact fields for one candidate that survived
//                                    dedupe and pre-screening and actually needs verification.

export type DiscoveryProviderName = "dataforseo" | "google_places";

export type WebsiteHintState = "present" | "absent" | "unknown";

export type BusinessStatusHint = "operational" | "closed_temporarily" | "closed_permanently" | "unknown";

export type DiscoverySearchQuery = {
  category: string;
  location: string;
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  countryCode: string;
  languageCode?: string;
  pageToken?: string | null;
  /** Optional upper bound on results for this request; providers clamp it to their own limits. */
  pageSize?: number;
  /**
   * Reference of a deferred search the provider previously returned as `pending`. When set, the
   * provider retrieves that task's result instead of starting a new (billable) search.
   */
  pendingTaskRef?: string | null;
};

/** Position of a listing in the provider's local search results, kept apart from business identity. */
export type DiscoveryRankHint = {
  /** Position among organic local listings (ads excluded). 1-based. */
  position: number;
  /** Position among every element of the result set, ads included. */
  absolutePosition: number | null;
};

export type DiscoveryRatingHint = {
  value: number;
  reviewCount: number | null;
};

export type DiscoveryCoordinates = {
  latitude: number;
  longitude: number;
};

/**
 * Minimal, provider-neutral description of a discovered business.
 * Everything except `providerRef` is treated as short-lived provider content
 * and is subject to the provider's retention rules.
 *
 * Stage 1 results carry identity fields only: `websiteHint` and `phoneHint` are null,
 * `websiteHintState` is "unknown" and `enrichedAt` is null. Stage 2 fills the contact
 * fields and stamps `enrichedAt`.
 */
export type DiscoveryCandidateInput = {
  provider: DiscoveryProviderName;
  /** Durable provider reference (a Google place ID for both current providers). */
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
  /** When the Stage 2 contact fields were fetched; null until enrichment has run. */
  enrichedAt: string | null;
  /** Local search ranking context, when the provider returns ranked results (DataForSEO Maps). Absent for Google Places. */
  rank?: DiscoveryRankHint | null;
  rating?: DiscoveryRatingHint | null;
  coordinates?: DiscoveryCoordinates | null;
};

/** A search the provider accepted but has not finished; the caller must call again later with `pendingTaskRef`. */
export type DiscoveryPendingTask = {
  taskRef: string;
  /** Suggested wait before retrieving the result. */
  retryAfterSeconds: number;
};

export type DiscoverySearchResult = {
  candidates: DiscoveryCandidateInput[];
  nextPageToken: string | null;
  /** Billable provider requests made by this call. Free polling/retrieval calls are not counted. */
  requestCount: number;
  /** Provider-reported charge for this call in USD, when the provider returns one. Accumulated on the campaign run. */
  costUsd?: number | null;
  /** Set when the provider queued the search instead of answering it; `candidates` is then empty. */
  pending?: DiscoveryPendingTask | null;
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
  /** Provider execution mode (e.g. DataForSEO standard/priority/live), recorded on each run when present. */
  readonly mode?: string;
  /**
   * Stage 1 — broad discovery. One request per page. Must never pay extra for contact fields:
   * a provider that prices by field (Google Places) requests identity fields only, while a provider
   * whose search results already include website and phone at no extra cost (DataForSEO) returns
   * candidates stamped as enriched so Stage 2 is skipped entirely.
   *
   * A provider may answer with `pending` instead of candidates when it queues the search; the caller
   * persists `pending.taskRef`, waits, and calls again with `pendingTaskRef` set to retrieve the result.
   */
  searchCandidates(query: DiscoverySearchQuery): Promise<DiscoverySearchResult>;
  /**
   * Stage 2 — selective enrichment. One request per candidate. Returns the full candidate
   * including website and contact fields, or null when the reference no longer exists.
   * Only call this for candidates that survived dedupe and pre-screening.
   */
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

/** True once Stage 2 contact fields are present, so a retry never pays for enrichment twice. */
export function isEnrichedCandidate(candidate: Pick<DiscoveryCandidateInput, "enrichedAt">): boolean {
  return typeof candidate.enrichedAt === "string" && candidate.enrichedAt.length > 0;
}
