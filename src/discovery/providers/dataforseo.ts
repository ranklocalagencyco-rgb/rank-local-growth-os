import {
  DiscoveryProviderError,
  type DiscoveryCandidateInput,
  type DiscoveryProvider,
  type DiscoveryProviderRetentionPolicy,
  type DiscoverySearchQuery,
  type DiscoverySearchResult,
} from "@/discovery/provider";

// DataForSEO discovery adapter (primary provider).
// Credentials are sent as HTTP Basic auth only and never appear in URLs, error messages or candidate data.
//
// Endpoints used (and the only ones this adapter ever calls):
//
//   Discovery, live mode        POST /v3/serp/google/maps/live/advanced
//                               One synchronous request per category x location search unit. Returns up to
//                               `depth` Google Maps listings (billed per SERP page of 100 results, $0.002 live).
//
//   Discovery, standard/priority POST /v3/serp/google/maps/task_post   (priority 1 = standard, 2 = priority)
//                               GET  /v3/serp/google/maps/task_get/advanced/{id}
//                               The search is queued and charged when posted ($0.0006 standard, $0.0012 priority
//                               per page); retrieval is free and the result stays available for 30 days. The
//                               adapter returns `pending` with the task id; the caller stores it and calls
//                               again with `pendingTaskRef` until the result is ready.
//
//   Re-fetch after purge        POST /v3/business_data/google/my_business_info/live  with keyword "place_id:<ref>"
//                               One request for one business, always live because it runs inside a single
//                               candidate.resolve job. Used only when stored candidate content has expired.
//
// Every listing already carries domain/url/phone, so candidates arrive enriched and the resolver never needs a
// per-candidate Stage 2 call. Output is normalised identically for all three modes.
//
// This adapter never asks DataForSEO to crawl or fetch a business website. Website verification is a
// separate deterministic worker (src/discovery/website) that probes URLs itself.

export type DataForSeoMode = "standard" | "priority" | "live";

export const DATAFORSEO_ATTRIBUTION = "Google Maps data via DataForSEO";
export const DATAFORSEO_MAPS_LIVE_PATH = "/v3/serp/google/maps/live/advanced";
export const DATAFORSEO_MAPS_TASK_POST_PATH = "/v3/serp/google/maps/task_post";
export const DATAFORSEO_MAPS_TASK_GET_PATH = "/v3/serp/google/maps/task_get/advanced";
export const DATAFORSEO_BUSINESS_INFO_PATH = "/v3/business_data/google/my_business_info/live";

/** Default and hard limits for the Maps `depth` parameter. Every 100 results is billed as one page. */
export const DATAFORSEO_DEFAULT_DEPTH = 100;
export const DATAFORSEO_MIN_DEPTH = 20;
export const DATAFORSEO_MAX_DEPTH = 700;

/** How long the caller should wait before retrieving a queued task, by mode. Retrieval is free. */
export const DATAFORSEO_POLL_DELAY_SECONDS: Record<Exclude<DataForSeoMode, "live">, number> = { standard: 60, priority: 20 };

/** Task-level status codes that mean "still processing" on task_get. */
const TASK_IN_PROGRESS_CODES = new Set([40601, 40602]);
const TASK_CREATED_CODE = 20100;
const TASK_OK_CODE = 20000;

/**
 * DataForSEO country location codes are 2000 + the ISO 3166-1 numeric code.
 * Extend this table (or set DATAFORSEO_LOCATION_CODE) for other territories.
 */
export const DATAFORSEO_COUNTRY_LOCATION_CODES: Record<string, number> = {
  GB: 2826,
  IE: 2372,
  US: 2840,
  CA: 2124,
  AU: 2036,
  NZ: 2554,
};

export type DataForSeoAddressInfo = {
  borough?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  region?: string | null;
  country_code?: string | null;
};

export type DataForSeoRating = {
  rating_type?: string | null;
  value?: number | null;
  votes_count?: number | null;
  rating_max?: number | null;
};

/** Subset of a Google Maps SERP item (`type: "maps_search"`) or a My Business Info item that the adapter reads. */
export type DataForSeoBusinessItem = {
  type?: string;
  rank_group?: number | null;
  rank_absolute?: number | null;
  title?: string | null;
  address?: string | null;
  address_info?: DataForSeoAddressInfo | null;
  place_id?: string | null;
  cid?: string | null;
  phone?: string | null;
  url?: string | null;
  domain?: string | null;
  category?: string | null;
  additional_categories?: string[] | null;
  rating?: DataForSeoRating | null;
  latitude?: number | null;
  longitude?: number | null;
};

