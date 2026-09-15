---
name: ssrf-safe-http
description: Required controls for any outbound HTTP request made by the app (probe, crawler, audit fetcher, provider adapters): scheme, host and IP blocking, DNS validation and pinning, redirect revalidation, timeouts, size caps, domain boundaries, and the test matrix that proves them.
version: 1
applies_to: ["src/discovery/website/**", "src/audit/**", "src/crawler/**", "src/discovery/providers/**"]
triggers: ["fetch", "crawl", "SSRF", "redirect", "DNS", "undici", "probe", "sitemap", "robots"]
related: ["rank-local-architecture", "quality-gate"]
---

# ssrf-safe-http

## Purpose
Website auditing is the highest-risk URL-fetch surface in the product. This skill defines the controls every outbound request must pass and the tests that prove them, so protections are never weakened to make a feature or a test easier.

## When to use
Writing or reviewing any code that fetches a URL supplied by data (provider hints, crawled links, sitemaps, redirects). Provider adapters that call fixed vendor hosts still apply the timeout and size controls.

## Non-negotiables
1. Only `http:` and `https:`. Reject everything else before any I/O (`file:`, `ftp:`, `gopher:`, `data:`, `javascript:`).
2. Reject URLs with embedded credentials (`url.username` or `url.password` non-empty).
3. Reject blocked hostnames: `localhost`, `metadata.google.internal`, `metadata`, `instance-data`, any single-label host, and suffixes `.localhost .local .internal .lan .home .arpa`.
4. Reject blocked addresses (IPv4 and IPv6): loopback, RFC1918, CGNAT 100.64/10, link-local 169.254/16 and fe80::/10, ULA fc00::/7, `0.0.0.0/8`, `192.0.0.0/24`, benchmarking 198.18/15, multicast 224/4, reserved 240/4, `::`, IPv4-mapped IPv6, NAT64 `64:ff9b::/96`. Cloud metadata IPs fall inside these ranges. Reuse `isBlockedIpAddress` and `isBlockedHostname` from `src/discovery/website/http-probe.ts`; do not fork the tables.
5. Resolve DNS before connecting and validate **every** returned address; one blocked address blocks the request.
6. Pin the connection to a validated address so a second resolution cannot rebind: use an undici `Agent` whose `connect.lookup` only answers for hostnames in an allow-list map populated by step 5 (verified snippet in `ai/examples/pinned-dns-agent.md`). Never trust the hostname after resolution.
7. Handle redirects manually (`redirect: "manual"`); each hop repeats steps 1–6; cap hops (`AUDIT_MAX_REDIRECTS`, default 5); record the chain.
8. Timeout every request with an `AbortController` (`AUDIT_REQUEST_TIMEOUT_MS`, default 10 000) and treat abort as a failed page, not a crash.
9. Cap response size: reject a `content-length` above the cap, and stream the body counting bytes, aborting past `AUDIT_MAX_RESPONSE_BYTES` (default 2 000 000).
10. Gate on content type: parse only `text/html` and `application/xhtml+xml`; record other types without reading the body.
11. Default ports only (80/443) for crawled targets.
12. Crawlers stay on the same registrable site: compare `normalizeDomain(url)` (`src/domain/identifiers.ts`, strips `www.`) with the audited domain; never follow third-party hosts.
13. Identify the client with a clear `User-Agent` (`RankLocalGrowthOS-<Component>/<version>`), use `GET`/`HEAD` only, never submit forms or send cookies/credentials.
14. Bound the whole operation: max pages per audit (`AUDIT_MAX_PAGES`, default 15), no unbounded recursion.

## Procedure
1. Parse with `new URL()`; apply checks 1–3 synchronously.
2. If the host is an IP literal, apply check 4 directly; otherwise resolve and validate all addresses (check 5).
3. Register `hostname → validated address` in the request's allow-list and issue the request through the pinned dispatcher (check 6), with timeout and manual redirects.
4. On 3xx, resolve the `Location` against the current URL and go back to step 1 for the new URL; stop at the hop cap.
5. Read the body under the byte cap only when the content type is HTML; otherwise discard.
6. Return a structured result (`ok`, `requestedUrl`, `finalUrl`, `status`, `contentType`, `redirectChain`, `durationMs`, `reason`) so callers never need raw responses.

## Verification
Automated tests (mock `fetchImpl` and `lookup`; no real network) must cover: `127.0.0.1`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, link-local IPv6, `file://`, `ftp://`, credentials in URL, hostname resolving to a private address, public URL redirecting to a private target, redirect loop past the cap, timeout, oversized `content-length`, oversized streamed body, non-HTML content type, off-site link rejection. Run `ai/checklists/ssrf-review.md` before declaring the change complete.

## References
`src/discovery/website/http-probe.ts` (guard tables, redirect loop, probe result shape); `src/domain/identifiers.ts` (`normalizeDomain`, `isThirdPartyHost`); `tests/discovery/website-verification.test.ts` (existing blocking tests); `docs/MASTER_BUILD_SPEC.md` §11.1 and §25.

## Residual limitations (document them in the code)
- Pinning depends on undici honouring `connect.lookup`; when tests inject a `fetchImpl`, pinning is bypassed by design.
- No protection against a legitimately public host that proxies to internal services; that is the target's responsibility.
- IPv6 zone identifiers and unusual literal encodings are rejected rather than parsed.
- HTTP proxies configured in the environment could alter routing; the crawler must not use `HTTP_PROXY`.

## Anti-patterns
Relying on `fetch` default redirect following; validating only the first URL; allow-listing by hostname string instead of resolved address; reading `response.text()` without a byte cap; parsing HTML from non-HTML responses; loosening a blocklist range to make a fixture resolve.
