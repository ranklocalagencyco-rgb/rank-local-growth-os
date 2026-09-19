import { describe, expect, it } from "vitest";

import { isAnalysableUrl, PerformanceProviderError } from "@/performance/provider";
import { buildPageSpeedUrl, normalizePageSpeedResponse, PAGESPEED_BASE_URL, PAGESPEED_FIELDS, PAGESPEED_LAB_AUDITS, PAGESPEED_MAX_RESPONSE_BYTES, PageSpeedPerformanceProvider, type PageSpeedResponse } from "@/performance/providers/pagespeed";
import realShapedResponse from "./fixtures/psi-v5-example-mobile.json";

// PageSpeed Insights adapter: normalization, error classes, request shape and outbound controls. No network; fetch is injected.
// fixtures/psi-v5-example-mobile.json is a real PSI v5 response for https://example.com/ (Lighthouse 13.4.1), trimmed: the six lab
// audits are verbatim, a few non-metric audits keep their real shape (details, base64 images shortened), the other ~140 are dropped.

const target = "https://www.example-roofing.co.uk/";
const at = "2026-09-19T10:00:00.000Z";

function response(overrides: Partial<PageSpeedResponse> = {}, lighthouse: Partial<NonNullable<PageSpeedResponse["lighthouseResult"]>> = {}): PageSpeedResponse {
  return {
    id: target,
    analysisUTCTimestamp: "2026-09-19T09:59:30.000Z",
    lighthouseResult: {
      requestedUrl: target,
      finalUrl: target,
      finalDisplayedUrl: target,
      lighthouseVersion: "12.6.0",
      fetchTime: "2026-09-19T09:59:20.000Z",
      runWarnings: [],
      categories: { performance: { score: 0.57 }, accessibility: { score: 0.885 }, "best-practices": { score: 1 }, seo: { score: 0.92 } },
      audits: {
        "first-contentful-paint": { numericValue: 2104.4 },
        "largest-contentful-paint": { numericValue: 5310.7 },
        "cumulative-layout-shift": { numericValue: 0.04321 },
        "total-blocking-time": { numericValue: 412.5 },
        "speed-index": { numericValue: 4890.2 },
        interactive: { numericValue: 7012.9 },
      },
      ...lighthouse,
    },
    ...overrides,
  };
}

const fieldData = { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2300 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 7 } }, overall_category: "FAST" };

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const provider = (fetchImpl: typeof fetch, apiKey?: string, maxResponseBytes?: number) => new PageSpeedPerformanceProvider({ fetchImpl, apiKey, now: () => new Date(at), maxResponseBytes });

async function failure(promise: Promise<unknown>): Promise<PerformanceProviderError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PerformanceProviderError);
  return error as PerformanceProviderError;
}

