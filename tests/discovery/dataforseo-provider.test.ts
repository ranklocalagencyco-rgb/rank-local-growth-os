import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoveryProviderError } from "@/discovery/provider";
import {
  buildMapsKeyword,
  clampDepth,
  classifyTaskStatus,
  DATAFORSEO_BUSINESS_INFO_PATH,
  DATAFORSEO_MAPS_LIVE_PATH,
  DATAFORSEO_MAPS_TASK_GET_PATH,
  DATAFORSEO_MAPS_TASK_POST_PATH,
  DataForSeoDiscoveryProvider,
  isTaskInProgress,
  mapDataForSeoItemToCandidate,
  resolveLocationCode,
  toDataForSeoLanguageCode,
  websiteFromItem,
  type DataForSeoBusinessItem,
} from "@/discovery/providers/dataforseo";
import { getDiscoveryProvider, getDiscoveryProviderReadiness } from "@/discovery/providers/registry";

const item: DataForSeoBusinessItem = {
  type: "maps_search",
  rank_group: 1,
  rank_absolute: 2,
  title: "A&B Roofing Ltd",
  address: "12 High St, Uxbridge UB8 1JX, United Kingdom",
  address_info: { borough: "Hillingdon", address: "12 High St", city: "Uxbridge", zip: "UB8 1JX", region: "England", country_code: "gb" },
  place_id: "ChIJabc123",
  cid: "194604053573767737",
  phone: "+44 1895 123456",
  url: "https://www.abroofing.co.uk/",
  domain: "abroofing.co.uk",
  category: "Roofing contractor",
  additional_categories: ["Contractor", "Roofing contractor"],
  rating: { rating_type: "Max5", value: 4.8, votes_count: 120, rating_max: 5 },
  latitude: 51.5462,
  longitude: -0.4786,
};

const taskId = "09151234-5678-0123-0000-abcdefabcdef";
const observedAt = "2026-09-15T10:00:00.000Z";

type EnvelopeOverrides = { taskStatus?: number; taskMessage?: string; cost?: number | null; envelopeStatus?: number; taskId?: string; withResult?: boolean };

