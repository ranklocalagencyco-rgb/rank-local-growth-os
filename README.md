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

Apply the migrations in `supabase/migrations/` in order (`001` through `005`) and then `supabase/seed.sql` through the Supabase SQL editor or Supabase CLI. Migrations are forward-only; rollback should be performed through a reviewed, environment-specific reverse migration.

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
