import { describe, expect, it } from "vitest";

import { dedupeReferences } from "@/discovery/dedupe";
import { planSearches } from "@/discovery/planner";
import type { DiscoveryReference } from "@/discovery/provider";

function reference(overrides: Partial<DiscoveryReference>): DiscoveryReference {
  return {
    provider: "google_places",
    externalRef: "ref-1",
    displayName: "A&B Roofing Ltd",
    formattedAddress: "1 High St, Uxbridge UB8 1AB, UK",
    locality: "Uxbridge",
    postcode: "UB8 1AB",
    countryCode: "GB",
    phone: "01895 123456",
    websiteHint: "https://www.abroofing.co.uk/",
    websiteHintState: "present",
    category: "roofing contractor",
    businessStatus: "operational",
    observedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("candidate deduplication", () => {
  it("collapses repeated provider references across pages and queries", () => {
    const result = dedupeReferences([reference({}), reference({ displayName: "A & B Roofing" })]);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicates[0].reason).toBe("provider_ref");
  });

  it("treats the same normalized domain or phone as a duplicate", () => {
    const result = dedupeReferences([
      reference({}),
      reference({ externalRef: "ref-2", websiteHint: "http://ABRoofing.co.uk/contact", phone: null }),
      reference({ externalRef: "ref-3", websiteHint: null, phone: "+44 1895 123456" }),
    ]);
    expect(result.unique.map((entry) => entry.externalRef)).toEqual(["ref-1"]);
    expect(result.duplicates.map((entry) => entry.reason)).toEqual(["domain", "phone"]);
  });

  it("never dedupes on similar names alone", () => {
    const result = dedupeReferences([
      reference({ websiteHint: null, phone: null }),
      reference({ externalRef: "ref-2", displayName: "A & B Roofing Limited", websiteHint: null, phone: null }),
    ]);
    expect(result.unique).toHaveLength(2);
    expect(result.duplicates).toHaveLength(0);
  });
});

describe("search planner", () => {
  it("builds a deterministic category × location grid without duplicates", () => {
    const plan = planSearches({ categories: ["Roofing", "roofing", "Plumbing"], locations: ["Uxbridge", " Hayes "], countryCode: "GB", maxProviderRequests: 12, maxCandidates: 60 });
    expect(plan.queries).toEqual([
      { category: "Roofing", location: "Uxbridge", countryCode: "GB" },
      { category: "Plumbing", location: "Uxbridge", countryCode: "GB" },
      { category: "Roofing", location: "Hayes", countryCode: "GB" },
      { category: "Plumbing", location: "Hayes", countryCode: "GB" },
    ]);
  });
});
