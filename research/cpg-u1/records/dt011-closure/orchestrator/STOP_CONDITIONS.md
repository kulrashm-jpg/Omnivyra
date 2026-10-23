# DEEPTECH-PARALLEL-011 — stop conditions fired, reported before any edit

Two of this directive's own §16 stop conditions fire, and a third structural collision underlies both. **No file in the
running mutation suite's working tree has been touched.**

## Verified state at task start

```
mutation suite            : STILL RUNNING (9 node processes)
its working tree          : C:/tmp/dt009-merge/tooling
candidate aggregate       : 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2  (594 files)
```

## STOP 1 — "DR-11 is not explicitly resolved"

§16 lists this verbatim as a stop condition. I extracted the decision text from the latest artefacts rather than
inferring it from the prompt, as §2 requires. The record says:

> **DR-11** — the same last-value-wins collapse at `cpg_u1_data.mjs:113`, `new Map(scan.results.map(...))`, inside
> `contamination()` which nine commands use; **VERIFIED to exist by me**; one line closes it; needs a hand-edited
> artefact, so a different threat model from DR-10.

That is a **finding plus a recommendation**. Nowhere in the record is there an owner resolution. Per §2 — "If it
contains only a recommendation, report it as OWNER DECISION REQUIRED" — **DR-11 is OWNER DECISION REQUIRED**, and §16
therefore says report rather than edit.

The same is true of `EVIDENCE_SCHEMA`. The record says it "was **not** bumped `/v1` → `/v2` … The brief said to infer
nothing further, so it stopped — and bumping it later is another aggregate-moving edit." §8 of this directive says to
change it only "if the DR explicitly requires a schema change". It does not. **OWNER DECISION REQUIRED.**

## STOP 2 — "current mutation worktree would be affected"

§3 (DR-12 fix), §7 (`TOOL_VERSION`), §9 (README) and §11 (executable pins) all require edits to files that live
**inside `C:/tmp/dt009-merge/tooling`** — the tree the mutation suite is reading right now. `README.md` and
`TOOL_VERSION` are both inside the aggregate; so is `lib/registration.mjs`.

§14 forbids modifying files underneath the running suite's working tree. So those edits cannot be applied in place.

## The structural collision underneath both — the finding that matters most

**Every one of the five decisions moves the tooling aggregate. The suite now running is certifying `638d68e6…`.
Any of them lands ⇒ that certification describes a tree that no longer exists.**

So there are exactly two coherent orderings, and only the owner can choose:

| | Path A — finish first | Path B — decide first |
|---|---|---|
| Let the current run complete | yes, certifies `638d68e6…` | no, ~N hours discarded |
| Apply the five decisions | after it finishes | now |
| Mutation runs needed | **two** (~36 h) | **one** (~18 h) |
| Risk | the certified tree is immediately superseded | the hours already spent are lost |

**And a third, worse ordering must be avoided:** applying only *some* decisions now (say DR-12 and README) produces an
aggregate that will be superseded again when DR-11 and `EVIDENCE_SCHEMA` are ruled on — costing a **third** run. Since
two of the five are unresolved, **any edit today guarantees at least one extra certification cycle.**

## What I am therefore doing, and not doing

**Not doing:** applying any aggregate-moving edit anywhere, including in a fresh candidate tree. Creating a new
candidate now would invite exactly the premature certification the paragraph above warns about, and would produce a
fourth aggregate value to track.

**Doing instead** — all of it read-only against the candidate, or in throwaway scratch copies that no certification path
consumes:

1. **DR-12** — prepare the minimum normalisation fix and its targeted tests as a **reviewable patch**, proven by
   applying it to a scratch copy and running only the targeted checks. §3 gives explicit requirements for this fix, so
   the *content* is authorised; the *application point* is not, while the suite runs.
2. **The 133-file sweep and the 23 executable pins** — classification is entirely read-only and is the bulk of §10/§11.
   Nothing needs an aggregate change to be *identified*.
3. **README, `TOOL_VERSION`, `EVIDENCE_SCHEMA`** — determine the one canonical answer for each and prepare the exact
   text, without applying it.
4. **VP-2, `enumerated_by`, the registration verifier** — verification only; these need no edit.
5. **Contamination carrier** — a genuine determination from the frozen protocol: does it already specify where late
   contamination must be disclosed? If not, §6 says stop and record, which I will.

The deliverable is a candidate that can be finalised in **one** edit session followed by **one** certification run, once
the owner has ruled on all five.
