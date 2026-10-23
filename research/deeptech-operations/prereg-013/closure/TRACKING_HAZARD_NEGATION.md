# §10 — READINESS-PACKAGE TRACKING HAZARD: SCOPED LOCAL NEGATION

DEEPTECH-PARALLEL-013, closure stream. Worktree `C:/tmp/dt4-uncert`, base `af2fb6e99ce461894bf16f18c2251f75088eba18`.
**Nothing committed.** The change is one new file: `research/deeptech-operations/.gitignore`.
Verbatim before/after evidence: `negation-proof/PROOF_TRANSCRIPT.txt`.

---

## 1. THE HAZARD IS A CLASS, NOT A FILE

The root `.gitignore` carries **51 patterns ending in `.md`**, written to suppress generated operational
prose in the application repo. Five of them match names this research programme uses as **source**, plus
one `*.log` pattern that catches certification evidence:

| Root pattern | Line | What it swallows here |
|---|---|---|
| `*_CHECKLIST.md` | `.gitignore:50` | `OPERATOR_CHECKLIST.md` |
| `*_READINESS*.md` | `.gitignore:51` | `REGISTRATION_READINESS_PACKAGE.md`, `REGISTRATION_READINESS_TABLE.md` |
| `*_REPORT.md` | `.gitignore:55` | the whole `DEEPTECH_PARALLEL_0NN_REPORT.md` series (six wave reports) |
| `*_RUNBOOK*.md` | `.gitignore:58` | wave runbooks |
| `ROLE_*.md` | `.gitignore:77` | `ROLE_DESCRIPTIONS.md` |
| `*.log` | `.gitignore:12` | `MUTATION_RUN.log` — **deliberately left ignored, see §5** |

Wave 012's measurement of **16 collisions across five patterns** is the right shape of the problem: §10's
framing as "one file" understates it. Two corrections confirmed here:

- **`*_PACKAGE*.md` is NOT a pattern.** `grep -n "PACKAGE" .gitignore` returns nothing.
  `REGISTRATION_READINESS_PACKAGE.md` is caught by `*_READINESS*.md` at `:51`, not by any `PACKAGE` rule.
- **`research/deeptech-operations` is entirely untracked.** `git ls-files research/deeptech-operations`
  returns 0 paths. So nothing is being *lost from history* today; what is at stake is the first commit.

**Why silent is the dangerous part.** The `BEFORE` block of `PROOF_TRANSCRIPT.txt` shows a bulk add of the
whole tree: **63 files present, 56 staged, exit 0, no warning.** Seven files vanish with no diagnostic. A
bulk add is exactly how a wave's output gets committed, so silent loss is the *default* outcome, not an edge
case. Naming an ignored file explicitly fails loudly (exit 1 plus a hint) — but nobody names 60 files by
hand.

## 2. THE NEGATION

New file, **`research/deeptech-operations/.gitignore`**, operative line 20:

```
!*.md
```

The file is 27 lines; the rest is the reasoning, the five colliding patterns with their root line numbers,
and the explicit non-negation of `*.log`.

**It does not alter global gitignore behaviour.** A `.gitignore` is consulted only for paths at or below its
own directory. Every pattern in it is inert outside `research/deeptech-operations/`. The root `.gitignore`
is byte-unchanged; `.gitignore:50/51/55/58/77` still suppress `*_CHECKLIST.md`, `*_READINESS*.md`,
`*_REPORT.md`, `*_RUNBOOK*.md` and `ROLE_*.md` everywhere else in the repository, exactly as before.

**In-repo precedent for scoped negation:** root `.gitignore:153-158` — a four-line CPG-046 comment followed
by `!research/cpg-u1/tooling/node_modules/` (`:157`) and `!research/cpg-u1/tooling/node_modules/**` (`:158`),
un-ignoring the vendored dependency because it is inside the hashed tooling aggregate. Same technique, same
repository, already reviewed.

### Why one line and not five

An enumerated negation —

```
!*_CHECKLIST.md
!*_READINESS*.md
!*_REPORT.md
!*_RUNBOOK*.md
!ROLE_*.md
```

