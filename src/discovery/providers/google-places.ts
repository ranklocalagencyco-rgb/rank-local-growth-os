import {
  DiscoveryProviderError,
  type BusinessStatusHint,
  type DiscoveryCandidateInput,
  type DiscoveryProvider,
  type DiscoveryProviderRetentionPolicy,
  type DiscoverySearchQuery,
  type DiscoverySearchResult,
} from "@/discovery/provider";

// Google Places API (New) adapter (RL-031).
// Credentials are passed via the X-Goog-Api-Key header only and are never embedded in URLs,
// error messages, or returned candidate data.
//
// Cost model. Google bills each request at the highest pricing tier of any field in its
// X-Goog-FieldMask, so one contact field in a broad search lifts every page to the Enterprise
// tier. The adapter therefore runs two stages with two fixed masks:
//
//   Stage 1  Text Search   (places:searchText)  DISCOVERY_PLACE_FIELDS   — Pro tier, 1 request per page of up to 20 places
//   Stage 2  Place Details (places/{id})        ENRICHMENT_PLACE_FIELDS  — Enterprise tier, 1 request per enriched candidate
//
// Stage 2 repeats the identity fields because Place Details is priced by tier, not by field
// count, so the extra fields are free and let one call also serve the purge re-fetch path.

export const GOOGLE_PLACES_ATTRIBUTION = "Google";

/**
 * Stage 1 field mask (Text Search). Identity, address, type and open/closed status only.
 * Everything here sits in Google's Pro tier. Never add websiteUri, phone numbers, rating,
 * userRatingCount, opening hours, price level or reviews: each of those moves the whole
 * search request to the Enterprise (or Enterprise + Atmosphere) tier.
 */
export const DISCOVERY_PLACE_FIELDS = ["id", "displayName", "formattedAddress", "addressComponents", "primaryType", "types", "businessStatus"] as const;

/**
 * Stage 2 field mask (Place Details). Adds the website and phone fields needed for official
 * website verification and phone matching. Billed at the Enterprise tier per candidate.
 */
export const ENRICHMENT_PLACE_FIELDS = [...DISCOVERY_PLACE_FIELDS, "websiteUri", "nationalPhoneNumber", "internationalPhoneNumber"] as const;

/** Exact X-Goog-FieldMask sent with every Stage 1 Text Search request. */
export const TEXT_SEARCH_FIELD_MASK = [...DISCOVERY_PLACE_FIELDS.map((field) => `places.${field}`), "nextPageToken"].join(",");

/**
 * X-Goog-FieldMask for the optional "inline" search profile, which asks Text Search for the
 * enrichment fields directly (Enterprise tier per page) and skips Stage 2 entirely.
 */
export const TEXT_SEARCH_INLINE_FIELD_MASK = [...ENRICHMENT_PLACE_FIELDS.map((field) => `places.${field}`), "nextPageToken"].join(",");

/** Exact X-Goog-FieldMask sent with every Stage 2 Place Details request. */
export const PLACE_DETAILS_FIELD_MASK = ENRICHMENT_PLACE_FIELDS.join(",");

/**
 * "minimal" (default) requests only DISCOVERY_PLACE_FIELDS during search and relies on Stage 2.
 * "inline" requests ENRICHMENT_PLACE_FIELDS during search so no Stage 2 calls are needed.
 */
export type GooglePlacesSearchProfile = "minimal" | "inline";

type GoogleLocalizedText = { text?: string; languageCode?: string };

type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

export type GooglePlace = {
  id?: string;
  displayName?: GoogleLocalizedText;
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
};

type GoogleTextSearchResponse = {
  places?: GooglePlace[];
  nextPageToken?: string;
};

export type GooglePlacesAdapterOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
  searchProfile?: GooglePlacesSearchProfile;
};

function componentValue(components: GoogleAddressComponent[] | undefined, type: string, prefer: "long" | "short" = "long"): string | null {
  const match = components?.find((component) => component.types?.includes(type));
  if (!match) return null;
  const value = prefer === "short" ? match.shortText ?? match.longText : match.longText ?? match.shortText;
  return value?.trim() || null;
}

function mapBusinessStatus(status: string | undefined): BusinessStatusHint {
  switch (status) {
    case "OPERATIONAL":
      return "operational";
    case "CLOSED_TEMPORARILY":
      return "closed_temporarily";
    case "CLOSED_PERMANENTLY":
      return "closed_permanently";
    default:
      return "unknown";
  }
}

function humaniseType(type: string | undefined | null): string | null {
  if (!type) return null;
  return type.replace(/_/g, " ").trim() || null;
}

/**
 * Maps a Google place into the provider-neutral candidate shape.
 * `stage` states which field mask produced the payload: a Stage 1 payload never contains
 * contact fields, so their absence must be recorded as "unknown" rather than "absent".
 */
