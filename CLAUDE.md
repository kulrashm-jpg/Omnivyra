# Repository guidance

## Governed engineering work

Engineering work in this repository follows the governed path described in
`scripts/jev-flow/README.md`: one Jira Story (OMNI) per governed worktree and branch, scope limited
to the Story's Authorized Paths, verification only through registry commands (`gov verify`), and
every governed commit carrying `Governed-By: OMNI-n` and `Gov-Packet: sha256:<packet hash>`.

`gov` = `node node_modules/tsx/dist/cli.mjs scripts/jev-flow/cli.ts` in any checkout that contains
`scripts/jev-flow/` (it is on `main`). From a worktree based on an older commit, invoke a current
checkout by absolute path (see the README).

This is explicit guidance only. There are no hooks and no automatic routing; the user enters
governed work by running `gov` or the `/gov` skill. Governance applies to a conversation only after
`gov start` (new work) or `gov attach` (existing conversation) — an arbitrary older chat is not
governed.

- **New work:** `gov start --story OMNI-n --slug <slug> --repo <git repo> [--base <ref>]` checks
  readiness, creates the governed worktree and branch, stores the packet and prints the `claude`
  command to run. It never launches Claude.
- **Existing work:** `gov attach --story OMNI-n --session <uuid> [--worktree <path>]` attaches an
  existing conversation to a clean worktree. Existing uncommitted work is adopted only after a
  human commits it as an adoption baseline (trailer `Governed-By: OMNI-n`, no `Gov-Packet`); attach
  without `--base` then records that commit as PRE_GOVERNANCE_ADOPTION_BASELINE and only later
  commits are governed. Adoption never creates commits, writes Jira, invokes JEV or modifies Claude
  transcripts.

## Evidence and authority

- Deterministic evidence is authoritative: `gov verify` runs the Story's registry commands and the
  scope check on a clean, committed HEAD and stores a hashed evidence bundle.
- `gov submit` prints the values a human records in Jira. An evidence-only Story (nothing to merge)
  ends there.
- JEV is advisory only: reached solely through `gov judge`, it never overrides deterministic
  evidence, verifies, waives, transitions, merges, releases or deploys.
- `gov check-merge` is a read-only gate for a human or CI (binding, packet and evidence hashes,
  HEAD, clean tree, deterministic PASS, scope, commit trailers; adoption baselines are classified,
  not treated as governed). It never merges.

## Human-only actions

- Creating and editing Stories and Acceptance Criteria, including Authorized Paths and
  Verification Requirements.
- Record Result and Record Verification in Jira (`gov submit` only prints the values).
- Gate Result and every Jira transition (Verify, Integrate, Release).
- `gov judge --write-back`.
- The adoption-baseline commit for existing work.
- Merging, releasing and deploying (`gov check-merge` is a gate, not a merge).

## Prohibited

- Invoking JEV other than through `gov judge`; any background or automatic JEV / gov invocation.
- Editing files outside the Story's Authorized Paths or inside its Prohibited Paths.
- Shell text in Verification Requirements; changing `verification-registry.json` without code review.
- Editing `.claude/settings*` or adding hooks to alter this workflow.
- Rewriting Claude transcripts.
- Credentials, prompts, packets, logs or raw evidence in the repository or in Jira.
