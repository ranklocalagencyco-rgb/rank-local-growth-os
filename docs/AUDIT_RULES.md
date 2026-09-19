# Website audit: evidence and rules catalogue

Versions in force: crawler `audit-crawler/v4` (`src/audit/extract.ts`), rules `audit-rules/v4` (`src/audit/findings.ts`), challenge detector `challenge-detector/v1` (`src/audit/challenge-detection.ts`). v4 of the crawler and rules adds only bot-challenge handling (§7); page evidence is still `evidenceVersion` 3 and every v3 rule is unchanged. Both are stamped on every `website_audit_runs` row; every finding row carries `rule_version`. Rows written by older versions stay readable: every v3 field is optional and every v3 rule checks `evidence_json.evidenceVersion >= 3` before it can fire, so re-finalising an old run never emits new codes.

Everything in this document is deterministic: HTML is parsed with cheerio, values are matched with fixed regular expressions and thresholds, and no LLM is involved anywhere in the fetch, parse or rules path (`ai/rules/no-llm-in-crawler.md`).

## 1. Page-role classification (`src/audit/classify.ts`)

Roles: `homepage`, `service`, `location`, `contact`, `about`, `testimonials`, `gallery`, `blog`, `other` (migration 007 widened the check constraint). Rules run in this order and the first match wins; the rule that fired is stored in `evidence_json.roleSignals`.

| # | Rule | Signal recorded |
|---|---|---|
| 1 | Discovered as the homepage, or path `/` | `homepage` |
| 2 | Path keywords (`src/audit/url.ts`), in the order blog → contact → testimonials → about → gallery → location → service | `path:<role>` |
| 3 | The page's own schema types: `BlogPosting/Article/NewsArticle` → blog, `ContactPage` → contact, `AboutPage` → about, `ImageGallery` → gallery, `Service` → service | `schema:<Type>` |
| 4 | Heading pattern `X <in|near|around|across|covering|serving|for|throughout> PLACE[, PLACE and PLACE]` on the H1 (then the title). If a place's slug equals the last path segment → location; else if the slug of X equals the segment (or starts with `segment-`) → service, and the page is recorded as a service × location combination | `h1_in_place:<slug>`, `title_in_place:<slug>`, `h1_service_in_place:<slug>` |
| 5 | H1 starts with the place (1–3 words whose slug equals the segment) followed by trade vocabulary (`TRADE_KEYWORDS`) → location | `h1_place_first:<slug>` |
| 6 | Breadcrumb parent item (JSON-LD `BreadcrumbList`, else HTML breadcrumb) matches a section label: areas we cover / service areas / locations → location; services / what we do → service; blog / news → blog; gallery / portfolio → gallery | `breadcrumb_parent:<slug>` |
| 7 | Homepage navigation parent of the link to this page (recorded in crawl state before any page is enqueued) matches the same section labels | `nav_parent:<slug>` |
| 8 | Otherwise `other` | none |

Guard: rules 4–7 each need a positive signal, so a single-segment page with no matching heading, breadcrumb or menu parent stays `other`. Known pre-existing limitation: the path rule `-in-[a-z]` also matches `/built-in-wardrobes`.

Crawl order: `crawlPriority(path, via, roleHint)` uses the path role, but a homepage navigation parent can raise a page's priority (never lower it), so nav-listed location pages are crawled before `other` pages within the page cap.

## 2. Per-page evidence (`website_audit_pages.evidence_json`)

v1/v2 keys are unchanged (`redirectChain`, `externalHosts`, `ctaSamples`, `jsonLdParseErrors`, `hasLocalBusinessSchema`, `canonicalMatchesFinal`, `renderingMode`, `renderingSignals`). v3 adds, all optional for readers:

