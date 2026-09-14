create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed')),
  country_code text not null default 'GB',
  target_categories text[] not null default '{}',
  target_locations text[] not null default '{}',
  website_filter text not null default 'any',
  minimum_score integer check (minimum_score between 0 and 100),
  entity_policy text not null default 'manual_review',
  daily_candidate_cap integer check (daily_candidate_cap is null or daily_candidate_cap > 0),
  daily_send_cap integer check (daily_send_cap is null or daily_send_cap > 0),
  approval_mode text not null default 'human',
  settings_json jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists campaign_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  cursor_json jsonb not null default '{}'::jsonb,
  candidates_seen integer not null default 0,
  prospects_created integer not null default 0,
  qualified_count integer not null default 0,
  error_summary text,
  created_at timestamptz not null default now()
);

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  canonical_domain text,
  primary_phone text,
  primary_email text,
  company_number text,
  entity_type text not null default 'unknown' check (entity_type in ('limited_company', 'llp', 'scottish_partnership', 'sole_trader', 'unincorporated_partnership', 'public_body', 'unknown')),
  entity_confidence numeric check (entity_confidence between 0 and 1),
  country_code text not null default 'GB',
  region text,
  city text,
  postcode text,
  status text not null default 'new' check (status in ('new', 'qualified', 'audited', 'outreach_ready', 'suppressed', 'archived')),
  pipeline_stage text not null default 'new' check (pipeline_stage in ('new', 'qualified', 'opportunity', 'meeting', 'won', 'lost')),
  owner_user_id uuid,
  current_opportunity_score integer check (current_opportunity_score between 0 and 100),
  current_score_version text,
  recommended_offer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prospect_source_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  provider text not null,
  external_id text not null,
  source_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retention_class text not null default 'standard',
  metadata jsonb not null default '{}'::jsonb,
  unique (workspace_id, provider, external_id)
);

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scope text not null check (scope in ('contact', 'prospect', 'domain', 'global_identity')),
  email_hash text,
  domain_hash text,
  phone_hash text,
  prospect_id uuid references prospects(id) on delete set null,
  reason text not null,
  source text not null default 'operator',
  created_at timestamptz not null default now(),
  created_by uuid,
  check (email_hash is not null or domain_hash is not null or phone_hash is not null or prospect_id is not null)
);

create index if not exists campaigns_workspace_status_idx on campaigns (workspace_id, status, created_at desc);
create index if not exists campaign_runs_campaign_created_idx on campaign_runs (campaign_id, created_at desc);
create index if not exists prospects_workspace_status_idx on prospects (workspace_id, status, updated_at desc);
create index if not exists prospects_workspace_score_idx on prospects (workspace_id, current_opportunity_score desc nulls last);
create index if not exists source_refs_prospect_idx on prospect_source_refs (workspace_id, prospect_id);
create index if not exists activity_events_prospect_created_idx on activity_events (workspace_id, prospect_id, created_at desc);
create index if not exists suppressions_workspace_prospect_idx on suppressions (workspace_id, prospect_id);

 drop trigger if exists campaigns_set_updated_at on campaigns;
create trigger campaigns_set_updated_at before update on campaigns for each row execute function set_updated_at();
drop trigger if exists prospects_set_updated_at on prospects;
create trigger prospects_set_updated_at before update on prospects for each row execute function set_updated_at();

create or replace function is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from workspace_users
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

alter table campaigns enable row level security;
alter table campaign_runs enable row level security;
alter table prospects enable row level security;
alter table prospect_source_refs enable row level security;
alter table activity_events enable row level security;
alter table suppressions enable row level security;

drop policy if exists campaigns_workspace_access on campaigns;
create policy campaigns_workspace_access on campaigns for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists campaign_runs_workspace_access on campaign_runs;
create policy campaign_runs_workspace_access on campaign_runs for all using (exists (select 1 from campaigns where campaigns.id = campaign_runs.campaign_id and is_workspace_member(campaigns.workspace_id))) with check (exists (select 1 from campaigns where campaigns.id = campaign_runs.campaign_id and is_workspace_member(campaigns.workspace_id)));
drop policy if exists prospects_workspace_access on prospects;
create policy prospects_workspace_access on prospects for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists source_refs_workspace_access on prospect_source_refs;
create policy source_refs_workspace_access on prospect_source_refs for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists activity_events_workspace_access on activity_events;
create policy activity_events_workspace_access on activity_events for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists suppressions_workspace_access on suppressions;
create policy suppressions_workspace_access on suppressions for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
