-- NNN_short_purpose.sql
-- One-line description of what this migration adds.

-- ---------------------------------------------------------------------------
-- <table>: what it stores and its retention posture
-- ---------------------------------------------------------------------------
create table if not exists example_things (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  score numeric check (score is null or score between 0 and 1),
  details_json jsonb not null default '{}'::jsonb,
  retention_class text not null default 'audit_evidence',
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, prospect_id, observed_at)
);

create index if not exists example_things_workspace_idx on example_things (workspace_id, created_at desc);
create index if not exists example_things_prospect_idx on example_things (prospect_id) where prospect_id is not null;

drop trigger if exists example_things_set_updated_at on example_things;
create trigger example_things_set_updated_at before update on example_things for each row execute function set_updated_at();

-- Adding columns to an existing table
alter table campaign_runs add column if not exists example_flag boolean not null default false;

-- ---------------------------------------------------------------------------
-- Row level security + service role grants (backend only; nothing granted to anon/authenticated)
-- ---------------------------------------------------------------------------
alter table example_things enable row level security;

drop policy if exists example_things_workspace_access on example_things;
create policy example_things_workspace_access on example_things for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

grant select, insert, update, delete on table public.example_things to service_role;
