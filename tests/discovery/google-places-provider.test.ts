import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoveryProviderError } from "@/discovery/provider";
import { buildTextQuery, DISCOVERY_PLACE_FIELDS, ENRICHMENT_PLACE_FIELDS, GooglePlacesDiscoveryProvider, mapGooglePlaceToCandidate, PLACE_DETAILS_FIELD_MASK, TEXT_SEARCH_FIELD_MASK, TEXT_SEARCH_INLINE_FIELD_MASK, type GooglePlace } from "@/discovery/providers/google-places";
import { getDiscoveryProviderReadiness } from "@/discovery/providers/registry";

const place: GooglePlace = {
  id: "ChIJabc123",
  displayName: { text: "A&B Roofing Ltd", languageCode: "en" },
  formattedAddress: "12 High St, Uxbridge UB8 1AA, UK",
  addressComponents: [
    { longText: "12", shortText: "12", types: ["street_number"] },
    { longText: "Uxbridge", shortText: "Uxbridge", types: ["postal_town"] },
    { longText: "Greater London", shortText: "Greater London", types: ["administrative_area_level_2"] },
    { longText: "United Kingdom", shortText: "GB", types: ["country", "political"] },
    { longText: "UB8 1AA", shortText: "UB8 1AA", types: ["postal_code"] },
  ],
  primaryType: "roofing_contractor",
  types: ["roofing_contractor", "point_of_interest"],
  businessStatus: "OPERATIONAL",
  websiteUri: "https://www.abroofing.co.uk/",
  nationalPhoneNumber: "01895 123456",
  internationalPhoneNumber: "+44 1895 123456",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Google Places mapping", () => {
  it("maps an enriched place into the provider-neutral candidate shape", () => {
    const candidate = mapGooglePlaceToCandidate(place, "2026-09-14T10:00:00.000Z", "enrichment");
    expect(candidate).toMatchObject({
      provider: "google_places",
      providerRef: "ChIJabc123",
      displayName: "A&B Roofing Ltd",
      locality: "Uxbridge",
      postcode: "UB8 1AA",
      region: "Greater London",
      countryCode: "GB",
      primaryCategory: "roofing contractor",
      websiteHint: "https://www.abroofing.co.uk/",
      websiteHintState: "present",
      phoneHint: "+44 1895 123456",
      businessStatus: "operational",
      attribution: "Google",
      observedAt: "2026-09-14T10:00:00.000Z",
      enrichedAt: "2026-09-14T10:00:00.000Z",
    });
  });

  it("maps a Stage 1 place with contact fields unknown, never absent, and no enrichment stamp", () => {
    const { websiteUri: _website, nationalPhoneNumber: _national, internationalPhoneNumber: _international, ...stageOne } = place;
    void _website; void _national; void _international;
    const candidate = mapGooglePlaceToCandidate(stageOne, "2026-09-14T10:00:00.000Z", "discovery");
    expect(candidate).toMatchObject({ providerRef: "ChIJabc123", displayName: "A&B Roofing Ltd", locality: "Uxbridge", primaryCategory: "roofing contractor", businessStatus: "operational", websiteHint: null, websiteHintState: "unknown", phoneHint: null, enrichedAt: null });
    // Even if a Stage 1 payload unexpectedly carried contact fields, they are not trusted as enrichment.
    expect(mapGooglePlaceToCandidate(place, "t", "discovery")).toMatchObject({ websiteHint: null, websiteHintState: "unknown", phoneHint: null, enrichedAt: null });
  });

  it("marks the website hint absent when the provider returns none, and drops places without an id", () => {
    const { websiteUri: _omitted, ...withoutWebsite } = place;
    void _omitted;
    expect(mapGooglePlaceToCandidate({ ...withoutWebsite, businessStatus: "CLOSED_PERMANENTLY" }, "t", "enrichment")).toMatchObject({ websiteHint: null, websiteHintState: "absent", businessStatus: "closed_permanently" });
    expect(mapGooglePlaceToCandidate({ displayName: { text: "No id" } }, "t", "enrichment")).toBeNull();
  });

  it("builds the text query from the campaign category and location", () => {
    expect(buildTextQuery({ category: " roofer ", location: "Uxbridge, UK" })).toBe("roofer in Uxbridge, UK");
  });
});

