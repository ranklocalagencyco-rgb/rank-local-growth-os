# Audit score and performance evidence

Version in force: `audit-score/v2` (`src/audit/score/rules.ts`, `src/audit/score/calculate.ts`). Stamped on every `website_audit_scores` row. v2 changes no weight, rule maximum, threshold or sufficiency constant; it adds the handling of bot-challenge evidence in §5.6, and for every audit without such evidence it produces exactly the `audit-score/v1` result (§6).

The audit score is a website-quality score computed **only from stored, verifiable evidence**: the run's `site_summary_json`, the `website_audit_pages` rows and the `website_performance_observations` rows. It never reads finding titles, severities or prose, and no LLM is involved anywhere (`ai/rules/no-llm-in-crawler.md` covers `src/audit/**` and `src/performance/**`). It is **not** the Opportunity Score of `MASTER_BUILD_SPEC.md` §12; it can later feed that score's "digital gap" input.

Not scored, by design: copy quality, brand quality, visual design, and the Lighthouse Accessibility / Best Practices / SEO category scores (stored and shown as evidence only; Lighthouse-SEO would double-count our own technical checks).

## 1. Performance evidence (`website_performance_observations`, migration 008)

- Provider interface: `src/performance/provider.ts` (`PerformanceProvider`), separate from business discovery, from our crawler and from the model router. First adapter: Google PageSpeed Insights API v5 (`src/performance/providers/pagespeed.ts`).
- `PAGESPEED_API_KEY` is optional. PageSpeed Insights is currently available without an API key; a key is recommended for frequent automated use. Quotas and rate limits depend on the Google project/authentication in use and are treated as configuration, not as application assumptions. The application's own bound is `PERFORMANCE_MAX_REQUESTS_PER_RUN`.
- Scope in V1: the audited **homepage only**, one request per strategy in `PERFORMANCE_STRATEGIES` (default `mobile,desktop`). The table carries `page_role` and the URL in its unique key so selected service/location pages can be added later.
- Stored per observation: provider and engine version, strategy, requested and final URL, the four Lighthouse category scores (0–100), lab metrics (FCP, LCP, CLS, TBT, Speed Index, TTI when returned), field p75 values (LCP, INP, CLS) with their scope (`url` or `origin`) and the provider's own overall category exactly as returned, run warnings, the provider's analysis timestamp, `attempts` (every provider request) and, on failure, a safe `error_code` / `error_summary`. The raw Lighthouse audits JSON is never persisted or logged: the adapter extracts only these normalized values and discards the rest of the response in memory. It does travel over the wire, because Google's partial-response syntax cannot select individual members of the `lighthouseResult.audits` map (a selector such as `audits(first-contentful-paint/numericValue)` is rejected with `400 INVALID_ARGUMENT`), so the `fields` mask requests that map whole and restricts everything else (provenance fields, the four category scores, field metrics). Observed responses are about 0.2–0.6 MB; the 10 MB streamed byte cap (`PAGESPEED_MAX_RESPONSE_BYTES`) is unchanged. PageSpeed exposes no monetary cost, so only request counts are recorded.
- Field data is often absent for small sites, and Google has announced it plans to stop including Chrome UX Report data in this API. Absent field data is recorded as `field_data_available = false` and is never scored as a failure.
- A PageSpeed failure never changes the website audit's status: `website_audit_runs.status` describes the crawl, `website_performance_observations.status` describes each measurement.

## 2. Jobs

```
audit.run completes ──► audit.performance:<runId>      (PERFORMANCE_PROVIDER=pagespeed)
                   └──► audit.score:<runId>:<version>  (PERFORMANCE_PROVIDER=none)
audit.performance ── one provider request per invocation, then `continue` ──► all rows terminal ──► audit.score
audit.score ── pure calculation over stored rows ──► insert-if-absent
```

