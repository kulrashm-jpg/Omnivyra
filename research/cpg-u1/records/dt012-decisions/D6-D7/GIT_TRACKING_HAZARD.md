# §10 — The git-tracking hazard: every ignored deliverable, and the minimum safe fix

**PROPOSAL ONLY. NOTHING WAS COMMITTED, AND NO `.gitignore` WAS MODIFIED.** No global gitignore rule was
changed. Every claim below is reproducible with `git check-ignore -v` and `git add -An` (dry run) in an
existing worktree at base `af2fb6e99ce461894bf16f18c2251f75088eba18`.

---

## 1. The reported case, verified

```
$ cd C:/tmp/dt4-sig
$ git check-ignore -v research/deeptech-operations/prereg-011/package/REGISTRATION_READINESS_PACKAGE.md
.gitignore:51:*_READINESS*.md   research/deeptech-operations/prereg-011/package/REGISTRATION_READINESS_PACKAGE.md
```

**Confirmed: `.gitignore:51 *_READINESS*.md` silently ignores the registration readiness package.**

**`*_PACKAGE*.md` is NOT a pattern — the earlier guess was wrong, and this is confirmed:**
`grep -n 'PACKAGE' .gitignore` returns **nothing**. The file is caught by `_READINESS`, not by `PACKAGE`.
This matters for the fix: `registration/REGISTRATION_PACKAGE.md` — the central registration document —
is **not** ignored, so the hazard is narrower than "all packages" and wider than "one file".

## 2. Why it is silent — the dry-run proof

In `C:/tmp/dt4-people`, whose `research/deeptech-operations` tree holds 56 files:

```
$ find research/deeptech-operations -type f | wc -l        →  56
$ git add -An research/deeptech-operations | wc -l         →  55
$ git add -An research/deeptech-operations | grep -c 'ROLE_DESCRIPTIONS'   →  0
```

**A bulk `git add` on the directory omits the ignored file, prints nothing about it, and exits 0.** There
is no warning, no summary line, no non-zero status. In a subtree where *every* deliverable happened to be
ignored, `git add -An` prints nothing at all and still exits 0 — verified in an isolated scratch repo.

By contrast, naming the file explicitly **does** fail loudly:

```
$ git add -An research/deeptech-operations/people/ROLE_DESCRIPTIONS.md
The following paths are ignored by one of your .gitignore files:
research/deeptech-operations/people/ROLE_DESCRIPTIONS.md
hint: Use -f if you really want to add them.
```

So the hazard is **specific to bulk adds**, which is how a wave's output is actually committed.

## 3. EVERY ignored deliverable — 15 collisions across five patterns

Measured by piping every file of `research/deeptech-operations` through `git check-ignore -v --stdin`,
across all nine populated worktrees, **and** by testing the staging corpus's filenames mapped to their
in-repo paths (so files not yet copied in are covered too).

| # | Pattern | Ignored deliverable | Present in-repo today? | Also stale-identity? |
|---|---|---|---|---|
| 1 | `.gitignore:50 *_CHECKLIST.md` | `dataset/ADMISSIBILITY_CHECKLIST.md` | yes | no |
| 2 | `.gitignore:50 *_CHECKLIST.md` | `registration/OPERATOR_CHECKLIST.md` | yes | **YES — 3 occ, CURRENT DOC** |
| 3 | `.gitignore:51 *_READINESS*.md` | `execution/EXECUTION_READINESS.md` | yes | **YES — 1 occ, CURRENT DOC** |
| 4 | `.gitignore:51 *_READINESS*.md` | `prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md` | yes | **YES — 4 occ, CURRENT DOC** |
| 5 | `.gitignore:51 *_READINESS*.md` | `prereg-011/package/REGISTRATION_READINESS_PACKAGE.md` | yes | no (correctly quotes it) |
| 6 | `.gitignore:55 *_REPORT.md` | `eight-person/DEEPTECH_PARALLEL_007_REPORT.md` | yes | YES — HISTORICAL |
| 7 | `.gitignore:55 *_REPORT.md` | `human-min/DEEPTECH_HUMAN_MIN_001_REPORT.md` | yes | YES — HISTORICAL |
| 8 | `.gitignore:55 *_REPORT.md` | `prereg-008/DEEPTECH_PARALLEL_008_REPORT.md` | yes | YES — HISTORICAL |
| 9 | `.gitignore:55 *_REPORT.md` | `prereg-009/DEEPTECH_PARALLEL_009_REPORT.md` | yes | YES — HISTORICAL |
| 10 | `.gitignore:55 *_REPORT.md` | `prereg-010/DEEPTECH_PARALLEL_010_REPORT.md` | yes | YES — HISTORICAL |
| 11 | `.gitignore:55 *_REPORT.md` | `prereg-011/DEEPTECH_PARALLEL_011_REPORT.md` | staging only | no |
| 12 | `.gitignore:55 *_REPORT.md` | **`DEEPTECH_PARALLEL_012_REPORT.md` — this wave's own report** | not yet written | n/a |
| 13 | `.gitignore:58 *_RUNBOOK*.md` | `registration/BITCOIN_RANDOMNESS_RUNBOOK.md` | yes | no |
| 14 | `.gitignore:77 ROLE_*.md` | `human-min/A-roles/ROLE_ELIMINATION_TABLE.md` | yes | YES — HISTORICAL |
| 15 | `.gitignore:77 ROLE_*.md` | `people/ROLE_DESCRIPTIONS.md` | yes | **YES — 1 occ, CURRENT DOC** |
| 16 | `.gitignore:12 *.log` | `prereg-009/orchestrator/MUTATION_RUN.log` | staging only | no |

