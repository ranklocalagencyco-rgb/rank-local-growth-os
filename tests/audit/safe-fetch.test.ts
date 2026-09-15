import { describe, expect, it, vi } from "vitest";

import { SafeFetcher, validateAuditUrl, type FetchLike, type FetchLikeInit } from "@/audit/safe-fetch";

type Route = { status?: number; headers?: Record<string, string>; body?: string | ReadableStream<Uint8Array>; delayMs?: number };

function fakeFetch(routes: Record<string, Route>, calls: string[] = []): FetchLike & { calls: string[] } {
  const impl = (async (url: string, init: FetchLikeInit) => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new TypeError(`fetch failed: no route for ${url}`);
    if (route.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, route.delayMs);
        init.signal.addEventListener("abort", () => { clearTimeout(timer); const error = new Error("aborted"); error.name = "AbortError"; reject(error); });
      });
    }
    return new Response(route.body ?? "", { status: route.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...(route.headers ?? {}) } });
  }) as unknown as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const publicLookup = async (hostname: string) => (hostname === "internal.example.com" ? ["10.0.0.5"] : hostname === "dual.example.com" ? ["93.184.216.34", "192.168.1.9"] : ["93.184.216.34"]);

describe("SSRF guard: synchronous URL validation", () => {
  it("rejects unsupported schemes before any I/O", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com", "data:text/html,hi", "javascript:alert(1)"]) {
      expect(validateAuditUrl(new URL(url)), url).toBe("unsupported_scheme");
    }
  });

  it("rejects credentials, non-default ports, blocked hosts and blocked IP literals", () => {
    expect(validateAuditUrl(new URL("https://user:pw@example.com/"))).toBe("credentials_in_url");
    expect(validateAuditUrl(new URL("https://example.com:8443/"))).toBe("blocked_port");
    expect(validateAuditUrl(new URL("http://localhost/"))).toBe("blocked_host");
    expect(validateAuditUrl(new URL("http://metadata.google.internal/"))).toBe("blocked_host");
    expect(validateAuditUrl(new URL("http://intranet/"))).toBe("blocked_host");
    expect(validateAuditUrl(new URL("http://box.local/"))).toBe("blocked_host");
    for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.5.5", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1", "[::1]", "[fe80::1]", "[fd00::1]", "[::ffff:10.0.0.1]", "[::ffff:a9fe:a9fe]", "[::ffff:7f00:1]"]) {
      expect(validateAuditUrl(new URL(`http://${ip}/`)), ip).toBe("blocked_address");
    }
    expect(validateAuditUrl(new URL("https://example.com/"))).toBeNull();
    expect(validateAuditUrl(new URL("http://93.184.216.34/"))).toBeNull();
  });
});

