# §10 — the tracking hazard is not one file; the whole DeepTech record is unversioned

§10 names `REGISTRATION_READINESS_PACKAGE.md`. Measured, the exposure is **much wider**, and it has two
independent causes that point the same way. Read-only measurement; nothing committed, no gitignore
changed.

## Cause 1 — `*_REPORT.md` is a live ignore pattern

```
$ git check-ignore -v research/deeptech-operations/prereg-012/DEEPTECH_PARALLEL_012_REPORT.md
.gitignore:55:*_REPORT.md   research/deeptech-operations/prereg-012/DEEPTECH_PARALLEL_012_REPORT.md
```

`.gitignore:55 *_REPORT.md` is not about this programme, but it catches **every wave report it has ever
produced**. So the file §10 worries about is one instance of a class:

| deliverable name | verdict |
|---|---|
| `DEEPTECH_PARALLEL_012_REPORT.md` | **IGNORED** — `.gitignore:55 *_REPORT.md` |
| `REGISTRATION_READINESS_PACKAGE.md` | **IGNORED** — `.gitignore:51 *_READINESS*.md` |
| `EXECUTABLE_PIN_REGISTER.md` | ok |
| `DECISION_REGISTER.md` | ok |
| `OWNER_DECISION_SHEET.md` | ok |

Confirming an earlier correction: **`*_REGISTER.md` is not a pattern** — the register files are visible
to git. `*_PACKAGE*.md` is not a pattern either; the readiness package is caught by the READINESS rule,
not a PACKAGE one.

Live patterns that bite our filenames: `.gitignore:50 *_CHECKLIST.md` · `:51 *_READINESS*.md` ·
`:54 *_SUMMARY.md` · `:55 *_REPORT.md` · `:57 *_PLAN.md` · `:58 *_RUNBOOK*.md` · `:77 ROLE_*.md`.
That last one matters for the **seven role packets** the sweep identified.

## Cause 2 — and this is the larger one: none of it is in a repo at all

```
git ls-files | grep -c DEEPTECH_PARALLEL      →  0
ls /c/tmp/dt0*/DEEPTECH_PARALLEL_*REPORT.md   →  5
/c/tmp/dt011-closure   → NOT A REPO
/c/tmp/dt012-decisions → NOT A REPO
```

**Zero** `DEEPTECH_PARALLEL*` files are tracked in `C:/virality`. **Five** wave reports exist, all under
`C:/tmp/`, and the wave-011 and wave-012 preservation roots are **not git repositories**. (`dt002` and
`dt009-merge` are each their own repo, so material there has some local history — still in `C:/tmp`.)

So the record is not "at risk of being dropped on commit". It has **never been committed**, and the
ignore rule means a well-intentioned attempt to rescue it by `git add` would **silently swallow the
reports while appearing to succeed** — the failure mode this programme keeps meeting: a plausible green
that is wrong.

Compounding it: wave 011 established that `research/deeptech-operations/` returns **0** from
`git ls-files` in every worktree, so the streams' own deliverables are untracked too, and the
`dt4-*` worktrees are explicitly disposable. By contrast `research/cpg-u1/` **is** tracked — 588 files —
which is exactly why the 587-file `640510782a…` tree is the trap: it is the only instrument tree git
hands you, it is in every checkout, and nothing in the repo marks it superseded.

## Proposed remedies — recorded as proposals only, nothing applied

§10 asks for the **minimum safe way** the final package cannot silently disappear, and forbids changing
global gitignore rules.

| option | effect | verdict |
|---|---|---|
| **Rename** (`…_PACKAGE.md` → `…_PACKAGE_REGISTER.md`, reports → `…_RECORD.md`) | sidesteps the patterns with no gitignore change | **smallest and safest**; costs a filename the directives have been quoting |
| **Local `.gitignore` negation** in `research/deeptech-operations/` | one file, scoped, no global change | **recommended if the names must stay** — exact lines below |
| `git add -f` | works once, per file, silently forgotten next time | **reject** — relies on memory at exactly the moment memory fails |
| Relocate outside ignored paths | large churn, breaks every recorded path | reject |

Proposed local negation, to live at `research/deeptech-operations/.gitignore` — **not created**:

```gitignore
# This tree is the DeepTech documentary record. The repo-root patterns
# *_REPORT.md / *_READINESS*.md / ROLE_*.md are meant for generated
# release scratch, not for it. Re-include it here only.
!*_REPORT.md
!*_READINESS*.md
!ROLE_*.md
```

**Caveat that must be verified before adopting it:** a negation cannot re-include a file if a **parent
directory** is itself excluded — git never descends into an excluded directory. The patterns above are
file patterns, so this should work, but it must be proven with `git check-ignore -v` **and** a dry
`git add -An` after the file exists, not assumed. That verification is engineering work and belongs to
the next wave.

## Status

**OWNER DECISION REQUIRED** — which remedy, and whether the DeepTech record should be committed to
`C:/virality` at all. That second question is the real one: it is a decision about whether this
programme's documentary record becomes durable, and nothing in this wave is authorised to commit
anything. Recorded, not acted on.
