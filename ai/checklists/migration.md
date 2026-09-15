# Migration checklist

- [ ] Next sequential number; header comment; banner sections.
- [ ] All statements idempotent (`if not exists`, `drop … if exists`, `create or replace`).
- [ ] `workspace_id` on tenant tables with cascade; optional links `on delete set null`.
- [ ] Text + check constraints instead of enums; numeric guards; JSONB defaults.
- [ ] Natural unique key for idempotent upserts; indexes named `<table>_<purpose>_idx`.
- [ ] `updated_at` trigger where the column exists.
- [ ] RLS enabled; `<table>_workspace_access` policy; service-role grant; function grants.
- [ ] Retention: provider content expires and is purged; our measurements retained.
- [ ] `src/db/types.ts` updated (row type + `Database` map).
- [ ] README migration range, `docs/DATA_MODEL_AND_API.md`, and any UI "migration NNN required" hint updated.
- [ ] `bash ai/scripts/validate-migration.sh` passes, including re-apply of the newest file.
- [ ] Handover states clearly whether the migration is applied to the linked project and how to apply it.