describe("SafeFetcher", () => {
  it("blocks private targets by hostname resolution and never calls fetch for them", async () => {
    const fetchImpl = fakeFetch({});
    const fetcher = new SafeFetcher({ fetchImpl, lookup: publicLookup });
    expect(await fetcher.fetch("http://internal.example.com/")).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(await fetcher.fetch("http://dual.example.com/")).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(await fetcher.fetch("http://127.0.0.1/")).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(await fetcher.fetch("http://[::1]/")).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(await fetcher.fetch("http://169.254.169.254/latest/meta-data/")).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(await fetcher.fetch("file:///etc/passwd")).toMatchObject({ ok: false, reason: "unsupported_scheme" });
    expect(await fetcher.fetch("ftp://example.com/")).toMatchObject({ ok: false, reason: "unsupported_scheme" });
    expect(await fetcher.fetch("https://u:p@example.com/")).toMatchObject({ ok: false, reason: "credentials_in_url" });
    expect(await fetcher.fetch("not-a-url")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(fetchImpl.calls).toEqual([]);
    const failing = new SafeFetcher({ fetchImpl, lookup: async () => { throw new Error("ENOTFOUND"); } });
    expect(await failing.fetch("https://nope.example.com/")).toMatchObject({ ok: false, reason: "dns_error" });
  });

  it("stops a redirect from a public URL into a private target without fetching it", async () => {
    const fetchImpl = fakeFetch({
      "https://example.com/": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } },
      "https://example.com/loop": { status: 301, headers: { location: "http://internal.example.com/admin" } },
      "https://example.com/local": { status: 301, headers: { location: "http://localhost:3000/" } },
    });
    const fetcher = new SafeFetcher({ fetchImpl, lookup: publicLookup });
    expect(await fetcher.fetch("https://example.com/")).toMatchObject({ ok: false, reason: "blocked_address", redirectChain: ["https://example.com/"] });
    expect(await fetcher.fetch("https://example.com/loop")).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(await fetcher.fetch("https://example.com/local")).toMatchObject({ ok: false, reason: "blocked_port" });
    expect(fetchImpl.calls).toEqual(["https://example.com/", "https://example.com/loop", "https://example.com/local"]);
  });

  it("follows safe redirects, records the chain, and caps the number of hops", async () => {
    const fetchImpl = fakeFetch({
      "http://example.com/": { status: 301, headers: { location: "https://example.com/" } },
      "https://example.com/": { status: 302, headers: { location: "/home" } },
      "https://example.com/home": { body: "<html><title>Home</title></html>" },
      "https://example.com/a": { status: 302, headers: { location: "/b" } },
      "https://example.com/b": { status: 302, headers: { location: "/a" } },
      "https://example.com/noloc": { status: 302 },
    });
    const fetcher = new SafeFetcher({ fetchImpl, lookup: publicLookup, maxRedirects: 3 });
    const result = await fetcher.fetch("http://example.com/");
    expect(result).toMatchObject({ ok: true, status: 200, isHtml: true, finalUrl: "https://example.com/home", redirectChain: ["http://example.com/", "https://example.com/"] });
    expect(result.body).toContain("Home");
    expect(await fetcher.fetch("https://example.com/a")).toMatchObject({ ok: false, reason: "too_many_redirects" });
    expect(await fetcher.fetch("https://example.com/noloc")).toMatchObject({ ok: false, reason: "redirect_without_location", status: 302 });
  });

  it("stops redirects that leave the audited site when a site domain is given", async () => {
    const fetchImpl = fakeFetch({ "https://example.com/out": { status: 302, headers: { location: "https://other.example.org/" } }, "https://example.com/www": { status: 301, headers: { location: "https://www.example.com/" } }, "https://www.example.com/": { body: "<html></html>" } });
    const fetcher = new SafeFetcher({ fetchImpl, lookup: publicLookup });
    expect(await fetcher.fetch("https://example.com/out", { sameSiteDomain: "example.com" })).toMatchObject({ ok: false, reason: "redirect_off_site" });
    expect(await fetcher.fetch("https://example.com/www", { sameSiteDomain: "example.com" })).toMatchObject({ ok: true, finalUrl: "https://www.example.com/" });
    expect(fetchImpl.calls).not.toContain("https://other.example.org/");
  });

  it("times out slow responses", async () => {
    const fetchImpl = fakeFetch({ "https://example.com/slow": { delayMs: 5_000, body: "<html></html>" } });
    const fetcher = new SafeFetcher({ fetchImpl, lookup: publicLookup, timeoutMs: 50 });
    expect(await fetcher.fetch("https://example.com/slow")).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("treats network failures as network_error", async () => {
    const fetcher = new SafeFetcher({ fetchImpl: fakeFetch({}), lookup: publicLookup });
    expect(await fetcher.fetch("https://example.com/missing")).toMatchObject({ ok: false, reason: "network_error" });
  });

  it("rejects oversized responses by declared length and by streamed bytes", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1000));
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; if (pulls > 100) controller.close(); else controller.enqueue(chunk); } });
    const fetchImpl = fakeFetch({
      "https://example.com/big-declared": { headers: { "content-length": "5000000" }, body: "<html></html>" },
      "https://example.com/big-stream": { body: endless },
      "https://example.com/ok": { body: "<html><title>ok</title></html>" },
    });
    const fetcher = new SafeFetcher({ fetchImpl, lookup: publicLookup, maxBytes: 10_000 });
    expect(await fetcher.fetch("https://example.com/big-declared")).toMatchObject({ ok: false, reason: "response_too_large", status: 200 });
    const streamed = await fetcher.fetch("https://example.com/big-stream");
    expect(streamed).toMatchObject({ ok: false, reason: "response_too_large" });
    expect(streamed.bytes).toBeGreaterThan(10_000);
    expect(pulls).toBeLessThan(100);
    expect(await fetcher.fetch("https://example.com/ok")).toMatchObject({ ok: true, bytes: 30 });
  });

  it("records non-HTML responses without reading the body, unless the caller opts in for text types", async () => {
    const fetchImpl = fakeFetch({
      "https://example.com/brochure.pdf": { headers: { "content-type": "application/pdf", "content-length": "1234" }, body: "%PDF" },
      "https://example.com/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nSitemap: https://example.com/sitemap.xml" },
      "https://example.com/missing": { status: 404, body: "<html>nope</html>" },
      "https://example.com/error": { status: 503, body: "<html>down</html>" },
    });
    const fetcher = new SafeFetcher({ fetchImpl, lookup: publicLookup });
    expect(await fetcher.fetch("https://example.com/brochure.pdf")).toMatchObject({ ok: true, status: 200, isHtml: false, body: null, bytes: 1234 });
    expect(await fetcher.fetch("https://example.com/robots.txt")).toMatchObject({ ok: true, isHtml: false, body: null });
    expect((await fetcher.fetch("https://example.com/robots.txt", { readContentTypes: /^text\/plain$/ })).body).toContain("Sitemap:");
    expect(await fetcher.fetch("https://example.com/missing")).toMatchObject({ ok: true, status: 404, isHtml: true });
    expect(await fetcher.fetch("https://example.com/error")).toMatchObject({ ok: true, status: 503 });
  });

  it("sends an identifying user agent and manual redirect mode, and close() forgets validated hosts", async () => {
    const init: FetchLikeInit[] = [];
    const fetchImpl: FetchLike = async (_url, options) => { init.push(options); return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }); };
    const lookup = vi.fn(publicLookup);
    const fetcher = new SafeFetcher({ fetchImpl, lookup });
    await fetcher.fetch("https://example.com/");
    expect(init[0]).toMatchObject({ method: "GET", redirect: "manual" });
    expect(init[0].headers["user-agent"]).toMatch(/^RankLocalGrowthOS-Auditor\//);
    await fetcher.close();
    await fetcher.fetch("https://example.com/");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
