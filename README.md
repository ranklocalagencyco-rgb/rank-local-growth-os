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

Apply the migrations in `supabase/migrations/` in order (`001` through `004`) and then `supabase/seed.sql` through the Supabase SQL editor or Supabase CLI. Migrations are forward-only; rollback should be performed through a reviewed, environment-specific reverse migration.

## Business discovery (campaign → candidates → prospects)

Discovery runs as durable background jobs stored in Postgres (`jobs` table). Nothing long-running happens inside a web request.

1. Add `GOOGLE_PLACES_API_KEY` and `JOB_RUNNER_SECRET` to `.env.local` (both server-side only; see `.env.example`).
2. Create a campaign with at least one category and one location, open it from the campaigns list, and press **Run discovery**. This creates a `campaign_runs` row and enqueues a `discovery.run` job.
3. Process jobs with one of:
   - `npm run worker` in a second terminal (polls `POST /api/jobs/run` with the bearer secret), or
   - the **Process queued jobs (local)** button on the campaign page (`APP_ENV=local` only), or
   - any scheduler calling `POST /api/jobs/run` with `Authorization: Bearer $JOB_RUNNER_SECRET`.
4. Each search page stores deduplicated `discovery_candidates` and enqueues one `candidate.resolve` job per candidate. Resolution verifies the official website (provider hint + HTTP probe), matches existing prospects by source reference, verified domain, then phone, and otherwise creates a prospect with per-field provenance in `prospect_field_evidence` and a `prospect_website_verifications` record.

Provider cost control (two-stage discovery): Google bills each Places request at the highest pricing tier of any field in its field mask, so the adapter never asks a broad search for contact fields.

- Stage 1, Text Search (`places:searchText`), one request per page of up to 20 places, field mask `places.id,places.displayName,places.formattedAddress,places.addressComponents,places.primaryType,places.types,places.businessStatus,nextPageToken` (Pro tier). Candidates are stored with `candidate_website_state = unknown` and no phone.
- Stage 2, Place Details (`places/{id}`), one request per candidate, field mask `id,displayName,formattedAddress,addressComponents,primaryType,types,businessStatus,websiteUri,nationalPhoneNumber,internationalPhoneNumber` (Enterprise tier). It runs inside `candidate.resolve` only for candidates that survived in-page dedupe and the known-candidate check, were not rejected on Stage 1 data (missing name, permanently closed), and are not already attached to a prospect by source reference. Retries reuse the stored enriched content, and a purged candidate is re-fetched with this same single call.
- `DISCOVERY_ENRICHMENT_MODE=inline` switches Text Search to the Stage 2 field mask (Enterprise tier per page) and skips Place Details entirely. Text Search is billed per page, not per place, so for territories with few duplicates this is usually the cheaper option; `two_stage` wins when most candidates are rejected or already known.

Provider retention: Google place IDs are kept as durable source references; all other Google-derived candidate content carries `expires_at` and is cleared by `purge_expired_discovery_content()` (run automatically at the start of every job batch). Names alone never merge prospects; name-and-locality collisions are flagged `ambiguous` for review.

Website states: `verified_website`, `unverified` (URL known but not confirmed), `likely_no_website` (single negative signal), `verified_no_website` (two independent negative sources or operator confirmation). The discovery provider is selected with `DISCOVERY_PROVIDER` and implemented behind `src/discovery/provider.ts`.