- A `blocked` run (homepage answered with a bot-challenge document, [`AUDIT_RULES.md`](AUDIT_RULES.md) §7) gets the same follow-up, once: both jobs treat `blocked` as terminal like `completed`. The "Measure performance & score" action remains for completed runs only.
- The follow-up is enqueued after the run is marked completed and is re-asserted whenever a completed `audit.run` is replayed, so a crash between the two can never strand an audit. For audits completed before these jobs existed, the prospect page has a "Measure performance & score" action that enqueues the same jobs.
- The pending observation rows are the cursor: a run with mobile `succeeded` and desktop `pending` resumes at desktop. Terminal rows are never rewritten.
- Every provider request is preceded by an atomic claim (`attempts = seen + 1 where status = 'pending' and attempts = seen`). Losing the claim means another execution owns the row, so no request is made. The claim also persists the request count before the call.
- Bounds: two attempts per strategy (`MAX_ATTEMPTS_PER_STRATEGY`) and `PERFORMANCE_MAX_REQUESTS_PER_RUN` (default 4) per audit, counted on the rows because `continue` resets the job's own attempt counter.
- Transient failures (rate limit, 5xx, timeout, network) are rethrown once for queue backoff; permanent failures (invalid request, rejected key, target page could not be analysed) are recorded immediately. When every row is terminal the score is enqueued regardless, so an unavailable provider never blocks scoring; it does cap that score at `provisional` (§5.4).
- `audit.performance` declares a 42 s budget to the job processor (`JobRegistry.register(..., { budgetMs })`): it is only started when a whole provider request fits the batch, and the request timeout is `min(PERFORMANCE_REQUEST_TIMEOUT_MS, time left − 3 s)`.

## 3. Categories and weights

| Category | Weight | Why |
|---|---|---|
| Technical SEO | 25 | Several items are hygiene with a weak ranking effect, so this is not the largest block. |
| Local SEO | 25 | The core of a trades business's visibility. |
| Content / structure | 20 | |
| Performance | 20 | Mobile-weighted. |
| Crawl / indexability | 10 | A noindexed homepage or a blanket `Disallow` is the most damaging single fact we can measure. |

## 4. Rules

Statuses: `pass` (full points), `partial` (a ratio or the middle band), `fail` (0 points), `not_evaluated` (excluded from the denominator). "Ratio" = `max × passing / eligible` over successfully crawled HTML pages. ᶜ = reads rendered content, so it is not evaluated on client-rendered pages/sites. ³ = needs `audit-crawler/v3` evidence, so it is not evaluated on older runs. ᵃ = absence rule (see §5).

**Crawl / indexability (10)**

| Rule | Max | Evidence |
|---|---|---|
| `homepage_reachable` | 2 | `homepageStatus` is 2xx |
| `homepage_indexable` | 4 | homepage row `noindex = false` |
| `robots_allows_crawling` | 2 | `robotsDisallowAll = false` |
| `pages_indexable` | 1 | ratio of non-homepage pages without noindex |
| `pages_fetch_success` | 1 | ratio of attempted pages fetched without a fetch error or 5xx |

**Technical SEO (25)**

| Rule | Max | Evidence |
|---|---|---|
| `https` | 4 | `homepageHttps` |
| `sitemap` | 2 | `sitemapReachable` |
| `robots_txt` | 1 | `robotsTxtReachable` |
| `title_coverage` | 4 | ratio of pages with a title |
| `title_length` ³ | 1 | ratio of titled pages within `TITLE_MIN_CHARS`–`TITLE_MAX_CHARS` |
| `meta_description_coverage` | 3 | ratio |
| `meta_description_length` ³ | 1 | ratio within `META_DESCRIPTION_MIN_CHARS`–`META_DESCRIPTION_MAX_CHARS` |
| `canonical_coverage` | 3 | ratio |
| `viewport_coverage` | 2 | ratio |
| `h1_coverage` ᶜ | 3 | ratio with exactly one non-empty H1 |
| `structured_data` ᶜ | 1 | ratio with any JSON-LD, microdata or RDFa |

**Local SEO (25)** — every rule ᶜ

| Rule | Max | Evidence |
|---|---|---|
| `localbusiness_schema` | 5 | any crawled page carries a LocalBusiness type |
| `localbusiness_name` ³ | 1 | `schema.hasName` (fails when no LocalBusiness node exists: that is a measured fact) |
| `localbusiness_telephone` ³ | 1 | `schema.hasTelephone` |
| `localbusiness_address` ³ | 2 | `schema.hasAddress` (street, locality and postcode) |
| `nap_phone` ³ | 4 | any phone in `nap.phones` or the schema telephone |
| `nap_address` ³ | 4 | an address candidate, schema address or schema postcode |
| `location_pages` ³ᵃ | 5 | at least one single-location page |
| `service_area_evidence` ³ | 3 | `schema.areaServed`, observed localities, service × location facts or a location page |

**Content / structure (20)**

