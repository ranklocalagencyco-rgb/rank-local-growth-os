import { describe, expect, it, vi } from "vitest";

import { DiscoveryProviderError } from "@/discovery/provider";
import { buildTextQuery, GOOGLE_PLACES_SEARCH_FIELD_MASK, GooglePlacesDiscoveryProvider, mapGooglePlaceToReference } from "@/discovery/providers/google-places";
import { getDiscoveryProviderReadiness } from "@/discovery/providers/registry";
import { parseRuntimeConfig } from "@/config/env";
import { computeExpiry, getRetentionRule } from "@/discovery/retention";

const samplePlace = {
  id: "ChIJabc123",
  displayName: { text: "A&B Roofing Ltd", languageCode: "en" },
  formattedAddress: "1 High St, Uxbridge UB8 1AB, UK",
  addressComponents: [
    { longText: "Uxbridge", shortText: "Uxbridge", types: ["postal_town"] },
    { longText: "UB8 1AB", shortText: "UB8 1AB", types: ["postal_code"] },
    { longText: "United Kingdom", shortText: "GB", types: ["country", "political"] },
  ],
  nationalPhoneNumber: "01895 123456",
  internationalPhoneNumber: "+44 1895 123456",
  websiteUri: "https://www.abroofing.co.uk/",
  primaryType: "roofing_contractor",
  businessStatus: "OPERATIONAL",
};

describe("Google Places provider mapping", () => {
  it("maps a place payload into the provider-neutral reference", () => {
    const reference = mapGooglePlaceToReference(samplePlace, "2026-09-14T10:00:00.000Z");
    expect(reference).toEqual({
      provider: "google_places",
      externalRef: "ChIJabc123",
      displayName: "A&B Roofing Ltd",
      formattedAddress: "1 High St, Uxbridge UB8 1AB, UK",
      locality: "Uxbridge",
      postcode: "UB8 1AB",
      countryCode: "GB",
      phone: "+44 1895 123456",
      websiteHint: "https://www.abroofing.co.uk/",
      websiteHintState: "present",
      category: "roofing contractor",
      businessStatus: "operational",
      observedAt: "2026-09-14T10:00:00.000Z",
    });
  });

  it("marks a missing website as an absent hint rather than a verified state", () => {
    const reference = mapGooglePlaceToReference({ ...samplePlace, websiteUri: undefined, businessStatus: "CLOSED_PERMANENTLY" }, "2026-09-14T10:00:00.000Z");
    expect(reference?.websiteHint).toBeNull();
    expect(reference?.websiteHintState).toBe("absent");
    expect(reference?.businessStatus).toBe("closed_permanently");
    expect(mapGooglePlaceToReference({ displayName: { text: "No id" } }, "2026-09-14T10:00:00.000Z")).toBeNull();
  });

  it("calls Text Search with a field mask, server-side key and cursor, and paginates", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ places: [samplePlace], nextPageToken: body.pageToken ? undefined : "page-2" }), { status: 200 });
    });
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "test-key", fetchImpl, now: () => new Date("2026-09-14T10:00:00.000Z") });

    const first = await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB", cursor: null });
    const second = await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB", cursor: first.nextCursor });

    expect(first.nextCursor).toBe("page-2");
    expect(second.nextCursor).toBeNull();
    expect(first.requestCount).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toBe(GOOGLE_PLACES_SEARCH_FIELD_MASK);
    expect(JSON.parse(String(init?.body))).toMatchObject({ textQuery: "roofer in Uxbridge", regionCode: "GB" });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({ pageToken: "page-2" });
    expect(buildTextQuery({ category: " plumber ", location: " Hayes ", countryCode: "GB", cursor: null })).toBe("plumber in Hayes");
  });

  it("classifies provider failures as retryable or not without leaking response bodies", async () => {
    const forbidden = new GooglePlacesDiscoveryProvider({ apiKey: "k", fetchImpl: async () => new Response('{"error":"secret detail"}', { status: 403 }) });
    await expect(forbidden.searchCandidates({ category: "a", location: "b", countryCode: "GB", cursor: null })).rejects.toMatchObject({ code: "auth", retryable: false });
    const throttled = new GooglePlacesDiscoveryProvider({ apiKey: "k", fetchImpl: async () => new Response("", { status: 429 }) });
    await expect(throttled.searchCandidates({ category: "a", location: "b", countryCode: "GB", cursor: null })).rejects.toMatchObject({ code: "quota", retryable: true });
    try {
      await forbidden.searchCandidates({ category: "a", location: "b", countryCode: "GB", cursor: null });
    } catch (error) {
      expect((error as DiscoveryProviderError).message).not.toContain("secret detail");
    }
  });

  it("returns null for unknown place details", async () => {
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "k", fetchImpl: async () => new Response("", { status: 404 }) });
    expect(await provider.getReferenceDetails("missing")).toBeNull();
  });

  it("reports readiness from server-side configuration only", () => {
    expect(getDiscoveryProviderReadiness(parseRuntimeConfig({ NODE_ENV: "test" })).configured).toBe(false);
    expect(getDiscoveryProviderReadiness(parseRuntimeConfig({ NODE_ENV: "test", GOOGLE_PLACES_API_KEY: "abc" })).configured).toBe(true);
    expect(() => new GooglePlacesDiscoveryProvider({ apiKey: "" })).toThrow(DiscoveryProviderError);
  });

  it("applies provider retention limits to candidate content", () => {
    const rule = getRetentionRule("google_places", 90);
    expect(rule.contentTtlDays).toBe(30);
    expect(rule.referenceRetention).toBe("provider_reference");
    expect(computeExpiry(rule, new Date("2026-09-14T00:00:00.000Z"))).toBe("2026-10-14T00:00:00.000Z");
  });
});