describe("Google Places adapter", () => {
  const stageOnePlace: GooglePlace = { id: place.id, displayName: place.displayName, formattedAddress: place.formattedAddress, addressComponents: place.addressComponents, primaryType: place.primaryType, types: place.types, businessStatus: place.businessStatus };

  it("documents the exact field mask for each stage", () => {
    expect(DISCOVERY_PLACE_FIELDS).toEqual(["id", "displayName", "formattedAddress", "addressComponents", "primaryType", "types", "businessStatus"]);
    expect(TEXT_SEARCH_FIELD_MASK).toBe("places.id,places.displayName,places.formattedAddress,places.addressComponents,places.primaryType,places.types,places.businessStatus,nextPageToken");
    expect(ENRICHMENT_PLACE_FIELDS).toEqual([...DISCOVERY_PLACE_FIELDS, "websiteUri", "nationalPhoneNumber", "internationalPhoneNumber"]);
    expect(PLACE_DETAILS_FIELD_MASK).toBe("id,displayName,formattedAddress,addressComponents,primaryType,types,businessStatus,websiteUri,nationalPhoneNumber,internationalPhoneNumber");
    expect(TEXT_SEARCH_INLINE_FIELD_MASK).toBe("places.id,places.displayName,places.formattedAddress,places.addressComponents,places.primaryType,places.types,places.businessStatus,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,nextPageToken");
  });

  it("Stage 1 search never requests website, phone, rating or review fields", () => {
    for (const expensive of ["websiteUri", "nationalPhoneNumber", "internationalPhoneNumber", "rating", "userRatingCount", "reviews", "regularOpeningHours", "priceLevel"]) {
      expect(TEXT_SEARCH_FIELD_MASK).not.toContain(expensive);
    }
    expect(PLACE_DETAILS_FIELD_MASK).not.toContain("rating");
    expect(PLACE_DETAILS_FIELD_MASK).not.toContain("reviews");
  });

  it("Stage 1: sends the key in a header with the minimal field mask, pages through results and returns unenriched candidates", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ places: [stageOnePlace], nextPageToken: "page-2" }))
      .mockResolvedValueOnce(jsonResponse({ places: [{ ...stageOnePlace, id: "ChIJdef456" }] }));
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "secret-key", fetchImpl, now: () => new Date("2026-09-14T10:00:00.000Z") });
    expect(provider.searchProfile).toBe("minimal");

    const first = await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB" });
    expect(first.candidates.map((candidate) => candidate.providerRef)).toEqual(["ChIJabc123"]);
    expect(first.candidates[0]).toMatchObject({ displayName: "A&B Roofing Ltd", websiteHint: null, websiteHintState: "unknown", phoneHint: null, enrichedAt: null });
    expect(first.nextPageToken).toBe("page-2");
    expect(first.requestCount).toBe(1);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(String(url)).not.toContain("secret-key");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("secret-key");
    expect(headers["X-Goog-FieldMask"]).toBe(TEXT_SEARCH_FIELD_MASK);
    expect(JSON.parse(String(init?.body))).toMatchObject({ textQuery: "roofer in Uxbridge", regionCode: "GB", pageSize: 20 });

    const second = await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB", pageToken: "page-2" });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({ pageToken: "page-2" });
    expect(second.nextPageToken).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) expect(String(call[0])).toContain("places:searchText");
  });

  it("Stage 2: fetches one candidate with the enrichment field mask and returns null for unknown references", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(place)).mockResolvedValueOnce(jsonResponse({ error: { message: "not found" } }, 404));
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "secret-key", fetchImpl, now: () => new Date("2026-09-14T11:00:00.000Z") });

    const details = await provider.getReferenceDetails("ChIJabc123");
    expect(details).toMatchObject({ displayName: "A&B Roofing Ltd", websiteHint: "https://www.abroofing.co.uk/", websiteHintState: "present", phoneHint: "+44 1895 123456", enrichedAt: "2026-09-14T11:00:00.000Z" });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://places.googleapis.com/v1/places/ChIJabc123");
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("GET");
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(PLACE_DETAILS_FIELD_MASK);
    expect(await provider.getReferenceDetails("missing")).toBeNull();
  });

  it("inline profile requests the enrichment fields during search so candidates arrive already enriched", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ places: [place] }));
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "secret-key", fetchImpl, searchProfile: "inline", now: () => new Date("2026-09-14T10:00:00.000Z") });

    const result = await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB" });
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(TEXT_SEARCH_INLINE_FIELD_MASK);
    expect(result.candidates[0]).toMatchObject({ websiteHintState: "present", phoneHint: "+44 1895 123456", enrichedAt: "2026-09-14T10:00:00.000Z" });
  });

  it("classifies provider failures without leaking the key", async () => {
    const attempt = async (status: number) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: { message: "denied for key secret-key" } }, status));
      const provider = new GooglePlacesDiscoveryProvider({ apiKey: "secret-key", fetchImpl });
      try {
        await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB" });
        throw new Error("expected failure");
      } catch (error) {
        return error as DiscoveryProviderError;
      }
    };

    const auth = await attempt(403);
    expect(auth).toBeInstanceOf(DiscoveryProviderError);
    expect(auth.code).toBe("auth");
    expect(auth.retryable).toBe(false);
    expect((await attempt(429)).retryable).toBe(true);
    expect((await attempt(503)).code).toBe("unavailable");
    expect((await attempt(400)).retryable).toBe(false);
  });

  it("refuses to construct without a key", () => {
    expect(() => new GooglePlacesDiscoveryProvider({ apiKey: "" })).toThrow(DiscoveryProviderError);
  });
});

describe("provider readiness", () => {
  const original = process.env.GOOGLE_PLACES_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = original;
  });

  it("reports the missing variable name without exposing values", () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(getDiscoveryProviderReadiness()).toEqual({ provider: "google_places", configured: false, missing: ["GOOGLE_PLACES_API_KEY"] });
    process.env.GOOGLE_PLACES_API_KEY = "abc";
    expect(getDiscoveryProviderReadiness()).toEqual({ provider: "google_places", configured: true, missing: [] });
  });
});
