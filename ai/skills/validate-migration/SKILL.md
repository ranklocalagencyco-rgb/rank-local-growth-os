---
name: validate-migration
description: How to add a Supabase/Postgres migration in this repo (numbering, idempotency, RLS, grants, types, docs) and prove it against a throwaway Docker Postgres before handing it to the user, who applies migrations manually.
version: 1
applies_to: ["supabase/migrations/**", "supabase/seed.sql", "src/db/types.ts"]
triggers: ["migration", "schema", "RLS", "policy", "grant", "table", "column", "supabase"]
related: ["rank-local-architecture", "quality-gate"]
---

# validate-migration

## Purpose
Migrations are applied by hand in the Supabase SQL editor and nothing in the test suite touches Postgres, so a broken migration blocks the whole feature. This skill makes every migration idempotent, complete (RLS, grants, types, docs) and locally proven.

## When to use
Any change under `supabase/migrations/`, and any code change that needs a new table, column, index, function or policy.

## Non-negotiables
1. Next sequential file `NNN_snake_case.sql` (zero-padded), header comment naming the file and its purpose, `-- ----` banner sections.
2. Every statement idempotent: `create table if not exists`, `alter table ... add column if not exists`, `create index if not exists`, `drop policy if exists` before `create policy`, `drop trigger if exists` before `create trigger`, `create or replace function`.
3. Status-like columns are `text not null default '…' check (col in (…))`, not Postgres enums. Numeric guards use `check`. JSONB defaults to `'{}'::jsonb` or `'[]'::jsonb`.
4. Tenant tables carry `workspace_id uuid not null references workspaces(id) on delete cascade`; child links `on delete cascade`, optional links `on delete set null`.
5. Same file enables RLS, creates `<table>_workspace_access` using `is_workspace_member(workspace_id)`, grants `select, insert, update, delete` on the table to `service_role`, and grants `execute` on new functions to `service_role`. Nothing to `anon`/`authenticated`.
6. Natural unique keys for idempotent upserts; indexes named `<table>_<purpose>_idx`, workspace-scoped, `desc` on time columns; `updated_at` trigger via `set_updated_at()` where the table has `updated_at`.
7. Our own measurements are retained; provider-restricted content carries `expires_at`/`retention_class` and is cleared by a purge function.
8. Update `src/db/types.ts` (row type + `Database` map), the README migration range (`001 through NNN`), `docs/DATA_MODEL_AND_API.md`, and any UI hint that names the last required migration.
9. Never run `supabase db push` against the linked project: 001–005 were applied by hand and are absent from the remote history table, so push would replay them.

## Procedure
1. Copy `ai/examples/migration-template.sql`, rename to the next number, fill in tables/columns/indexes/RLS/grants.
2. Add the TypeScript row types and `Database` entries; add store code with deterministic ids and `ignoreDuplicates` upserts.
3. Validate locally: `bash ai/scripts/validate-migration.sh` (starts `postgres:16` in Docker, applies `ai/scripts/supabase-stubs.sql`, then every migration in order plus `supabase/seed.sql`, re-applies the newest file to prove idempotency, prints the new tables, removes the container).
4. If the schema is needed by a running feature, confirm application through the project's REST endpoint (`GET /rest/v1/<table>?select=id&limit=1` with the service role key returns 200, not 404/400) without printing keys.
5. Hand over: tell the user which file to run in the SQL editor, or `npx supabase db query --linked -f supabase/migrations/NNN_*.sql` with `SUPABASE_ACCESS_TOKEN` exported. Report "not applied" states plainly.

## Verification
`bash ai/scripts/validate-migration.sh` exits 0 and shows the expected tables; `ai/checklists/migration.md` all ticked; `bash ai/scripts/quality-gate.sh` passes.

## References
`supabase/migrations/004_discovery.sql` and `005_local_rank_observations.sql` (canonical patterns); `supabase/migrations/002_crm_foundation.sql` (`is_workspace_member`); `src/db/types.ts`; `src/domain/deterministic-id.ts`; `README.md` (migrations paragraph).

## Anti-patterns
`create type` enums; policies granted to `authenticated`; forgetting the grant so the service role gets `permission denied`; a table without `workspace_id`; editing an already-applied migration instead of adding a new one; assuming the seed has been applied.
