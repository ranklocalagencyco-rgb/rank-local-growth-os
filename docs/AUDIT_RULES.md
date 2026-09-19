# Website audit: evidence and rules catalogue

Versions in force: crawler `audit-crawler/v3` (`src/audit/extract.ts`), rules `audit-rules/v3` (`src/audit/findings.ts`). Both are stamped on every `website_audit_runs` row; every finding row carries `rule_version`. Rows written by older versions stay readable: every v3 field is optional and every v3 rule checks `evidence_json.evidenceVersion >= 3` before it can fire, so re-finalising an old run never emits new codes.

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

NAP scope: UK phone formats (`+44`, national `0…`, 10–11 digits), UK postcodes, English copyright lines. An address candidate is an `<address>` element, or the deepest element (≤200 chars) containing a postcode and at least two comma-separated parts. No canonical NAP is chosen; values and provenance are stored as observed.

## 3. Site-level evidence (`website_audit_runs.site_summary_json`)

v1/v2 keys unchanged. v3 adds `evidenceVersion`, `galleryPagesFound`, `blogPagesFound`, `locationPages[] {path, locality, hub}`, `servicePages[] {path, service}`, `serviceLocationCombos[]`, `nap` (values aggregated across pages with page counts and sources), `schema` (LocalBusiness/Organization presence, `hasName`, `hasTelephone`, `hasAddress`, `areaServed`, `hasGeo`, `sameAs`, `hasAggregateRating`, `reviewCount`, `localBusinessMissingFields`), `duplicateTitleGroups`, `duplicateMetaGroups`, `duplicateTitleMetaPairs`, `homepageLinkCount`, `pagesWithoutInboundLinks` (crawl scope only), `internalRedirects[] {requestedUrl, finalUrl, linkedFrom}`, `linksTruncatedOnAnyPage`.

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
| `localbusiness_schema_incomplete` | site | low | LocalBusiness type present but name, telephone or a full address (street + locality + postcode) missing from every LocalBusiness node; never emitted together with `no_localbusiness_schema` | v3 |

Deterministic finding ids are `(run, page or "site", code)`, so a site-scope code appears once per run; every rule that can fire more than once is page-scope with the group in its evidence.

## 6. Documented limitations

- **Near-duplicate body content is not detected.** A reliable deterministic rule needs boilerplate stripping and shingle/simhash comparison with calibration; on small trade sites the shared header/footer would dominate. `headingFingerprint` and the title/meta duplicate groups are stored as evidence only.
- `location_page_title_missing_locality` is not emitted in this version; the locality and title lengths are stored so it can be added without a crawler change.
- Orphan-like pages and homepage coverage are judged within the crawl scope (`AUDIT_MAX_PAGES`, `MAX_FRONTIER`), never across the whole site.
- NAP extraction is UK/English-specific (postcode and phone formats, prepositions, `and`/`&` splitting); lengths are UTF-16 code units and word counts undercount CJK text.
- `og:type` is never used as a signal: WordPress SEO plugins emit `article` on every page.
