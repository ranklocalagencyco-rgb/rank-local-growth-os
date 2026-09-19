# Rule: working-tree ownership — one implementation agent per slice

Applies to every coding agent and tool that can touch this repository: Claude Code, Codex, ChatGPT coding agents, Gemini, Cursor, Windsurf and anything that comes later. The repository defines this process; no model or vendor does. Ownership is attached to the **slice** (one ticket or one coherent unit of change), never to a vendor, and any agent may hold it.

## Roles

- **Active implementation owner**: the single agent allowed to modify the working tree, commit and push for the current slice. There is at most one at any time.
- **Reviewer**: any other agent or model. Reviewers are read-only. They may review plans, diffs, tests and live results, and may run read-only commands (`git status`, `git diff`, `git log`, reading files). They must not edit, stage, commit, push, stash, reset, check out, or otherwise alter the working tree or branch unless ownership is explicitly transferred to them.

The human operator decides who the owner is. An agent never takes ownership from another agent on its own initiative, except under "Crash / lost-access recovery" below.

## Before starting a slice

The implementation agent must:

1. Read `AGENTS.md`.
2. Read the `ai/skills/` and `ai/rules/` files relevant to the slice (index: `ai/README.md`).
3. Run `git status`.
4. Run `git log -5 --oneline`.
5. Confirm the working tree state: branch, clean or dirty, ahead/behind `origin`.
6. Confirm whether another agent has uncommitted work. Any modified, staged or untracked file the agent did not create in this slice counts as another agent's work until the operator says otherwise. Do not edit, stash, revert or delete it; report it and wait for a decision.
7. Explicitly declare itself the active implementation owner, naming the slice, e.g. "I am the active implementation owner for slice: <name>".

## During a slice

- Only the active implementation owner modifies files.
- Reviewers remain read-only, as defined under Roles.
- Never assume the working tree is unchanged since you, or another agent, last looked. Re-run `git status` after any pause, handoff, review round or operator action, and before any step that depends on repo state.
- If the owner finds changes it did not make, it stops and reports them instead of absorbing or discarding them.
- Keep changes inside the slice. Unrelated fixes become their own slice.

## Before committing

The active owner must:

1. Run `git status`.
2. Run `git diff --check`.
3. Inspect `git log -5 --oneline` and confirm HEAD is where the slice expects it (no commits from elsewhere since the slice started, or they are understood).
4. Confirm every changed file belongs to the current slice.
5. Confirm no unexpected files from another agent are present, staged or untracked.
6. Run the relevant quality gate (`ai/skills/quality-gate/SKILL.md`; `bash ai/scripts/quality-gate.sh`, with `--with-migrations` when migrations changed) and report each step's result.

## Commit and push

- Only the active implementation owner commits and pushes.
- Commit only reviewed changes that belong to the active slice. Stage files by path; avoid blanket staging that could sweep in another agent's files.
- Commit and push only when the operator has asked for it.
- After pushing, confirm the branch is clean and in sync with `origin` (`git status` shows nothing to commit and the branch is neither ahead nor behind).
- Ownership is released once the slice is pushed and the working tree is clean. The next slice starts again from "Before starting a slice", whichever agent takes it.

## Ownership transfer

Ownership may move between models or tools at any point. Before transfer, the current owner:

1. Stops editing.
2. Reports the working tree status (`git status`, branch, HEAD from `git log -5 --oneline`).
3. Reports every uncommitted file (modified, staged, untracked) and what each is for.
4. Reports which tests and gates have already been run, against which state, and their results.

The new owner then re-checks the Git state independently, compares it with the handoff report, resolves any mismatch with the operator before editing, and declares itself the active implementation owner. The previous owner becomes a reviewer and is read-only from that moment. Gates reported in a handoff are informational; the new owner re-runs them before committing.

## Crash / lost-access recovery

If access to the active model or tool is lost (outage, quota, expired session, vendor change):

- Another model may take over the slice.
- It must inspect the repository state first: `git status`, `git log -5 --oneline`, `git diff`, and the files themselves.
- It must not trust stale chat claims, summaries or memories about what is committed, uncommitted, tested or pushed.
- Git and the repository files are authoritative. Where chat history and Git disagree, Git wins.
- It then follows "Before starting a slice" in full, treats the uncommitted work it found as inherited slice work only after the operator confirms, and declares itself the new owner.

## Why

- Two agents writing to one working tree produce interleaved, unreviewed changes and commits that mix slices.
- Chat context is per-vendor and perishable; Git state is shared and durable. Tying the process to Git keeps the project portable across models and tools.
- `AGENTS.md`: "Do not silently change architecture" and "Never claim completion if checks fail" both depend on knowing exactly whose changes are in the tree.

## Anti-patterns

- A reviewer "just fixing" a typo, formatting a file or running a command that rewrites files.
- Committing with `git add -A` / `git commit -a` without first reading `git status`.
- Resuming after a break, or taking over from another agent, on the strength of a conversation summary.
- Stashing, resetting or cleaning files of unknown origin to get a clean tree.
- Copying this rule into a tool-specific adapter (`CLAUDE.md`, `.claude/`, `.cursor/`, `GEMINI.md`). Adapters point here; they never restate it.
