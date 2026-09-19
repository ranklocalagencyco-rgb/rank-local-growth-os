-- 008_performance_and_scores.sql
-- Performance evidence and the deterministic audit score (RL-058, RL-070, RL-071).
-- website_performance_observations: one normalized provider result per (audit run, provider, strategy, URL). No Lighthouse JSON blobs.
-- website_audit_scores: one immutable, versioned score per (audit run, scoring version), reproducible from stored evidence.
-- Both are our own measurements (retention class audit_evidence): retained, never purged with provider content.

-- ---------------------------------------------------------------------------
-- Performance observations: also the cursor of the audit.performance job (pending -> succeeded | failed)
-- ---------------------------------------------------------------------------
create table if not exists website_performance_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  audit_run_id uuid not null references website_audit_runs(id) on delete cascade,
  provider text not null,
  provider_version text,
  strategy text not null check (strategy in ('mobile', 'desktop')),
  page_role text not null default 'homepage',
  requested_url text not null,
  final_url text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  -- Every provider HTTP request for this row, incremented before the call so a crash still counts it.
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  error_summary text,
  performance_score integer check (performance_score is null or performance_score between 0 and 100),
  accessibility_score integer check (accessibility_score is null or accessibility_score between 0 and 100),
  best_practices_score integer check (best_practices_score is null or best_practices_score between 0 and 100),
  seo_score integer check (seo_score is null or seo_score between 0 and 100),
  fcp_ms integer check (fcp_ms is null or fcp_ms >= 0),
  lcp_ms integer check (lcp_ms is null or lcp_ms >= 0),
  cls numeric(6,3) check (cls is null or cls >= 0),
  tbt_ms integer check (tbt_ms is null or tbt_ms >= 0),
  speed_index_ms integer check (speed_index_ms is null or speed_index_ms >= 0),
  tti_ms integer check (tti_ms is null or tti_ms >= 0),
  field_data_available boolean not null default false,
  field_scope text check (field_scope is null or field_scope in ('url', 'origin')),
  field_lcp_ms integer check (field_lcp_ms is null or field_lcp_ms >= 0),
  field_inp_ms integer check (field_inp_ms is null or field_inp_ms >= 0),
  field_cls numeric(6,3) check (field_cls is null or field_cls >= 0),
  -- Overall field assessment exactly as the provider returned it (e.g. FAST / AVERAGE / SLOW); never derived by us.
  field_overall_category text,
  run_warnings text[] not null default '{}',
  observed_at timestamptz,
  retention_class text not null default 'audit_evidence',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_run_id, provider, strategy, requested_url)
);

create index if not exists website_performance_observations_run_idx on website_performance_observations (audit_run_id, strategy);
create index if not exists website_performance_observations_prospect_idx on website_performance_observations (workspace_id, prospect_id, created_at desc);

drop trigger if exists website_performance_observations_set_updated_at on website_performance_observations;
create trigger website_performance_observations_set_updated_at before update on website_performance_observations for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit scores: insert-only. A new scoring version adds a row; an existing row is never recalculated.
-- ---------------------------------------------------------------------------
create table if not exists website_audit_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  audit_run_id uuid not null references website_audit_runs(id) on delete cascade,
  scoring_version text not null,
  score_status text not null check (score_status in ('complete', 'provisional', 'insufficient_evidence')),
  -- Null when score_status = insufficient_evidence.
  overall_score numeric(5,2) check (overall_score is null or overall_score between 0 and 100),
  -- Category scores are out of the category weight; null = not evaluated (too little of the category was measured).
  technical_score numeric(5,2) check (technical_score is null or technical_score >= 0),
  local_seo_score numeric(5,2) check (local_seo_score is null or local_seo_score >= 0),
  content_structure_score numeric(5,2) check (content_structure_score is null or content_structure_score >= 0),
  performance_score numeric(5,2) check (performance_score is null or performance_score >= 0),
  crawl_score numeric(5,2) check (crawl_score is null or crawl_score >= 0),
  evaluated_weight numeric(5,2) not null check (evaluated_weight between 0 and 100),
  evidence_coverage numeric(5,2) not null check (evidence_coverage between 0 and 100),
  breakdown_json jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  retention_class text not null default 'audit_evidence',
  created_at timestamptz not null default now(),
  unique (audit_run_id, scoring_version),
  check ((score_status = 'insufficient_evidence') = (overall_score is null))
);

create index if not exists website_audit_scores_run_idx on website_audit_scores (audit_run_id, calculated_at desc);
create index if not exists website_audit_scores_prospect_idx on website_audit_scores (workspace_id, prospect_id, calculated_at desc);

-- ---------------------------------------------------------------------------
-- Row level security + service role grants (backend only; nothing granted to anon/authenticated)
-- ---------------------------------------------------------------------------
alter table website_performance_observations enable row level security;
alter table website_audit_scores enable row level security;

drop policy if exists website_performance_observations_workspace_access on website_performance_observations;
create policy website_performance_observations_workspace_access on website_performance_observations for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists website_audit_scores_workspace_access on website_audit_scores;
create policy website_audit_scores_workspace_access on website_audit_scores for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

grant select, insert, update, delete on table
  public.website_performance_observations,
  public.website_audit_scores
  to service_role;
