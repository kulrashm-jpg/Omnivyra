# gov automation policy (OMNI-44)

This policy says what the `gov` tooling may do on its own and what only a human may do. It is
reviewed like code. Its digest is one of the identity dimensions of evidence freshness: evidence
produced while a different version of this file was in force is STALE (see *Stale evidence*).
Changing this file therefore invalidates existing evidence, by design.

The digest is the sha256 of this file's text with CRLF normalized to LF
(`lifecycle.ts policyDigest`). The version in force is the copy next to the `gov` CLI being run. The
version that applied to a piece of evidence is the copy at that evidence's HEAD commit.

## Permitted automation

Every command below runs only when a person, or a Claude Code session the person is driving,
invokes it explicitly. Nothing runs in the background, on a hook, on a schedule or as a side effect of
another command.

| Command | May do | Writes |
| --- | --- | --- |
| `gov packet` / `start` / `attach` | read Jira (reader identity), store a packet, append a binding | GOV_HOME only |
| `gov verify` | run registry commands only, on a clean committed HEAD | evidence + logs in GOV_HOME |
| `gov judge` | ask JEV for an advisory judgment through BJC | JEV advisory fields only with `--write-back` (a human action) |
| `gov submit` | print per-AC values for a human to record | nothing |
| `gov check-merge`, `gov audit-branch`, `gov admit` | read and report | nothing |
| `gov reconcile` | read the ledger, stored evidence, git and Jira; evaluate each AC; print a proposed change set | nothing |
| `gov intake` | classify and store a proposal | GOV_HOME only (`--apply` is a human action) |

## Prohibited side effects

No automated `gov` path may:

- write Jira, except the four JEV advisory fields through `gov judge --write-back`, which a human
  runs. In particular it may not record a Deterministic Result, Evidence References, Verification,
  Disposition or Gate Result, and may not perform any transition.
- create commits, merge, push, release or deploy.
- invoke JEV, except through `gov judge`. `gov reconcile` and the lifecycle engine never reach JEV.
- rewrite or delete a packet, a binding, an evidence bundle or a log. The ledger is append-only, and
  stored artifacts are content-addressed and re-hashed on every read.
- apply a reconcile proposal. `gov reconcile` has no apply mode. A human makes every change it
  proposes, in Jira, under their own identity.
- edit `.claude/settings*`, register hooks, or rewrite Claude transcripts.

## Per-AC evaluation

Each Acceptance Criterion is evaluated on its own against the registry id that proves it: the
`Registry check <id> passes` statement written by `gov intake`, or else the unique packet registry id
that produces the AC's evidence kind. A bundle-wide PASS is never assigned to an AC. If the mapping is
ambiguous or contradictory, a human decides; gov does not guess.

| State | Meaning |
| --- | --- |
| `VERIFIABLE` | fresh, intact evidence; the AC's own item passed |
| `FAILED` | fresh, intact evidence; the AC's own item failed |
| `STALE` | evidence exists, but at least one identity dimension moved |
| `INSUFFICIENT_EVIDENCE` | no usable evidence for this AC: missing, not intact, or no item |
| `NEEDS_HUMAN` | Judgment AC, or an AC that cannot be mapped to a single registry id |
| `CONFLICT` | sources disagree: statement vs packet, duplicate items, or result vs exit code |

Missing evidence never passes. Objective results and human judgment are kept apart: a Judgment AC
never receives a deterministic result from gov.

## Stale evidence

Evidence is current only while every identity dimension still matches:

1. **bundle hash**: the bundle is the Story's current (latest verified) bundle, and it re-hashes intact;
2. **governed HEAD**: the worktree is still at the bundle's HEAD, with a clean tree;
3. **packet hash**: the bundle, the binding and the stored packet agree, and the packet still matches Jira;
4. **verification-registry digest**: the registry entries the packet names are unchanged;
5. **automation-policy digest**: this policy is unchanged since the evidence was produced;
6. **session/Story binding**: the Story's latest binding has the bundle's worktree, branch and base.

When any dimension moves, the evidence is STALE and is never treated as current, whatever its
result. If Jira cites stale evidence, `gov reconcile` proposes INVALIDATE_STALE_EVIDENCE: a human
clears the recorded result, or replaces it with fresh per-AC values, and resets a recorded
Verification to UNVERIFIED. Re-running `gov verify` on the new HEAD produces fresh evidence.

## Human decision boundaries

Only a human:

- creates or edits Stories and Acceptance Criteria (Authorized Paths, Verification Requirements);
- records Deterministic Result and Evidence References ("Record Result"), using the values that
  `gov submit` or `gov reconcile` print;
- records Verification / Disposition ("Record Verification"), and decides every Judgment AC;
- resolves every reconcile CONFLICT, HUMAN_DECISION and INVALIDATE_STALE_EVIDENCE proposal;
- runs `gov judge --write-back` and `gov intake --apply`;
- makes the adoption-baseline commit.

JEV is advisory only. Its verdict is reported next to the deterministic state and never changes that
state, a reconcile disposition or a proposal.

## Integrate and Release boundaries

Integrate, Release and deployment are human-only transitions. No gov command performs them,
proposes them, or treats a reconcile NO_OP as permission for them. `gov check-merge` is a read-only
gate for a human or CI, and it never merges. Policy: integrate a Story only after a human has
recorded results and verification that cite fresh evidence. A reconcile run that proposes nothing for
any AC is the read-only way to confirm this. Jira does not enforce this rule: Integrate has no
transition condition (HARNESS-CERTIFICATION.md, H-13). The human remains the gate.