function envelope(items: DataForSeoBusinessItem[], overrides: EnvelopeOverrides = {}): unknown {
  const cost = overrides.cost === undefined ? 0.002 : overrides.cost;
  return {
    status_code: overrides.envelopeStatus ?? 20000,
    status_message: "Ok.",
    cost,
    tasks: [{ id: overrides.taskId ?? taskId, status_code: overrides.taskStatus ?? 20000, status_message: overrides.taskMessage ?? "Ok.", cost, result: overrides.withResult === false ? null : [{ items }] }],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Task = Record<string, unknown>;

function requestOf(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): { path: string; method: string; body: Task[]; headers: Record<string, string> } {
  const [url, init] = fetchImpl.mock.calls[index];
  return { path: new URL(String(url)).pathname, method: init?.method ?? "GET", body: init?.body ? (JSON.parse(String(init.body)) as Task[]) : [], headers: (init?.headers ?? {}) as Record<string, string> };
}

const query = { category: "roofer", location: "Uxbridge", countryCode: "GB", languageCode: "en-GB" };

describe("DataForSEO mapping", () => {
  it("maps a Maps SERP item into an already-enriched candidate with rank, rating and coordinates kept apart from identity", () => {
    expect(mapDataForSeoItemToCandidate(item, observedAt)).toEqual({
      provider: "dataforseo",
      providerRef: "ChIJabc123",
      displayName: "A&B Roofing Ltd",
      formattedAddress: "12 High St, Uxbridge UB8 1JX, United Kingdom",
      locality: "Uxbridge",
      postcode: "UB8 1JX",
      region: "England",
      countryCode: "GB",
      primaryCategory: "Roofing contractor",
      categories: ["Roofing contractor", "Contractor"],
      websiteHint: "https://www.abroofing.co.uk/",
      websiteHintState: "present",
      phoneHint: "+44 1895 123456",
      businessStatus: "unknown",
      attribution: "Google Maps data via DataForSEO",
      observedAt,
      enrichedAt: observedAt,
      rank: { position: 1, absolutePosition: 2 },
      rating: { value: 4.8, reviewCount: 120 },
      coordinates: { latitude: 51.5462, longitude: -0.4786 },
    });
  });

  it("leaves rank, rating and coordinates null when the payload lacks them and never copies photos, hours or review content", () => {
    const noisy = { ...item, rank_group: null, rank_absolute: null, rating: null, latitude: null, longitude: undefined, main_image: "https://example/img.jpg", total_photos: 20, work_hours: {}, rating_distribution: { 5: 100 }, snippet: "text" } as DataForSeoBusinessItem;
    const candidate = mapDataForSeoItemToCandidate(noisy, observedAt)!;
    expect(candidate).toMatchObject({ rank: null, rating: null, coordinates: null });
    expect(Object.keys(candidate)).not.toEqual(expect.arrayContaining(["main_image", "total_photos", "work_hours", "rating_distribution", "snippet"]));
    expect(mapDataForSeoItemToCandidate({ ...item, rating: { value: 4.2, votes_count: null } }, observedAt)).toMatchObject({ rating: { value: 4.2, reviewCount: null } });
  });

  it("falls back to the domain for the website hint and marks the hint absent when neither is present", () => {
    expect(websiteFromItem({ url: null, domain: "abroofing.co.uk" })).toBe("https://abroofing.co.uk");
    expect(websiteFromItem({ url: "  ", domain: "http://abroofing.co.uk" })).toBe("http://abroofing.co.uk");
    expect(mapDataForSeoItemToCandidate({ ...item, url: null, domain: null }, observedAt)).toMatchObject({ websiteHint: null, websiteHintState: "absent", enrichedAt: observedAt });
  });

  it("uses the cid as a fallback reference and drops items without any reference", () => {
    expect(mapDataForSeoItemToCandidate({ ...item, place_id: null }, observedAt)).toMatchObject({ providerRef: "cid:194604053573767737" });
    expect(mapDataForSeoItemToCandidate({ ...item, place_id: null, cid: null }, observedAt)).toBeNull();
  });

  it("uses the borough when the city is missing", () => {
    expect(mapDataForSeoItemToCandidate({ ...item, address_info: { borough: "Hillingdon", zip: "UB8 1JX" } }, observedAt)).toMatchObject({ locality: "Hillingdon", region: null, countryCode: null });
  });

  it("builds the keyword, language, location and depth parameters", () => {
    expect(buildMapsKeyword({ category: " roofer ", location: "Uxbridge " })).toBe("roofer in Uxbridge");
    expect(toDataForSeoLanguageCode("en-GB")).toBe("en");
    expect(toDataForSeoLanguageCode(undefined)).toBe("en");
    expect(resolveLocationCode("gb")).toBe(2826);
    expect(resolveLocationCode("GB", 1006886)).toBe(1006886);
    expect(() => resolveLocationCode("XX")).toThrow(DiscoveryProviderError);
    expect(clampDepth(undefined)).toBe(100);
    expect(clampDepth(5)).toBe(20);
    expect(clampDepth(5000)).toBe(700);
  });
});

describe("DataForSEO adapter (live mode)", () => {
  it("discovers with one live Maps request per unit, Basic auth in the header, and returns enriched candidates with the reported cost", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(envelope([item, { ...item, rank_group: 2, rank_absolute: 3, place_id: "ChIJdef456", title: "Other Roofer" }, { type: "maps_paid_item", rank_absolute: 1, title: "Ad", place_id: "ad-1" }])));
    const provider = new DataForSeoDiscoveryProvider({ login: "user@example.com", password: "secret", mode: "live", fetchImpl, now: () => new Date(observedAt) });
    expect(provider.mode).toBe("live");

    const result = await provider.searchCandidates(query);

    expect(result.candidates.map((candidate) => candidate.providerRef)).toEqual(["ChIJabc123", "ChIJdef456"]);
    expect(result.candidates.map((candidate) => candidate.rank?.position)).toEqual([1, 2]);
    expect(result.candidates[0]).toMatchObject({ websiteHint: "https://www.abroofing.co.uk/", phoneHint: "+44 1895 123456", enrichedAt: observedAt });
    expect(result).toMatchObject({ nextPageToken: null, requestCount: 1, costUsd: 0.002 });
    expect(result.pending).toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = requestOf(fetchImpl);
    expect(request).toMatchObject({ path: DATAFORSEO_MAPS_LIVE_PATH, method: "POST" });
    expect(request.headers.Authorization).toBe(`Basic ${Buffer.from("user@example.com:secret").toString("base64")}`);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("secret");
    expect(request.body).toEqual([{ keyword: "roofer in Uxbridge", location_code: 2826, language_code: "en", depth: 100, device: "desktop" }]);
  });

  it("treats the configured depth as the result cap: a smaller page size lowers it, a larger one cannot raise it, and there is never a next page", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(envelope([])));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", mode: "live", fetchImpl, depth: 5000, locationCode: 1006886 });
    expect(provider.depth).toBe(700);

    await provider.searchCandidates({ ...query, pageSize: 250 });
    expect(requestOf(fetchImpl, 0).body[0]).toMatchObject({ depth: 250, location_code: 1006886 });

    const capped = new DataForSeoDiscoveryProvider({ login: "u", password: "p", mode: "live", fetchImpl, depth: 100 });
    const result = await capped.searchCandidates({ ...query, pageSize: 400 });
    expect(requestOf(fetchImpl, 1).body[0]).toMatchObject({ depth: 100 });
    expect(result.nextPageToken).toBeNull();
  });

  it("re-fetches one reference through My Business Info by place_id, live regardless of mode, and keeps the requested reference", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(envelope([{ ...item, type: "google_business_info", rank_group: null }])))
      .mockResolvedValueOnce(jsonResponse(envelope([])));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", mode: "standard", fetchImpl, now: () => new Date(observedAt) });

    const details = await provider.getReferenceDetails("ChIJabc123");
    expect(details).toMatchObject({ providerRef: "ChIJabc123", displayName: "A&B Roofing Ltd", websiteHint: "https://www.abroofing.co.uk/", phoneHint: "+44 1895 123456", enrichedAt: observedAt, rank: null, rating: { value: 4.8, reviewCount: 120 } });
    expect(requestOf(fetchImpl, 0)).toMatchObject({ path: DATAFORSEO_BUSINESS_INFO_PATH, method: "POST", body: [{ keyword: "place_id:ChIJabc123", location_code: 2826, language_code: "en" }] });

    expect(await provider.getReferenceDetails("ChIJgone")).toBeNull();
    expect(await provider.getReferenceDetails("  ")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("looks up cid-based references with the cid keyword form", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(envelope([{ ...item, place_id: null }])));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", fetchImpl });
    const details = await provider.getReferenceDetails("cid:194604053573767737");
    expect(details?.providerRef).toBe("cid:194604053573767737");
    expect(requestOf(fetchImpl).body[0].keyword).toBe("cid:194604053573767737");
  });

  it("only ever calls the documented endpoints and never asks the provider to crawl a website", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(envelope([item])));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", mode: "live", fetchImpl });
    await provider.searchCandidates(query);
    await provider.getReferenceDetails("ChIJabc123");
    expect(fetchImpl.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([DATAFORSEO_MAPS_LIVE_PATH, DATAFORSEO_BUSINESS_INFO_PATH]);
    for (const call of fetchImpl.mock.calls) expect(String(call[1]?.body)).not.toContain("abroofing.co.uk");
  });
});

