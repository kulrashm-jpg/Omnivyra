# §9 — The 4 UNKNOWN files, the 12 transposed abbreviations, and every OWNER DECISION REQUIRED item

**Wave:** DEEPTECH-PARALLEL-013, identity-sweep stream. **Base SHA:** `af2fb6e99ce461894bf16f18c2251f75088eba18`.
**Nothing in this file was decided by this stream. None of the files named here was edited.**

---

## A. The 4 UNKNOWN files — STOPPED AND INSPECTED, NOT GUESSED

All four are **re-runnable synthetic-fixture reproducibility harnesses** for waves whose transcripts are
already committed deliverables. Each prints an expected baseline and **continues** rather than refusing —
which is why they are neither CURRENT EXECUTABLE (they gate nothing) nor comfortably HISTORICAL (they
re-run, and the 8-person model they support *is* authorised). Each was read this wave. **None was edited.**

### UNKNOWN-1 · `eight-person/E-scan-sufficiency/RUN.sh` — `:6`, `:29` (2 occ)

`:6` documents `INSTRUMENT` as "a byte-identical copy of `C:/tmp/dt002/research/cpg-u1/tooling`
(593 files, aggregate `f7699f05…`)". `:28` performs a **live recomputation** with the instrument's own
`lib/aggregate.mjs`, then `:29` prints `expected: 593 files, f7699f05…`. Against the candidate it prints a
flat self-contradiction and **exits 0**.

