# SSRF / outbound HTTP review checklist

- [ ] Scheme restricted to http/https before any I/O.
- [ ] URLs with embedded credentials rejected.
- [ ] Hostname blocklist and suffix list applied (localhost, metadata hosts, single-label, .local/.internal/.arpa …).
- [ ] IP blocklist covers loopback, RFC1918, CGNAT, link-local v4/v6, ULA, 0/8, 192.0.0/24, 198.18/15, multicast, reserved, mapped IPv6, NAT64; reused from `http-probe.ts`, not re-typed.
- [ ] DNS resolved before the request; all addresses validated; failure to resolve is a hard fail.
- [ ] Connection pinned to a validated address (undici `connect.lookup` allow-list) or the residual TOCTOU risk is documented.
- [ ] Redirects handled manually, each hop re-validated, hop cap enforced, chain recorded.
- [ ] Timeout via AbortController on every request.
- [ ] Response size capped both by `content-length` and by streamed byte count.
- [ ] Only HTML content types are parsed; others recorded without reading the body.
- [ ] Non-default ports rejected for crawled targets.
- [ ] Same-registrable-domain rule for crawl frontier; third-party hosts never fetched.
- [ ] Identifying User-Agent; GET/HEAD only; no cookies, no form submission, no proxy env.
- [ ] Page/request caps make the whole operation bounded.
- [ ] Tests cover the full matrix in `ai/skills/ssrf-safe-http/SKILL.md` with mocked fetch/lookup.
- [ ] No transitive LLM dependency in the protected paths (imports reviewed, not just scanned).