describe("DataForSEO adapter (standard and priority queues)", () => {
  it("defaults to the standard queue: posts a priority-1 task, is charged at post time, and returns a pending task reference instead of candidates", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(envelope([], { taskStatus: 20100, taskMessage: "Task Created.", cost: 0.0006, withResult: false })));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", fetchImpl });
    expect(provider.mode).toBe("standard");

    const result = await provider.searchCandidates(query);

    expect(result).toEqual({ candidates: [], nextPageToken: null, requestCount: 1, costUsd: 0.0006, pending: { taskRef: taskId, retryAfterSeconds: 60 } });
    expect(requestOf(fetchImpl)).toMatchObject({ path: DATAFORSEO_MAPS_TASK_POST_PATH, method: "POST", body: [{ keyword: "roofer in Uxbridge", location_code: 2826, language_code: "en", depth: 100, device: "desktop", priority: 1 }] });
  });

  it("posts priority-2 tasks with a shorter poll delay in priority mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(envelope([], { taskStatus: 20100, cost: 0.0012, withResult: false })));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", mode: "priority", fetchImpl });
    const result = await provider.searchCandidates(query);
    expect(result).toMatchObject({ requestCount: 1, costUsd: 0.0012, pending: { taskRef: taskId, retryAfterSeconds: 20 } });
    expect(requestOf(fetchImpl).body[0].priority).toBe(2);
  });

  it("retrieves a pending task with a free GET: stays pending while queued, then returns the same normalised candidates as live mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(envelope([], { taskStatus: 40602, taskMessage: "Task In Queue.", cost: 0, withResult: false })))
      .mockResolvedValueOnce(jsonResponse(envelope([], { taskStatus: 40601, taskMessage: "Task Handed.", cost: 0, withResult: false })))
      .mockResolvedValueOnce(jsonResponse(envelope([item, { type: "maps_paid_item", title: "Ad", place_id: "ad-1" }], { cost: 0 })));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", fetchImpl, now: () => new Date(observedAt) });

    const queued = await provider.searchCandidates({ ...query, pendingTaskRef: taskId });
    expect(queued).toEqual({ candidates: [], nextPageToken: null, requestCount: 0, costUsd: null, pending: { taskRef: taskId, retryAfterSeconds: 60 } });
    const handed = await provider.searchCandidates({ ...query, pendingTaskRef: taskId });
    expect(handed.pending).toEqual({ taskRef: taskId, retryAfterSeconds: 60 });

    const done = await provider.searchCandidates({ ...query, pendingTaskRef: taskId });
    expect(done.pending).toBeUndefined();
    expect(done).toMatchObject({ nextPageToken: null, requestCount: 0, costUsd: null });
    expect(done.candidates).toHaveLength(1);
    const live = new DataForSeoDiscoveryProvider({ login: "u", password: "p", mode: "live", fetchImpl: vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(envelope([item]))), now: () => new Date(observedAt) });
    expect(done.candidates[0]).toEqual((await live.searchCandidates(query)).candidates[0]);

    for (const index of [0, 1, 2]) {
      expect(requestOf(fetchImpl, index)).toMatchObject({ path: `${DATAFORSEO_MAPS_TASK_GET_PATH}/${taskId}`, method: "GET" });
      expect(fetchImpl.mock.calls[index][1]?.body).toBeUndefined();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails non-retryably when the task reference is unknown or malformed, and retryably when the post returns no id", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(envelope([], { taskStatus: 40401, taskMessage: "Task Not Found.", withResult: false })))
      .mockResolvedValueOnce(jsonResponse(envelope([], { taskStatus: 20100, taskId: "", withResult: false })));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", fetchImpl });
    await expect(provider.searchCandidates({ ...query, pendingTaskRef: taskId })).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    await expect(provider.searchCandidates({ ...query, pendingTaskRef: "../etc" })).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    await expect(provider.searchCandidates(query)).rejects.toMatchObject({ code: "unavailable", retryable: true });
  });

  it("recognises in-progress codes", () => {
    expect(isTaskInProgress(40601)).toBe(true);
    expect(isTaskInProgress(40602)).toBe(true);
    expect(isTaskInProgress(20000)).toBe(false);
    expect(isTaskInProgress(undefined)).toBe(false);
  });
});