describe("PageSpeed response normalization", () => {
  it("maps scores to 0-100 integers, lab metrics to rounded values and keeps provenance", () => {
    const measurement = normalizePageSpeedResponse(response(), { url: target, strategy: "mobile" }, at);
    expect(measurement).toEqual({
      provider: "pagespeed",
      providerVersion: "12.6.0",
      strategy: "mobile",
      requestedUrl: target,
      finalUrl: target,
      observedAt: "2026-09-19T09:59:30.000Z",
      scores: { performance: 57, accessibility: 89, bestPractices: 100, seo: 92 },
      lab: { fcpMs: 2104, lcpMs: 5311, cls: 0.043, tbtMs: 413, speedIndexMs: 4890, ttiMs: 7013 },
      field: null,
      warnings: [],
    });
  });

  it("reports missing field data as null rather than zeros", () => {
    expect(normalizePageSpeedResponse(response({ loadingExperience: {}, originLoadingExperience: { metrics: {} } }), { url: target, strategy: "mobile" }, at).field).toBeNull();
  });

  it("reads URL-level field data and converts the CLS percentile", () => {
    const measurement = normalizePageSpeedResponse(response({ loadingExperience: fieldData }), { url: target, strategy: "mobile" }, at);
    expect(measurement.field).toEqual({ scope: "url", lcpMs: 2300, inpMs: 180, cls: 0.07, overallCategory: "FAST" });
  });

  it("labels origin-level field data, whether flagged as a fallback or returned separately", () => {
    expect(normalizePageSpeedResponse(response({ loadingExperience: { ...fieldData, origin_fallback: true } }), { url: target, strategy: "desktop" }, at).field?.scope).toBe("origin");
    expect(normalizePageSpeedResponse(response({ originLoadingExperience: fieldData }), { url: target, strategy: "desktop" }, at).field).toMatchObject({ scope: "origin", lcpMs: 2300 });
  });

  it("keeps metrics the provider omitted as null (e.g. no Time to Interactive) and falls back for timestamps", () => {
    const body = response({ analysisUTCTimestamp: undefined }, { audits: { "largest-contentful-paint": { numericValue: 1800 } }, fetchTime: undefined, categories: { performance: { score: 0.99 } } });
    const measurement = normalizePageSpeedResponse(body, { url: target, strategy: "desktop" }, at);
    expect(measurement.lab).toEqual({ fcpMs: null, lcpMs: 1800, cls: null, tbtMs: null, speedIndexMs: null, ttiMs: null });
    expect(measurement.scores).toEqual({ performance: 99, accessibility: null, bestPractices: null, seo: null });
    expect(measurement.observedAt).toBe(at);
  });

  it("treats a Lighthouse runtime error as a permanent target failure, not a measurement", () => {
    expect(() => normalizePageSpeedResponse(response({}, { runtimeError: { code: "ERRORED_DOCUMENT_REQUEST", message: "x" } }), { url: target, strategy: "mobile" }, at)).toThrowError(expect.objectContaining({ code: "target_unanalyzable", retryable: false }));
  });
});

/** Splits a partial-response selector list on its top-level commas: "a,b(c,d),e" → ["a", "b(c,d)", "e"]. */
function topLevelSelectors(mask: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of mask) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  return [...parts, current];
}