— is narrower in *what it re-includes* but **wider in residual risk**, and it was rejected for that reason.
It leaves the other ~46 `.md` patterns armed (`*_SUMMARY.md`, `*_PLAN.md`, `*_GUIDE.md`, `*_COMPLETION*.md`,
`*_IMPLEMENTATION*.md`, `VALIDATION_*.md`, `DEPLOYMENT_*.md`, `SESSION_*.md`, `OPERATIONS_*.md`,
`MONITORING_*.md`, `SRE_*.md`, ...), each of which fails in the same silent way the moment a future wave
names a file to match. Fixing a silent-loss hazard with a mechanism that can silently fail again is the
wrong trade. Markdown under this directory is source by construction — nothing generated lives here — so
`!*.md` states the actual invariant rather than an enumeration of today's accidents.

**Measured cost of the wider form:** it re-includes exactly **one** file that was previously ignored and is
not a canary — `prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md` — plus future `.md` files. It
re-includes no binary, no build output, no secret, no log. Nothing under this tree should be ignored except
logs, and logs are explicitly not negated.

**Rejected alternatives**, for the record: *renaming* the deliverables (mutilates the names the registration
package and the wave reports already cite); `git add -f` *per file* (works, is not durable, and fails the
first time someone bulk-adds); *relocating* the tree out of `research/` (moves the problem and breaks every
recorded path).

## 3. PROOF — `git check-ignore` AND DRY `git add`, BEFORE AND AFTER

Full verbatim transcript: `negation-proof/PROOF_TRANSCRIPT.txt`. It was produced by moving the new
`.gitignore` out of the tree, measuring, moving it back, and measuring again — so the BEFORE block is a real
measurement of the unfixed state, not a recollection.

Six canary files were created for the purpose, one per pattern, under
`negation-proof/` (the real §10 target name is among them):

```
REGISTRATION_READINESS_PACKAGE.md   CANARY_CHECKLIST.md   CANARY_REPORT.md
CANARY_RUNBOOK_A.md                 ROLE_CANARY.md        CANARY.log
```

### BEFORE — `git check-ignore -v`

```
.gitignore:51:*_READINESS*.md   research/.../prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md
.gitignore:12:*.log             research/.../negation-proof/CANARY.log
.gitignore:50:*_CHECKLIST.md    research/.../negation-proof/CANARY_CHECKLIST.md
.gitignore:55:*_REPORT.md       research/.../negation-proof/CANARY_REPORT.md
.gitignore:58:*_RUNBOOK*.md     research/.../negation-proof/CANARY_RUNBOOK_A.md
.gitignore:51:*_READINESS*.md   research/.../negation-proof/REGISTRATION_READINESS_PACKAGE.md
.gitignore:77:ROLE_*.md         research/.../negation-proof/ROLE_CANARY.md
exit=0
```

`git check-ignore --stdin` (without `-v`, which lists only paths that are *actually* ignored) returns the
same seven paths. All five `.md` patterns fire, at exactly the root lines named in §1.

### BEFORE — dry bulk add

```
$ find research/deeptech-operations -type f | wc -l     -> 63
$ git add -An research/deeptech-operations | wc -l      -> 56
$ git add -An research/deeptech-operations ; echo $?    -> exit=0    (silent; 7 files dropped)
```

### AFTER — `git check-ignore`

```
$ git check-ignore --stdin      (no -v: ONLY actually-ignored paths)
research/deeptech-operations/prereg-013/closure/negation-proof/CANARY.log
exit=0
```

**One path remains ignored, and it is the one intended to remain ignored.** All five `.md` canaries and
`REGISTRATION_READINESS_TABLE.md` are gone from the ignored set.

With `-v`, every `.md` under the tree now reports
`research/deeptech-operations/.gitignore:20:!*.md`. **Read that correctly:** `-v` prints the last *matching*
pattern, and a negation is a match — a line beginning `!` means the file is **NOT** ignored. This is the one
place a naive reading of `check-ignore -v` inverts the answer, which is why the `--stdin`-without-`-v` form
above is the authoritative test.

### AFTER — dry bulk add

```
$ find research/deeptech-operations -type f | wc -l     -> 64   (+1: the new .gitignore itself)
$ git add -An research/deeptech-operations | wc -l      -> 63
```