describe("DataForSEO failure classification", () => {
  it("classifies HTTP failures without leaking credentials", async () => {
    const attempt = async (status: number): Promise<DiscoveryProviderError> => {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ status_code: 40101, status_message: "denied for secret" }, status));
      const provider = new DataForSeoDiscoveryProvider({ login: "user", password: "secret", mode: "live", fetchImpl });
      return provider.searchCandidates(query).then(
        () => { throw new Error("expected a provider error"); },
        (error: unknown) => error as DiscoveryProviderError,
      );
    };
    expect(await attempt(401)).toMatchObject({ code: "auth", retryable: false });
    expect(await attempt(402)).toMatchObject({ code: "quota", retryable: false });
    expect(await attempt(429)).toMatchObject({ code: "quota", retryable: true });
    expect(await attempt(400)).toMatchObject({ code: "invalid_request", retryable: false });
    expect(await attempt(503)).toMatchObject({ code: "unavailable", retryable: true });
    expect((await attempt(401)).message).not.toContain("secret");
  });

  it("classifies task-level status codes returned inside a 200 response", async () => {
    expect(classifyTaskStatus(20000, "Ok.")).toBeNull();
    expect(classifyTaskStatus(20100, "Task Created.")).toBeNull();
    expect(classifyTaskStatus(40101, "Auth error")).toMatchObject({ code: "auth", retryable: false });
    expect(classifyTaskStatus(40201, "Insufficient funds")).toMatchObject({ code: "quota", retryable: false });
    expect(classifyTaskStatus(40401, "Task Not Found")).toMatchObject({ code: "invalid_request", retryable: false });
    expect(classifyTaskStatus(40501, "Task limit")).toMatchObject({ code: "quota", retryable: true });
    expect(classifyTaskStatus(40602, "Task In Queue")).toMatchObject({ code: "unavailable", retryable: true });
    expect(classifyTaskStatus(40001, "Bad keyword")).toMatchObject({ code: "invalid_request", retryable: false });
    expect(classifyTaskStatus(50000, "Internal")).toMatchObject({ code: "unavailable", retryable: true });
    expect(classifyTaskStatus(undefined, undefined)).toMatchObject({ code: "unknown", retryable: true });

    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(envelope([item], { taskStatus: 40201, taskMessage: "Insufficient funds" })));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", fetchImpl });
    await expect(provider.searchCandidates(query)).rejects.toMatchObject({ code: "quota", retryable: false });
  });

  it("treats a network failure as retryable and refuses to construct without credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket hang up"));
    const provider = new DataForSeoDiscoveryProvider({ login: "u", password: "p", mode: "live", fetchImpl });
    await expect(provider.searchCandidates(query)).rejects.toMatchObject({ code: "unavailable", retryable: true });
    expect(() => new DataForSeoDiscoveryProvider({ login: "", password: "p" })).toThrow(DiscoveryProviderError);
    expect(() => new DataForSeoDiscoveryProvider({ login: "u", password: "" })).toThrow(DiscoveryProviderError);
  });
});

