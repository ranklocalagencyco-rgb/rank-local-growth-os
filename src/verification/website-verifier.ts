import { nameTokens, normalizeDomain, normalizeLocality, normalizePhone, normalizeUrl } from "@/domain/identifiers";
import type { DiscoveryProviderName, WebsiteHintState } from "@/discovery/provider";
import type { FetchOutcome, WebsiteFetcher } from "@/verification/fetcher";
import { isPlatformDomain } from "@/verification/platforms";

export const WEBSITE_VERIFICATION_METHOD_VERSION = "v1";

export type WebsiteVerificationState = "verified_website" | "unverified_website" | "social_profile_only" | "verified_no_website" | "unknown";

export type VerificationSignal = {
  signal: "provider_website_hint" | "platform_profile" | "website_fetch" | "domain_probe";
  source: string;
  observedAt: string;
  result: "positive" | "negative" | "inconclusive";
  detail: Record<string, unknown>;
};

export type WebsiteVerificationInput = {
  provider: DiscoveryProviderName;
  externalRef: string;
  businessName: string | null;
  phone: string | null;
  locality: string | null;
  postcode: string | null;
  countryCode: string;
  websiteHint: string | null;
  websiteHintState: WebsiteHintState;
};

export type WebsiteVerificationResult = {
  state: WebsiteVerificationState;
  verifiedUrl: string | null;
  canonicalDomain: string | null;
  confidence: number;
  evidence: VerificationSignal[];
  methodVersion: string;
  checkedAt: string;
};

export type PageMatch = {
  nameStrength: "strong" | "weak" | "none";
  phoneMatch: boolean;
  localityMatch: boolean;
  title: string | null;
};

const GENERIC_TRADE_TOKENS = new Set(["roofing", "roofers", "roofer", "plumbing", "plumber", "plumbers", "heating", "electrical", "electrician", "electricians", "builders", "builder", "building", "landscaping", "landscapes", "plastering", "plasterers", "painting", "decorating", "decorators", "cleaning", "cleaners", "clearance", "driveways", "paving", "kitchens", "bathrooms", "windows", "doors", "drainage", "gardening", "gardens", "property", "maintenance", "solutions", "contractors", "construction", "home", "homes", "local"]);