| Rule | Max | Evidence |
|---|---|---|
| `service_pages` ᶜᵃ | 4 | at least one service page |
| `contact_page` ᶜᵃ | 2 | a contact page |
| `homepage_links_key_pages` ᶜ³ | 3 | ratio of service and single-location pages linked from the homepage (not evaluated when there are none or stored links were truncated) |
| `unique_titles` ³ | 3 | ratio of titled pages outside `duplicateTitleGroups` |
| `unique_meta_descriptions` ³ | 2 | ratio outside `duplicateMetaGroups` |
| `non_thin_pages` ᶜ³ | 3 | ratio with at least `THIN_PAGE_MIN_WORDS` words (contact and gallery pages excluded) |
| `no_broken_internal_links` | 2 | `brokenInternalLinks = 0` |
| `no_internal_redirects` ³ | 1 | no `internalRedirects` entry that a crawled page links to |

**Performance (20)** — homepage observations; bands are Google's published good / needs-improvement thresholds: at or under the first = full points, at or under the second = half, above = none.

| Rule | Max | Evidence |
|---|---|---|
| `lighthouse_performance_mobile` | 6 | linear: `6 × score / 100` |
| `lighthouse_performance_desktop` | 3 | linear |
| `lcp_mobile_lab` | 3 | 2500 / 4000 ms |
| `cls_mobile_lab` | 2 | 0.10 / 0.25 |
| `tbt_mobile_lab` | 2 | 200 / 600 ms |
| `field_lcp` | 2 | mobile field p75, 2500 / 4000 ms; not evaluated without field data |
| `field_inp` | 1 | 200 / 500 ms; not evaluated without field data |
| `field_cls` | 1 | 0.10 / 0.25; not evaluated without field data |

A location index page (`/areas-we-cover`, `/locations`) is judged on the last path segment only, so `/areas-we-cover/uxbridge` counts as a location page for scoring.

## 5. Missing evidence

Missing evidence never counts as a failure, and it never makes a thinly measured site look strong either.

1. **Rule level.** A `not_evaluated` rule leaves both numerator and denominator: `category score = weight × earned / evaluatedMax`. Rule maxima sum to the category weight, so with everything evaluated the rule points add up to the category score directly.
2. **Category level.** A category is scored only when at least `CATEGORY_MIN_COVERAGE` (50%) of its nominal points were evaluated. Otherwise its score is `null` ("Not evaluated"), it contributes nothing to the overall score or to coverage, and its rule results stay in the breakdown flagged `suppressed: "insufficient_category_evidence"`.
3. **Overall.** `overall = 100 × Σ category scores / Σ weights of the scored categories`; with all five scored this is exactly the sum of the category scores. `evidence_coverage` is the share of the 100 nominal points evaluated inside scored categories.
4. **Sufficiency.** `score_status` is decided from overall coverage and from whether any category was withheld:

   | Status | Condition | `overall_score` |
   |---|---|---|
   | `complete` | coverage ≥ `COMPLETE_MIN_COVERAGE` (70%) **and** all five category scores are non-null | number |
   | `provisional` | coverage ≥ `PROVISIONAL_MIN_COVERAGE` (40%) **and** (coverage < 70% **or** at least one category score is `null`); internal only, always labelled | number, normalised over the scored categories |
   | `insufficient_evidence` | coverage < 40% | `null` |

   A withheld category means the overall number was rescaled over the remaining weight, so it cannot stand on its own however high coverage is. The per-category test is unchanged (point 2, 50%), which gives these consequences:
   - **Missing CrUX field data alone does not force `provisional`.** The three field rules are 4 of the 20 Performance points; with Lighthouse and lab metrics measured the category is 16/20 (80%) evaluated, is scored, and the status can be `complete`.
   - **A total PageSpeed failure prevents `complete`.** With no successful observation every Performance rule is `not_evaluated`, `performance_score` is `null`, and the best possible status is `provisional` (a fully measured site otherwise sits at 80% coverage). The same applies when `PERFORMANCE_PROVIDER=none`, and to partial measurements that leave Performance under 50% (for example desktop only, 3/20).
   - The same holds for any other withheld category, e.g. Local SEO or Content on a client-rendered site or a pre-v3 run.
5. **Absence rules (ᵃ).** "No such page" is only a measured fact when the crawl ran out of URLs before it ran out of page budget. Finalisation stores `site_summary_json.crawlScope {pageCap, frontierRemaining}`; when the page type is absent and `frontierRemaining > 0` the rule is `not_evaluated (crawl_capped)`. Runs finalised before `crawlScope` existed are treated as capped when `pages_attempted ≥ 15` (`LEGACY_ASSUMED_PAGE_CAP`), and the breakdown records `crawlCapInferred: true`.