type DataForSeoTask = {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number | null;
  result?: Array<{ items?: DataForSeoBusinessItem[] | null } | null> | null;
};

type DataForSeoEnvelope = {
  status_code?: number;
  status_message?: string;
  cost?: number | null;
  tasks?: DataForSeoTask[] | null;
};

export type DataForSeoAdapterOptions = {
  login: string;
  password: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
  /** Execution mode for discovery searches (default standard, the cheapest). Re-fetches are always live. */
  mode?: DataForSeoMode;
  /** Number of Maps results per search unit (default 100, max 700). Each 100 is billed as one page. */
  depth?: number;
  /** Overrides the country-derived DataForSEO location_code. */
  locationCode?: number;
  /** Overrides the per-mode wait before a queued task is retrieved. */
  pollDelaySeconds?: number;
};

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function positiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** DataForSEO returns the website as `url` and separately as `domain`; fall back to the domain when only that is present. */
export function websiteFromItem(item: Pick<DataForSeoBusinessItem, "url" | "domain">): string | null {
  const url = clean(item.url);
  if (url) return url;
  const domain = clean(item.domain);
  if (!domain) return null;
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

export function clampDepth(value: number | undefined): number {
  return Math.min(Math.max(Math.floor(value ?? DATAFORSEO_DEFAULT_DEPTH), DATAFORSEO_MIN_DEPTH), DATAFORSEO_MAX_DEPTH);
}

/**
 * Maps a DataForSEO business item into the provider-neutral candidate shape.
 * Every item from both endpoints already includes contact fields, so the candidate is stamped as enriched.
 * Ranking, rating and coordinates are carried separately from identity fields. Photos, opening hours,
 * rating distributions and review content are deliberately not mapped or stored.
 */
export function mapDataForSeoItemToCandidate(item: DataForSeoBusinessItem, observedAt: string): DiscoveryCandidateInput | null {
  const providerRef = clean(item.place_id) ?? (clean(item.cid) ? `cid:${clean(item.cid)}` : null);
  if (!providerRef) return null;

  const websiteHint = websiteFromItem(item);
  const primaryCategory = clean(item.category);
  const categories = [primaryCategory, ...(item.additional_categories ?? []).map((category) => clean(category))].filter((category): category is string => Boolean(category));

  const position = positiveInteger(item.rank_group);
  const ratingValue = finiteNumber(item.rating?.value);
  const latitude = finiteNumber(item.latitude);
  const longitude = finiteNumber(item.longitude);

  return {
    provider: "dataforseo",
    providerRef,
    displayName: clean(item.title),
    formattedAddress: clean(item.address),
    locality: clean(item.address_info?.city) ?? clean(item.address_info?.borough),
    postcode: clean(item.address_info?.zip),
    region: clean(item.address_info?.region),
    countryCode: clean(item.address_info?.country_code)?.toUpperCase() ?? null,
    primaryCategory,
    categories: [...new Set(categories)],
    websiteHint,
    websiteHintState: websiteHint ? "present" : "absent",
    phoneHint: clean(item.phone),
    // Maps SERP items do not report closure status; the resolver treats "unknown" as not-yet-rejected.
    businessStatus: "unknown",
    attribution: DATAFORSEO_ATTRIBUTION,
    observedAt,
    enrichedAt: observedAt,
    rank: position ? { position, absolutePosition: positiveInteger(item.rank_absolute) } : null,
    rating: ratingValue !== null ? { value: ratingValue, reviewCount: typeof item.rating?.votes_count === "number" && item.rating.votes_count >= 0 ? Math.floor(item.rating.votes_count) : null } : null,
    coordinates: latitude !== null && longitude !== null ? { latitude, longitude } : null,
  };
}

export function buildMapsKeyword(query: Pick<DiscoverySearchQuery, "category" | "location">): string {
  return `${query.category.trim()} in ${query.location.trim()}`;
}

/** DataForSEO expects a bare ISO 639-1 code ("en"), while campaigns may carry a locale ("en-GB"). */
export function toDataForSeoLanguageCode(languageCode: string | undefined): string {
  return (languageCode ?? "en").split("-")[0].toLowerCase() || "en";
}

export function resolveLocationCode(countryCode: string, override?: number): number {
  if (override) return override;
  const code = DATAFORSEO_COUNTRY_LOCATION_CODES[countryCode.trim().toUpperCase()];
  if (!code) {
    throw new DiscoveryProviderError(`No DataForSEO location code is known for country "${countryCode}". Set DATAFORSEO_LOCATION_CODE.`, "invalid_request", false);
  }
  return code;
}

function classifyHttpFailure(status: number): DiscoveryProviderError {
  if (status === 401 || status === 403) return new DiscoveryProviderError(`DataForSEO rejected the credentials (${status}). Check DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.`, "auth", false);
  if (status === 402) return new DiscoveryProviderError("DataForSEO account balance is exhausted.", "quota", false);
  if (status === 429) return new DiscoveryProviderError("DataForSEO rate limit exceeded.", "quota", true);
  if (status === 400 || status === 404) return new DiscoveryProviderError(`DataForSEO rejected the request (${status}).`, "invalid_request", false);
  if (status >= 500) return new DiscoveryProviderError(`DataForSEO is unavailable (${status}).`, "unavailable", true);
  return new DiscoveryProviderError(`DataForSEO returned an unexpected status (${status}).`, "unknown", true);
}

/** True when a task_get answer says the queued task has not finished yet. */
export function isTaskInProgress(code: number | undefined): boolean {
  return code !== undefined && TASK_IN_PROGRESS_CODES.has(code);
}

/**
 * DataForSEO reports outcomes per task with five-digit status codes even when the HTTP status is 200.
 * 20000 is success (20100 "task created" for task_post); 401xx auth, 402xx billing, 404xx not found,
 * 405xx rate/task limits, 406xx task still queued, 400xx bad request, 5xxxx server side.
 */
export function classifyTaskStatus(code: number | undefined, message: string | undefined): DiscoveryProviderError | null {
  if (code === TASK_OK_CODE || code === TASK_CREATED_CODE) return null;
  const detail = message ? ` Provider message: ${message.slice(0, 200)}` : "";
  if (code === undefined) return new DiscoveryProviderError("DataForSEO returned no task status.", "unknown", true);
  if (code >= 40100 && code < 40200) return new DiscoveryProviderError(`DataForSEO rejected the credentials (${code}).${detail}`, "auth", false);
  if (code >= 40200 && code < 40300) return new DiscoveryProviderError(`DataForSEO account balance or plan limit reached (${code}).${detail}`, "quota", false);
  if (code >= 40400 && code < 40500) return new DiscoveryProviderError(`DataForSEO could not find the requested task or resource (${code}).${detail}`, "invalid_request", false);
  if (code >= 40500 && code < 40600) return new DiscoveryProviderError(`DataForSEO rate or task limit reached (${code}).${detail}`, "quota", true);
  if (isTaskInProgress(code)) return new DiscoveryProviderError(`DataForSEO task is still in progress (${code}).${detail}`, "unavailable", true);
  if (code >= 40000 && code < 50000) return new DiscoveryProviderError(`DataForSEO rejected the request (${code}).${detail}`, "invalid_request", false);
  if (code >= 50000) return new DiscoveryProviderError(`DataForSEO could not complete the task (${code}).${detail}`, "unavailable", true);
  return new DiscoveryProviderError(`DataForSEO returned an unexpected task status (${code}).${detail}`, "unknown", true);
}

type TaskResponse = { task: DataForSeoTask | undefined; items: DataForSeoBusinessItem[]; cost: number | null };

export class DataForSeoDiscoveryProvider implements DiscoveryProvider {
  readonly name = "dataforseo" as const;
  // The listings are Google Maps content, so the same conservative retention rules apply: the reference is
  // durable, everything else expires and is purged.
  readonly retention: DiscoveryProviderRetentionPolicy = {
    referenceRetention: "indefinite",
    contentRetention: "expiring",
    attributionRequired: false,
    attributionText: DATAFORSEO_ATTRIBUTION,
  };
  readonly mode: DataForSeoMode;
  readonly depth: number;

  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly locationCode: number | undefined;
  private readonly pollDelaySeconds: number;

  constructor(options: DataForSeoAdapterOptions) {
    if (!options.login || !options.password) throw new DiscoveryProviderError("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not configured", "not_configured", false);
    this.authorization = `Basic ${Buffer.from(`${options.login}:${options.password}`, "utf8").toString("base64")}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.dataforseo.com").replace(/\/$/, "");
    this.now = options.now ?? (() => new Date());
    this.mode = options.mode ?? "standard";
    this.depth = clampDepth(options.depth);
    this.locationCode = options.locationCode;
    this.pollDelaySeconds = options.pollDelaySeconds ?? (this.mode === "live" ? 0 : DATAFORSEO_POLL_DELAY_SECONDS[this.mode]);
  }

  /**
   * Discovery: one Google Maps SERP task per search unit. Results include contact fields, so no Stage 2 follows.
   * Live mode answers synchronously; standard/priority post a task and return `pending` until it is retrieved.
   * The Maps endpoint has no page cursor: the whole `depth` arrives in one response, so `nextPageToken` is always null.
   */
  async searchCandidates(query: DiscoverySearchQuery): Promise<DiscoverySearchResult> {
    if (query.pendingTaskRef) return this.retrieveTask(query.pendingTaskRef);

    const task: Record<string, unknown> = {
      keyword: buildMapsKeyword(query),
      location_code: resolveLocationCode(query.countryCode, this.locationCode),
      language_code: toDataForSeoLanguageCode(query.languageCode),
      depth: clampDepth(Math.min(query.pageSize ?? this.depth, this.depth)),
      device: "desktop",
    };

    if (this.mode === "live") {
      const { items, cost } = await this.request("POST", DATAFORSEO_MAPS_LIVE_PATH, [task]);
      return { candidates: this.mapItems(items), nextPageToken: null, requestCount: 1, costUsd: cost };
    }

    task.priority = this.mode === "priority" ? 2 : 1;
    const { task: created, cost } = await this.request("POST", DATAFORSEO_MAPS_TASK_POST_PATH, [task]);
    const taskRef = created?.id?.trim();
    if (!taskRef) throw new DiscoveryProviderError("DataForSEO accepted the task but returned no task id.", "unavailable", true);
    return { candidates: [], nextPageToken: null, requestCount: 1, costUsd: cost, pending: { taskRef, retryAfterSeconds: this.pollDelaySeconds } };
  }

  /** Retrieves a queued task. Free of charge; counts as zero billable requests. */
  private async retrieveTask(taskRef: string): Promise<DiscoverySearchResult> {
    const ref = taskRef.trim();
    if (!/^[A-Za-z0-9-]+$/.test(ref)) throw new DiscoveryProviderError("Invalid DataForSEO task reference.", "invalid_request", false);

    const { task, items } = await this.request("GET", `${DATAFORSEO_MAPS_TASK_GET_PATH}/${ref}`, undefined, { allowInProgress: true });
    if (isTaskInProgress(task?.status_code)) {
      return { candidates: [], nextPageToken: null, requestCount: 0, costUsd: null, pending: { taskRef: ref, retryAfterSeconds: this.pollDelaySeconds } };
    }
    return { candidates: this.mapItems(items), nextPageToken: null, requestCount: 0, costUsd: null };
  }

  private mapItems(items: DataForSeoBusinessItem[]): DiscoveryCandidateInput[] {
    const observedAt = this.now().toISOString();
    return items
      .filter((item) => !item.type || item.type === "maps_search")
      .map((item) => mapDataForSeoItemToCandidate(item, observedAt))
      .filter((candidate): candidate is DiscoveryCandidateInput => candidate !== null);
  }

  /** Re-fetch after purge: one live My Business Info request for a single reference, regardless of mode. */
  async getReferenceDetails(providerRef: string): Promise<DiscoveryCandidateInput | null> {
    const ref = providerRef.trim();
    if (!ref) return null;

    const task = {
      keyword: ref.startsWith("cid:") ? ref : `place_id:${ref}`,
      location_code: this.locationCode ?? DATAFORSEO_COUNTRY_LOCATION_CODES.GB,
      language_code: "en",
    };
    const { items } = await this.request("POST", DATAFORSEO_BUSINESS_INFO_PATH, [task]);
    const item = items[0];
    if (!item) return null;

    const candidate = mapDataForSeoItemToCandidate(item, this.now().toISOString());
    // Keep the reference we were asked about so the stored dedupe key never drifts.
    return candidate ? { ...candidate, providerRef: ref } : null;
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown[], options: { allowInProgress?: boolean } = {}): Promise<TaskResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: this.authorization, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new DiscoveryProviderError("DataForSEO request failed before a response was received.", "unavailable", true);
    }
    if (!response.ok) throw classifyHttpFailure(response.status);

    let envelope: DataForSeoEnvelope;
    try {
      envelope = (await response.json()) as DataForSeoEnvelope;
    } catch {
      throw new DiscoveryProviderError("DataForSEO returned an unreadable response.", "unavailable", true);
    }

    const envelopeError = classifyTaskStatus(envelope.status_code, envelope.status_message);
    if (envelopeError) throw envelopeError;
    const task = envelope.tasks?.[0];
    if (!(options.allowInProgress && isTaskInProgress(task?.status_code))) {
      const taskError = classifyTaskStatus(task?.status_code, task?.status_message);
      if (taskError) throw taskError;
    }

    const items = (task?.result ?? []).flatMap((result) => result?.items ?? []);
    const cost = typeof task?.cost === "number" ? task.cost : typeof envelope.cost === "number" ? envelope.cost : null;
    return { task, items, cost };
  }
}