**RECOMMENDATION — annotate as HISTORICAL; do not update the expected values.** The script's contract is
"a byte-identical copy of the 593-file tree", stated in its own header, and the fixtures it builds were
built by that tree's modules. Repointing it at a different tree is not the same experiment. One header line
("this harness reproduces the DEEPTECH-PARALLEL-007 measurement against the superseded 593-file tree; it is
a closed record and is not to be re-run against the registered instrument") closes it honestly.
**OWNER DECISION REQUIRED.**

### UNKNOWN-2 · `eight-person/E-scan-sufficiency/make_fixtures.mjs` — `:7` (1 occ)

Provenance comment only. The file performs **no** comparison; it imports the instrument's `schema`,
`canonical` and `csv` modules to build synthetic fixtures.

**RECOMMENDATION — lowest risk of the four; annotate as HISTORICAL alongside UNKNOWN-1.** The comment is a
statement about which tree built the fixtures that exist on disk today, and that statement is **true**.
Substituting `<NEW_AGG>` would make it false. If the owner rules wave-007 reproducibility a live path, this
file needs regeneration of its fixtures, not a string edit. **OWNER DECISION REQUIRED.**

### UNKNOWN-3 · `eight-person/G-timeline/g_calendar.mjs` — `:271` (1 occ)

`EXPECT_AGG` at `:271`; `:274` prints `MATCH` / `*** MISMATCH ***` for the aggregate and `:275` the same
for `agg.n === 593`. It **does not abort**. It re-implements the §19.1/§24 aggregate recipe independently
rather than importing `lib/aggregate.mjs`.

**RECOMMENDATION — this is the one with a genuine case for being a LIVE path, and it is the one to update.**
The 8-person model is authorised and its calendar arithmetic is forward-looking, not a closed measurement.
Update `:271` to `<NEW_AGG>` and `:275`'s `593` to `<NEW_N>` **in the substitution pass**, and change the
two prints from advisory to `process.exit(1)` so it stops printing a contradiction and exiting 0. Its
independent re-implementation of the recipe is a *feature* — it cross-checks `lib/aggregate.mjs` — and is
worth keeping alive. **OWNER DECISION REQUIRED.**

### UNKNOWN-4 · `prereg-008/B-cmdscan/RUN.sh` — `:8`, `:29` (2 occ)

Same shape as UNKNOWN-1. **It also carries a hazard neither prior wave recorded, and it decides the case:**

`:35` reads the instrument by **line number** — `sed -n '230,234p' "$INSTRUMENT/cpg_u1_data.mjs"` — to
display "the defect, read out of the frozen source" for DR-10. Measured this wave:

| Tree | `cpg_u1_data.mjs:230–234` |
|---|---|
| `dt002` (593 files — the tree it was written against) | `const frame = loadCsv(need(o, 'frame'), FRAME_COLUMNS);` … the `cmdScan` body, i.e. the intended target |
| `dt013-candidate` (595 files) | `const res = evaluate(reg, readJson(need(o, 'evidence')), stage, …);` — **completely unrelated code** |

**RECOMMENDATION — annotate as HISTORICAL. Do NOT merely update the expected digest.** Updating only the
aggregate would make the script *look* current while its line-number read silently displays the wrong five
lines and the transcript would assert a defect demonstration it did not perform. That is strictly worse
than an honest contradiction. If the owner wants it live, it needs its `sed` replaced by a pattern match,
not a digest edit. **OWNER DECISION REQUIRED.**

### Either way

The committed transcripts stay untouched as HISTORICAL:
`eight-person/E-scan-sufficiency/out/TRANSCRIPT.txt`, `prereg-008/B-cmdscan/out/TRANSCRIPT.txt`,
`eight-person/G-timeline/RUN_OUTPUT.{json,txt}`. Verified: none was modified by this pass.

---

## B. The transposed abbreviation — **12 files, confirmed by re-measurement**

`f7699f05…5eb04e5cc5dd` is wrong; the real digest ends `…dbb04e5cc5dd` (`dbb0` → `5eb0`). It is a suffix of
**neither** instrument tree, so a human verifying against it **fails against both**. Measured this wave —
exactly 12 defect sites, plus 8 sites in wave-011/012 files that *report* the defect and are correct:

| # | File | Line | Class | Disposition in this pass |
|---|---|---|---|---|
| 1 | `people/ELIGIBILITY_AND_ASSIGNMENT_WORKFLOW.md` | 8 | CUR_DOC | **CORRECTED** → `<NEW_AGG>` |
| 2 | `people/HUMAN_DEPENDENCY_MAP.md` | 7 | CUR_DOC | **HELD — OWNER DECISION REQUIRED (see §C)** |
| 3 | `people/INDEPENDENCE_DECLARATION_TEMPLATE.md` | 9 | CUR_DOC | **CORRECTED** |
| 4 | `people/RATER_PACKET_INSTRUCTIONS.md` | 9 | CUR_DOC | **CORRECTED** |
| 5 | `people/RATING_ADJUDICATION_PACKET.md` | 9 | CUR_DOC | **CORRECTED** |
| 6 | `people/REFERENCE_ADJUDICATION_PACKET.md` | 9 | CUR_DOC | **CORRECTED** |
| 7 | `people/REFERENCE_TEAM_PACKET.md` | 9 | CUR_DOC | **CORRECTED** |
| 8 | `reference/tools/blind_record_precheck.mjs` | 8 | **CUR_EXEC** | **CORRECTED** (comment; the file is an executable) |
| 9 | `reference/tools/README.md` | 30 | CUR_DOC | **CORRECTED** — it stated a *release gate* with an unmatchable value |
| 10 | `human-min/B-reference/COVERAGE_COST_ARITHMETIC.md` | 219 | HISTORICAL | **NOT TOUCHED** — see below |
| 11 | `human-min/B-reference/REFERENCE_TWO_HUMAN_ANALYSIS.md` | 376 | HISTORICAL | **NOT TOUCHED** |
| 12 | `human-min/B-reference/RESOLUTION_RULE_ASSESSMENT.md` | 7 | HISTORICAL | **NOT TOUCHED** |

**Seven of the twelve are the `dt004-operations/people/` role packets — documents humans read in order to
verify the instrument** — and six of those seven are now corrected.

**On entries 10–12, this stream deliberately did not follow D-7's recommendation.** D-7 argued a
typographic error is not a historical fact and should be fixed even in historical files. That reasoning is
sound, but the directive for this stream says plainly **HISTORICAL — do not rewrite**, and these three sit
inside the `human-min/` wave, which is historical both by label and by decision (the two-human model was
found not defensible). Repairing a typo there would also require choosing what to write — the *historical*
digest marked superseded, not `<NEW_AGG>` — which is a different edit from the one this pass performs
everywhere else. **Recommend the owner authorise a one-line typo repair to the historical `…dbb04e5cc5dd`
value, explicitly marked superseded, as a separate act. Not done here. OWNER DECISION REQUIRED.**

Not in the 12 and correct as written, because they *report* the defect:
`dt011-closure/DEEPTECH_PARALLEL_011_REPORT.md:198`, `dt011-closure/sweep/EXECUTABLE_PIN_REGISTER.md:40`,
`dt011-closure/sweep/UPDATE_SET.md:127,:129`, and the wave-012 D6–D7 documents.

---

## C. OWNER DECISION REQUIRED — the complete list

### C-1 · `people/HUMAN_DEPENDENCY_MAP.md:7` — a verification claim over an unverifiable value · **HIGHEST**

The line reads (verbatim, digest abbreviated as the file has it):
`… aggregate `f7699f05…5eb04e5cc5dd` (VERIFIED by recomputation).`

**It claims verification by recomputation of a digest that matches no tree in existence.** Recomputation
cannot have produced it. This is the only file in the 91-file CURRENT set that this stream **refused to
correct**, and the refusal is the point: substituting `<NEW_AGG>` would leave "(VERIFIED by recomputation)"
attached to a value nobody has recomputed, silently converting a broken claim into a fresh false one.
**The claim must be re-attested by whoever made it, not relabelled by a sweep.** The file is unchanged.
**Required of the owner:** identify the attester, have them state what was actually recomputed and against
which tree, then either re-attest against the post-substitution value or withdraw the parenthetical.

### C-2 · The 4 UNKNOWN files — closed record, or live reproducibility path?

Per-file recommendations in §A: **HISTORICAL for UNKNOWN-1, -2 and -4** (UNKNOWN-4 decisively, because of
its line-number read into the instrument), **LIVE and updated for UNKNOWN-3** (`g_calendar.mjs`, plus a
change from advisory print to non-zero exit). The owner may rule them as a block; this stream recommends
against it, because they do not have the same status.

### C-3 · The transposed abbreviation in the 3 historical `human-min/B-reference/` files

Authorise (or decline) a typo-only repair to the historical `…dbb04e5cc5dd`, marked superseded. §B.

### C-4 · Authority to open the in-tree README edit session at all

It moves the registered identity and forces the 404-mutant certification suite to be re-run once against
the post-edit tree. `README_PATCH.diff` is prepared and **not applied**. No such authority exists as of
this writing.

### C-5 · The Option A / Option B evidence-schema choice, which the README patch depends on

Defect 8's hunk is written as **Option A** (`cpg-u1-sampling-evidence/v1` deliberately frozen despite DR-1
breaking the beacon shape). Under **Option B** that hunk must be replaced by a mechanical `/v1` → `/v2`
change at `README.md:92, :176, :187` plus `lib/sampling.mjs` and `test/selftest.mjs`. **Do not apply that
hunk before the choice is recorded.**

