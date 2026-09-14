import { isThirdPartyHost, normalizeDomain, normalizeWebsiteUrl } from "@/domain/identifiers";
import type { WebsiteState } from "@/db/types";

// Official-website verifier (RL-036). Deterministic rule engine over typed signals.
// A business is never labelled "verified no website" from a single weak signal.

export const WEBSITE_VERIFIER_VERSION = "v1";

export type WebsiteSignalSource = "discovery_provider" | "http_probe" | "search_engine" | "operator";

export type WebsiteSignal =
  | { source: WebsiteSignalSource; kind: "website_url_present"; url: string; observedAt: string }
  | { source: WebsiteSignalSource; kind: "website_url_absent"; observedAt: string }
  | { source: WebsiteSignalSource; kind: "third_party_profile"; url: string; host: string; observedAt: string }
  | { source: "http_probe"; kind: "reachable"; url: string; finalUrl: string; statusCode: number; observedAt: string }
  | { source: "http_probe"; kind: "unreachable"; url: string; reason: string; statusCode?: number; observedAt: string }
  | { source: WebsiteSignalSource; kind: "no_website_confirmed"; observedAt: string; note?: string };

export type WebsiteVerificationState = Exclude<WebsiteState, "unknown">;

export type WebsiteVerification = {
  state: WebsiteVerificationState;
  websiteUrl: string | null;
  canonicalDomain: string | null;
  confidence: number;
  signals: WebsiteSignal[];
  reasons: string[];
  verifierVersion: typeof WEBSITE_VERIFIER_VERSION;
};

/** Converts a provider website hint into signals, reclassifying third-party hosts as profile links. */
export function signalsFromWebsiteHint(input: { source: WebsiteSignalSource; url: string | null; observedAt: string }): WebsiteSignal[] {
  const { source, url, observedAt } = input;
  if (!url) return [{ source, kind: "website_url_absent", observedAt }];

  const domain = normalizeDomain(url);
  if (!domain) return [{ source, kind: "website_url_absent", observedAt }];
  if (isThirdPartyHost(domain)) return [{ source, kind: "third_party_profile", url, host: domain, observedAt }];
  return [{ source, kind: "website_url_present", url, observedAt }];
}

/** Returns the official-looking URL that should be probed, if any. */
export function officialUrlToProbe(signals: WebsiteSignal[]): string | null {
  for (const signal of signals) {
    if (signal.kind === "website_url_present") {
      const domain = normalizeDomain(signal.url);
      if (domain && !isThirdPartyHost(domain)) return normalizeWebsiteUrl(signal.url);
    }
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function evaluateWebsiteSignals(signals: WebsiteSignal[]): WebsiteVerification {
  const reasons: string[] = [];
  const base = { signals, verifierVersion: WEBSITE_VERIFIER_VERSION } as const;

  if (signals.length === 0) {
    return { ...base, state: "unverified", websiteUrl: null, canonicalDomain: null, confidence: 0, reasons: ["no_signals"] };
  }

  // 1. Positive: an official URL that answered over HTTP.
  const reachable = signals.filter((signal): signal is Extract<WebsiteSignal, { kind: "reachable" }> => signal.kind === "reachable");
  for (const hit of reachable) {
    const finalDomain = normalizeDomain(hit.finalUrl);
    const requestedDomain = normalizeDomain(hit.url);
    if (!finalDomain) continue;

    if (isThirdPartyHost(finalDomain)) {
      reasons.push("redirected_to_third_party");
      continue;
    }

    const redirectedElsewhere = requestedDomain !== null && finalDomain !== requestedDomain;
    reasons.push("http_reachable");
    if (redirectedElsewhere) reasons.push("redirected_to_other_domain");
    const confidence = round(redirectedElsewhere ? 0.8 : hit.statusCode >= 200 && hit.statusCode < 300 ? 0.95 : 0.85);

    return {
      ...base,
      state: "verified_website",
      websiteUrl: normalizeWebsiteUrl(hit.finalUrl),
      canonicalDomain: finalDomain,
      confidence,
      reasons,
    };
  }

  // 2. An official-looking URL exists but has not been confirmed.
  const official = signals.filter((signal): signal is Extract<WebsiteSignal, { kind: "website_url_present" }> => {
    if (signal.kind !== "website_url_present") return false;
    const domain = normalizeDomain(signal.url);
    return domain !== null && !isThirdPartyHost(domain);
  });

  if (official.length > 0) {
    const url = normalizeWebsiteUrl(official[0].url);
    const unreachable = signals.find((signal): signal is Extract<WebsiteSignal, { kind: "unreachable" }> => signal.kind === "unreachable");
    if (unreachable) reasons.push(`http_unreachable:${unreachable.reason}`);
    else reasons.push("not_probed");
    return {
      ...base,
      state: "unverified",
      websiteUrl: url,
      canonicalDomain: normalizeDomain(url),
      confidence: unreachable ? 0.4 : 0.5,
      reasons,
    };
  }

  // 3. Negative: count independent sources asserting there is no official website.
  const operatorConfirmed = signals.some((signal) => signal.kind === "no_website_confirmed" && signal.source === "operator");
  const negativeSources = new Set<WebsiteSignalSource>();
  let thirdPartyUrl: string | null = null;
  for (const signal of signals) {
    if (signal.kind === "website_url_absent" || signal.kind === "no_website_confirmed") negativeSources.add(signal.source);
    if (signal.kind === "third_party_profile") {
      negativeSources.add(signal.source);
      thirdPartyUrl = thirdPartyUrl ?? signal.url;
      if (!reasons.includes("third_party_profile_only")) reasons.push("third_party_profile_only");
    }
  }

  if (operatorConfirmed) {
    reasons.push("operator_confirmed_no_website");
    return { ...base, state: "verified_no_website", websiteUrl: null, canonicalDomain: null, confidence: 0.95, reasons };
  }

  if (negativeSources.size >= 2) {
    reasons.push("independent_sources_agree_no_website");
    return { ...base, state: "verified_no_website", websiteUrl: null, canonicalDomain: null, confidence: 0.8, reasons };
  }

  if (negativeSources.size === 1) {
    reasons.push("single_source_no_website");
    return { ...base, state: "likely_no_website", websiteUrl: null, canonicalDomain: null, confidence: thirdPartyUrl ? 0.55 : 0.5, reasons };
  }

  reasons.push("insufficient_signals");
  return { ...base, state: "unverified", websiteUrl: null, canonicalDomain: null, confidence: 0.1, reasons };
}
