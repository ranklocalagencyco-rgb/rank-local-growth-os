import type { DiscoveryCandidateInput } from "@/discovery/provider";
import type { WebsiteVerification } from "@/discovery/website/verify";
import { normalizeBusinessName } from "@/domain/crm";
import { normalizeLocality, normalizePhone } from "@/domain/identifiers";

// Candidate resolver (RL-035): turns a discovery reference into a canonical prospect.
// Matching uses weighted identifiers in a fixed priority. Names alone never merge.

export type MatchIdentifier = "source_ref" | "domain" | "phone" | "name_locality";

export type ExistingProspectMatch = {
  prospectId: string;
  matchedBy: MatchIdentifier;
};

export type ResolutionLookup = {
  workspaceId: string;
  provider: string;
  providerRef: string;
  canonicalDomain: string | null;
  normalizedPhone: string | null;
  normalizedName: string;
  locality: string | null;
};

export type ResolutionDecision =
  | { resolution: "matched"; prospectId: string; confidence: number; matchedIdentifiers: MatchIdentifier[]; warnings: string[] }
  | { resolution: "create"; prospectId: null; confidence: number; matchedIdentifiers: []; warnings: string[] }
  | { resolution: "ambiguous"; prospectId: null; confidence: number; matchedIdentifiers: MatchIdentifier[]; candidateProspectIds: string[]; warnings: string[] }
  | { resolution: "rejected"; prospectId: null; confidence: number; matchedIdentifiers: []; reason: string; warnings: string[] };

const IDENTIFIER_CONFIDENCE: Record<MatchIdentifier, number> = {
  source_ref: 0.99,
  domain: 0.9,
  phone: 0.85,
  name_locality: 0.4,
};

export function buildResolutionLookup(input: { workspaceId: string; candidate: DiscoveryCandidateInput; verification: WebsiteVerification }): ResolutionLookup {
  const { workspaceId, candidate, verification } = input;
  return {
    workspaceId,
    provider: candidate.provider,
    providerRef: candidate.providerRef,
    // Only a verified official domain is a trustworthy identity key.
    canonicalDomain: verification.state === "verified_website" ? verification.canonicalDomain : null,
    normalizedPhone: normalizePhone(candidate.phoneHint, candidate.countryCode ?? "GB"),
    normalizedName: normalizeBusinessName(candidate.displayName ?? ""),
    locality: normalizeLocality(candidate.locality),
  };
}

export function decideResolution(input: { candidate: Pick<DiscoveryCandidateInput, "displayName" | "businessStatus">; matches: ExistingProspectMatch[] }): ResolutionDecision {
  const { candidate, matches } = input;
  const warnings: string[] = [];

  if (!candidate.displayName || !candidate.displayName.trim()) {
    return { resolution: "rejected", prospectId: null, confidence: 1, matchedIdentifiers: [], reason: "missing_business_name", warnings };
  }
  if (candidate.businessStatus === "closed_permanently") {
    return { resolution: "rejected", prospectId: null, confidence: 1, matchedIdentifiers: [], reason: "closed_permanently", warnings };
  }

  const strong = matches.filter((match) => match.matchedBy !== "name_locality");
  const weak = matches.filter((match) => match.matchedBy === "name_locality");

  if (strong.length > 0) {
    const prospectIds = [...new Set(strong.map((match) => match.prospectId))];
    const identifiers = [...new Set(strong.map((match) => match.matchedBy))];

    if (prospectIds.length > 1) {
      warnings.push("conflicting_identifiers");
      return { resolution: "ambiguous", prospectId: null, confidence: 0.3, matchedIdentifiers: identifiers, candidateProspectIds: prospectIds, warnings };
    }

    const confidence = Math.max(...identifiers.map((identifier) => IDENTIFIER_CONFIDENCE[identifier]));
    if (weak.some((match) => match.prospectId !== prospectIds[0])) warnings.push("similar_name_elsewhere");
    return { resolution: "matched", prospectId: prospectIds[0], confidence, matchedIdentifiers: identifiers, warnings };
  }

  if (weak.length > 0) {
    warnings.push("name_locality_only");
    return {
      resolution: "ambiguous",
      prospectId: null,
      confidence: IDENTIFIER_CONFIDENCE.name_locality,
      matchedIdentifiers: ["name_locality"],
      candidateProspectIds: [...new Set(weak.map((match) => match.prospectId))],
      warnings,
    };
  }

  return { resolution: "create", prospectId: null, confidence: 0.7, matchedIdentifiers: [], warnings };
}

export type NewProspectRecord = {
  workspaceId: string;
  displayName: string;
  normalizedName: string;
  canonicalDomain: string | null;
  primaryPhone: string | null;
  countryCode: string;
  region: string | null;
  city: string | null;
  postcode: string | null;
  websiteState: WebsiteVerification["state"];
  websiteUrl: string | null;
};

export function buildNewProspectRecord(input: { workspaceId: string; candidate: DiscoveryCandidateInput; verification: WebsiteVerification; lookup: ResolutionLookup; defaultCountryCode: string }): NewProspectRecord {
  const { workspaceId, candidate, verification, lookup, defaultCountryCode } = input;
  return {
    workspaceId,
    displayName: candidate.displayName?.trim() ?? "",
    normalizedName: lookup.normalizedName,
    canonicalDomain: verification.state === "verified_website" ? verification.canonicalDomain : null,
    primaryPhone: lookup.normalizedPhone,
    countryCode: candidate.countryCode ?? defaultCountryCode,
    region: candidate.region,
    city: candidate.locality,
    postcode: candidate.postcode,
    websiteState: verification.state,
    websiteUrl: verification.websiteUrl,
  };
}