### C-6 · The 5 worktree-only HISTORICAL files, for completeness

`prereg-010/B-leaves/{OWNER_INPUT_SHEET,VERIFIER_MESSAGING_NOTES,VERIFIER_REHEARSAL}.md` live in
`C:/tmp/dt4-uncert` and `prereg-010/F-manifest/{ARTEFACT_MANIFEST,SUPERSEDED_VALUES}.md` in
`C:/tmp/dt4-corp`, carrying 44 of the 174 HISTORICAL occurrences (36 of them in `SUPERSEDED_VALUES.md`,
whose entire subject is superseded values). **All 5 are HISTORICAL, so no correction is owed** and nothing
is outstanding. Recorded only so the 162-vs-167 gap is not mistaken for unfinished work. This stream's
write authority covered the `C:/tmp/dt00*` staging files and this `prereg-013/sweep/` directory, not those
worktree paths.

### C-7 · The substitution pass itself

Ordering, from wave 012 and unchanged: **README edit session → one recomputation → substitute `<NEW_AGG>`
and `<NEW_N>` across the 90 corrected files and the README patch → register.** Doing it in any other order
desynchronises the paperwork a second time. `CORRECTION_LOG.tsv` gives every file and every changed line,
so the pass is mechanical. **Until it runs, nothing this stream touched is consistent.**

---

## D. Two findings that arrived with the measurement and must not be lost

### D-1 · Option A already has a standing recommendation — the README patch is aligned with it, not ahead of it

`prereg-012/D3-D5/EVIDENCE_SCHEMA_RESOLUTION.md:279, :292, :301` recommends, in its own words,
**"ADOPT OPTION (A) — FREEZE `cpg-u1-sampling-evidence/v1`. Do not bump."**, having found and recorded
*against itself* the one diagnostic case `/v2` would catch (its §5d). The Defect-8 hunk in
`README_PATCH.diff` is therefore written to the standing recommendation rather than to a guess. It is still
**undecided**: that document states "DECISION REQUIRED" and this stream did not decide it. C-5 stands.

### D-2 · THE UNTRACKED WORKTREE TWINS ARE STILL STALE — this pass did not and could not reach them

Applied corrections landed in the `C:/tmp/dt00*` staging files, which is exactly the write authority this
stream was given. **The untracked in-worktree copies under `<worktree>/research/deeptech-operations/` were
not touched**, and they are the copies a reader working in a git worktree actually opens. Measured after the
pass, files still carrying a literal `f7699f05`:

| Worktree | Files | Worktree | Files |
|---|---|---|---|
| `dt4-people` | **34** | `dt4-uncert` | **18** |
| `dt4-frame` | **20** | `dt4-corp` | **17** |
| `dt4-reg` | **19** | `dt4-exec` | **14** |
| `dt4-sig` | 3 | `dt4-legal` | 2 |
| `dt4-brand` | 0 | | |

`dt4-sig` and `dt4-legal`'s few are wave-011/012 documents that *report* the defect and are correct as
written. The rest are twins of files this pass corrected in staging — including, in `dt4-corp` alone,
`prereg-008/H-automation/tools/bind.mjs`, `prereg-008/H-automation/tools/instrument.mjs`,
`prereg-008/H-automation/MANUAL_CHECKS_REMAINING.md` and
`prereg-008/H-automation/PERSONNEL_AUTOMATION_AUDIT.md`.

**Consequence: the corpus is now split.** Staging carries placeholders; the worktrees still carry the
superseded digest. **Required:** the substitution pass must cover **both**, and the orchestrator should
decide whether the worktree copies are re-synced from staging or corrected in place. Until then, no reader
should be pointed at a worktree copy of any of these files. This is a scope boundary, not an oversight, and
it is recorded here so it is not mistaken for completion.
