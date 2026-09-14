# First Coding Prompt

Read `AGENTS.md` and all four files under `/docs` before writing code.

Implement only the engineering foundation represented by RL-001 through RL-007 in the backlog.

Requirements:
- Next.js + TypeScript.
- Supabase/PostgreSQL.
- Simple single-workspace architecture with future workspace_id support.
- Add SEND_MODE=disabled|sandbox|live and default to disabled.
- Add `.env.example`.
- No Gmail sending.
- No Google Places.
- No Hermes.
- No paid AI provider should be required just to boot the app.
- AI access must be abstracted behind a model-router interface.
- Add appropriate tests.

Before coding, give me:
1. implementation plan;
2. proposed repository tree;
3. database migration plan;
4. assumptions.

Then implement.

At the end:
- run tests;
- run typecheck;
- run lint;
- list changed files;
- explain how I run the app;
- do not claim success if any check fails.