63 of 64. The single omission is `CANARY.log`, by design.

### The `.log` still fails loudly when named

```
$ git add -n research/deeptech-operations/prereg-013/closure/negation-proof/CANARY.log
The following paths are ignored by one of your .gitignore files:
research/deeptech-operations/prereg-013/closure/negation-proof/CANARY.log
hint: Use -f if you really want to add them.
exit=1
```

**Confirmed: `*.log` behaviour is what was intended.** It is still suppressed in bulk adds and still refuses
loudly when named, so nothing has been quietly decided about mutation logs.

## 4. THE EXCLUDED-DIRECTORY CAVEAT — DOES IT BITE?

Git will not re-include a file beneath an **excluded directory**, because it never descends into one. A
negation placed under such a directory is dead. Checked three ways; **the caveat does not bite.**

1. **The patterns in play are file patterns.** All six — `*_CHECKLIST.md`, `*_READINESS*.md`, `*_REPORT.md`,
   `*_RUNBOOK*.md`, `ROLE_*.md`, `*.log` — end in a literal extension and carry **no trailing slash**. None
   can match a directory name in this tree, so none can exclude a parent of the affected files.
2. **No ancestor is excluded — measured.** `git check-ignore -v` on each ancestor:

   ```
   research                                                        NOT IGNORED
   research/deeptech-operations                                     NOT IGNORED
   research/deeptech-operations/prereg-013                          NOT IGNORED
   research/deeptech-operations/prereg-013/closure                  NOT IGNORED
   research/deeptech-operations/prereg-013/closure/negation-proof    NOT IGNORED
   ```

   Separately, every trailing-slash (directory) pattern in the root `.gitignore` was listed — `.playwright-browsers/`,
   `.npm-cache/`, `tmp/`, `artifacts/`, `tmp_chrome_profile*/`, `tmp_report_inspection/`, the eleven
   `.governance-*/`, `.cert-supabase/`, `scripts/governance-baseline/reports/`,
   `architecture-migration/reports/`, `supabase/.temp/`, `test-results/` — and **none** matches any component
   of `research/deeptech-operations/...`.
3. **Empirically it took effect.** Six files moved out of the ignored set. Had an ancestor been excluded,
   git would never have consulted the nested `.gitignore` at all and the AFTER measurement would be
   identical to BEFORE. It is not.

**Fallback, recorded in case a future pattern ever does exclude an ancestor** (it would have to be a new
root pattern matching `research`, `deeptech-operations`, or a wave directory): the negation must then be
placed in the **root** `.gitignore` as a directory re-inclusion pair, following the CPG-046 precedent
verbatim —

```
!research/deeptech-operations/
!research/deeptech-operations/**
```

— which is wider than a scoped file, and is therefore not what is proposed now.

## 5. `MUTATION_RUN.log` — OWNER DECISION REQUIRED

```
OWNER DECISION REQUIRED: whether *.log under research/deeptech-operations is tracked.
```

**Not decided here, and deliberately not negated.** It is a separate and narrower question from the
documentation class: a mutation log is large, churning, machine-generated, and it is arguable whether it is
certification *evidence* (belongs in the record) or a *by-product* (belongs in an artefact store with only
its hash in the record). Bundling it into a one-line `.md` negation would smuggle that judgement past the
owner.

Interim handling, which is safe either way: name such a file explicitly (`git add -f <path>`), which fails
loudly rather than silently, or keep it out of git. Nothing about the current decision forecloses either
answer.

## 6. AGGREGATE EFFECT AND COMMIT STATUS

> **Does §10 move the aggregate? NO.**

`toolingManifest(root)` (`lib/aggregate.mjs:8-23`) hashes only files beneath `dirname(cpg_u1_data.mjs)` —
the tooling tree. `research/deeptech-operations/.gitignore` and everything under `prereg-013/closure/` are
outside it. A `.gitignore` is in any case invisible to the aggregate, which walks the filesystem directly
and does not consult git. **Mutation-count effect: none.** The live mutation run is unaffected.

> **NOT COMMITTED.** `git add` was invoked only with `-n` / `-An` (dry run) throughout; the index was never
> written. Nothing was staged, committed or pushed.
