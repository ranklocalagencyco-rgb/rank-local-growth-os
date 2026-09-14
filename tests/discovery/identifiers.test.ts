import { describe, expect, it } from "vitest";

import { isThirdPartyHost, normalizeDomain, normalizeLocality, normalizePhone, normalizeWebsiteUrl } from "@/domain/identifiers";

describe("domain normalization", () => {
  it("strips scheme, www, port, path, query and trailing dots", () => {
    expect(normalizeDomain("https://www.Example.co.uk/services?utm=1#top")).toBe("example.co.uk");
    expect(normalizeDomain("HTTP://WWW2.example.com:8080")).toBe("example.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
    expect(normalizeDomain("  sub.example.org/  ")).toBe("sub.example.org");
  });

  it("rejects values that are not public DNS names", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("http://192.168.0.1/")).toBeNull();
    expect(normalizeDomain("mailto:hello@example.com")).toBeNull();
    expect(normalizeDomain("ftp://example.com")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });

  it("canonicalises website URLs without tracking noise", () => {
    expect(normalizeWebsiteUrl("https://Www.Example.co.uk/about/?utm_source=x#team")).toBe("https://www.example.co.uk/about");
    expect(normalizeWebsiteUrl("example.co.uk")).toBe("http://example.co.uk");
    expect(normalizeWebsiteUrl("not a url")).toBeNull();
  });

  it("recognises third-party profile hosts without treating owned sites as third-party", () => {
    expect(isThirdPartyHost("m.facebook.com")).toBe(true);
    expect(isThirdPartyHost("checkatrade.com")).toBe(true);
    expect(isThirdPartyHost("abroofing.co.uk")).toBe(false);
    expect(isThirdPartyHost("notfacebook.com")).toBe(false);
    expect(isThirdPartyHost(null)).toBe(false);
  });
});

describe("phone and locality normalization", () => {
  it("normalises UK numbers to international form", () => {
    expect(normalizePhone("01895 123456")).toBe("+441895123456");
    expect(normalizePhone("+44 (0)1895 123456")).toBe("+441895123456");
    expect(normalizePhone("0044 1895 123456")).toBe("+441895123456");
    expect(normalizePhone("+1 212 555 0100")).toBe("+12125550100");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("normalises localities for cautious name+locality comparison", () => {
    expect(normalizeLocality("  Uxbridge ")).toBe("uxbridge");
    expect(normalizeLocality("Stoke-on-Trent")).toBe("stoke on trent");
    expect(normalizeLocality(null)).toBeNull();
  });
});
