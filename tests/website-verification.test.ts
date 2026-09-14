import { describe, expect, it } from "vitest";

import { isBlockedTarget, type FetchOutcome, type WebsiteFetcher } from "@/verification/fetcher";
import { generateDomainGuesses, matchPage, WebsiteVerifier, type WebsiteVerificationInput } from "@/verification/website-verifier";

class FakeFetcher implements WebsiteFetcher {
  readonly requested: string[] = [];
  constructor(private readonly responses: Record<string, FetchOutcome | ((url: string) => FetchOutcome)>, private readonly fallback: (url: string) => FetchOutcome = notFound) {}
  async fetchPage(url: string): Promise<FetchOutcome> {
    this.requested.push(url);
    const entry = this.responses[url];
    if (!entry) return this.fallback(url);
    return typeof entry === "function" ? entry(url) : entry;
  }
}

function page(url: string, html: string): FetchOutcome {
  return { ok: true, requestedUrl: url, finalUrl: url, status: 200, contentType: "text/html", html };
}
function notFound(url: string): FetchOutcome {
  return { ok: false, requestedUrl: url, finalUrl: null, status: null, failure: "network", message: "getaddrinfo ENOTFOUND" };
}
function timeout(url: string): FetchOutcome {
  return { ok: false, requestedUrl: url, finalUrl: null, status: null, failure: "timeout", message: "Request timed out" };
}

const baseInput: WebsiteVerificationInput = {
  provider: "google_places",
  externalRef: "ChIJabc123",
  businessName: "Brunel Roofing Ltd",
  phone: "01895 123456",
  locality: "Uxbridge",
  postcode: "UB8 1AB",
  countryCode: "GB",
  websiteHint: "https://www.brunelroofing.co.uk/",
  websiteHintState: "present",
};

const matchingHtml = "<html><head><title>Brunel Roofing Ltd | Roofers in Uxbridge</title></head><body><h1>Brunel Roofing</h1><p>Call 01895 123456</p></body></html>";
const now = () => new Date("2026-09-14T12:00:00.000Z");