| Key | Content |
|---|---|
| `evidenceVersion`, `crawlerVersion` | `3`, `audit-crawler/v3` |
| `meaningfulRedirect` | requested vs final URL differ by scheme, host or path (a trailing slash or letter case is not a redirect) |
| `roleSignals`, `locality`, `service`, `headingPattern` | classification provenance; `headingPattern` = `{source, subject, preposition, places[]}` |
| `titleLength`, `metaDescriptionLength` | UTF-16 length of the whitespace-collapsed text |
| `h1EmptyCount`, `h2Text[]` (≤15 × 120 chars), `breadcrumbNames[]` | |
| `links[]` (≤150), `linksTruncated` | same-site crawlable links as written by the site (trailing slash kept): `{url, text, region: nav|header|footer|main, group}`; `group` is the parent menu item label |
| `socialProfileLinks[]` (≤10) | external links whose registrable domain is a known social / review / map platform |
| `nap` | `phones[] {raw, digits, sources}`, `emails[]`, `postcodes[]`, `addressCandidates[] {text, postcode, source}`, `businessNames[] {value, source}`, `hasContactForm`. Sources: `tel_link`, `mailto_link`, `text:header|footer|main`, `address_element`, `og_site_name`, `copyright`, `logo_alt` |
| `schema` | `localBusiness {types, name, telephone, address, areaServed, geo, sameAs, openingHours, priceRange}`, `organization {name, telephone, address, sameAs, logo}`, `aggregateRating`, `reviewCount`, `hasService`, `breadcrumbNames` |
| `headingFingerprint` | sha1 of the lowercased H1/H2/H3 sequence; evidence only |
| `challenge` (v4) | present only when the challenge detector matched (§7): `{detected, kind, confidence, rule, markerFamily, signals[], detectorVersion, url, httpStatus, title, wordCount, internalLinkCount, h1Count, detectedAt}`. With `confidence: "high"` the row is provenance only: every content column and every other evidence key stays at its default |

NAP scope: UK phone formats (`+44`, national `0…`, 10–11 digits), UK postcodes, English copyright lines. An address candidate is an `<address>` element, or the deepest element (≤200 chars) containing a postcode and at least two comma-separated parts. No canonical NAP is chosen; values and provenance are stored as observed.

## 3. Site-level evidence (`website_audit_runs.site_summary_json`)

v1/v2 keys unchanged. v3 adds `evidenceVersion`, `galleryPagesFound`, `blogPagesFound`, `locationPages[] {path, locality, hub}`, `servicePages[] {path, service}`, `serviceLocationCombos[]`, `nap` (values aggregated across pages with page counts and sources), `schema` (LocalBusiness/Organization presence, `hasName`, `hasTelephone`, `hasAddress`, `areaServed`, `hasGeo`, `sameAs`, `hasAggregateRating`, `reviewCount`, `localBusinessMissingFields`), `duplicateTitleGroups`, `duplicateMetaGroups`, `duplicateTitleMetaPairs`, `homepageLinkCount`, `pagesWithoutInboundLinks` (crawl scope only), `internalRedirects[] {requestedUrl, finalUrl, linkedFrom}`, `linksTruncatedOnAnyPage`.

v4 adds `challengePages[] {path, kind}` on a completed run (secondary pages excluded as challenge documents), and on a `blocked` run replaces the whole summary with `homepageUrl`, `homepageFinalUrl`, `homepageStatus`, `homepageRedirectChain`, `crawlBlocked: true` and `challenge` (§7): no other site fact is derived, because none was measured on the real website.

Since the audit score was added, finalisation also stores `crawlScope {pageCap, frontierRemaining}`: the page cap in force and how many discovered URLs were still queued when the crawl stopped. It is evidence only (no finding reads it); the score uses it to tell "no such page" from "stopped at the page cap" ([`AUDIT_SCORE.md`](AUDIT_SCORE.md) §5). Runs finalised earlier do not have it.

## 4. Thresholds (`src/audit/thresholds.ts`)

| Constant | Value |
|---|---|
| `TITLE_MIN_CHARS` / `TITLE_MAX_CHARS` | 20 / 70 |
| `META_DESCRIPTION_MIN_CHARS` / `META_DESCRIPTION_MAX_CHARS` | 50 / 160 |
| `THIN_PAGE_MIN_WORDS` | 150 |
| `MAX_STORED_LINKS_PER_PAGE` | 150 (sets `linksTruncated`; link-coverage rules are suppressed when any page hit it) |
| NAP caps | 10 phones, 5 emails, 5 postcodes, 5 address candidates, 5 names |

## 5. Finding catalogue

Severity is fixed per rule (except `page_noindex`, high on the homepage). "Content" rules are skipped on client-rendered app shells, exactly as in v2.

