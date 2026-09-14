import { describe, expect, it } from "vitest";

import { dedupeCandidates, partitionAgainstKnown } from "@/discovery/dedupe";
import { candidateDedupeKey, type DiscoveryCandidateInput } from "@/discovery/provider";
import { advanceCursor, buildSearchUnits, isCursorFinished, parseCursor } from "@/discovery/search-plan";

function candidate(overrides: Partial<DiscoveryCandidateInput>): DiscoveryCandidateInput {
  return {
    provider: "google_places",
    providerRef: "place-1",
    displayName: "A&B Roofing",
    formattedAddress: null,
    locality: "Uxbridge",
    postcode: null,
    region: null,
    countryCode: "GB",
    primaryCategory: "roofing contractor",
    categories: [],
    websiteHint: null,
    websiteHintState: "absent",
    phoneHint: null,
    businessStatus: "operational",
    attribution: "Google",
    observedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

describe("candidate deduplication", () => {
  it("collapses repeated provider references and fills gaps from later sightings", () => {
    const result = dedupeCandidates([
      candidate({ providerRef: "place-1", postcode: null }),
      candidate({ providerRef: "place-2", displayName: "Other Roofing" }),
      candidate({ providerRef: "place-1", postcode: "UB8 1AA", websiteHint: "https://abroofing.co.uk" }),
    ]);

    expect(result.duplicates).toBe(1);
    expect(result.unique.map((item) => item.providerRef)).toEqual(["place-1", "place-2"]);
    expect(result.unique[0].postcode).toBe("UB8 1AA");
    expect(result.unique[0].displayName).toBe("A&B Roofing");
  });

  it("does not merge different references even when the names are identical", () => {
    const result = dedupeCandidates([candidate({ providerRef: "place-1" }), candidate({ providerRef: "place-9" })]);
    expect(result.unique).toHaveLength(2);
    expect(result.duplicates).toBe(0);
  });

  it("separates candidates already known to the campaign", () => {
    const known = new Set([candidateDedupeKey(candidate({ providerRef: "place-1" }))]);
    const { fresh, known: seenAgain } = partitionAgainstKnown([candidate({ providerRef: "place-1" }), candidate({ providerRef: "place-2" })], known);
    expect(fresh.map((item) => item.providerRef)).toEqual(["place-2"]);
    expect(seenAgain.map((item) => item.providerRef)).toEqual(["place-1"]);
  });
});

describe("search plan and cursor", () => {
  it("builds every category x location pair, trimmed and de-duplicated", () => {
    const units = buildSearchUnits({ target_categories: [" roofer", "Roofer", "plumber"], target_locations: ["Uxbridge", "Hayes ", ""] });
    expect(units).toEqual([
      { category: "roofer", location: "Uxbridge" },
      { category: "plumber", location: "Uxbridge" },
      { category: "roofer", location: "Hayes" },
      { category: "plumber", location: "Hayes" },
    ]);
    expect(buildSearchUnits({ target_categories: [], target_locations: ["Uxbridge"] })).toEqual([]);
  });

  it("persists progress through page tokens and moves on at the page cap", () => {
    let cursor = parseCursor({ unitIndex: 0, pageToken: null, pagesFetched: 0 });
    let step = advanceCursor(cursor, "token-2", 2);
    expect(step).toEqual({ cursor: { unitIndex: 0, pageToken: "token-2", pagesFetched: 1 }, unitCompleted: false });
    step = advanceCursor(step.cursor, "token-3", 2);
    expect(step).toEqual({ cursor: { unitIndex: 1, pageToken: null, pagesFetched: 0 }, unitCompleted: true });
    cursor = advanceCursor(step.cursor, null, 2).cursor;
    expect(isCursorFinished(cursor, 2)).toBe(true);
    expect(parseCursor("garbage")).toEqual({ unitIndex: 0, pageToken: null, pagesFetched: 0 });
  });
});
