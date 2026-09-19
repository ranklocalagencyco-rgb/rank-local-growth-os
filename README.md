# Rank Local Growth OS

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. The app boots without Supabase credentials or an AI provider. `SEND_MODE` defaults to `disabled`; use `sandbox` only with a sandbox provider adapter and reserve `live` for an explicitly configured production environment.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Migrations live in `supabase/migrations/` (`001` through `008`) and are deployed with the Supabase CLI: validate locally (`bash ai/scripts/quality-gate.sh --with-migrations`), run `npx supabase db push --dry-run` and confirm it proposes only the new migration, then `npx supabase db push`. Do not paste migrations into the SQL editor or edit `supabase_migrations.schema_migrations` by hand: the remote history is aligned with this directory and must stay that way. `supabase/seed.sql` is applied once per environment. Migrations are forward-only; rollback should be performed through a reviewed, environment-specific reverse migration.

## Website audits (prospect → bounded crawl → evidence → findings)

Audits are deterministic and run in the background job worker; no LLM is involved in fetching or parsing (`ai/rules/no-llm-in-crawler.md`, enforced by `node ai/scripts/check-llm-imports.mjs --scan`).

1. On a prospect page with a `verified_website`, press **Run website audit**. `requestWebsiteAudit()` creates a `website_audit_runs` row and enqueues an `audit.run` job; a partial unique index prevents a second queued/running audit for the same prospect.
2. The worker fetches the homepage through the SSRF-safe fetcher (`src/audit/safe-fetch.ts`), reads `robots.txt` and up to three sitemap files, builds a prioritised frontier (services, service areas, contact, about, testimonials, gallery, blog first; a homepage menu parent such as "Areas We Cover" raises a page's priority; admin, auth, cart, search, tags, pagination, binaries and third-party hosts ignored; query strings and fragments dropped; URLs deduplicated on a slash-agnostic key while the fetch URL keeps the trailing slash the site links with, so no artefact redirects are recorded), then crawls up to `AUDIT_MAX_PAGES` same-site pages. Each page row is written as it is fetched and the crawl state (including the homepage link context) is persisted, so the job yields at its deadline and resumes.
3. Every successful HTML page yields evidence in `website_audit_pages` (`audit-crawler/v3`): title, meta description and their lengths, H1 count/text/empty count, H2 count and text, canonical, meta robots (noindex/nofollow), lang, viewport, word count, internal/external/tel/mailto link counts, stored links with anchor text, region and menu parent, forms, CTA count, JSON-LD count, schema types, structured-data presence, LocalBusiness/Organization schema detail (name, telephone, address, areaServed, geo, sameAs, ratings), breadcrumbs, NAP observations with provenance (phones, emails, postcodes, address candidates, business-name signals), social profile links, rendering mode, response time and bytes. Page roles (`homepage`, `service`, `location`, `contact`, `about`, `testimonials`, `gallery`, `blog`, `other`) come from a multi-signal deterministic classifier (path, H1/title pattern, schema type, breadcrumb parent, homepage navigation parent) whose decision is stored in `roleSignals`. No HTML is stored.
4. Finalisation computes the site summary (`site_summary_json`: HTTPS, redirect chain, robots/sitemap reachability, sitemap URLs, pages by role, location/service pages and service × location combinations, aggregated NAP and schema facts, duplicate title/meta groups, internal redirects, pages without inbound links within the crawl) and `website_audit_findings` from explicit rules (`audit-rules/v3`). Codes: `missing_title`, `missing_meta_description`, `missing_h1`, `multiple_h1`, `h1_empty`, `missing_canonical`, `page_noindex`, `missing_viewport`, `no_structured_data`, `title_too_short`, `title_too_long`, `meta_description_too_short`, `meta_description_too_long`, `duplicate_title`, `duplicate_meta_description`, `thin_page`, `broken_internal_link`, `internal_link_redirect`, `location_page_not_linked_from_homepage`, `service_page_not_linked_from_homepage`, `no_localbusiness_schema`, `localbusiness_schema_incomplete`, `no_contact_page_detected`, `no_service_pages_detected`, `location_pages_missing`, `nap_phone_missing`, `nap_address_missing`, `homepage_not_https`, `robots_txt_missing`, `sitemap_missing`, `client_rendered_site`. Rules, thresholds, evidence shapes and limitations are documented in [`docs/AUDIT_RULES.md`](docs/AUDIT_RULES.md). Findings carry severity, scope, evidence and rule version; they are not an input to the score. Rows written by older crawler versions stay readable and are never judged by newer rules.

Safety: scheme, credential, port, hostname and IP blocklists; DNS resolved and validated before every request with the connection pinned to the validated address (undici `connect.lookup`); redirects re-validated per hop and capped; timeouts, streamed byte caps and HTML-only parsing; same registrable domain only. Failures on one page never fail the audit; a homepage that cannot be fetched fails the run (transient network errors retry up to the job's attempt limit).

## Performance evidence and audit score (audit → PageSpeed → deterministic score)

After a website audit completes, two more background jobs run; neither can fail the audit itself. Details, rule table and weights: [`docs/AUDIT_SCORE.md`](docs/AUDIT_SCORE.md).

1. `audit.performance` measures the **homepage only** with Google PageSpeed Insights v5, once per strategy in `PERFORMANCE_STRATEGIES` (default mobile + desktop), behind the provider-neutral interface in `src/performance/provider.ts`. `PAGESPEED_API_KEY` is optional: the API is currently available without a key and a key is recommended for frequent automated use; quotas depend on the Google project and are not assumed by the application. One provider request per job invocation, at most two attempts per strategy and `PERFORMANCE_MAX_REQUESTS_PER_RUN` per audit. Normalized metrics land in `website_performance_observations` (category scores, lab metrics, field data when returned, provenance, attempts, safe error state); no Lighthouse JSON is stored. `PERFORMANCE_PROVIDER=none` skips this step.
2. `audit.score` computes `audit-score/v1` from stored evidence only: Technical SEO 25, Local SEO 25, Content/structure 20, Performance 20, Crawl/indexability 10. Every rule is `pass`, `partial`, `fail` or `not_evaluated`; evidence the system did not collect (no field data, client-rendered content, a crawl stopped at the page cap, pre-v3 evidence, an unavailable provider) leaves the denominator instead of scoring zero. A category with under 50% of its points measured is withheld; the score is `complete` only when overall coverage is at least 70% and every category was scored, `provisional` (internal only) when coverage is at least 40% but either is under 70% or a category was withheld (for example Performance after a total PageSpeed failure; missing CrUX field data alone does not withhold it), and `insufficient_evidence` with no overall number under 40%. The row in `website_audit_scores` keeps the full per-rule breakdown and is immutable: a future scoring version adds a row, it never rewrites one.
3. The prospect page shows the overall score and its status, the five category scores, mobile and desktop performance, field-data availability, coverage and the scoring version. Audits completed before these jobs existed can be measured and scored with the "Measure performance & score" button. No AI is involved anywhere in this path.

## AI engineering library

Model-agnostic guidance for coding agents (Claude Code, Codex, Cursor, Windsurf, Gemini) lives in [`ai/`](ai/README.md): skills, standing rules, checklists, examples and scripts. `AGENTS.md` remains the constitution; `CLAUDE.md` and `.claude/` are thin Claude adapters. Before reporting any change complete, run the repository quality gate:

```bash
bash ai/scripts/quality-gate.sh            # tests, typecheck, lint, build, LLM-import scan
bash ai/scripts/quality-gate.sh --with-migrations   # also validates migrations on Docker Postgres 16
```

## Business discovery (campaign → candidates → prospects)

Discovery runs as durable background jobs stored in Postgres (`jobs` table). Nothing long-running happens inside a web request.

1. Add `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` and `JOB_RUNNER_SECRET` to `.env.local` (all server-side only; see `.env.example`). `GOOGLE_PLACES_API_KEY` is only needed when `DISCOVERY_PROVIDER=google_places`. `DATAFORSEO_MODE` defaults to `standard` (cheapest, queued); set `live` for an on-demand run that answers in seconds.
2. Create a campaign with at least one category and one location, open it from the campaigns list, and press **Run discovery**. This creates a `campaign_runs` row and enqueues a `discovery.run` job.
3. Process jobs with one of:
   - `npm run worker` in a second terminal (polls `POST /api/jobs/run` with the bearer secret), or
   - the **Process queued jobs (local)** button on the campaign page (`APP_ENV=local` only), or
   - any scheduler calling `POST /api/jobs/run` with `Authorization: Bearer $JOB_RUNNER_SECRET`.
4. Each search page stores deduplicated `discovery_candidates` and enqueues one `candidate.resolve` job per candidate. Resolution verifies the official website (provider hint + HTTP probe), matches existing prospects by source reference, verified domain, then phone, and otherwise creates a prospect with per-field provenance in `prospect_field_evidence` and a `prospect_website_verifications` record.

### Discovery providers

`DISCOVERY_PROVIDER` selects the adapter behind `src/discovery/provider.ts`. Only the selected adapter's credentials are required.

| Provider | Value | Credentials | Enrichment calls |
|---|---|---|---|
| DataForSEO (default) | `dataforseo` | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | none during discovery |
| Google Places (fallback) | `google_places` | `GOOGLE_PLACES_API_KEY` | one Place Details call per surviving candidate |

**DataForSEO** (`src/discovery/providers/dataforseo.ts`) is the primary provider. It only ever calls the Google Maps SERP endpoints below and the My Business Info lookup; it never asks DataForSEO to crawl a website. Website audits and verification stay in our own deterministic crawler/probe.

- Discovery: one Google Maps SERP task per category × location unit, body `{ keyword: "<category> in <location>", location_code: <country code, GB = 2826>, language_code: "en", depth: DATAFORSEO_MAPS_DEPTH, device: "desktop" }`. `DATAFORSEO_MODE` picks how it runs:
  - `standard` (default): `POST /v3/serp/google/maps/task_post` with `priority: 1`, charged at post time ($0.0006 per page of 100 results). The run job stores the task id in its cursor and returns to the queue; each later invocation issues a free `GET /v3/serp/google/maps/task_get/advanced/{id}` until the result is ready (typically minutes, target under 45). Retrieval calls do not count against the request cap. A task still pending after `DISCOVERY_TASK_TIMEOUT_MINUTES` fails the run.
  - `priority`: the same workflow with `priority: 2` ($0.0012 per page) and a shorter poll delay.
  - `live`: `POST /v3/serp/google/maps/live/advanced` answers synchronously in seconds ($0.002 per page). Use it for manual/on-demand runs.
- Each `maps_search` item (ads are dropped) maps to a candidate from `title`, `address`, `address_info.{city|borough,zip,region,country_code}`, `place_id` (falling back to `cid`), `category` + `additional_categories`, `url`/`domain`, `phone`, `latitude`/`longitude`, plus ranking context kept apart from identity: `rank_group` (organic position), `rank_absolute` (position including ads) and the listing's `rating.value`/`votes_count`. Photos, opening hours, rating distributions and review text are not mapped or stored. Because contact fields arrive with the search, candidates are stored with `enrichedAt` set and `candidate.resolve` reuses them; there is no Stage 2 call.
- Ranking intelligence: every ranked candidate on a page adds one row to `local_rank_observations` (run, unit, provider reference, position, absolute position, rating, review count, observed time), linked to the prospect once resolved. Repeat runs add new observations without re-creating candidates or prospects. These rows are our own measurement, are not purged, and are not yet used by the Opportunity Score; they exist so a later local-SERP-visibility job can read them.
- Pagination: the Maps endpoint has no cursor; the whole `depth` (20–700, billed per 100) arrives in one response and the adapter never issues a second request for the same unit. `DISCOVERY_MAX_PAGES_PER_QUERY` therefore only affects Google Places.
- Re-fetch after purge: `POST /v3/business_data/google/my_business_info/live` with `keyword: "place_id:<ref>"` (or `cid:<ref>`), one live request ($0.0054) for one candidate, used only when the stored content has expired and been purged before resolution.
- Cost and caps: a campaign run stops at the candidate cap (`daily_candidate_cap` / `DISCOVERY_DEFAULT_CANDIDATE_CAP`) or the billable request cap (`DISCOVERY_MAX_REQUESTS_PER_RUN`, lowerable per campaign through `settings_json.max_requests_per_run`), whichever comes first, and records `provider_requests`, `provider_cost_usd` (sum of DataForSEO's reported task cost) and `provider_mode` on `campaign_runs`. Roughly: 100 prospects ≈ 1–2 requests, 1,000 ≈ 12–15, 10,000 ≈ 120–150; at standard rates that is under $0.10 for 10,000 listings, about $0.30 live.
- Location is passed inside the keyword against the country-level `location_code`, which avoids brittle matching of free-text town names against DataForSEO's location list. `DATAFORSEO_LOCATION_CODE` overrides the code when needed.

**Google Places** (`src/discovery/providers/google-places.ts`) is an optional fallback selected with `DISCOVERY_PROVIDER=google_places`; it is only constructed when selected, so the application boots and runs discovery without any Google Cloud credentials.

Google Places cost control (two-stage discovery): Google bills each Places request at the highest pricing tier of any field in its field mask, so the adapter never asks a broad search for contact fields.

- Stage 1, Text Search (`places:searchText`), one request per page of up to 20 places, field mask `places.id,places.displayName,places.formattedAddress,places.addressComponents,places.primaryType,places.types,places.businessStatus,nextPageToken` (Pro tier). Candidates are stored with `candidate_website_state = unknown` and no phone.
- Stage 2, Place Details (`places/{id}`), one request per candidate, field mask `id,displayName,formattedAddress,addressComponents,primaryType,types,businessStatus,websiteUri,nationalPhoneNumber,internationalPhoneNumber` (Enterprise tier). It runs inside `candidate.resolve` only for candidates that survived in-page dedupe and the known-candidate check, were not rejected on Stage 1 data (missing name, permanently closed), and are not already attached to a prospect by source reference. Retries reuse the stored enriched content, and a purged candidate is re-fetched with this same single call.
- `DISCOVERY_ENRICHMENT_MODE=inline` switches Text Search to the Stage 2 field mask (Enterprise tier per page) and skips Place Details entirely. Text Search is billed per page, not per place, so for territories with few duplicates this is usually the cheaper option; `two_stage` wins when most candidates are rejected or already known.

Provider retention (both providers): Google place IDs are kept as durable source references in `prospect_source_refs` with the originating provider; all other candidate content carries `expires_at` and is cleared by `purge_expired_discovery_content()` (run automatically at the start of every job batch). Ranking observations are retained. Names alone never merge prospects; name-and-locality collisions are flagged `ambiguous` for review.

Website states: `verified_website`, `unverified` (URL known but not confirmed), `likely_no_website` (single negative signal), `verified_no_website` (two independent negative sources or operator confirmation). The discovery provider is selected with `DISCOVERY_PROVIDER` and implemented behind `src/discovery/provider.ts`.