| Code | Scope | Severity | Rule | Version |
|---|---|---|---|---|
| `missing_title`, `missing_meta_description`, `missing_h1`, `multiple_h1`, `missing_canonical`, `page_noindex`, `missing_viewport`, `no_structured_data` | page | as before | unchanged from v1 | v1 |
| `broken_internal_link` | page | medium | 404/410 reached from a crawled page; evidence now adds `linkedFrom[]` and `anchorText[]` | v1 (evidence extended v3) |
| `no_localbusiness_schema`, `no_contact_page_detected`, `no_service_pages_detected`, `homepage_not_https`, `robots_txt_missing`, `sitemap_missing`, `client_rendered_site` | site | as before | unchanged | v1/v2 |
| `duplicate_title` | page, one per member | medium | normalised title shared by ≥2 crawled pages with different URL keys; pages whose canonical points elsewhere are excluded | v3 |
| `duplicate_meta_description` | page, one per member | low | same on the meta description | v3 |
| `title_too_short` / `title_too_long` | page | low | `titleLength < 20` / `> 70` | v3 |
| `meta_description_too_short` | page | low | `metaDescriptionLength < 50` | v3 |
| `meta_description_too_long` | page | info | `metaDescriptionLength > 160` | v3 |
| `h1_empty` | page | low | an H1 element exists with no visible text (content rule) | v3 |
| `thin_page` | page | low | `word_count < 150`, role not contact/gallery (content rule) | v3 |
| `internal_link_redirect` | page (the redirected row) | low | `redirect_count > 0`, meaningful redirect, discovered via a link or linked from a crawled page | v3 |
| `location_page_not_linked_from_homepage` / `service_page_not_linked_from_homepage` | page | low | homepage is server-rendered with ≥1 stored link, no page hit the link cap, and the page (by either of its URL keys) is absent from the homepage's links; hub pages excluded | v3 |
| `location_pages_missing` | site | low | no non-hub `location` page among crawled pages (content rule) | v3 |
| `nap_phone_missing` | site | medium | no phone from any source on any crawled page | v3 |
| `nap_address_missing` | site | medium | no address candidate, schema address or schema postcode on any crawled page | v3 |
| `challenge_page_detected` | page | info | high-confidence challenge document (§7). Operational, not an SEO defect. The only finding that row can produce; on the homepage it is the only finding of the run | v4 |
| `challenge_page_suspected` | page | info | medium-confidence detection (§7). The page is evaluated normally and keeps its other findings | v4 |
| `localbusiness_schema_incomplete` | site | low | LocalBusiness type present but name, telephone or a full address (street + locality + postcode) missing from every LocalBusiness node; never emitted together with `no_localbusiness_schema` | v3 |

Deterministic finding ids are `(run, page or "site", code)`, so a site-scope code appears once per run; every rule that can fire more than once is page-scope with the group in its evidence.

While any crawled URL of a run is a high-confidence challenge document, the page-type absence rules `no_contact_page_detected`, `no_service_pages_detected` and `location_pages_missing` are not emitted: the challenged URL may be that page, so its absence was not measured.

## 6. Documented limitations

- **Near-duplicate body content is not detected.** A reliable deterministic rule needs boilerplate stripping and shingle/simhash comparison with calibration; on small trade sites the shared header/footer would dominate. `headingFingerprint` and the title/meta duplicate groups are stored as evidence only.
- `location_page_title_missing_locality` is not emitted in this version; the locality and title lengths are stored so it can be added without a crawler change.
- Orphan-like pages and homepage coverage are judged within the crawl scope (`AUDIT_MAX_PAGES`, `MAX_FRONTIER`), never across the whole site.
- NAP extraction is UK/English-specific (postcode and phone formats, prepositions, `and`/`&` splitting); lengths are UTF-16 code units and word counts undercount CJK text.
- `og:type` is never used as a signal: WordPress SEO plugins emit `article` on every page.

## 7. Bot-challenge and interstitial detection (`src/audit/challenge-detection.ts`, RL-067)

Some hosts answer an unknown client with a browser-verification, challenge or holding document and HTTP 200 instead of the website. Auditing that document would produce findings and a score about the wrong thing (seen live on 2026-09-19: "One moment, please...", 8 words, no links). The detector is a pure function over the response HTML and the counts the extractor already produced. No LLM, no network, no headers (`SafeFetchResult` does not expose them). It **detects and stops**: nothing in the crawler solves a CAPTCHA, executes challenge scripts, alters its `User-Agent`, rotates addresses or otherwise tries to get past the host's decision.

### 7.1 Signals

| Class | Matched against | Values |
|---|---|---|
| Strong marker (challenge-only vendor internals) | raw HTML | Cloudflare `_cf_chl_opt`, `cf_chl_` / `cf-chl-` (not `cf-chl-widget`), `/cdn-cgi/challenge-platform/…/orchestrate/`, `challenge-error-text`; Sucuri `sucuri_cloudproxy_js`; Imperva `_Incapsula_Resource?CWUDNSAI` or "Incapsula incident ID"; DataDome `captcha-delivery.com`; PerimeterX `px-captcha`; SiteGround `/.well-known/sgcaptcha/` |
| Weak marker (also found on ordinary pages) | raw HTML | `/cdn-cgi/challenge-platform/` (Cloudflare injects its JavaScript-detection script into normal pages), Turnstile / reCAPTCHA / hCaptcha widgets, `<meta http-equiv="refresh">` |
| Strong title | the whole normalised title (lowercase, whitespace collapsed, trailing dots removed) must equal the phrase | just a moment · one moment, please · checking your browser · verify/verifying you are human · human verification · attention required! \| cloudflare · security check · ddos-guard · robot check / are you a robot / bot verification |
| Weak title (recorded only, never decides) | same | please wait · access denied |
| Body phrase | document text without scripts and styles, `<noscript>` included | checking your browser / if the site connection is secure · verify/verifying/confirm you are human · enable javascript and cookies to continue · needs to review the security of your connection · complete the security check · your request is being verified · your browser will redirect · not a robot |
| Structural gate | extractor counts | `wordCount ≤ 80` **and** `internalLinkCount ≤ 2`. "Tiny document" = `wordCount ≤ 20`, 0 internal links, no H1 |