**The brief's suspicion is correct: the wave report itself is caught.** Every DEEPTECH wave report from
007 onward is ignored by `*_REPORT.md`, and so is this wave's. **Six wave reports** — the primary
narrative record of the whole programme — are currently unversioned.

Patterns checked and found **not** to collide with anything in this tree: `*_SUMMARY.md`, `*_PLAN.md`,
`*_COMPLETION*.md`, `*_IMPLEMENTATION*.md`, `*_GUIDE.md`, `*_QUICK_*.md`, `PHASE_*.md`, `VALIDATION_*.md`,
`OPERATIONS_*.md`, `DEPLOYMENT_*.md`, `SESSION_*.md`, `REPORT_CARD_*.md`. There is no `*_REGISTER.md`
pattern, so `EXECUTABLE_PIN_REGISTER.md` and `PENDING_PERSONNEL_REGISTER.json` are safe.

### Compounding finding

**Four CURRENT DOC files are simultaneously stale-identity and untracked** (rows 2, 3, 4, 15). A file that
is both wrong and unversioned can be corrected in the final pass and then silently fail to be committed —
leaving the corpus looking corrected while the repository still holds nothing. **This is why the git fix
must land before the identity corrections, not after.**

Also note that `research/deeptech-operations` is **entirely untracked today** — `git ls-files
research/deeptech-operations` returns **0** in every worktree checked, and `git status --short` shows only
`?? research/deeptech-operations/`. So all 147+ paths currently exist only as working-tree copies across
eight worktrees. The 15 ignored files are the subset that would *still* be missing after someone finally
commits the tree.

---

## 4. Options compared

| Option | Fixes all 15? | Silent-failure risk after the fix | Verdict |
|---|---|---|---|
| **Rename the file(s)** — e.g. `REGISTRATION_READINESS_PACKAGE.md` → `REGISTRATION_PACKAGE_FINAL.md` | No — one file per rename, 15 renames, and every cross-reference in the corpus must be chased | **High.** The next new deliverable named `*_REPORT.md` or `*_CHECKLIST.md` is silently ignored again. It treats a class hazard as a series of accidents | **Rejected.** Also renames documents that other packages cite by name — including the wave reports, whose names are the programme's index |
| **`git add -f`** | Yes, per invocation | **High.** A human action that must be remembered on every commit, by every future agent, for files nobody can see are missing. The failure mode is exactly the one we are trying to remove | **Rejected** as the *mechanism*. Acceptable only as a one-off stopgap if the negation is deferred |
| **Relocate the tree** (e.g. out of `research/`) | No | — | **Rejected.** The offending patterns are unanchored (`*_REPORT.md` has no `/`), so git matches them at any depth. Relocation changes nothing. Verified |
| **Broaden — delete the patterns from the root `.gitignore`** | Yes | Low | **Rejected.** Those patterns exist to keep the repository lean (memory: repo leanness). Removing them un-ignores unrelated generated docs across the whole repo. Out of scope and explicitly prohibited |
| **Local (nested) `.gitignore` negation scoped to this subtree** | **Yes, all 14 `.md` collisions in one line** | **Low.** Declarative, committed with the tree, applies automatically to every future deliverable in it | ✅ **RECOMMENDED** |

### Why a negation works here, and the empirical proof

