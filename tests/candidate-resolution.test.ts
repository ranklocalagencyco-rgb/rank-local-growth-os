import { describe, expect, it } from "vitest";

import { resolveCandidate, type CandidateIdentity, type ProspectMatch, type ProspectMatchRepository } from "@/discovery/resolver";
import type { WebsiteVerificationResult } from "@/verification/website-verifier";

class InMemoryRepository implements ProspectMatchRepository {
  constructor(private readonly prospects: ProspectMatch[], private readonly sourceRefs: Record<string, string> = {}) {}
  async findBySourceRef(_workspaceId: string, provider: string, externalRef: string) {
    const id = this.sourceRefs[`${provider}:${externalRef}`];
    return this.prospects.find((prospect) => prospect.id === id) ?? null;
  }
  async findByDomain(_workspaceId: string, domain: string) {
    return this.prospects.filter((prospect) => prospect.canonicalDomain === domain);
  }
  async findByPhone(_workspaceId: string, phone: string) {
    return this.prospects.filter((prospect) => prospect.primaryPhone === phone);
  }
  async findByNormalizedName(_workspaceId: string, normalizedName: string) {
    return this.prospects.filter((prospect) => prospect.normalizedName === normalizedName);
  }
}

const existing: ProspectMatch = { id: "p-1", displayName: "Brunel Roofing Ltd", normalizedName: "brunel roofing ltd", canonicalDomain: "brunelroofing.co.uk", primaryPhone: "+441895123456", city: "Uxbridge", postcode: "UB8 1AB" };

const candidate: CandidateIdentity = {
  workspaceId: "ws",
  provider: "google_places",
  externalRef: "place-new",
  displayName: "Brunel Roofing Ltd",
  phone: "01895 123456",
  locality: "Uxbridge",
  postcode: "UB8 1AB",
  countryCode: "GB",
  businessStatus: "operational",
};

function verification(overrides: Partial<WebsiteVerificationResult> = {}): WebsiteVerificationResult {
  return { state: "verified_website", verifiedUrl: "https://brunelroofing.co.uk", canonicalDomain: "brunelroofing.co.uk", confidence: 0.9, evidence: [], methodVersion: "v1", checkedAt: "2026-09-14T12:00:00.000Z", ...overrides };
}

describe("candidate → prospect resolution", () => {
  it("matches by stored source reference before anything else", async () => {
    const decision = await resolveCandidate({ ...candidate, externalRef: "place-1" }, verification({ state: "unknown", canonicalDomain: null }), new InMemoryRepository([existing], { "google_places:place-1": "p-1" }));
    expect(decision).toMatchObject({ resolution: "matched", prospectId: "p-1", matchedIdentifiers: ["source_ref"] });
  });

  it("matches by verified domain and records the phone as corroboration", async () => {
    const decision = await resolveCandidate(candidate, verification(), new InMemoryRepository([existing]));
    expect(decision).toMatchObject({ resolution: "matched", prospectId: "p-1", matchedIdentifiers: ["domain", "phone"] });
    expect(decision.confidence).toBeGreaterThan(0.95);
  });

  it("ignores an unverified domain and falls back to phone", async () => {
    const decision = await resolveCandidate(candidate, verification({ state: "unverified_website", canonicalDomain: null, verifiedUrl: null }), new InMemoryRepository([existing]));
    expect(decision).toMatchObject({ resolution: "matched", prospectId: "p-1", matchedIdentifiers: ["phone"] });
  });

  it("flags same name and locality as ambiguous instead of merging", async () => {
    const decision = await resolveCandidate({ ...candidate, phone: null }, verification({ state: "verified_no_website", canonicalDomain: null, verifiedUrl: null }), new InMemoryRepository([existing]));
    expect(decision.resolution).toBe("ambiguous");
    expect(decision).toMatchObject({ matchedIdentifiers: ["name_locality"], candidateProspectIds: ["p-1"] });
  });

  it("creates a new prospect when the same name appears in a different locality", async () => {
    const decision = await resolveCandidate({ ...candidate, phone: null, locality: "Reading", postcode: "RG1 1AA" }, verification({ state: "verified_no_website", canonicalDomain: null, verifiedUrl: null }), new InMemoryRepository([existing]));
    expect(decision.resolution).toBe("created");
  });

  it("flags conflicting identifiers as ambiguous", async () => {
    const decision = await resolveCandidate(candidate, verification({ canonicalDomain: "otherroofer.co.uk", verifiedUrl: "https://otherroofer.co.uk" }), new InMemoryRepository([existing]));
    expect(decision).toMatchObject({ resolution: "ambiguous", matchedIdentifiers: ["phone"] });
  });

  it("flags a domain shared by multiple prospects", async () => {
    const decision = await resolveCandidate({ ...candidate, phone: null }, verification(), new InMemoryRepository([existing, { ...existing, id: "p-2", primaryPhone: null }]));
    expect(decision).toMatchObject({ resolution: "ambiguous", matchedIdentifiers: ["domain"], candidateProspectIds: ["p-1", "p-2"] });
  });

  it("rejects permanently closed or nameless candidates", async () => {
    const closed = await resolveCandidate({ ...candidate, businessStatus: "closed_permanently" }, verification(), new InMemoryRepository([]));
    const nameless = await resolveCandidate({ ...candidate, displayName: "  " }, verification(), new InMemoryRepository([]));
    expect(closed).toMatchObject({ resolution: "rejected", reasonCode: "closed_permanently" });
    expect(nameless).toMatchObject({ resolution: "rejected", reasonCode: "missing_name" });
  });
});