6. **Bot-challenge evidence (v2).**
   - *Blocked run* (`site_summary_json.crawlBlocked = true`): every rule of Technical SEO, Local SEO, Content / structure and Crawl / indexability is `not_evaluated` with reason `crawl_blocked`, including the site-level ones (HTTPS, robots.txt, sitemap, homepage status), because the layer that challenged the homepage also answers those requests. Performance is evaluated exactly as usual. Rule maxima and weights are untouched and nothing scores zero: the four categories are withheld (`null`). Coverage is therefore at most 20% (16% without field data), which is always `insufficient_evidence` with `overall_score = null`; a measured Performance category score is still stored and shown. Successful PageSpeed evidence never makes a blocked audit `provisional` or `complete`.
   - *Challenge document on a secondary page* (completed run): the row is not an HTML success, so it is outside every page ratio, and it is also removed from both sides of `pages_fetch_success`. While such a row exists, an absent page type is `not_evaluated (challenge_pages_not_evaluated)` for the absence rules (ᵃ), because the challenged URL may be that page.

All arithmetic is in integer hundredths of a point, so rule points, category scores and the overall score reconcile exactly from `breakdown_json` alone.

## 6. Transparency and versioning

`website_audit_scores.breakdown_json`:

```json
{
  "scoringVersion": "audit-score/v2",
  "constants": { "categoryMinCoverage": 0.5, "completeMinCoverage": 0.7, "provisionalMinCoverage": 0.4 },
  "inputs": { "crawlerVersion": "…", "rulesVersion": "…", "evidenceVersion": 3, "pagesStored": 15, "htmlPagesScored": 14, "renderedContentEvaluated": true, "crawlCapped": true, "crawlCapInferred": false, "crawlBlocked": false, "challengePagesExcluded": 0, "observationIds": ["…"] },
  "categories": {
    "technical": { "weight": 25, "nominalMax": 25, "evaluatedMax": 25, "earned": 21.5, "coverage": 1, "score": 21.5, "suppressed": null,
      "rules": { "https": { "status": "pass", "points": 4, "max": 4, "evidence": { "homepageFinalUrl": "https://…" } } } }
  }
}
```

Every rule's `evidence` holds the measured values the points derive from, or the reason the rule was not evaluated. No reasoning text is stored.

A score row is immutable: `unique (audit_run_id, scoring_version)`, inserted if absent, never updated. Changing any weight, rule, threshold or sufficiency constant requires a new `AUDIT_SCORE_VERSION`; older rows keep the number their version produced and are never silently recalculated. To measure a site again, run a new audit.

**v1 → v2.** `audit-score/v2` = v1 + §5.6. Existing `audit-score/v1` rows are never updated, deleted or recalculated; `audit.score` only ever inserts the row of the version in force if it is absent. For an audit without challenge evidence the two versions are numerically identical: the golden fixtures in `tests/audit/score-golden.test.ts` keep their v1 numbers unchanged, and `tests/audit/score-blocked.test.ts` pins the published v1 category and overall values of every ordinary fixture under v2. The only v2 additions to the breakdown are `inputs.crawlBlocked` and `inputs.challengePagesExcluded`.

## 7. Known limitations

- `audit-rules/v3` treats any path containing a location hub segment as a hub, so its `location_pages_missing` finding can fire for a site whose town pages live under `/areas-we-cover/…`. The score does not inherit this (§4); the rule itself is unchanged in this version.
- If the `audit.performance` job dead-letters on an infrastructure error (not a provider error), its observation rows stay `pending` and no score is written until the job is re-queued by an operator. Tracked as RL-066.
- The score trusts the crawl evidence it is given. Bot-challenge documents served with HTTP 200 are detected by the crawler since RL-067 (§5.6); a challenge the detector does not recognise ([`AUDIT_RULES.md`](AUDIT_RULES.md) §7.4) would still be scored as the website. One historical row is affected and deliberately left as written: an `audit-score/v1` `complete` score computed on 2026-09-19 from a one-page challenge document. Treat any pre-v4 completed run with one page and a near-empty homepage as not measured.
- Lab metrics come from one synthetic run and vary between runs; the stored observation, not a re-measurement, is what a score is reproducible from.
