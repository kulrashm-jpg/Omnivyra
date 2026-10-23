# The corpus is split — measured, and the orchestrator's disposition

The sweep applied corrections to the `C:/tmp/dt00*` staging trees. The untracked **worktree twins** were
outside its write authority and still hold the superseded digest. Measured myself:

| worktree | files still pinning `f7699f05` | | staging tree | `f7699f05` left | `<NEW_AGG>` written |
|---|---|---|---|---|---|
| `dt4-people` | **34** | | `dt004-operations` | 3 | 32 |
| `dt4-frame` | **20** | | `dt006-human-min` | 33 | **0** |
| `dt4-reg` | **19** | | `dt007-eight-person` | 10 | 22 |
| `dt4-uncert` | **18** | | `dt008-prereg` | 6 | 35 |
| `dt4-corp` | **17** | | `dt009-closure` | 15 | 1 |
| `dt4-exec` | **14** | | | | |
| `dt4-sig` / `dt4-legal` | 3 / 2 — correct *reports* of the defect | | | | |

**122 files across six worktrees.** `dt006-human-min`'s 33 with zero placeholders is expected and correct —
that wave's material is HISTORICAL, plus the three transposed-abbreviation files deliberately held.

## Disposition: the staging roots are the corpus of record. Do NOT separately correct the twins.

Three reasons, and the third is decisive:

1. **The twins are disposable by construction.** Every stream's own sign-off classifies its `dt4-*`
   worktree DISPOSABLE, and wave 012 measured `research/deeptech-operations` as **entirely untracked**
   (`git ls-files` → 0) in every worktree. They carry no git history worth preserving.
2. **The staging roots are where the material has been collected** wave after wave, and where the sweep
   was applied.
3. **Correcting both creates exactly the desync this wave exists to close.** Two copies each needing the
   `<NEW_AGG>` → final-digest substitution is two chances to substitute inconsistently. One corpus,
   substituted once, is the only arrangement that cannot drift.

**I am not deleting anything.** Retiring the worktrees is destructive and outward-facing enough to need
your word, and several still hold this wave's only copies of deliverables. Recorded as a recommendation:
after the deliverables are collected, the `dt4-*` worktrees can be removed with
`git worktree remove … --force`, which would eliminate all 122 stale pins at a stroke.

## The one hazard that is not merely duplication

`dt4-corp` holds twins of `prereg-008/H-automation/tools/{bind,instrument}.mjs` — **executables on the
certification path**. A person or script pointed at the worktree copy instead of the staging copy gets the
stale pin and a stale gate. That is a live footgun, not a bookkeeping nuisance.

Until the worktrees are retired, the rule is: **the certification path runs from `C:/tmp/dt00*` only.**
Nothing under `dt4-*` is an instrument or a gate; it is documentation staging.

## A correction to what my own earlier verification established

I reported the sweep's occurrence total as "321, verified from the manifest". The sweep has now found the
true count is **325** — the manifest undercounts three CUR_DOC files
(`SECTION_4A3_VERIFICATION.md` 1→3, `TOOLING_GAP_AUDIT.md` 2→3, `REGISTRATION_READINESS_TABLE.md` 4→5).

So what I actually verified was the manifest's **internal arithmetic** — that its rows summed to its stated
total — **not its accuracy against the corpus.** Those are different claims and I stated the stronger one.
Corpus membership (167 files) is unaffected; only the occurrence count moves.

This is the same lesson as the header-less TSV and the `check-ignore -v` inversion: a measurement can be
internally consistent and still wrong about the world. Recomputing a document's own sum verifies the
document, not the thing it describes.

## What the sweep did establish, and I re-verified

Over the full current code set — 14 CUR_EXEC + 4 CUR_TEST + the import-inheriting 30th — **zero** files and
**zero** occurrences of `f7699f05…`, the transposed `…5eb04e5cc5dd`, the obsolete 593-file identity, or an
obsolete tooling version. And **no stale reference lives inside any instrument tree** (`dt009-merge` 594,
`dt002` 593, `dt013-candidate` 595, in-repo `research/cpg-u1` 588 — all zero), which is what makes the sweep
**aggregate-neutral**. Only the prepared README corrections move the aggregate.

Two deliberate mechanics worth preserving in the record: the provenance banner is **appended at EOF, never
inserted**, so no existing `file:line` citation in the wave-010/011/012 audits was invalidated; and the
placeholders are string literals, so every file still parses (`node --check` clean, `JSON.parse` clean)
while **failing closed**. The executables now refuse every tree including the candidate — correct for a
pre-registration gate, and the reason nothing in these trees is runnable end-to-end until substitution.

**Every corrected file carries `<NEW_AGG>`/`<NEW_N>` and none is internally consistent. No provisional
digest was written anywhere.** The substitution pass remains required, and must run after the single
recomputation — not before.
