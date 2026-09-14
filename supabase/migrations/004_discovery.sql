-- 004_discovery.sql
-- Durable job queue, discovery candidates, website verification, field provenance.

-- ---------------------------------------------------------------------------
-- Durable jobs (Postgres-backed queue; claimed with SKIP LOCKED)
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status workflow_run_status not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  trace_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create index if not exists jobs_claimable_idx on jobs (run_after) where status in ('queued', 'failed');
create index if not exists jobs_workspace_status_idx on jobs (workspace_id, status, created_at desc);
create index if not exists jobs_type_status_idx on jobs (type, status);

drop trigger if exists jobs_set_updated_at on jobs;
create trigger jobs_set_updated_at before update on jobs for each row execute function set_updated_at();

-- Atomically claims up to p_limit runnable jobs for a worker.
-- Also recovers jobs whose lock is older than p_stale_after (crashed workers).
create or replace function claim_jobs(p_worker_id text, p_limit integer default 5, p_stale_after interval default interval '10 minutes')
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select j.id
    from jobs j
    where (
        (j.status in ('queued', 'failed') and j.run_after <= now())
        or (j.status = 'running' and j.locked_at is not null and j.locked_at < now() - p_stale_after)
      )
    order by j.run_after asc, j.created_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id
  from candidates
  where j.id = candidates.id
  returning j.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Campaign runs: workspace scoping + discovery progress fields
-- ---------------------------------------------------------------------------
alter table campaign_runs add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table campaign_runs add column if not exists run_type text not null default 'discovery';
alter table campaign_runs add column if not exists requested_by uuid;
alter table campaign_runs add column if not exists job_id uuid;
alter table campaign_runs add column if not exists search_units_total integer not null default 0;
alter table campaign_runs add column if not exists search_units_completed integer not null default 0;
alter table campaign_runs add column if not exists provider text;
alter table campaign_runs add column if not exists provider_requests integer not null default 0;

update campaign_runs cr set workspace_id = c.workspace_id from campaigns c where c.id = cr.campaign_id and cr.workspace_id is null;

create index if not exists campaign_runs_workspace_idx on campaign_runs (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Discovery candidates (short-lived provider content + durable reference)
-- ---------------------------------------------------------------------------
create table if not exists discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  campaign_run_id uuid references campaign_runs(id) on delete set null,
  provider text not null,
  provider_ref text not null,
  status text not null default 'new' check (status in ('new', 'resolving', 'resolved', 'failed', 'expired')),
  candidate_name text,
  candidate_category text,
  candidate_location text,
  candidate_website_state text not null default 'unknown' check (candidate_website_state in ('present', 'absent', 'unknown')),
  candidate_summary_json jsonb not null default '{}'::jsonb,
  dedupe_key text,
  source_query_json jsonb not null default '{}'::jsonb,
  retention_class text not null default 'provider_restricted_data',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  content_purged_at timestamptz,
  resolution_status text not null default 'pending' check (resolution_status in ('pending', 'created', 'matched', 'ambiguous', 'rejected', 'failed')),
  resolution_confidence numeric check (resolution_confidence between 0 and 1),
  resolution_notes_json jsonb not null default '{}'::jsonb,
  resolved_prospect_id uuid references prospects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, provider, provider_ref)
);

create index if not exists discovery_candidates_campaign_status_idx on discovery_candidates (campaign_id, status);
create index if not exists discovery_candidates_run_idx on discovery_candidates (campaign_run_id);
create index if not exists discovery_candidates_workspace_resolution_idx on discovery_candidates (workspace_id, resolution_status);
create index if not exists discovery_candidates_expiry_idx on discovery_candidates (expires_at) where content_purged_at is null;

drop trigger if exists discovery_candidates_set_updated_at on discovery_candidates;
create trigger discovery_candidates_set_updated_at before update on discovery_candidates for each row execute function set_updated_at();

-- Clears provider-restricted content after expiry, retaining only the provider reference and resolution outcome.
create or replace function purge_expired_discovery_content()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged integer;
begin
  update discovery_candidates
  set candidate_name = null,
      candidate_location = null,
      candidate_summary_json = '{}'::jsonb,
      content_purged_at = now(),
      status = case when status in ('new', 'resolving') then 'expired' else status end
  where expires_at is not null
    and expires_at <= now()
    and content_purged_at is null;
  get diagnostics purged = row_count;
  return purged;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prospect website state + verification history
-- ---------------------------------------------------------------------------
alter table prospects add column if not exists website_state text not null default 'unknown'
  check (website_state in ('unknown', 'verified_website', 'unverified', 'likely_no_website', 'verified_no_website'));
alter table prospects add column if not exists website_url text;
alter table prospects add column if not exists website_verified_at timestamptz;

create index if not exists prospects_workspace_website_state_idx on prospects (workspace_id, website_state);
create index if not exists prospects_workspace_domain_idx on prospects (workspace_id, canonical_domain) where canonical_domain is not null;
create index if not exists prospects_workspace_phone_idx on prospects (workspace_id, primary_phone) where primary_phone is not null;
create index if not exists prospects_workspace_name_city_idx on prospects (workspace_id, normalized_name, city);

create table if not exists prospect_website_verifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  candidate_id uuid references discovery_candidates(id) on delete set null,
  state text not null check (state in ('verified_website', 'unverified', 'likely_no_website', 'verified_no_website')),
  website_url text,
  canonical_domain text,
  confidence numeric not null check (confidence between 0 and 1),
  signals_json jsonb not null default '[]'::jsonb,
  verifier_version text not null,
  verified_at timestamptz not null default now(),
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists website_verifications_prospect_idx on prospect_website_verifications (workspace_id, prospect_id, verified_at desc);
create unique index if not exists website_verifications_current_idx on prospect_website_verifications (prospect_id) where is_current;

-- ---------------------------------------------------------------------------
-- Field provenance
-- ---------------------------------------------------------------------------
create table if not exists prospect_field_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  field_name text not null,
  value_hash text not null,
  display_value text,
  source_type text not null,
  source_ref_id uuid references prospect_source_refs(id) on delete set null,
  observed_at timestamptz not null default now(),
  confidence numeric check (confidence between 0 and 1),
  retention_class text not null default 'canonical_business_data',
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists field_evidence_prospect_field_idx on prospect_field_evidence (workspace_id, prospect_id, field_name, is_current);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table jobs enable row level security;
alter table discovery_candidates enable row level security;
alter table prospect_website_verifications enable row level security;
alter table prospect_field_evidence enable row level security;

drop policy if exists jobs_workspace_access on jobs;
create policy jobs_workspace_access on jobs for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists discovery_candidates_workspace_access on discovery_candidates;
create policy discovery_candidates_workspace_access on discovery_candidates for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists website_verifications_workspace_access on prospect_website_verifications;
create policy website_verifications_workspace_access on prospect_website_verifications for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists field_evidence_workspace_access on prospect_field_evidence;
create policy field_evidence_workspace_access on prospect_field_evidence for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Service role grants (backend only; nothing granted to anon/authenticated)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table
  public.jobs,
  public.discovery_candidates,
  public.prospect_website_verifications,
  public.prospect_field_evidence,
  public.domain_events,
  public.workflow_runs
  to service_role;

grant execute on function claim_jobs(text, integer, interval) to service_role;
grant execute on function purge_expired_discovery_content() to service_role;
