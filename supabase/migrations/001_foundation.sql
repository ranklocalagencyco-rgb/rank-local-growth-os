create extension if not exists pgcrypto;

do $$ begin
  create type send_mode as enum ('disabled', 'sandbox', 'live');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type workflow_run_status as enum ('queued', 'running', 'completed', 'failed', 'dead_letter');
exception when duplicate_object then null;
end $$;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Europe/London',
  country_code text not null default 'GB',
  send_mode send_mode not null default 'disabled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_users (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'operator', 'analyst')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_type text not null,
  entity_type text,
  entity_id uuid,
  status workflow_run_status not null default 'queued',
  attempt integer not null default 0 check (attempt >= 0),
  idempotency_key text not null,
  input_hash text,
  output_hash text,
  provider text,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message_safe text,
  usage_json jsonb not null default '{}'::jsonb,
  cost_estimate numeric,
  trace_id text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create index if not exists workflow_runs_workspace_status_idx on workflow_runs (workspace_id, status, created_at desc);

create table if not exists domain_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  unique (workspace_id, idempotency_key)
);

create index if not exists domain_events_unpublished_idx on domain_events (workspace_id, occurred_at) where published_at is null;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspaces_set_updated_at on workspaces;
create trigger workspaces_set_updated_at before update on workspaces for each row execute function set_updated_at();
