import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoveryProviderError } from "@/discovery/provider";
import { buildTextQuery, GooglePlacesDiscoveryProvider, mapGooglePlaceToCandidate, PLACE_DETAILS_FIELD_MASK, TEXT_SEARCH_FIELD_MASK, type GooglePlace } from "@/discovery/providers/google-places";
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
  it("maps a place into the provider-neutral candidate shape", () => {
    const candidate = mapGooglePlaceToCandidate(place, "2026-09-14T10:00:00.000Z");
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
    });
  });

  it("marks the website hint absent when the provider returns none, and drops places without an id", () => {
    const { websiteUri: _omitted, ...withoutWebsite } = place;
    void _omitted;
    expect(mapGooglePlaceToCandidate({ ...withoutWebsite, businessStatus: "CLOSED_PERMANENTLY" }, "t")).toMatchObject({ websiteHint: null, websiteHintState: "absent", businessStatus: "closed_permanently" });
    expect(mapGooglePlaceToCandidate({ displayName: { text: "No id" } }, "t")).toBeNull();
  });

  it("builds the text query from the campaign category and location", () => {
    expect(buildTextQuery({ category: " roofer ", location: "Uxbridge, UK" })).toBe("roofer in Uxbridge, UK");
  });
});

describe("Google Places adapter", () => {
  it("sends the key in a header with an explicit field mask and pages through results", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ places: [place], nextPageToken: "page-2" }))
      .mockResolvedValueOnce(jsonResponse({ places: [{ ...place, id: "ChIJdef456" }] }));
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "secret-key", fetchImpl, now: () => new Date("2026-09-14T10:00:00.000Z") });

    const first = await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB" });
    expect(first.candidates.map((candidate) => candidate.providerRef)).toEqual(["ChIJabc123"]);
    expect(first.nextPageToken).toBe("page-2");
    expect(first.requestCount).toBe(1);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(String(url)).not.toContain("secret-key");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("secret-key");
    expect(headers["X-Goog-FieldMask"]).toBe(TEXT_SEARCH_FIELD_MASK);
    expect(TEXT_SEARCH_FIELD_MASK).toContain("places.websiteUri");
    expect(TEXT_SEARCH_FIELD_MASK).toContain("nextPageToken");
    expect(JSON.parse(String(init?.body))).toMatchObject({ textQuery: "roofer in Uxbridge", regionCode: "GB", pageSize: 20 });

    const second = await provider.searchCandidates({ category: "roofer", location: "Uxbridge", countryCode: "GB", pageToken: "page-2" });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({ pageToken: "page-2" });
    expect(second.nextPageToken).toBeNull();
  });

  it("fetches reference details with the details field mask and returns null for unknown references", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(place)).mockResolvedValueOnce(jsonResponse({ error: { message: "not found" } }, 404));
    const provider = new GooglePlacesDiscoveryProvider({ apiKey: "secret-key", fetchImpl });

    const details = await provider.getReferenceDetails("ChIJabc123");
    expect(details?.displayName).toBe("A&B Roofing Ltd");
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://places.googleapis.com/v1/places/ChIJabc123");
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(PLACE_DETAILS_FIELD_MASK);
    expect(await provider.getReferenceDetails("missing")).toBeNull();
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
