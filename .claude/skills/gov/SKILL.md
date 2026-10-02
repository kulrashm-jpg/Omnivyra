---
name: gov
description: User-invoked. Enter or continue governed engineering work on an OMNI Jira Story using the gov CLI (packet, start, attach, verify, submit). Use only when the user asks for governed work or types /gov.
---

# Governed work (`gov`)

Reference: `scripts/jev-flow/README.md`.
`gov` = `node node_modules/tsx/dist/cli.mjs scripts/jev-flow/cli.ts` in any checkout that contains
`scripts/jev-flow/` (it is on `main`); from a worktree based on an older commit, use a current
checkout by absolute path (`node <TOOLING>/node_modules/tsx/dist/cli.mjs <TOOLING>/scripts/jev-flow/cli.ts`).

## Steps

1. Ask for the Story key (`OMNI-<n>`) or confirm the one the user gave. Do not guess it.
2. Run what the user asks for:
   - `gov packet --story OMNI-n --worktree <path> [--regenerate]` — show the packet; regenerate only
     when it is STALE.
   - `gov start --story OMNI-n --slug <slug> --repo <git repo> [--base <ref>]` — new work. Give the
     user the printed `claude …` command; do not launch it yourself.
   - `gov attach --story OMNI-n --session <uuid> [--worktree <path>] [--fork]` — existing chat.
     Give the user the printed `cd` / `claude --resume` commands and the `@<packet.md>` step.
   - Existing **uncommitted** work: attach refuses a dirty tree. Tell the user that a human must
     first commit it as the adoption baseline (trailer `Governed-By: OMNI-n` only, no `Gov-Packet`);
     then run `gov attach` without `--base`. Never create that commit yourself.
3. Read the packet. Work only in the governed worktree and only on files matching its
   Authorized Paths; never touch Prohibited Paths. If the task needs other paths, stop and say so —
   a human changes the Story.
4. Commit every change with both trailers:
   ```
   Governed-By: OMNI-n
   Gov-Packet: sha256:<packet hash>
   ```
5. Run `gov verify --story OMNI-n --worktree <path>` on a clean, committed tree and report the
   evidence bundle hash; then `gov submit --story OMNI-n --evidence <sha256:…> --worktree <path>`
   to print the values the human records in Jira.
6. Report results plainly: status, exit code, findings, hashes. Do not soften a failure. Use the
   README recovery table for the next step.

## Never

- Run `gov judge --write-back`.
- Transition Jira, or perform Record Result / Record Verification. `gov submit` only prints values
  for the human.
- Merge, release or deploy.
- Invoke JEV any way other than `gov judge` (without `--write-back`), and only when the user asks.
- Edit `.claude/settings*`, add hooks, or change `verification-registry.json` to make a check pass.
- Put credentials, tokens, logs or packet contents in the repository, a commit message or Jira.
- Clean or reset the tree through gov; ask the user how to handle uncommitted changes.
- Create the adoption-baseline commit, or claim pre-baseline work was governed.
- Create a commit only to make `gov check-merge` pass (an evidence-only Story has nothing to merge).
