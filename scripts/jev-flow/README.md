# Governed Claude workflow (`gov`)

An explicit path from a Jira Story to verified, merge-ready commits.
Builds on Phase 2: BJC bounded judgment (`scripts/jev-bjc/`) and the Jira orchestrator
(`scripts/jev-jira/`). Shared contract: `types.ts` (`gov-flow/1`) and `verification-registry.json`.

```sh
node node_modules/tsx/dist/cli.mjs scripts/jev-flow/cli.ts <verb> ...   # referred to below as `gov`
```

**Where to run it from.** The relative form above works only inside a checkout that contains
`scripts/jev-flow/` (the tooling branch, or `main` once the tooling is merged). A governed product
worktree created from a base that predates the tooling (for example today's `origin/main`) does
not contain it, so there invoke the tooling checkout by absolute path — every path gov needs is
passed explicitly (`--worktree`, `--repo`), and `attach --worktree` defaults to the current
directory:

```sh
node <TOOLING>/node_modules/tsx/dist/cli.mjs <TOOLING>/scripts/jev-flow/cli.ts <verb> ...
```

`<TOOLING>` is the absolute path of a checkout of the tooling branch. The verification registry
is read from that checkout; registry commands run inside the governed worktree, which therefore
needs its own `node_modules` (e.g. a junction `cmd /c mklink /J <worktree>\node_modules <repo>\node_modules`
— gov prints it but never creates it).

**Jira is the work authority. Deterministic evidence is authoritative. JEV is advisory.**
gov runs only when a person (or Claude Code acting on a person's request) invokes it. There are
no hooks, no `claude-jev` routing, no automatic JEV invocation and no background orchestration.
gov never merges, releases, deploys, or transitions Jira.

## Why governance exists

Without it, a coding session has no durable link to the work it claims to do: scope is implicit,
"tests pass" is a sentence instead of a record, and a model's opinion can be mistaken for
evidence. gov binds one Claude session to one Jira Story, limits the change to the Story's
Authorized Paths, produces hashed evidence from reviewed commands only, keeps JEV's opinion
separate from that evidence, and leaves every decision with authority (result, verification,
gate, merge, release, deploy) to a human.

## Commands

| Verb | Purpose | Writes |
|---|---|---|
| `gov start --story OMNI-n --slug <slug> --repo <git repo> [--base <ref>] [--worktree-root <dir>]` | Readiness gate; resolves `--base` (default `origin/main`) in `--repo` to a full commit; creates the governed worktree `<root>/omni-n-<slug>` (default root `C:/tmp`) on branch `omni-n/<slug>`; stores the packet; binds a **new** session id; prints the exact `claude --session-id <uuid> --add-dir <packetdir> "@<packet.md> …"` command. Launches nothing. | worktree, `GOV_HOME` |
| `gov attach --story OMNI-n --session <uuid> [--worktree <path>] [--base <ref>] [--fork]` | Readiness; fingerprints the existing transcript (read-only, never rewritten); requires a clean worktree on a named branch; base = `--base`, else the earlier binding's base, else **existing-work adoption** (see below); binds; prints the resume commands. `--worktree` defaults to the current directory. | `GOV_HOME` |
| `gov packet --story OMNI-n --worktree <path> [--regenerate]` | Displays the bound packet; reports `STALE` (exit 12) when Jira or the registry changed. `--regenerate` stores a fresh packet for the same base and re-binds the same session. | `GOV_HOME` with `--regenerate` |
| `gov verify --story OMNI-n --worktree <path>` | Runs the Story's registry commands and the scope check on a clean, committed HEAD; stores the evidence bundle; prints its hash. | `GOV_HOME` |
| `gov judge --story OMNI-n --worktree <path> --evidence <sha256:…> --invoked-by <human\|claude-code>:<id> [--write-back] [--model <id>]` | BJC + bounded JEV advisory per AC. `--write-back` writes only the four advisory fields (human-run). Never transitions Jira. | `GOV_HOME`; Jira advisory fields with `--write-back` |
| `gov submit --story OMNI-n --evidence <sha256:…> [--worktree <path>]` | Prints the values a **human** records in Jira. | nothing |
| `gov check-merge --story OMNI-n --worktree <path> --evidence <sha256:…>` | Deterministic merge gate for a human or CI. Fails closed. Never merges. | nothing |

Exit codes: `0` OK · `10` NOT_READY · `11` REFUSED · `12` STALE · `13` INTEGRITY_FAILED ·
`14` VERIFICATION_FAILED · `15` SCOPE_VIOLATION · `16` JUDGMENT_UNAVAILABLE · `64` usage · `70` ERROR.

### Identity and storage

- Jira reads: `JEV_JIRA_IDENTITY=reader` + `JEV_READER_TOKEN`.
- `gov judge --write-back`: `JEV_JIRA_IDENTITY=advisory` + `JEV_ADVISORY_TOKEN`, with the Phase 2
  permission preflight (advisory = Browse + Edit only). `TYPESAFE_API_KEY` for JEV.
- Credentials come from the environment only. Never put them in the repo, a Story, a prompt or a packet.
- `GOV_HOME` (default `~/.omnivyra/gov`) holds `packets/<story>/<hash>.{json,md}`, `bindings.jsonl`,
  `evidence/<story>/<hash>.json` and `evidence/<story>/logs/<hash>.log`. gov refuses a `GOV_HOME`
  inside any git work tree (the repository is public).

## Normal workflow

1. A human creates the Story and its Acceptance Criteria in Jira (see *What makes a Story READY*).
2. `gov start` (new work) or `gov attach` (an existing Claude conversation; existing *uncommitted*
   work is first committed by a human as an adoption baseline — see *Adopting existing work*).
3. The human launches Claude with the printed command. Claude reads the packet.
4. Claude changes only Authorized Paths and commits with both trailers:
   ```
   Governed-By: OMNI-n
   Gov-Packet: sha256:<packet hash>
   ```
5. `gov verify` → evidence bundle hash (zero commits after the base is allowed: the base itself is verified).
6. Optional: `gov judge` for JEV advisory per AC (`--write-back` only when a human runs it).
7. `gov submit` prints values; a human runs Record Result and Record Verification in Jira.
8. `gov check-merge` (human or CI) → the human merges. Integration, release and deployment stay human.
   An evidence-only Story whose work is already on `main` (a back-fill) has nothing to merge:
   it ends at step 7, and `check-merge` correctly refuses a new-task binding with no governed commit.

### New task

```sh
gov start --story OMNI-42 --slug report-export-fix --repo <path to a checkout of the repo> [--base origin/main]
```

Readiness runs first; on any finding nothing is created (`NOT_READY`). Otherwise gov records the
base as a full commit id, creates the worktree and branch `omni-42/report-export-fix`, stores the
packet, binds a new session id and prints:

```sh
claude --session-id <uuid> --add-dir <GOV_HOME>/packets/OMNI-42 "@<GOV_HOME>/packets/OMNI-42/<hash>.md …"
```

`--add-dir` lets the session read the packet without copying it into the repository. gov does
not start Claude; the human runs the command.

### Existing chat

```sh
gov attach --story OMNI-42 --session <uuid> [--worktree <path>] [--fork]
```

gov hashes the existing transcript (`.jsonl`) and records its path, size, `cwd` and `gitBranch`;
the transcript is never modified. The worktree must be a clean governed worktree whose HEAD
descends from the packet base. gov prints:

```sh
cd "<session cwd>"
claude --resume <uuid> [--fork-session]
```

then, inside the resumed conversation, type `@<packet.md>`.

The base of an attach is chosen deterministically, never inferred from history:

1. `--base <ref>` given → that commit (ordinary attach; every commit base..HEAD is governed).
2. otherwise, an earlier binding for this Story and worktree → its base (and its adoption, if any).
3. otherwise → **existing-work adoption**, below. If HEAD is not an adoption baseline, attach
   refuses (exit 11) and says how to create one.

### Adopting existing work (PRE_GOVERNANCE_ADOPTION_BASELINE)

Work that was started before governance — often uncommitted in an existing worktree — enters
governance in two explicit steps. gov never weakens the clean-tree rule and never adopts dirty work.

1. **A human commits the existing work** on the worktree's branch, leaving a clean tree, with exactly
   this trailer and **no** `Gov-Packet` trailer (the packet does not exist yet):
   ```sh
   git commit -m "<summary> (adoption baseline)" -m "Governed-By: OMNI-n"
   ```
2. **Attach with no `--base`** from that clean worktree:
   ```sh
   gov attach --story OMNI-n --session <uuid> [--worktree <path>]
   ```
   Requirements (any failure → exit 10/11, nothing written): Story READY, transcript found, named
   branch, clean tree, HEAD carries `Governed-By: OMNI-n` (every value exactly the Story) and no
   `Gov-Packet`. gov records HEAD as the packet base and in the binding as
   `adoption: { baseline_commit, classification: PRE_GOVERNANCE_ADOPTION_BASELINE }`, and prints the
   packet hash.

Semantics:

- The baseline and everything before it are **pre-governance**: recorded and classified, never
  claimed to have been governed, and not inspected by `check-merge`.
- Every commit **after** the baseline is governed and must carry both trailers:
  `Governed-By: OMNI-n` and `Gov-Packet: sha256:<exact packet hash>`.
- `gov verify` scopes and verifies only baseline..HEAD; with zero governed commits it verifies the
  baseline itself.
- Adoption **does not** create commits, write Jira, invoke JEV or modify Claude transcripts.
- Re-running `attach` reuses the recorded baseline; `gov packet --regenerate` keeps it.

- **Why `@packet.md` and not `--append-system-prompt`:** the packet becomes a visible, ordinary
  message in the transcript — auditable and identical to the new-task path. A system-prompt
  addition is invisible in the transcript and cannot be checked against the binding.
- **Why `cd` first:** Claude Code locates a session by the directory it was started in. If
  `--resume` cannot find the session, `cd` to the `cwd` recorded in the transcript (gov prints it)
  and resume from there.
- **`--fork` / `--fork-session`:** resumes into a new session id, leaving the original conversation
  unchanged. Use it when the old conversation should stay as it was.

## Jira hierarchy (OMNI)

| Tier | Item | Gate |
|---|---|---|
| T3 | Epic | Human. |
| T2 | Workstream (Stories linked by issue link) | Human. |
| T1 | Story | Gate Result PASS and every AC sub-task Verified. |
| — | Acceptance Criterion (sub-task) | Verify (transition 41). |

- Story, Workstream and Epic are editable only by Administrators, Release Approvers and Engineers.
- An AC may be Verified when: deterministic PASS + VERIFIED and JEV Verdict ≠ CONFLICT; or a
  judgment AC with a human disposition; or a human WAIVED it.
- Record Result (111) and Record Verification (121) are human-only transitions.
- Release is performed only by Release Approvers.
- The JEV advisory identity writes only JEV Verdict, JEV Confidence, JEV Model and JEV Input Hash.

### What makes a Story READY

Readiness fails closed with sorted findings (`ReadinessCode` in `types.ts`). A Story must:

- be an issue of type Story that is not already Verified, Integrated or Released;
- have **Objective**, **Authorized Paths** and **Verification Requirements** filled;
- use valid path patterns in Authorized / Prohibited Paths, one per line: repo-relative, forward
  slashes, no leading `/`, no `..`; `dir/**` = everything under `dir/`, `*` = within one segment,
  otherwise an exact file. Prohibited always wins;
- list **registry ids** in Verification Requirements, one per line — never shell text. Each id
  must exist in `verification-registry.json`;
- have at least one Acceptance Criterion, each with **AC ID** (`AC-<n>`, unique), **Statement**,
  **Kind** (Deterministic / Judgment) and **Evidence Kind**;
- for every Deterministic AC: Evidence Kind Test, Typecheck or Build (Lint, Security, Deployment,
  Manual and Other are rejected), and at least one listed registry id that produces that kind
  (`test_run`, `typecheck`, `build`).

Architecture and Invariants (one per line) are optional and carried into the packet when present.

## The packet

A deterministic JSON document (`gov-packet/1`) plus a Markdown rendering: Story fields, ACs,
scope, registry ids with `registry_digest`, base (commit, branch, worktree), and the fixed
human-only rules. `packet_hash` = SHA-256 over canonical JSON (sorted keys), so the same inputs
always give the same hash. Packets are stored by hash and never edited.

The packet records the Jira `updated` timestamps of the Story and each AC, and the digest of the
referenced registry entries. If either changes later, the packet is `STALE`: run `gov packet` to
regenerate it, give the new packet to the session, and use the new hash in later commit trailers.

## Verification registry

`verification-registry.json` (`gov-registry/1`) is the only source of commands gov executes.
Each entry: `id`, `description`, `argv`, `evidence_kind`, `timeout_ms`.

- `argv[0]` must be `node`; arguments are paths relative to the governed worktree.
- Executed with `spawn`, **no shell**: no pipes, globs, `&&`, environment expansion or redirection.
- Adding or changing an entry is a code change to this file and goes through normal code review.
  Jira only references ids; it can never supply a command.

## Evidence bundles

`gov verify` refuses a dirty tree. On a clean, committed HEAD it runs the scope check
(changed paths base..HEAD against Authorized / Prohibited Paths) and each registry id in order,
producing items `EV-1…` with exit code, timeout flag, `argv_digest` and the hash and size of the
captured log. The bundle (`gov-evidence/1`) is PASS only if scope is ok and every item passed.
It is stored under `GOV_HOME/evidence/` by `bundle_hash`; logs never leave `GOV_HOME`.

## BJC / JEV boundary

`gov judge` builds one bounded BJC request per AC and calls BJC `judge()`; it is the only way gov
reaches JEV.

- **JEV receives:** the AC statement, the Story invariants and summary, and evidence metadata
  (ids, kinds, results, hashes). **Never** code, diffs, logs, secrets or file contents.
- Model pinned to `jev-1.13.0`.
- **Deterministic precedence:** a deterministic FAIL stays FAIL whatever JEV says. CONTRADICTS on a
  deterministic PASS is `PASS_DISPUTED` (Jira `CONFLICT`) — a dispute for humans, not a failure
  or a pass. A JEV failure is `JUDGMENT_UNAVAILABLE`; no verdict is fabricated and nothing is written.
- `--write-back` uses the Phase 2 write-back unchanged (four advisory fields only). JEV Advisory
  Disposition stays human-only.

## Human gates

| Gate | Who |
|---|---|
| Creating Stories / ACs; changing Authorized Paths or Verification Requirements | Human (Jira) |
| Record Result (111): Kind, Deterministic Result, Evidence Kind, Evidence References | Human — values from `gov submit` |
| Record Verification (121): Verification / Disposition | Human decision |
| AC Verify (41), Story Gate Result (T1), Workstream (T2), Epic (T3) | Human |
| Merge / integration | Human, after `gov check-merge` passes |
| Release | Release Approvers |
| Deployment | Human, per deploy discipline |

`gov check-merge` passes only when: the binding exists; the packet hash matches; the evidence
bundle hash matches; HEAD equals the bundle's HEAD and the tree is clean; the deterministic result
is PASS; scope is ok; and the commit rule holds:

- **new task / `--base` attach:** at least one commit base..HEAD, every one carrying
  `Governed-By: OMNI-n` and `Gov-Packet: sha256:…`;
- **adopted Story:** the baseline equals the packet and binding base, is an ancestor of HEAD, and
  carries exactly `Governed-By: OMNI-n` with no `Gov-Packet`; every commit after it carries exactly
  `Governed-By: OMNI-n` and the exact `Gov-Packet` (zero governed commits is allowed).

Any mismatch, ambiguity or git error fails closed (exit 13). check-merge never merges.

## Prohibited

- Hooks, `claude-jev` routing, automatic or background JEV / gov invocation.
- Invoking JEV other than through `gov judge`; `--write-back` run by Claude.
- Any Jira transition, Record Result or Record Verification by gov or Claude.
- Merging, releasing or deploying by gov.
- Shell text in Verification Requirements; unreviewed registry entries.
- Editing files outside Authorized Paths or inside Prohibited Paths.
- Rewriting or editing Claude transcripts.
- Credentials, prompts, packets, logs or raw evidence in the repository or Jira.
- Editing `.claude/settings*` to bypass any of the above.

## Recovering from a failure status

| Status | Meaning | Recovery |
|---|---|---|
| `NOT_READY` (10) | Readiness findings | A human fixes the Story / ACs in Jira per each finding, then re-run. |
| `REFUSED` (11) | Precondition failed (dirty tree, wrong base, unknown registry id, HEAD not an adoption baseline, …) | Commit or clean the tree yourself — never via gov. For existing work, create the human adoption-baseline commit (`Governed-By` only). Fix the named precondition. |
| `STALE` (12) | Jira or registry changed after the packet | `gov packet`; hand the new packet to the session; use the new hash in trailers. |
| `INTEGRITY_FAILED` (13) | Packet / evidence / HEAD hash mismatch (e.g. commits after verify) | Re-run `gov verify` on the current HEAD and use the new bundle hash. |
| `VERIFICATION_FAILED` (14) | A registry command failed | Fix the code, commit, re-run `gov verify`. |
| `SCOPE_VIOLATION` (15) | Changes outside Authorized or inside Prohibited Paths | Revert those changes, or a human changes the Story's Authorized Paths (then `STALE` → regenerate). |
| `JUDGMENT_UNAVAILABLE` (16) | BJC / JEV did not complete | Retry later; deterministic evidence is unaffected. |
| `64` / `70` | Usage / unexpected error | Correct the arguments / inspect the error. |
