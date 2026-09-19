-- 009_audit_blocked_status.sql
-- RL-067: a website audit whose homepage was answered with a bot-challenge / browser-verification / interstitial document ends in
-- the explicit terminal status 'blocked'. It is not 'failed' (the host was reachable and answered) and not 'completed' (the website
-- itself was never crawled). Detection provenance lives in site_summary_json.challenge and website_audit_pages.evidence_json.challenge;
-- no HTML is stored. Additive only: no new table, so RLS and the service-role grants from 006 are unchanged.

-- ---------------------------------------------------------------------------
-- website_audit_runs.status: add 'blocked'
-- Postgres names an inline column check <table>_<column>_check; there is no "add constraint if not exists",
-- so drop-if-exists then re-add keeps the statement idempotent (same pattern as 007). Existing rows use a subset of the values.
-- ---------------------------------------------------------------------------
alter table website_audit_runs drop constraint if exists website_audit_runs_status_check;
alter table website_audit_runs add constraint website_audit_runs_status_check
  check (status in ('queued', 'running', 'completed', 'blocked', 'failed'));

-- When the run became blocked, alongside completed_at / failed_at.
alter table website_audit_runs add column if not exists blocked_at timestamptz;

-- website_audit_runs_active_idx (006) covers only 'queued' and 'running', so a blocked run never prevents a later audit of the
-- same prospect: retrying is simply requesting a new run.