Git cannot re-include a file whose *parent directory* is excluded. Here nothing excludes a directory —
the collisions are all *filename* patterns — so a negation is effective. Verified in an isolated scratch
repo reproducing the five patterns:

```
before:  4 files present, 0 added by `git add -An`   (all silently ignored)
after :  `git add -An` adds the .gitignore + all 3 .md files
         `git check-ignore -v` reports the negation as the deciding rule for each
         *.log remains ignored — the negation is scoped to .md only
```

There is also direct in-repo precedent for scoped negation: `.gitignore:155–158` carries a commented
negation block for `research/cpg-u1/tooling/node_modules/`, added for exactly this reason (those bytes are
inside the tooling aggregate and must be tracked).

---

## 5. THE MINIMUM SAFE FIX — proposed change, not applied

**Exact file it would go in (a NEW file):**

```
research/deeptech-operations/.gitignore
```

**Exact contents:**

```gitignore
# DEEPTECH / CPG-U1 registration operations — every file in this subtree is registration
# evidence and must be version-controlled. The repository-root .gitignore excludes
# *_CHECKLIST.md (:50), *_READINESS*.md (:51), *_REPORT.md (:55), *_RUNBOOK*.md (:58) and
# ROLE_*.md (:77) by name, which silently omits 14 deliverables here — including every
# DEEPTECH wave report — from a bulk `git add`. This negation is scoped to this subtree
# only and changes nothing elsewhere in the repository.
!*.md
```

**The one operative line is `!*.md`.** Scoped, declarative, self-documenting, committed alongside the
deliverables it protects, and automatically covering future documents in this tree.

**Alternative placement, if a single root file is preferred** (same effect; direct precedent at
`.gitignore:157–158`) — append **after** line 77, or at end of file:

```gitignore
# Registration evidence: see research/deeptech-operations/. Must be tracked despite the
# *_CHECKLIST / *_READINESS / *_REPORT / *_RUNBOOK / ROLE_* patterns above.
!research/deeptech-operations/**/*.md
```

Both were verified to work. The nested file is preferred because its blast radius is provably confined to
one subtree: it cannot affect any path outside it even by mistake, whereas a root-file line sits in a file
that governs the whole repository.

### Deliberately NOT covered by `!*.md`

- `prereg-009/orchestrator/MUTATION_RUN.log` — ignored by `.gitignore:12 *.log`. It is certification
  evidence (the 404-mutant run), so it probably should be tracked, but a `!*.log` negation would also
  un-ignore any future incidental log dropped in this tree. **Separate, narrower decision:** either
  `!**/MUTATION_RUN.log` in the nested file, or rename the artefact to `MUTATION_RUN.txt`. Flagged, not
  decided.
- Nothing else. No `.json`, `.mjs`, `.sh`, `.jsonl` or `.txt` file in this subtree is ignored by any
  pattern — checked exhaustively.

### Verification step to record in the runbook

After the negation is in place, the check that must pass before any registration commit is declared
complete — it is cheap and it is the only thing that closes this hazard for good:

```
test "$(find research/deeptech-operations -type f | wc -l)" \
   = "$(git add -An research/deeptech-operations | wc -l)"
```

and

```
find research/deeptech-operations -type f | git check-ignore --stdin ; test $? -eq 1
```

(`git check-ignore` exits 1 when *nothing* matched — i.e. nothing is ignored.)

---

## 6. `git check-ignore` on this stream's own deliverables

Run in `C:/tmp/dt4-sig` on each file written by D-6/D-7:

| Deliverable | Result |
|---|---|
| `research/deeptech-operations/prereg-012/D6-D7/TOOL_VERSION_DECISION.md` | **not ignored** |
| `research/deeptech-operations/prereg-012/D6-D7/README_IDENTITY_DEFECTS.md` | **not ignored** |
| `research/deeptech-operations/prereg-012/D6-D7/STALE_IDENTITY_CORRECTION_MANIFEST.md` | **not ignored** |
| `research/deeptech-operations/prereg-012/D6-D7/GIT_TRACKING_HAZARD.md` | **not ignored** |
| `research/deeptech-operations/prereg-012/D6-D7/_manifest.tsv` | **not ignored** |

Names were chosen to avoid the patterns: none ends in `_REPORT.md`, `_CHECKLIST.md`, `_SUMMARY.md`,
`_PLAN.md`, `_READINESS*.md` or `_RUNBOOK*.md`, and none begins `ROLE_`. **The wave-012 report itself will
still be ignored** if it is named `DEEPTECH_PARALLEL_012_REPORT.md`, which is the strongest single reason
to land the negation in this wave.