export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : null;
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .toLowerCase();
  return { title, text };
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export function matchPage(html: string, input: Pick<WebsiteVerificationInput, "businessName" | "phone" | "locality" | "postcode" | "countryCode">): PageMatch {
  const { title, text } = htmlToText(html);
  const haystack = `${title?.toLowerCase() ?? ""} ${text} ${html.toLowerCase()}`;

  let nameStrength: PageMatch["nameStrength"] = "none";
  if (input.businessName) {
    const tokens = nameTokens(input.businessName);
    const distinctive = tokens.filter((token) => token.length >= 3 && !GENERIC_TRADE_TOKENS.has(token));
    const compact = tokens.join("");
    const matchedDistinctive = distinctive.filter((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(haystack));
    const compactFound = compact.length >= 6 && haystack.includes(compact);
    const fullPhrase = tokens.length >= 2 && haystack.includes(tokens.join(" "));
    if (compactFound || fullPhrase || matchedDistinctive.length >= 2 || (distinctive.length === 1 && matchedDistinctive.length === 1 && distinctive[0].length >= 5)) nameStrength = "strong";
    else if (matchedDistinctive.length >= 1 || tokens.some((token) => token.length >= 4 && new RegExp(`\\b${escapeRegExp(token)}\\b`).test(haystack))) nameStrength = "weak";
  }

  let phoneMatch = false;
  const targetPhone = normalizePhone(input.phone, input.countryCode);
  if (targetPhone) {
    const candidates = html.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
    phoneMatch = candidates.some((candidate) => normalizePhone(candidate, input.countryCode) === targetPhone);
  }

  let localityMatch = false;
  const locality = normalizeLocality(input.locality);
  if (locality && new RegExp(`\\b${escapeRegExp(locality)}\\b`).test(text)) localityMatch = true;
  if (!localityMatch && input.postcode) {
    const compactPostcode = input.postcode.toUpperCase().replace(/\s+/g, "");
    if (compactPostcode.length >= 5 && text.toUpperCase().replace(/\s+/g, "").includes(compactPostcode)) localityMatch = true;
  }

  return { nameStrength, phoneMatch, localityMatch, title };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function generateDomainGuesses(businessName: string | null, countryCode: string, limit = 6): string[] {
  if (!businessName) return [];
  const tokens = nameTokens(businessName);
  if (tokens.length === 0) return [];
  const compact = tokens.join("");
  const hyphenated = tokens.join("-");
  if (compact.length < 4 || compact.length > 40) return [];
  const tlds = countryCode.toUpperCase() === "GB" ? ["co.uk", "com", "uk"] : ["com", "net"];

  const guesses: string[] = [];
  for (const tld of tlds) guesses.push(`${compact}.${tld}`);
  if (hyphenated !== compact) for (const tld of tlds.slice(0, 2)) guesses.push(`${hyphenated}.${tld}`);
  return guesses.filter((guess) => !isPlatformDomain(guess)).slice(0, limit);
}

type VerifierDependencies = {
  fetcher: WebsiteFetcher;
  now?: () => Date;
  maxProbes?: number;
};

export class WebsiteVerifier {
  private readonly now: () => Date;
  private readonly maxProbes: number;

  constructor(private readonly deps: VerifierDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.maxProbes = deps.maxProbes ?? 6;
  }

  async verify(input: WebsiteVerificationInput): Promise<WebsiteVerificationResult> {
    const evidence: VerificationSignal[] = [];
    const observedAt = this.now().toISOString();
    const hintUrl = normalizeUrl(input.websiteHint);
    const hintDomain = normalizeDomain(hintUrl);

    evidence.push({
      signal: "provider_website_hint",
      source: input.provider,
      observedAt,
      result: hintUrl ? "positive" : input.websiteHintState === "absent" ? "negative" : "inconclusive",
      detail: { externalRef: input.externalRef, websiteHint: hintUrl, hintState: input.websiteHintState },
    });

    if (hintUrl && hintDomain && isPlatformDomain(hintDomain)) {
      evidence.push({ signal: "platform_profile", source: "platform_list", observedAt, result: "negative", detail: { domain: hintDomain, reason: "Third-party profile, not an owned website" } });
      const probe = await this.probeDomains(input, evidence);
      if (probe.match) return this.finish("verified_website", probe.match.url, probe.match.domain, probe.match.confidence, evidence);
      return this.finish("social_profile_only", null, null, probe.allDefinitive ? 0.7 : 0.5, evidence);
    }

    if (hintUrl && hintDomain) {
      const outcome = await this.deps.fetcher.fetchPage(hintUrl);
      const assessment = this.assessFetch(outcome, input, evidence, "provider_hint");
      if (assessment.kind === "match") return this.finish("verified_website", assessment.url, assessment.domain, assessment.confidence, evidence);
      // The provider link exists but could not be corroborated. Never downgrade this to "no website".
      return this.finish("unverified_website", null, null, assessment.kind === "reachable_no_match" ? 0.5 : 0.35, evidence);
    }

    const probe = await this.probeDomains(input, evidence);
    if (probe.match) return this.finish("verified_website", probe.match.url, probe.match.domain, probe.match.confidence, evidence);

    const negativeSignals = evidence.filter((signal) => signal.result === "negative").length;
    if (input.websiteHintState === "absent" && probe.attempted >= 3 && probe.allDefinitive && negativeSignals >= 3) {
      return this.finish("verified_no_website", null, null, 0.75, evidence);
    }
    if (input.websiteHintState === "absent" && probe.attempted > 0 && probe.allDefinitive) {
      return this.finish("verified_no_website", null, null, 0.65, evidence);
    }
    return this.finish("unknown", null, null, 0.3, evidence);
  }

  private async probeDomains(input: WebsiteVerificationInput, evidence: VerificationSignal[]): Promise<{ attempted: number; allDefinitive: boolean; match: { url: string; domain: string; confidence: number } | null }> {
    const guesses = generateDomainGuesses(input.businessName, input.countryCode, this.maxProbes);
    let attempted = 0;
    let allDefinitive = true;

    for (const guess of guesses) {
      attempted += 1;
      let outcome = await this.deps.fetcher.fetchPage(`https://${guess}`);
      if (!outcome.ok && outcome.failure === "network" && !/ENOTFOUND|EAI_AGAIN/i.test(outcome.message)) {
        outcome = await this.deps.fetcher.fetchPage(`http://${guess}`);
      }
      const assessment = this.assessFetch(outcome, input, evidence, "domain_guess");
      if (assessment.kind === "match") return { attempted, allDefinitive, match: { url: assessment.url, domain: assessment.domain, confidence: assessment.confidence } };
      if (assessment.kind === "inconclusive") allDefinitive = false;
    }

    return { attempted, allDefinitive, match: null };
  }

  private assessFetch(
    outcome: FetchOutcome,
    input: WebsiteVerificationInput,
    evidence: VerificationSignal[],
    origin: "provider_hint" | "domain_guess",
  ): { kind: "match"; url: string; domain: string; confidence: number } | { kind: "reachable_no_match" } | { kind: "definitive_negative" } | { kind: "inconclusive" } {
    const observedAt = this.now().toISOString();
    const signal: VerificationSignal["signal"] = origin === "provider_hint" ? "website_fetch" : "domain_probe";

    if (!outcome.ok) {
      const inconclusive = outcome.failure === "timeout" || outcome.failure === "blocked_target";
      evidence.push({ signal, source: "http_fetch", observedAt, result: inconclusive ? "inconclusive" : "negative", detail: { url: outcome.requestedUrl, finalUrl: outcome.finalUrl, status: outcome.status, failure: outcome.failure, message: outcome.message } });
      return inconclusive ? { kind: "inconclusive" } : { kind: "definitive_negative" };
    }

    const finalUrl = normalizeUrl(outcome.finalUrl) ?? outcome.finalUrl;
    const finalDomain = normalizeDomain(finalUrl);
    const match = matchPage(outcome.html, input);
    const detail = { url: outcome.requestedUrl, finalUrl, status: outcome.status, title: match.title, nameMatch: match.nameStrength, phoneMatch: match.phoneMatch, localityMatch: match.localityMatch };

    if (!finalDomain || isPlatformDomain(finalDomain)) {
      evidence.push({ signal, source: "http_fetch", observedAt, result: "negative", detail: { ...detail, reason: "Redirected to a third-party platform" } });
      return { kind: "definitive_negative" };
    }

    let confidence = 0;
    if (origin === "provider_hint") {
      if (match.nameStrength === "strong" || match.phoneMatch) confidence = 0.9;
      else if (match.nameStrength === "weak" && match.localityMatch) confidence = 0.8;
      if (match.nameStrength === "strong" && match.phoneMatch) confidence = 0.95;
    } else {
      // A guessed domain must be corroborated by identity, not just by resolving.
      if (match.phoneMatch && match.nameStrength !== "none") confidence = 0.85;
      else if (match.phoneMatch) confidence = 0.8;
      else if (match.nameStrength === "strong" && match.localityMatch) confidence = 0.75;
    }

    if (confidence > 0) {
      evidence.push({ signal, source: "http_fetch", observedAt, result: "positive", detail });
      return { kind: "match", url: finalUrl, domain: finalDomain, confidence };
    }

    evidence.push({ signal, source: "http_fetch", observedAt, result: origin === "provider_hint" ? "inconclusive" : "negative", detail: { ...detail, reason: "Page content did not corroborate the business identity" } });
    return origin === "provider_hint" ? { kind: "reachable_no_match" } : { kind: "definitive_negative" };
  }

  private finish(state: WebsiteVerificationState, verifiedUrl: string | null, canonicalDomain: string | null, confidence: number, evidence: VerificationSignal[]): WebsiteVerificationResult {
    return { state, verifiedUrl, canonicalDomain, confidence, evidence, methodVersion: WEBSITE_VERIFICATION_METHOD_VERSION, checkedAt: this.now().toISOString() };
  }
}