describe("website verification states", () => {
  it("verifies a provider link when the page corroborates the business", async () => {
    const fetcher = new FakeFetcher({ "https://www.brunelroofing.co.uk": page("https://www.brunelroofing.co.uk", matchingHtml) });
    const result = await new WebsiteVerifier({ fetcher, now }).verify(baseInput);
    expect(result.state).toBe("verified_website");
    expect(result.canonicalDomain).toBe("brunelroofing.co.uk");
    expect(result.verifiedUrl).toBe("https://www.brunelroofing.co.uk");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.evidence.map((signal) => `${signal.signal}:${signal.result}`)).toEqual(["provider_website_hint:positive", "website_fetch:positive"]);
  });

  it("keeps a provider link unverified when the fetch fails instead of calling it no website", async () => {
    const fetcher = new FakeFetcher({}, timeout);
    const result = await new WebsiteVerifier({ fetcher, now }).verify(baseInput);
    expect(result.state).toBe("unverified_website");
    expect(result.canonicalDomain).toBeNull();
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("does not verify a reachable link whose content belongs to a different business", async () => {
    const fetcher = new FakeFetcher({ "https://www.brunelroofing.co.uk": page("https://www.brunelroofing.co.uk", "<title>Domain for sale</title><p>Buy this domain</p>") });
    const result = await new WebsiteVerifier({ fetcher, now }).verify(baseInput);
    expect(result.state).toBe("unverified_website");
    expect(result.evidence.at(-1)?.result).toBe("inconclusive");
  });

  it("classifies a Facebook link as a social profile and probes for an owned site", async () => {
    const fetcher = new FakeFetcher({});
    const result = await new WebsiteVerifier({ fetcher, now }).verify({ ...baseInput, websiteHint: "https://www.facebook.com/brunelroofing" });
    expect(result.state).toBe("social_profile_only");
    expect(fetcher.requested).not.toContain("https://www.facebook.com/brunelroofing");
    expect(fetcher.requested.length).toBeGreaterThanOrEqual(3);
  });

  it("only labels verified_no_website after the provider hint and independent probes all come back negative", async () => {
    const fetcher = new FakeFetcher({});
    const result = await new WebsiteVerifier({ fetcher, now }).verify({ ...baseInput, websiteHint: null, websiteHintState: "absent" });
    expect(result.state).toBe("verified_no_website");
    expect(result.confidence).toBe(0.75);
    const negatives = result.evidence.filter((signal) => signal.result === "negative");
    expect(negatives.length).toBeGreaterThanOrEqual(3);
    expect(new Set(negatives.map((signal) => signal.signal))).toEqual(new Set(["provider_website_hint", "domain_probe"]));
  });

  it("returns unknown when a probe is inconclusive, never no website from one weak signal", async () => {
    const fetcher = new FakeFetcher({ "https://brunelroofing.co.uk": timeout("https://brunelroofing.co.uk") });
    const result = await new WebsiteVerifier({ fetcher, now }).verify({ ...baseInput, websiteHint: null, websiteHintState: "absent" });
    expect(result.state).toBe("unknown");
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it("finds an owned website through a domain guess when identity is corroborated", async () => {
    const fetcher = new FakeFetcher({ "https://brunelroofing.co.uk": page("https://brunelroofing.co.uk", matchingHtml) });
    const result = await new WebsiteVerifier({ fetcher, now }).verify({ ...baseInput, websiteHint: null, websiteHintState: "absent" });
    expect(result.state).toBe("verified_website");
    expect(result.canonicalDomain).toBe("brunelroofing.co.uk");
    expect(result.confidence).toBe(0.85);
  });

  it("does not accept a guessed domain that merely resolves", async () => {
    const fetcher = new FakeFetcher({ "https://brunelroofing.co.uk": page("https://brunelroofing.co.uk", "<title>Roofing</title><p>Generic roofing directory</p>") });
    const result = await new WebsiteVerifier({ fetcher, now }).verify({ ...baseInput, websiteHint: null, websiteHintState: "absent" });
    expect(result.state).toBe("verified_no_website");
  });

  it("cannot verify anything without a business name to probe", async () => {
    const result = await new WebsiteVerifier({ fetcher: new FakeFetcher({}), now }).verify({ ...baseInput, businessName: null, websiteHint: null, websiteHintState: "absent" });
    expect(result.state).toBe("unknown");
  });
});

describe("page matching and probing helpers", () => {
  it("matches names, phones and localities deterministically", () => {
    const match = matchPage(matchingHtml, baseInput);
    expect(match).toMatchObject({ nameStrength: "strong", phoneMatch: true, localityMatch: true, title: "Brunel Roofing Ltd | Roofers in Uxbridge" });
    expect(matchPage("<title>Some Other Trader</title><p>Roofing in Hayes</p>", baseInput).nameStrength).toBe("none");
  });

  it("generates bounded UK domain guesses and skips platform hosts", () => {
    expect(generateDomainGuesses("Brunel Roofing Ltd", "GB")).toEqual(["brunelroofing.co.uk", "brunelroofing.com", "brunelroofing.uk", "brunel-roofing.co.uk", "brunel-roofing.com"]);
    expect(generateDomainGuesses("AB", "GB")).toEqual([]);
    expect(generateDomainGuesses(null, "GB")).toEqual([]);
  });

  it("blocks private and local fetch targets", () => {
    expect(isBlockedTarget(new URL("http://localhost:3000"))).toBe(true);
    expect(isBlockedTarget(new URL("http://169.254.169.254/latest/meta-data"))).toBe(true);
    expect(isBlockedTarget(new URL("http://10.1.2.3"))).toBe(true);
    expect(isBlockedTarget(new URL("http://172.20.0.1"))).toBe(true);
    expect(isBlockedTarget(new URL("ftp://example.com"))).toBe(true);
    expect(isBlockedTarget(new URL("https://example.co.uk"))).toBe(false);
  });
});