describe("provider selection", () => {
  const keys = ["DISCOVERY_PROVIDER", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "DATAFORSEO_MODE", "GOOGLE_PLACES_API_KEY"] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("defaults to DataForSEO in standard mode and does not require a Google key", () => {
    for (const key of keys) delete process.env[key];
    expect(getDiscoveryProviderReadiness()).toEqual({ provider: "dataforseo", configured: false, missing: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"] });
    expect(() => getDiscoveryProvider()).toThrow(DiscoveryProviderError);

    process.env.DATAFORSEO_LOGIN = "user";
    expect(getDiscoveryProviderReadiness()).toEqual({ provider: "dataforseo", configured: false, missing: ["DATAFORSEO_PASSWORD"] });

    process.env.DATAFORSEO_PASSWORD = "pass";
    expect(getDiscoveryProviderReadiness()).toEqual({ provider: "dataforseo", configured: true, missing: [] });
    const provider = getDiscoveryProvider();
    expect(provider.name).toBe("dataforseo");
    expect(provider.mode).toBe("standard");

    process.env.DATAFORSEO_MODE = "live";
    expect(getDiscoveryProvider().mode).toBe("live");
    process.env.DATAFORSEO_MODE = "priority";
    expect(getDiscoveryProvider().mode).toBe("priority");
    process.env.DATAFORSEO_MODE = "bogus";
    expect(() => getDiscoveryProvider()).toThrow();
  });

  it("keeps Google Places available as an explicit fallback", () => {
    for (const key of keys) delete process.env[key];
    process.env.DISCOVERY_PROVIDER = "google_places";
    expect(getDiscoveryProviderReadiness()).toEqual({ provider: "google_places", configured: false, missing: ["GOOGLE_PLACES_API_KEY"] });
    process.env.GOOGLE_PLACES_API_KEY = "abc";
    expect(getDiscoveryProviderReadiness()).toEqual({ provider: "google_places", configured: true, missing: [] });
    expect(getDiscoveryProvider().name).toBe("google_places");
  });
});