describe("PageSpeed partial-response mask", () => {
  // Regression (live, 2026-09-19): Google rejects any selector inside the lighthouseResult.audits map with 400 INVALID_ARGUMENT.
  const lighthouseSelector = topLevelSelectors(PAGESPEED_FIELDS).find((selector) => selector.startsWith("lighthouseResult("));
  const lighthouseFields = topLevelSelectors(lighthouseSelector?.slice("lighthouseResult(".length, -1) ?? "");

  it("requests the whole Lighthouse audits map", () => {
    expect(lighthouseSelector).toBeDefined();
    expect(lighthouseFields).toContain("audits");
  });

  it("never selects inside the audits map, in any syntax", () => {
    expect(lighthouseFields.filter((field) => field.startsWith("audits"))).toEqual(["audits"]);
    expect(PAGESPEED_FIELDS).not.toMatch(/audits\s*[(/]/);
    expect(PAGESPEED_FIELDS).not.toContain("numericValue");
    expect(PAGESPEED_FIELDS).not.toContain("*");
    for (const audit of PAGESPEED_LAB_AUDITS) expect(PAGESPEED_FIELDS).not.toContain(audit);
    expect(decodeURIComponent(buildPageSpeedUrl(PAGESPEED_BASE_URL, { url: target, strategy: "mobile" }, "secret-key-value"))).not.toMatch(/audits\s*[(/]/);
  });

  it("still restricts the rest of the response", () => {
    expect(topLevelSelectors(PAGESPEED_FIELDS)).toEqual(["id", "analysisUTCTimestamp", "loadingExperience(metrics,overall_category,origin_fallback)", "originLoadingExperience(metrics,overall_category)", lighthouseSelector]);
    expect(lighthouseFields).toEqual(["requestedUrl", "finalUrl", "finalDisplayedUrl", "lighthouseVersion", "fetchTime", "runtimeError", "runWarnings", "categories(performance/score,accessibility/score,best-practices/score,seo/score)", "audits"]);
    // Bulky Lighthouse sections that are never read stay excluded.
    for (const excluded of ["fullPageScreenshot", "stackPacks", "i18n", "timing", "configSettings", "categoryGroups", "entities"]) expect(PAGESPEED_FIELDS).not.toContain(excluded);
  });
});

describe("PageSpeed real-shaped response", () => {
  const exampleUrl = "https://example.com/";

  it("extracts FCP, LCP, CLS, TBT, Speed Index and TTI from a whole audits map", () => {
    const body = realShapedResponse as PageSpeedResponse;
    expect(Object.keys(body.lighthouseResult?.audits ?? {})).toEqual(expect.arrayContaining([...PAGESPEED_LAB_AUDITS, "final-screenshot", "network-requests"]));
    expect(normalizePageSpeedResponse(body, { url: exampleUrl, strategy: "mobile" }, at)).toEqual({
      provider: "pagespeed",
      providerVersion: "13.4.1",
      strategy: "mobile",
      requestedUrl: exampleUrl,
      finalUrl: exampleUrl,
      observedAt: "2026-09-19T14:17:54.444Z",
      scores: { performance: 100, accessibility: 96, bestPractices: 96, seo: 80 },
      lab: { fcpMs: 757, lcpMs: 757, cls: 0, tbtMs: 0, speedIndexMs: 757, ttiMs: 757 },
      field: { scope: "url", lcpMs: 939, inpMs: 81, cls: 0, overallCategory: "FAST" },
      warnings: [],
    });
  });

  it("returns only normalized values through measure(): nothing else from the audits map survives", async () => {
    const result = await provider(fakeFetch(() => json(realShapedResponse)).fetchImpl, "secret-key-value").measure({ url: exampleUrl, strategy: "mobile", timeoutMs: 1000 });
    expect(Object.keys(result.measurement).sort()).toEqual(["field", "finalUrl", "lab", "observedAt", "provider", "providerVersion", "requestedUrl", "scores", "strategy", "warnings"]);
    const serialized = JSON.stringify(result);
    for (const leaked of ["base64", "details", "final-screenshot", "network-requests", "numericUnit", "displayValue", "secret-key-value"]) expect(serialized).not.toContain(leaked);
  });
});

describe("PageSpeed request", () => {
  it("sends one GET with strategy, four categories and the partial-response mask, and no key unless configured", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(response()));
    const result = await provider(fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 });
    expect(result.requestCount).toBe(1);
    expect(result.costUsd).toBeNull();
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(PAGESPEED_BASE_URL);
    expect(url.searchParams.get("url")).toBe(target);
    expect(url.searchParams.get("strategy")).toBe("MOBILE");
    expect(url.searchParams.getAll("category")).toEqual(["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"]);
    expect(url.searchParams.get("fields")).toBe(PAGESPEED_FIELDS);
    expect(url.searchParams.has("key")).toBe(false);
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>)["user-agent"]).toMatch(/^RankLocalGrowthOS-Performance\//);
    expect(PAGESPEED_FIELDS).not.toMatch(/screenshot/i);
  });

  it("uses DESKTOP for the desktop strategy and appends the key when one is configured", () => {
    const url = new URL(buildPageSpeedUrl(PAGESPEED_BASE_URL, { url: target, strategy: "desktop" }, "secret-key-value"));
    expect(url.searchParams.get("strategy")).toBe("DESKTOP");
    expect(url.searchParams.get("key")).toBe("secret-key-value");
  });

  it("never sends a URL that is not plain http(s)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(response()));
    for (const bad of ["file:///etc/passwd", "https://user:pass@example.co.uk/", "javascript:alert(1)", "https://localhost/", "not a url"]) {
      expect(isAnalysableUrl(bad)).toBe(false);
      expect(await failure(provider(fetchImpl).measure({ url: bad, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "invalid_request", retryable: false });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("PageSpeed failures", () => {
  it("classifies rate limits and server errors as transient", async () => {
    expect(await failure(provider(fakeFetch(() => json({ error: { message: "Quota exceeded" } }, 429)).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "quota", retryable: true });
    expect(await failure(provider(fakeFetch(() => json({ error: { message: "Backend error" } }, 503)).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "unavailable", retryable: true });
    expect(await failure(provider(fakeFetch(() => { throw new TypeError("fetch failed"); }).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "unavailable", retryable: true });
  });

  it("names the optional key variable when rate limited without a key, and not when one is set", async () => {
    const limited = () => json({ error: { message: "Quota exceeded" } }, 429);
    expect((await failure(provider(fakeFetch(limited).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).message).toContain("PAGESPEED_API_KEY");
    expect((await failure(provider(fakeFetch(limited).fetchImpl, "secret-key-value").measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).message).not.toContain("PAGESPEED_API_KEY");
  });

  it("classifies bad requests, rejected keys and unanalysable targets as permanent", async () => {
    expect(await failure(provider(fakeFetch(() => json({ error: { message: "Invalid value" } }, 400)).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "invalid_request", retryable: false });
    expect(await failure(provider(fakeFetch(() => json({ error: { message: "API key not valid" } }, 403)).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "auth", retryable: false });
    expect(await failure(provider(fakeFetch(() => json({ error: { message: "Lighthouse returned error: FAILED_DOCUMENT_REQUEST." } }, 500)).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "target_unanalyzable", retryable: false });
  });

  it("aborts at the timeout and reports a transient timeout", async () => {
    const { fetchImpl } = fakeFetch((_url, init) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    expect(await failure(provider(fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 20 }))).toMatchObject({ code: "timeout", retryable: true });
  });

  it("refuses an oversized body, by declared length or while streaming", async () => {
    const big = JSON.stringify({ padding: "x".repeat(5_000) });
    expect(await failure(provider(fakeFetch(() => new Response(big, { status: 200, headers: { "content-length": String(big.length) } })).fetchImpl, undefined, 1_000).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "response_too_large", retryable: false });
    expect(await failure(provider(fakeFetch(() => new Response(big, { status: 200 })).fetchImpl, undefined, 1_000).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "response_too_large", retryable: false });
  });

  it("keeps the 10 MB cap: a realistic whole-audits payload passes, anything over the cap is refused", async () => {
    expect(PAGESPEED_MAX_RESPONSE_BYTES).toBe(10_000_000);
    // Live responses with the whole audits map measured 0.2-0.6 MB; pad the real-shaped fixture to 1 MB.
    const padded = (bytes: number) => JSON.stringify({ ...realShapedResponse, lighthouseResult: { ...realShapedResponse.lighthouseResult, audits: { ...realShapedResponse.lighthouseResult.audits, "screenshot-thumbnails": { details: { data: "x".repeat(bytes) } } } } });
    const ok = await provider(fakeFetch(() => new Response(padded(1_000_000), { status: 200 })).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 });
    expect(ok.measurement.lab.lcpMs).toBe(757);
    expect(await failure(provider(fakeFetch(() => new Response(padded(PAGESPEED_MAX_RESPONSE_BYTES), { status: 200 })).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "response_too_large", retryable: false });
  });

  it("scrubs the API key from the invalid-argument error Google returns for a bad mask", async () => {
    const key = "secret-key-value";
    const rejected = await failure(provider(fakeFetch((url) => json({ error: { code: 400, status: "INVALID_ARGUMENT", message: `Request contains an invalid argument. ${url}` } }, 400)).fetchImpl, key).measure({ url: target, strategy: "desktop", timeoutMs: 1000 }));
    expect(rejected).toMatchObject({ code: "invalid_request", retryable: false });
    expect(rejected.message).toContain("Request contains an invalid argument.");
    expect(rejected.message).not.toContain(key);
    expect(JSON.stringify(rejected)).not.toContain(key);
  });

  it("never leaks the API key through an error message", async () => {
    const key = "secret-key-value";
    const echoing = await failure(provider(fakeFetch((url) => json({ error: { message: `Bad request for ${url}` } }, 400)).fetchImpl, key).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }));
    expect(echoing.message).not.toContain(key);
    const network = await failure(provider(fakeFetch((url) => { throw new Error(`connect failed ${url}`); }).fetchImpl, key).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }));
    expect(network.message).not.toContain(key);
  });

  it("reports a non-JSON success body as a transient unknown failure", async () => {
    expect(await failure(provider(fakeFetch(() => new Response("<html>", { status: 200 })).fetchImpl).measure({ url: target, strategy: "mobile", timeoutMs: 1000 }))).toMatchObject({ code: "unknown", retryable: true });
  });
});