Deliberately not strong markers, because vendors add them to real pages: Imperva's bare `_Incapsula_Resource?SWJIYLWA` sensor, PerimeterX `_pxAppId`, DataDome `tags.js`, Turnstile's runtime `cf-chl-widget-*` ids.

### 7.2 Decision table (first match wins)

| # | Rule code | Condition | Confidence | Effect |
|---|---|---|---|---|
| 1 | `strong_marker` | any strong marker. **No structural gate**: some vendor documents exceed it | high | page excluded; homepage → run `blocked` |
| 2 | `title_tiny_document` | gate + strong title + tiny document | high | same |
| 3 | `title_corroborated` | gate + strong title + (a body phrase or a weak marker) | high | same |
| 4 | `phrase_weak_marker` | gate + a body phrase + a weak marker | medium | recorded; `challenge_page_suspected` (info); page evaluated normally; never blocks |
| 5 | `title_only` | gate + strong title, nothing else | low | recorded in `evidence_json.challenge` only |
| — | — | anything else | not detected | nothing stored |

Heuristic signals (rules 2–5) are only read inside the structural gate. Consequently none of these is ever a detection on its own: a low word count, a weak title, a CAPTCHA/Turnstile widget, a meta refresh, Cloudflare's generic script path, or verification wording. Ordinary sparse brochure sites, WordPress homepages behind Cloudflare, client-rendered shells (still handled by the rendering classifier, §2), maintenance pages, cookie-consent pages and pages that merely say "please wait" are covered by tests as non-detections.

`kind`: `bot_challenge` when a strong marker, a verification phrase or a verification title matched; otherwise `access_block` for an access-denied title; otherwise `interstitial`. Confidence is fixed by the rule, never a probability.

### 7.3 Crawler behaviour

**Homepage, high confidence.** The page row is stored (HTTP facts + `evidence_json.challenge`; no content columns). The job does **not** request robots.txt or a sitemap and builds no frontier, so the host receives exactly one request. `crawl_state_json.phase = "blocked"` is persisted before finalising, so a retry after a crash finishes from the stored row without another request. The run gets status `blocked`, `blocked_at`, the blocked summary (§3) and exactly one finding, `challenge_page_detected`; `error_summary` stays null. Activity and domain event `audit.blocked` are recorded once. The job completes, so the queue never retries. The usual follow-up (`audit.performance`, then `audit.score`) is enqueued exactly once: PageSpeed is fetched by Google, not by our crawler, and its evidence stands on its own ([`AUDIT_SCORE.md`](AUDIT_SCORE.md) §5.6).

**Any other page, high confidence.** The row is stored as provenance and counted in `pages_failed`; `isHtmlSuccess` is false for it, so the summary, link graph, NAP/schema aggregation, every finding rule and every score ratio ignore it; its links are never enqueued. The crawl continues over the remaining frontier and the run completes normally, with `site_summary_json.challengePages` listing the excluded paths. Only the homepage can block a run in this version.

**Medium / low.** No change to crawling, evidence or status.

**Retry.** A blocked run is terminal. A later audit is a new run requested by an operator; nothing is retried automatically.

### 7.4 Limitations

- Marker and phrase lists are finite and English-only; an unknown vendor is caught only by rules 2–3. A challenge document larger than the gate with no known internal is not detected.
- A challenge served with HTTP 403/503 is outside this rule: the homepage then fails the run ("Homepage returned HTTP 403") and other pages are failed pages, exactly as before. Tracked as RL-069.
- Response headers (`cf-mitigated`, vendor cookies) are not available to the detector.
- A host that challenges only some secondary pages yields a completed audit on the rest; site-wide escalation is tracked as RL-068.
- The SC Roofing fixture is a reconstruction from the facts that run stored (title, status, word, link and H1 counts), because HTML is never persisted.
