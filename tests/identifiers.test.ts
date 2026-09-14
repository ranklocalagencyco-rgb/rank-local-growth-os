import { describe, expect, it } from "vitest";

import { normalizeDomain, normalizePhone, normalizePostcodeOutward, normalizeUrl } from "@/domain/identifiers";

describe("domain normalization", () => {
  it("strips scheme, www, ports, paths and case", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.co.uk/contact?x=1#top")).toBe("example.co.uk");
    expect(normalizeDomain("www2.example.com:443/")).toBe("example.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
    expect(normalizeDomain("  Example.COM ")).toBe("example.com");
  });

  it("rejects values that are not public domains", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("192.168.0.1")).toBeNull();
    expect(normalizeDomain("mailto:someone@example.com")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
  });

  it("normalizes URLs without changing their identity", () => {
    expect(normalizeUrl("example.co.uk")).toBe("https://example.co.uk");
    expect(normalizeUrl("https://Example.co.uk/Services/#faq")).toBe("https://example.co.uk/Services");
    expect(normalizeUrl("http://example.com:80/")).toBe("http://example.com");
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });
});

describe("phone and postcode normalization", () => {
  it("normalizes UK numbers to E.164", () => {
    expect(normalizePhone("01895 123456")).toBe("+441895123456");
    expect(normalizePhone("+44 (0)7700 900123")).toBe("+4407700900123".replace("+440", "+44"));
    expect(normalizePhone("0044 1895 123456")).toBe("+441895123456");
    expect(normalizePhone("call us")).toBeNull();
  });

  it("extracts the outward postcode", () => {
    expect(normalizePostcodeOutward("UB8 1AB")).toBe("UB8");
    expect(normalizePostcodeOutward("sw1a1aa")).toBe("SW1A");
    expect(normalizePostcodeOutward("nonsense")).toBeNull();
  });
});
