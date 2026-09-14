# Rank Local Growth OS

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. The app boots without Supabase credentials or an AI provider. `SEND_MODE` defaults to `disabled`; use `sandbox` only with a sandbox provider adapter and reserve `live` for an explicitly configured production environment.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Apply `supabase/migrations/001_foundation.sql` and then `supabase/seed.sql` through the Supabase SQL editor or Supabase CLI. The migration is forward-only; rollback should be performed through a reviewed, environment-specific reverse migration.
