-- 006_website_audits.sql
-- Website audit foundation: audit runs, crawled-page evidence, deterministic findings.
-- Evidence is our own measurement (retention class audit_evidence): retained, never provider content, no raw HTML.

-- ---------------------------------------------------------------------------
-- Audit runs: one bounded crawl of a prospect's verified website
-- ---------------------------------------------------------------------------
create table if not exists website_audit_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  job_id uuid,
  requested_by uuid,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  website_url text not null,
  canonical_domain text not null,
  crawler_version text not null,
  rules_version text not null,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  pages_attempted integer not null default 0 check (pages_attempted >= 0),
  pages_succeeded integer not null default 0 check (pages_succeeded >= 0),
  pages_failed integer not null default 0 check (pages_failed >= 0),
  error_summary text,
  site_summary_json jsonb not null default '{}'::jsonb,
  crawl_state_json jsonb not null default '{}'::jsonb,
  retention_class text not null default 'audit_evidence',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists website_audit_runs_prospect_idx on website_audit_runs (workspace_id, prospect_id, created_at desc);
create index if not exists website_audit_runs_status_idx on website_audit_runs (workspace_id, status, created_at desc);
-- At most one queued/running audit per prospect.
create unique index if not exists website_audit_runs_active_idx on website_audit_runs (prospect_id) where status in ('queued', 'running');

drop trigger if exists website_audit_runs_set_updated_at on website_audit_runs;
create trigger website_audit_runs_set_updated_at before update on website_audit_runs for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Crawled pages: parsed deterministic evidence per fetched URL (no HTML blobs)
-- ---------------------------------------------------------------------------
create table if not exists website_audit_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  audit_run_id uuid not null references website_audit_runs(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  requested_url text not null,
  final_url text,
  path text,
  discovered_via text not null default 'link' check (discovered_via in ('homepage', 'sitemap', 'link')),
  discovered_from text,
  page_role text not null default 'other' check (page_role in ('homepage', 'service', 'location', 'about', 'contact', 'testimonials', 'other')),
  fetch_ok boolean not null default false,
  fetch_error text,
  http_status integer,
  content_type text,
  redirect_count integer not null default 0 check (redirect_count >= 0),
  response_ms integer check (response_ms is null or response_ms >= 0),
  response_bytes integer check (response_bytes is null or response_bytes >= 0),
  title text,
  meta_description text,
  h1_count integer not null default 0 check (h1_count >= 0),
  h1_text text[] not null default '{}',
  h2_count integer not null default 0 check (h2_count >= 0),
  canonical_url text,
  meta_robots text,
  noindex boolean not null default false,
  nofollow boolean not null default false,
  lang text,
  has_viewport boolean not null default false,
  word_count integer not null default 0 check (word_count >= 0),
  internal_link_count integer not null default 0 check (internal_link_count >= 0),
  external_link_count integer not null default 0 check (external_link_count >= 0),
  tel_link_count integer not null default 0 check (tel_link_count >= 0),
  mailto_link_count integer not null default 0 check (mailto_link_count >= 0),
  form_count integer not null default 0 check (form_count >= 0),
  cta_count integer not null default 0 check (cta_count >= 0),
  json_ld_count integer not null default 0 check (json_ld_count >= 0),
  schema_types text[] not null default '{}',
  has_structured_data boolean not null default false,
  evidence_json jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (audit_run_id, requested_url)
);

create index if not exists website_audit_pages_run_idx on website_audit_pages (audit_run_id, fetched_at);
create index if not exists website_audit_pages_prospect_idx on website_audit_pages (workspace_id, prospect_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- Findings: deterministic rule outcomes with evidence and rule version
-- ---------------------------------------------------------------------------
create table if not exists website_audit_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  audit_run_id uuid not null references website_audit_runs(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  page_id uuid references website_audit_pages(id) on delete cascade,
  scope text not null check (scope in ('site', 'page')),
  code text not null,
  severity text not null check (severity in ('info', 'low', 'medium', 'high')),
  evidence_json jsonb not null default '{}'::jsonb,
  rule_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists website_audit_findings_run_idx on website_audit_findings (audit_run_id, severity);
create index if not exists website_audit_findings_prospect_idx on website_audit_findings (workspace_id, prospect_id, code);

-- ---------------------------------------------------------------------------
-- Row level security + service role grants (backend only; nothing granted to anon/authenticated)
-- ---------------------------------------------------------------------------
alter table website_audit_runs enable row level security;
alter table website_audit_pages enable row level security;
alter table website_audit_findings enable row level security;

drop policy if exists website_audit_runs_workspace_access on website_audit_runs;
create policy website_audit_runs_workspace_access on website_audit_runs for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists website_audit_pages_workspace_access on website_audit_pages;
create policy website_audit_pages_workspace_access on website_audit_pages for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists website_audit_findings_workspace_access on website_audit_findings;
create policy website_audit_findings_workspace_access on website_audit_findings for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

grant select, insert, update, delete on table
  public.website_audit_runs,
  public.website_audit_pages,
  public.website_audit_findings
  to service_role;
