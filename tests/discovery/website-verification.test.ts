import { describe, expect, it, vi } from "vitest";

import { isBlockedHostname, isBlockedIpAddress, probeWebsite } from "@/discovery/website/http-probe";
import { evaluateWebsiteSignals, officialUrlToProbe, signalsFromWebsiteHint, type WebsiteSignal } from "@/discovery/website/verify";

const at = "2026-09-14T10:00:00.000Z";

describe("website verification states", () => {
  it("verifies a website when the provider URL is official-looking and answers over HTTP", () => {
    const result = evaluateWebsiteSignals([
      { source: "discovery_provider", kind: "website_url_present", url: "https://www.abroofing.co.uk/", observedAt: at },
      { source: "http_probe", kind: "reachable", url: "https://www.abroofing.co.uk", finalUrl: "https://www.abroofing.co.uk/", statusCode: 200, observedAt: at },
    ]);
    expect(result.state).toBe("verified_website");
    expect(result.canonicalDomain).toBe("abroofing.co.uk");
    expect(result.websiteUrl).toBe("https://www.abroofing.co.uk");
    expect(result.confidence).toBe(0.95);
    expect(result.reasons).toContain("http_reachable");
  });

  it("follows a redirect to another domain with reduced confidence", () => {
    const result = evaluateWebsiteSignals([
      { source: "discovery_provider", kind: "website_url_present", url: "http://abroofing.co.uk", observedAt: at },
      { source: "http_probe", kind: "reachable", url: "http://abroofing.co.uk", finalUrl: "https://abroofing-ltd.com/home", statusCode: 200, observedAt: at },
    ]);
    expect(result.state).toBe("verified_website");
    expect(result.canonicalDomain).toBe("abroofing-ltd.com");
    expect(result.confidence).toBe(0.8);
    expect(result.reasons).toContain("redirected_to_other_domain");
  });

  it("keeps an unreachable provider URL as unverified rather than calling it no website", () => {
    const result = evaluateWebsiteSignals([
      { source: "discovery_provider", kind: "website_url_present", url: "https://abroofing.co.uk", observedAt: at },
      { source: "http_probe", kind: "unreachable", url: "https://abroofing.co.uk", reason: "timeout", observedAt: at },
    ]);
    expect(result.state).toBe("unverified");
    expect(result.websiteUrl).toBe("https://abroofing.co.uk");
    expect(result.confidence).toBe(0.4);
    expect(result.reasons).toContain("http_unreachable:timeout");
  });

  it("treats a redirect into a third-party host as unverified, not verified", () => {
    const result = evaluateWebsiteSignals([
      { source: "discovery_provider", kind: "website_url_present", url: "https://abroofing.co.uk", observedAt: at },
      { source: "http_probe", kind: "reachable", url: "https://abroofing.co.uk", finalUrl: "https://www.facebook.com/abroofing", statusCode: 200, observedAt: at },
    ]);
    expect(result.state).toBe("unverified");
    expect(result.reasons).toContain("redirected_to_third_party");
  });

  it("never labels verified no website from a single weak signal", () => {
    const absentOnly = evaluateWebsiteSignals([{ source: "discovery_provider", kind: "website_url_absent", observedAt: at }]);
    expect(absentOnly.state).toBe("likely_no_website");
    expect(absentOnly.confidence).toBe(0.5);
    expect(absentOnly.reasons).toContain("single_source_no_website");

    const facebookOnly = evaluateWebsiteSignals(signalsFromWebsiteHint({ source: "discovery_provider", url: "https://www.facebook.com/abroofing", observedAt: at }));
    expect(facebookOnly.state).toBe("likely_no_website");
    expect(facebookOnly.websiteUrl).toBeNull();
    expect(facebookOnly.reasons).toContain("third_party_profile_only");
  });

  it("reaches verified no website only with independent agreeing sources or operator confirmation", () => {
    const twoSources = evaluateWebsiteSignals([
      { source: "discovery_provider", kind: "website_url_absent", observedAt: at },
      { source: "search_engine", kind: "website_url_absent", observedAt: at },
    ]);
    expect(twoSources.state).toBe("verified_no_website");
    expect(twoSources.confidence).toBe(0.8);

    const sameSourceTwice = evaluateWebsiteSignals([
      { source: "discovery_provider", kind: "website_url_absent", observedAt: at },
      { source: "discovery_provider", kind: "third_party_profile", url: "https://yell.com/biz/x", host: "yell.com", observedAt: at },
    ]);
    expect(sameSourceTwice.state).toBe("likely_no_website");

    const operator = evaluateWebsiteSignals([
      { source: "discovery_provider", kind: "website_url_absent", observedAt: at },
      { source: "operator", kind: "no_website_confirmed", observedAt: at },
    ]);
    expect(operator.state).toBe("verified_no_website");
    expect(operator.confidence).toBe(0.95);
  });

  it("returns unverified with zero confidence when there are no signals", () => {
    expect(evaluateWebsiteSignals([])).toMatchObject({ state: "unverified", confidence: 0, reasons: ["no_signals"] });
  });

  it("only probes official-looking URLs", () => {
    const signals: WebsiteSignal[] = signalsFromWebsiteHint({ source: "discovery_provider", url: "https://www.checkatrade.com/trades/abroofing", observedAt: at });
    expect(officialUrlToProbe(signals)).toBeNull();
    expect(officialUrlToProbe(signalsFromWebsiteHint({ source: "discovery_provider", url: "abroofing.co.uk/?ref=g", observedAt: at }))).toBe("http://abroofing.co.uk");
  });
});

describe("HTTP probe safety", () => {
  it("blocks private, loopback, link-local and metadata targets", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.5.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
    expect(isBlockedIpAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("intranet")).toBe(true);
    expect(isBlockedHostname("example.co.uk")).toBe(false);
  });

  it("refuses hosts that resolve to blocked addresses and never fetches them", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await probeWebsite("https://evil.example/", { fetchImpl, lookup: async () => ["10.0.0.8"] });
    expect(result).toEqual({ ok: false, url: "https://evil.example/", reason: "blocked_address" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows bounded redirects, re-checking every hop", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.abroofing.co.uk/" } }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    const result = await probeWebsite("http://abroofing.co.uk", { fetchImpl, lookup: async () => ["93.184.216.34"] });
    expect(result).toEqual({ ok: true, url: "http://abroofing.co.uk", finalUrl: "https://www.abroofing.co.uk/", statusCode: 200 });

    const redirectIntoPrivate = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    expect(await probeWebsite("http://abroofing.co.uk", { fetchImpl: redirectIntoPrivate, lookup: async () => ["93.184.216.34"] })).toMatchObject({ ok: false, reason: "blocked_address" });
  });

  it("reports not found, server errors and network failures distinctly", async () => {
    const lookup = async () => ["93.184.216.34"];
    expect(await probeWebsite("https://abroofing.co.uk", { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })), lookup })).toMatchObject({ ok: false, reason: "not_found", statusCode: 404 });
    expect(await probeWebsite("https://abroofing.co.uk", { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })), lookup })).toMatchObject({ ok: false, reason: "server_error" });
    expect(await probeWebsite("https://abroofing.co.uk", { fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")), lookup })).toMatchObject({ ok: false, reason: "network_error" });
    expect(await probeWebsite("https://abroofing.co.uk", { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })), lookup })).toMatchObject({ ok: true, statusCode: 403 });
    expect(await probeWebsite("ftp://abroofing.co.uk", { fetchImpl: vi.fn<typeof fetch>(), lookup })).toMatchObject({ ok: false, reason: "unsupported_scheme" });
  });
});
