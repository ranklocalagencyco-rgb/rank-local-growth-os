-- 005_local_rank_observations.sql
-- Discovery provider execution mode + cost on campaign runs; local search ranking observations.

-- ---------------------------------------------------------------------------
-- Campaign runs: provider mode and accumulated provider cost
-- ---------------------------------------------------------------------------
alter table campaign_runs add column if not exists provider_mode text;
alter table campaign_runs add column if not exists provider_cost_usd numeric(12, 6) not null default 0 check (provider_cost_usd >= 0);

-- ---------------------------------------------------------------------------
-- Local rank observations
-- One row per (run, provider, reference, search unit): where a listing ranked in the provider's local
-- results when discovery ran. This is our own measurement, kept apart from business identity and from
-- provider-restricted content; it is not purged with candidate content. Rating and review count are the
-- numeric aggregates shown on the listing at that moment (never review text).
-- ---------------------------------------------------------------------------
create table if not exists local_rank_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  campaign_run_id uuid references campaign_runs(id) on delete set null,
  candidate_id uuid references discovery_candidates(id) on delete set null,
  prospect_id uuid references prospects(id) on delete set null,
  provider text not null,
  provider_ref text not null,
  search_category text not null,
  search_location text not null,
  country_code text not null,
  rank_position integer not null check (rank_position > 0),
  rank_absolute integer check (rank_absolute is null or rank_absolute > 0),
  rating numeric(3, 2) check (rating is null or rating between 0 and 5),
  review_count integer check (review_count is null or review_count >= 0),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (campaign_run_id, provider, provider_ref, search_category, search_location)
);

create index if not exists local_rank_observations_prospect_idx on local_rank_observations (workspace_id, prospect_id, observed_at desc);
create index if not exists local_rank_observations_campaign_idx on local_rank_observations (campaign_id, observed_at desc);
create index if not exists local_rank_observations_candidate_idx on local_rank_observations (candidate_id);
create index if not exists local_rank_observations_unit_idx on local_rank_observations (workspace_id, search_category, search_location, observed_at desc);

-- ---------------------------------------------------------------------------
-- Row level security + service role grants (backend only; nothing granted to anon/authenticated)
-- ---------------------------------------------------------------------------
alter table local_rank_observations enable row level security;

drop policy if exists local_rank_observations_workspace_access on local_rank_observations;
create policy local_rank_observations_workspace_access on local_rank_observations for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

grant select, insert, update, delete on table public.local_rank_observations to service_role;
