# Quality gate checklist

- [ ] `bash ai/scripts/quality-gate.sh` run in full (with `--with-migrations` if migrations changed).
- [ ] `npm test` PASS, `npm run typecheck` PASS, `npm run lint` PASS, `npm run build` PASS, LLM-import scan PASS.
- [ ] No test weakened, no lint ignore widened, no blocklist relaxed to get a PASS.
- [ ] New behaviour has tests; no real network in tests.
- [ ] Stray dev servers/workers stopped; ports free.
- [ ] Report lists results per step, changed files, migration status, unresolved issues; no secret values.