export function mapGooglePlaceToCandidate(place: GooglePlace, observedAt: string, stage: "discovery" | "enrichment" = "enrichment"): DiscoveryCandidateInput | null {
  const providerRef = place.id?.trim();
  if (!providerRef) return null;

  const enriched = stage === "enrichment";
  const websiteHint = enriched ? place.websiteUri?.trim() || null : null;
  const locality = componentValue(place.addressComponents, "postal_town") ?? componentValue(place.addressComponents, "locality");

  return {
    provider: "google_places",
    providerRef,
    displayName: place.displayName?.text?.trim() || null,
    formattedAddress: place.formattedAddress?.trim() || null,
    locality,
    postcode: componentValue(place.addressComponents, "postal_code"),
    region: componentValue(place.addressComponents, "administrative_area_level_2") ?? componentValue(place.addressComponents, "administrative_area_level_1"),
    countryCode: componentValue(place.addressComponents, "country", "short"),
    primaryCategory: humaniseType(place.primaryType),
    categories: (place.types ?? []).map((type) => humaniseType(type)).filter((type): type is string => Boolean(type)),
    websiteHint,
    websiteHintState: enriched ? (websiteHint ? "present" : "absent") : "unknown",
    phoneHint: enriched ? place.internationalPhoneNumber?.trim() || place.nationalPhoneNumber?.trim() || null : null,
    businessStatus: mapBusinessStatus(place.businessStatus),
    attribution: GOOGLE_PLACES_ATTRIBUTION,
    observedAt,
    enrichedAt: enriched ? observedAt : null,
  };
}

export function buildTextQuery(query: Pick<DiscoverySearchQuery, "category" | "location">): string {
  return `${query.category.trim()} in ${query.location.trim()}`;
}

function classifyHttpFailure(status: number, safeMessage: string): DiscoveryProviderError {
  if (status === 401 || status === 403) return new DiscoveryProviderError(`Google Places rejected the request (${status}). Check the API key and that Places API (New) is enabled. ${safeMessage}`.trim(), "auth", false);
  if (status === 429) return new DiscoveryProviderError("Google Places quota or rate limit exceeded.", "quota", true);
  if (status === 400 || status === 404) return new DiscoveryProviderError(`Google Places rejected the request (${status}). ${safeMessage}`.trim(), "invalid_request", false);
  if (status >= 500) return new DiscoveryProviderError(`Google Places is unavailable (${status}).`, "unavailable", true);
  return new DiscoveryProviderError(`Google Places returned an unexpected status (${status}).`, "unknown", true);
}

async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string; status?: string } };
    const message = body.error?.message?.slice(0, 200);
    return message ? `Provider message: ${message}` : "";
  } catch {
    return "";
  }
}

export class GooglePlacesDiscoveryProvider implements DiscoveryProvider {
  readonly name = "google_places" as const;
  readonly retention: DiscoveryProviderRetentionPolicy = {
    referenceRetention: "indefinite",
    contentRetention: "expiring",
    attributionRequired: true,
    attributionText: GOOGLE_PLACES_ATTRIBUTION,
  };
  readonly searchProfile: GooglePlacesSearchProfile;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(options: GooglePlacesAdapterOptions) {
    if (!options.apiKey) throw new DiscoveryProviderError("GOOGLE_PLACES_API_KEY is not configured", "not_configured", false);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://places.googleapis.com/v1").replace(/\/$/, "");
    this.now = options.now ?? (() => new Date());
    this.searchProfile = options.searchProfile ?? "minimal";
  }

  /** Stage 1: one Text Search request per page using the minimal discovery field mask. */
  async searchCandidates(query: DiscoverySearchQuery): Promise<DiscoverySearchResult> {
    const body: Record<string, unknown> = {
      textQuery: buildTextQuery(query),
      pageSize: Math.min(Math.max(query.pageSize ?? 20, 1), 20),
      regionCode: query.countryCode,
      languageCode: query.languageCode ?? "en-GB",
    };
    if (query.pageToken) body.pageToken = query.pageToken;

    const inline = this.searchProfile === "inline";
    const response = await this.request(`${this.baseUrl}/places:searchText`, {
      method: "POST",
      headers: this.headers(inline ? TEXT_SEARCH_INLINE_FIELD_MASK : TEXT_SEARCH_FIELD_MASK, true),
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as GoogleTextSearchResponse;
    const observedAt = this.now().toISOString();
    const candidates = (payload.places ?? [])
      .map((place) => mapGooglePlaceToCandidate(place, observedAt, inline ? "enrichment" : "discovery"))
      .filter((candidate): candidate is DiscoveryCandidateInput => candidate !== null);

    return { candidates, nextPageToken: payload.nextPageToken?.trim() || null, requestCount: 1 };
  }

  /** Stage 2: one Place Details request for a single surviving candidate, using the enrichment field mask. */
  async getReferenceDetails(providerRef: string): Promise<DiscoveryCandidateInput | null> {
    const ref = providerRef.trim();
    if (!ref) return null;

    const response = await this.request(`${this.baseUrl}/places/${encodeURIComponent(ref)}`, {
      method: "GET",
      headers: this.headers(PLACE_DETAILS_FIELD_MASK, false),
    }, { allowNotFound: true });
    if (!response) return null;

    const place = (await response.json()) as GooglePlace;
    return mapGooglePlaceToCandidate(place, this.now().toISOString(), "enrichment");
  }

  private headers(fieldMask: string, json: boolean): Record<string, string> {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      "X-Goog-Api-Key": this.apiKey,
      "X-Goog-FieldMask": fieldMask,
    };
  }

  private async request(url: string, init: RequestInit, options: { allowNotFound: true }): Promise<Response | null>;
  private async request(url: string, init: RequestInit): Promise<Response>;
  private async request(url: string, init: RequestInit, options?: { allowNotFound: true }): Promise<Response | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      throw new DiscoveryProviderError("Google Places request failed before a response was received.", "unavailable", true);
    }

    if (response.ok) return response;
    if (options?.allowNotFound && response.status === 404) return null;
    throw classifyHttpFailure(response.status, await safeErrorMessage(response));
  }
}
