# §9 — Stale-identity correction manifest (167 files)

**CLASSIFICATION: PREPARATION / READ-ONLY AUDIT. NOTHING WAS EDITED.** No write under
`C:/tmp/dt009-merge`. No mutation suite, selftest or aggregate recomputation was run. Every number below
was measured this wave with `grep`, `find` and `git`, not copied from wave 011.

**The goal is not "zero mentions."** It is: *no current executable, no current test and no current
instruction may pin the superseded identity; and no historical record may be rewritten.*

---

## 0. The corpus, reconciled to 167

Two corpora, which must not be conflated:

| Corpus | Files with a `f7699f05` hit | Occurrences |
|---|---|---|
| Staging directories (`C:/tmp/dt00*`, uncommitted scratch) | **162** | 277 full-digest + abbreviations |
| Worktree in-repo trees (`<wt>/research/deeptech-operations/`, **untracked**) | **156** distinct relative paths | — |
| Present in both (after path normalisation) | 142 | — |
| Staging-only (wave reports, orchestrator logs, `registration/ERRATA.md`, `dt005-orchestration/DAG.md`) | **20** | — |
| Worktree-only | **14** | — |
| **Union** | **176** | — |
| less wave-011's own nine closure deliverables under `prereg-011/`, which name the superseded digest *as their subject* | **−9** | — |
| **= distinct logical files carrying a stale/obsolete identity reference** | **167** | **321** |

The union arithmetic closes exactly on **167**, and it explains wave 011's figure: wave 011 reported 5
worktree-only files because its own `prereg-011/` deliverables had not yet been copied into the
worktrees. Those nine files are correct as written — they quote the superseded digest in order to analyse
it — and are **excluded from the correction scope**, not left undiscovered.

Extension breakdown of the 167, which is where the executable count comes from:

| `.md` | `.mjs` | `.json` | `.txt` | `.sh` | `.jsonl` | total |
|---|---|---|---|---|---|---|
| 128 | 27 | 5 | 4 | 2 | 1 | **167** |

---

## 1. COUNTS PER CLASS

| Class | Files | Occurrences | Disposition |
|---|---|---|---|
| **CURRENT EXECUTABLE** | **14** | 17 | **MUST correct** — each fails closed against the candidate today |
| **CURRENT TEST** | **4** (5 pins) | 6 | **MUST correct** — plus one file with **0 literal hits** that inherits the pin by `import` |
| **CURRENT DOC** | **73** | 118 | **MUST correct** — read *now* as instruction by operators and independent participants |
| **HISTORICAL** | **72** | 174 | **Leave alone.** Correctly record what was true when written |
| **INTENTIONAL FIXTURE** | **0 standalone files; 4 fixture *sites*** | (inside the 4 CURRENT TEST files) | May keep the old identity **only where marked historical**; see §4 |
| **UNKNOWN** | **4** | 6 | **Owner call** — see §5 |
| **Total** | **167** | **321** | |

**Class E carries no files of its own** because every deliberate old-identity fixture in the corpus is a
*block inside a file that is otherwise a CURRENT TEST*. Counting those files twice would inflate the
totals, so they are counted once as CURRENT TEST and the sites are enumerated separately.

**Classification rule applied (and it matters).** A file is CURRENT only if it claims to describe the
instrument that will actually be registered. An executable that self-consistently targets the superseded
tree — hard-codes `C:/tmp/dt002/research/cpg-u1/tooling` *and* expects `f7699f05…` *and* is labelled
`_rehearsal` / `prototype` / a completed one-off analysis — is recording a historical measurement and is
**HISTORICAL even though it is executable**. Verified individually for each: `_rehearsal/make_synthetic_frame.mjs:9`,
`prototype/resolver.mjs:30`, `prototype/derive_frame.mjs:30`, `prototype/twoRaterRating.mjs:29`,
`prototype/make_synthetic_snapshot.mjs:10`, `prototype/test/resolver.test.mjs:71`,
`F-statistics/05_assemble_docs.mjs:44`, `zero-change-evidence/demo_auditlog.mjs:19`. The whole
`human-min/` wave is additionally historical **by decision** — the two-human model was found not
defensible and a second enumerator was added instead.

**Divergence from wave 011, stated plainly.** Wave 011 reported A 14 / B 4 / C 64 / D 80 / F 5. My totals
agree on the corpus (167) and on the executable and test classes exactly, but I place **73** files in
CURRENT DOC against their 64 + 5 = 69, and I move **4** re-runnable reproducibility scripts out of
HISTORICAL into **UNKNOWN**. The difference is a classification boundary, not a measurement disagreement:
I count an analysis memo sitting inside the live prereg package as read-now instruction, and I refuse to
call a script HISTORICAL when it is re-runnable, prints a self-contradicting baseline rather than
refusing, and supports a model that is currently authorised.

---

## 2. THE TRUE EXECUTABLE COUNT — **29**, and the directive's 23 is SUPERSEDED

Measured independently this wave, not adopted from either figure:

```
grep -rIl 'f7699f05' dt004-operations dt005-orchestration dt006-human-min \
     dt007-eight-person dt008-prereg dt009-closure dt010-rehearsal \
  | grep -cE '\.(mjs|js|sh|ts|cjs|py|ps1)$'
→ 29
```

**29 executables carry a literal hit: 27 `.mjs` + 2 `.sh`.** This falls straight out of the extension
breakdown in §0 (27 + 2), so it is checkable without re-running the grep. It reproduces wave 011's
measurement and the orchestrator's independent reproduction.

**The directive's figure of 23 is stale and must not be used to scope the correction pass.** It traces to
`DEEPTECH_PARALLEL_010_REPORT.md:179` ("133 files, 23 executable `.mjs`"), which had a narrower directory
scope. Several other documents in the corpus are wrong by one to two orders of magnitude and are equally
unusable for scoping: `prereg-008/F-registration/OPERATOR_REGISTRATION_SEQUENCE.md:79` says "five
documents", `human-min/G-amendment/AMENDMENT_ORDERING.md:18` says "eight dt004 documents",
`prereg-010/orchestrator/HUMAN_ACTIONS.md:34` says "roughly six registration documents".

**Plus one thirtieth executable with no literal hit at all.**
`prereg-008/E-rating/test/test_rating_packet_validator.mjs` has `grep -c 'f7699f05'` = **0** and inherits
the pin entirely through `import { REQUIRED_FILES, loadInstrument, validatePackage } from '../RATING_PACKET_VALIDATOR.mjs';`
at line 17. A literal-only sweep misses it. **Total executables carrying the pin: 30 (29 literal + 1 by
import).** It is *not* in the 167, which is a literal-hit census.

The 29 split by class: **11 CURRENT EXECUTABLE** (`.mjs`), **4 CURRENT TEST**, **10 HISTORICAL**,
**4 UNKNOWN**. The remaining 3 CURRENT EXECUTABLE entries are `.json` machine-read inputs.

---

## 3. THE TRANSPOSED ABBREVIATION — true count **12**, and it is a human-facing hazard

The real digest ends `…dbb04e5cc5dd`. Twelve files write `f7699f05…5eb04e5cc5dd` — `dbb0` transposed to
`5eb0`. A human following any one of them would fail to match **both** instrument trees, because the
abbreviation is a suffix of neither. Each of these is a document a human reads in order to verify the
instrument, so the defect is load-bearing even though the file is "only" documentation.

**The seven human role packets** (`dt004-operations/people/`) — the set the directive named:

| # | File | Line | Text |
|---|---|---|---|
| 1 | `people/ELIGIBILITY_AND_ASSIGNMENT_WORKFLOW.md` | 8 | `- Instrument: tooling v6, aggregate `f7699f05…5eb04e5cc5dd`.` |
| 2 | `people/HUMAN_DEPENDENCY_MAP.md` | 7 | `… aggregate `f7699f05…5eb04e5cc5dd` (VERIFIED by recomputation).` — **claims verification of a value that cannot be verified** |
| 3 | `people/INDEPENDENCE_DECLARATION_TEMPLATE.md` | 9 | `` `f7699f05…5eb04e5cc5dd`). The register carries exactly these keys …`` |
| 4 | `people/RATER_PACKET_INSTRUCTIONS.md` | 9 | `- Instrument: tooling v6, aggregate `f7699f05…5eb04e5cc5dd`` |
| 5 | `people/RATING_ADJUDICATION_PACKET.md` | 9 | same |
| 6 | `people/REFERENCE_ADJUDICATION_PACKET.md` | 9 | same |
| 7 | `people/REFERENCE_TEAM_PACKET.md` | 9 | same |

**Five more, which the directive's "seven" does not cover** — the orchestrator's "~12" is correct:

| # | File | Line | Note |
|---|---|---|---|
| 8 | `reference/tools/blind_record_precheck.mjs` | 8 | **an executable**, comment only |
| 9 | `reference/tools/README.md` | 30 | `run unless that tree's aggregate is `f7699f05…5eb04e5cc5dd`**.` — a release gate stated with an unmatchable value |
| 10 | `human-min/B-reference/COVERAGE_COST_ARITHMETIC.md` | 219 | inside a copy-paste `export CPG_U1_INSTRUMENT=…` line |
| 11 | `human-min/B-reference/REFERENCE_TWO_HUMAN_ANALYSIS.md` | 376 | "Refuses any tree whose aggregate is not `f7699f05…5eb04e5cc5dd`." |
| 12 | `human-min/B-reference/RESOLUTION_RULE_ASSESSMENT.md` | 7 | |

**Total: 12 files, 12 occurrences.** Three further files (`dt011-closure/DEEPTECH_PARALLEL_011_REPORT.md`,
`sweep/EXECUTABLE_PIN_REGISTER.md`, `sweep/UPDATE_SET.md`) contain the string because they *report* this
defect; they are correct and are **not** in the 12.

Entries 10–12 are inside the historical `human-min/` wave. They still get a one-line correction, because a
wrong abbreviation is not a historical fact — it is a typographic error, and fixing a typo does not
rewrite evidence. The corrected form should carry the historical digest, plainly marked as superseded.

---

## 4. THE THREE FILES ACTIVELY UNSAFE TO "FIX" — all three CONFIRMED

### 4.1 `human-min/D-frame/prototype/test_derive_frame.mjs` — the golden set

`GOLD` at `:23–34` holds, in one object literal:

```
:24  frame_hash:            '912e7ed4…8d8c8e58'
:25  frame_csv_sha256:      'bb32be8e…3242a429'
:26  snapshot_sha256:       'de9dc2d5…1933d4f8'
:27  predicates_sha256:     'bad6f70c…ba9e4151'
:28  instrument_aggregate:  'f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd'
:29  records_in:            246
```

The assertions at `:68–:73` check `frame_hash`, `frame_csv_sha256`, `snapshot_sha256`,
`predicates_sha256` and `records_in` — and **never check `instrument_aggregate`**. So editing `:28`
alone produces a golden set in which the aggregate no longer matches the frame it certifies, and
**the suite still passes**. The inconsistency is silent, permanent and inside a golden record. **Do not
touch.** The whole `GOLD` object is one measurement of one tree; it is either preserved intact or the
frame is re-derived against the new instrument and every member recomputed together.

### 4.2 `eight-person/C-partition-tooling/zero-change-evidence/demo_auditlog.mjs` — hash-chained log

`:19` writes the digest **into** an append-only, hash-chained audit log:

```
appendAuditEvent(log, 'LOG_OPENED', '2026-09-19',
  { protocol_sha256: 'c50fc680…', tooling_aggregate_sha256: 'f7699f05…dbb04e5cc5dd' });
```

The emitted `event_sha256 fa6fb52c…` in `enumeration_audit.jsonl` covers that payload, and every later
link chains from it. Changing the literal invalidates the chain from the first event onward — which is
precisely the property the zero-change evidence exists to demonstrate. **Do not touch.**

### 4.3 `human-min/F-statistics/05_assemble_docs.mjs` — self-declared as not recomputed

`:44` in its own emitted provenance table:
`| Instrument aggregate | \`f7699f05…dbb04e5cc5dd\` (as stated in the assignment; not recomputed here) |`
and `:328` in its own limitations list: `**The tooling aggregate hash was not recomputed.** I took
\`f7699f05...\` from the assignment and verified the four named files individually by sha256.`

The file already discloses the exact epistemic status of its own value. Substituting a newer digest would
convert an honest disclosure into a false claim of verification. **Do not touch.**

### 4.4 A fourth hazard, in the opposite direction — CORRECTING wave 011

`prereg-008/D-reference/test/test_reference_packet_validator.mjs:57` holds
`const STALE_AGGREGATE = '640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f';`, used at
`:72` and in assertion **E3** at `:529`, to prove the 587-file in-repo tree is refused "even though it
imports and runs". This is the corpus's best-labelled fixture — header `:34–37` names both trees and both
counts, and it self-reports "vacuous here" rather than passing silently when the stale tree is absent.
**It must not be updated.** It falls outside the `f7699f05` sweep, so the hazard is only that a broader
"update all the hashes" pass would destroy it. **27 files** name `640510…` and every one names it in order
to warn against it; the trap is handled correctly in the corpus and needs **preservation, not
correction**.

### 4.5 And a wave-011 judgement I reverse

Wave 011 flagged `dataset/tools/test_tools.mjs:100` and `people/tools/test_tools.mjs:369` as negative
controls whose literals are hazardous to replace. **On inspection they are not.** Both quote the *tool's
own error message*, which prints what the tool expects:

- `dataset/tools/test_tools.mjs:100` — asserts `'INSTRUMENT_MISMATCH', 'expected aggregate f7699f05…'`
- `people/tools/test_tools.mjs:369` — asserts the message `'not the registered f7699f05…'`

Once `instrument.mjs` expects `<NEW_AGG>`, those messages will say `<NEW_AGG>`, so these assertions
**must** be updated in lockstep or the negative controls fail. A blanket substitution is correct here; the
hazard is *omitting* them. The same two files additionally contain positive current-identity assertions
that must move — `dataset/tools/test_tools.mjs:112` (`'f7699f05… VERIFIED'`) and
`people/tools/test_tools.mjs:373` (`toolingManifest(TOOLING).aggregate === 'f7699f05…'`). What those two
files genuinely lack is a *label*: neither says which tree the quoted digest belongs to. One added clause
each, not a redesign. `reference/tools/test_tools.mjs:165` is comment-only and its assertion turns on the
error code, so it is safe either way.

---

## 5. UNKNOWN — 4 files, owner call

Re-runnable reproducibility scripts for waves whose models are **currently authorised**, which print an
expected baseline and **continue** rather than refusing:

| File | Line | Behaviour on the candidate tree |
|---|---|---|
| `eight-person/E-scan-sufficiency/RUN.sh` | 6, 29 | `echo "expected: 593 files, f7699f05…"` beside a live recomputation — prints a contradiction, exits 0 |
| `eight-person/E-scan-sufficiency/make_fixtures.mjs` | 7 | provenance comment only |
| `eight-person/G-timeline/g_calendar.mjs` | 271 | `EXPECT_AGG`; prints `*** MISMATCH ***` at `:274`/`:276` and **does not abort** |
| `prereg-008/B-cmdscan/RUN.sh` | 8, 29 | as above |

Why not HISTORICAL: their committed transcripts are deliverables, but the scripts are re-runnable, the
8-person model is authorised, and nothing in them says "do not re-run". Why not CURRENT EXECUTABLE: they
do not gate anything — they print. **The owner must decide whether wave-007/008 reproducibility is a
closed record (annotate as historical) or a live path (update the expected values).** Either way the
transcripts `eight-person/E-scan-sufficiency/out/TRANSCRIPT.txt`, `prereg-008/B-cmdscan/out/TRANSCRIPT.txt`,
`eight-person/G-timeline/RUN_OUTPUT.{json,txt}` stay untouched as HISTORICAL.

---

## 6. DOES ANY STALE REFERENCE LIVE INSIDE AN INSTRUMENT TREE? — **NO**

| Tree | Files | `grep -rIln` for `f7699f05`, `638d68e6`, `640510`, `593 file`, `594 file`, `587 file` |
|---|---|---|
| `C:/tmp/dt009-merge` (entire candidate package, incl. the protocol) | 594 in `tooling/` | **0 files** |
| `C:/tmp/dt002/research/cpg-u1/tooling` | 593 | **0 files** |
| `<worktree>/research/cpg-u1/` (the tracked 587 tree + protocol) | 587 + 1 | **0 files** |

**No instrument tree ever names its own identity, or any other.** Every pin lives outside the aggregate.

> ## Therefore the whole 167-file sweep does NOT move the aggregate.
> Not one of the 167 files is inside any instrument tree. Only the nine README corrections in
> `README_IDENTITY_DEFECTS.md` move it. That is what makes the sequence safe: the in-tree README session
> lands first, the aggregate is recomputed once, and the sweep then writes that final value.

**All prepared substitutions use `<NEW_AGG>` and `<NEW_N>`.** No provisional digest — neither
`638d68e6…` nor anything else — is pasted into any prepared edit, because the README session will move it
again.

---

## 7. THE PER-FILE MANIFEST — all 167

Paths are normalised to the in-repo layout `research/deeptech-operations/<path>`; the staging twin is
`C:/tmp/dt004-operations/<path>` for `dataset|execution|people|reference|registration`,
`C:/tmp/dt006-human-min/` for `human-min/`, `C:/tmp/dt007-eight-person/` for `eight-person/`,
`C:/tmp/dt008-prereg/` for `prereg-008/`, `C:/tmp/dt009-closure/` for `prereg-009/`,
`C:/tmp/dt010-rehearsal/` for `prereg-010/`. `occ` = literal `f7699f05` occurrences.

### CURRENT EXECUTABLE — 14 files, 17 occ · MUST correct

Every one presents itself, in the present tense, as the guard for the *registered* instrument, and each
therefore fails closed against the candidate today. **Failing closed is correct behaviour, not a defect** —
they are refusing a tree they were never certified against.

| File | occ |
|---|---|
| `dataset/tools/instrument.mjs` | 1 |
| `execution/tools/instrument.mjs` | 1 |
| `execution/wikidata_snapshot_conformance.mjs` | 2 |
| `people/tools/instrument.mjs` | 1 |
| `prereg-008/C-enumerators/ENUMERATOR_PACKET_VALIDATOR.mjs` | 1 |
| `prereg-008/D-reference/REFERENCE_PACKET_VALIDATOR.mjs` | 1 |
| `prereg-008/E-rating/RATING_PACKET_VALIDATOR.mjs` | 2 |
| `prereg-008/H-automation/tools/bind.mjs` | 1 |
| `prereg-008/H-automation/tools/instrument.mjs` | 1 |
| `prereg-009/F-enumerators/PENDING_PERSONNEL_REGISTER.json` | 2 |
| `reference/tools/blind_record_precheck.mjs` | 1 |
| `reference/tools/lib/instrument.mjs` | 1 |
| `registration/registration_fields.TEMPLATE.json` | 1 |
| `registration/registration_record.DRAFT.json` | 1 |

Sub-structure that changes how each is corrected:

- **Hard comparison constants (8 files)** — the lines that make the tools refuse:
  `dataset/tools/instrument.mjs:18`, `execution/tools/instrument.mjs:22`,
  `execution/wikidata_snapshot_conformance.mjs:30`, `people/tools/instrument.mjs:23`,
  `reference/tools/lib/instrument.mjs:19`, `REFERENCE_PACKET_VALIDATOR.mjs:38`,
  `RATING_PACKET_VALIDATOR.mjs:42` (plus `:71`, `:87` user-facing strings and
  `REGISTERED_TOOLING_FILE_COUNT = 593` at `:43`), `H-automation/tools/instrument.mjs:23`.
- **Comment/provenance only (3 files)** — `reference/tools/blind_record_precheck.mjs:8` (**also a
  transposed abbreviation**), `H-automation/tools/bind.mjs:17`,
  `C-enumerators/ENUMERATOR_PACKET_VALIDATOR.mjs:24/:26/:27`. `ENUMERATOR_PACKET_VALIDATOR.mjs` performs
  **no aggregate comparison at all** — a grep for `aggregate` and `toolingManifest` over it returns only
  those comment lines. Its hit is a "baseline this file was written against" note: a CURRENT EXECUTABLE
  *file* whose *content* is historical. Annotate rather than substitute.
- **Structured records (3 files)** — `registration_record.DRAFT.json:6` and
  `registration_fields.TEMPLATE.json:6` hold `tooling_aggregate_sha256`: **the registration field itself,
  the one value that cannot be repaired after registration.**
  `PENDING_PERSONNEL_REGISTER.json:9`/`:208` hold it in `$`-prefixed keys that `checkPersonnelRegister`
  ignores (the file says so itself), so they are non-functional — but the file is a live
  `check-personnel` input, so a reader will still see the wrong value.

### CURRENT TEST — 4 files with a literal hit, 5 pins · MUST correct

| File | occ | Note |
|---|---|---|
| `dataset/tools/test_tools.mjs` | 2 | `:100` negative control (must move, see §4.5); `:112` positive assertion `'f7699f05… VERIFIED'` |
| `people/tools/test_tools.mjs` | 2 | `:369` refusal message (must move); `:373` positive `toolingManifest(TOOLING).aggregate === …` |
| `prereg-008/D-reference/test/test_reference_packet_validator.mjs` | 1 | `:35` comment; its `640510…` fixture at `:57` is **not** to be touched (§4.4) |
| `reference/tools/test_tools.mjs` | 1 | `:165` comment only; the assertion turns on the error code — safe |
| `prereg-008/E-rating/test/test_rating_packet_validator.mjs` | **0** | **inherits the pin by `import` at `:17`.** Not in the 167 (literal census); must be corrected with its validator |

### CURRENT DOC — 73 files, 118 occ · MUST correct

Read *now*, as instruction, by an operator or an independent participant. Several are self-defeating as
written: `prereg-008/C-enumerators/MATERIAL_RELEASE_GATE.md:183` states
`**G0.5** The instrument to be used is the **593-file** tree at aggregate f7699f05… — **not** a 587-file tree`,
and `REFERENCE_MATERIAL_RELEASE_GATE.md:152`, `RATING_MATERIAL_RELEASE_GATE.md:6` and
`MATERIAL_RELEASE_JOINT_GATE.md:152`/`:154` each instruct the releaser to verify the tree hashes to
`f7699f05…` **before release** — a check the tree that will actually be registered cannot pass.

| File | occ |
|---|---|
| `dataset/CONTAMINATION_PROCEDURE.md` | 1 |
| `dataset/ENUMERATOR_WORKSPACE.md` | 1 |
| `dataset/FRAME_DRY_RUN.md` | 1 |
| `dataset/tools/README.md` | 1 |
| `eight-person/A-protocol/AMENDMENT_VERDICT.md` | 1 |
| `eight-person/A-protocol/PARTITION_GOVERNANCE.md` | 1 |
| `eight-person/A-protocol/SECTION_4A3_VERIFICATION.md` | 1 |
| `eight-person/B-partition/PARTITION_DESIGN.md` | 1 |
| `eight-person/C-partition-tooling/AUDIT_LOG_DESIGN.md` | 1 |
| `eight-person/C-partition-tooling/README.md` | 1 |
| `eight-person/C-partition-tooling/TOOLING_GAP_AUDIT.md` | 2 |
| `eight-person/D-merge/CONFLICT_HANDLING.md` | 2 |
| `eight-person/D-merge/FRAME_IDENTITY_CONTRACT.md` | 2 |
| `eight-person/E-scan-sufficiency/README.md` | 1 |
| `eight-person/E-scan-sufficiency/SCAN_COMPOSITION_ANALYSIS.md` | 1 |
| `eight-person/E-scan-sufficiency/SUFFICIENCY_COMPOSITION.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_A_ALLOCATION.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_B_ALLOCATION.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_CONTAMINATION_RULES.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_EVIDENCE_HANDLING.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_INDEPENDENCE_DECLARATION.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_ROLE_DESCRIPTION.md` | 1 |
| `eight-person/F-recruitment/ENUMERATOR_SUBMISSION_PROCEDURE.md` | 1 |
| `eight-person/F-recruitment/RECRUITMENT_DELTA.md` | 1 |
| `eight-person/G-timeline/CALENDAR_SAVING_RECOMPUTED.md` | 2 |
| `execution/DETERMINISTIC_EXECUTION_PACKAGING.md` | 1 |
| `execution/EXECUTION_READINESS.md` | 1 |
| `people/ELIGIBILITY_AND_ASSIGNMENT_WORKFLOW.md` | 1 |
| `people/HUMAN_DEPENDENCY_MAP.md` | 1 |
| `people/INDEPENDENCE_DECLARATION_TEMPLATE.md` | 1 |
| `people/RATER_PACKET_INSTRUCTIONS.md` | 1 |
| `people/RATING_ADJUDICATION_PACKET.md` | 1 |
| `people/REFERENCE_ADJUDICATION_PACKET.md` | 1 |
| `people/REFERENCE_TEAM_PACKET.md` | 1 |
| `people/ROLE_DESCRIPTIONS.md` | 1 |
| `prereg-008/A-decisions/DR7_DECISION_MEMO.md` | 3 |
| `prereg-008/A-decisions/DR8_OPERATIONAL_RULE.md` | 1 |
| `prereg-008/A-decisions/DR9_DECISION_MEMO.md` | 1 |
| `prereg-008/C-enumerators/ENUMERATOR_AB_DIFFERENCES.md` | 1 |
| `prereg-008/C-enumerators/ENUMERATOR_B_AUTHORIZATION.md` | 1 |
| `prereg-008/C-enumerators/ENUMERATOR_DEADLINES.md` | 1 |
| `prereg-008/C-enumerators/FEE_AGREEMENT_TEMPLATE.md` | 1 |
| `prereg-008/C-enumerators/MATERIAL_RELEASE_GATE.md` | 2 |
| `prereg-008/D-reference/README.md` | 1 |
| `prereg-008/D-reference/REFERENCE_ADJUDICATION_NOTE.md` | 1 |
| `prereg-008/D-reference/REFERENCE_ADJUDICATOR_PACKET.md` | 1 |
| `prereg-008/D-reference/REFERENCE_AUTHOR_PACKET.md` | 1 |
| `prereg-008/D-reference/REFERENCE_CONFIRMER_PACKET.md` | 1 |
| `prereg-008/D-reference/REFERENCE_MATERIAL_RELEASE_GATE.md` | 1 |
| `prereg-008/D-reference/REFERENCE_WORKLOAD_NOTE.md` | 1 |
| `prereg-008/E-rating/RATER_1_PACKET.md` | 1 |
| `prereg-008/E-rating/RATER_2_PACKET.md` | 1 |
| `prereg-008/E-rating/RATING_ADJUDICATOR_PACKET.md` | 1 |
| `prereg-008/E-rating/RATING_INTEGRITY_NOTES.md` | 1 |
| `prereg-008/E-rating/RATING_MATERIAL_RELEASE_GATE.md` | 1 |
| `prereg-008/E-rating/RATING_WORKLOAD_NOTE.md` | 1 |
| `prereg-008/F-registration/OPERATOR_REGISTRATION_SEQUENCE.md` | 5 |
| `prereg-008/F-registration/OSF_METADATA_PREPARED.md` | 2 |
| `prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md` | 4 |
| `prereg-008/G-randomness/CUSTODIAN_ACTION_SHEET.md` | 2 |
| `prereg-008/G-randomness/DR1_RELAY_FLOOR_DECISION.md` | 3 |
| `prereg-008/G-randomness/RANDOMNESS_PREFLIGHT_STATE.md` | 1 |
| `prereg-008/H-automation/MANUAL_CHECKS_REMAINING.md` | 2 |
| `prereg-008/H-automation/PERSONNEL_AUTOMATION_AUDIT.md` | 7 |
| `reference/tools/README.md` | 2 |
| `registration/DR1_DRAND_RELAY_FLOOR_MEMO.md` | 10 |
| `registration/DR2_CERTENV_WORDING_MEMO.md` | 4 |
| `registration/OPERATOR_CHECKLIST.md` | 3 |
| `registration/REGISTRATION_PACKAGE.md` | 4 |
| `registration/REGISTRATION_RECORD_NOTES.md` | 3 |
| `registration/REGISTRATION_SEQUENCE.md` | 1 |
| `registration/REMAINING_FIELDS.md` | 1 |

**Three of these are also silently untracked by git** — `registration/OPERATOR_CHECKLIST.md`,
`execution/EXECUTION_READINESS.md`, `people/ROLE_DESCRIPTIONS.md`, plus
`prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md`. See `GIT_TRACKING_HAZARD.md`. A file that is
both stale and unversioned can be corrected and then lost.

### UNKNOWN — 4 files, 6 occ · owner call (§5)

| File | occ |
|---|---|
| `eight-person/E-scan-sufficiency/RUN.sh` | 2 |
| `eight-person/E-scan-sufficiency/make_fixtures.mjs` | 1 |
| `eight-person/G-timeline/g_calendar.mjs` | 1 |
| `prereg-008/B-cmdscan/RUN.sh` | 2 |

### HISTORICAL — 72 files, 174 occ · LEAVE ALONE

No historical evidence may be rewritten. Three of these are the actively-unsafe files of §4.1–4.3.

Enumerated individually (15 files, 25 occ):

| File | occ |
|---|---|
| `dataset/_rehearsal/make_synthetic_frame.mjs` | 1 |
| `dt005-orchestration/DAG.md` | 1 |
| `eight-person/C-partition-tooling/zero-change-evidence/demo_auditlog.mjs` | 1 |
| `eight-person/C-partition-tooling/zero-change-evidence/enumeration_audit.jsonl` | 1 |
| `eight-person/DEEPTECH_PARALLEL_007_REPORT.md` | 1 |
| `eight-person/E-scan-sufficiency/out/TRANSCRIPT.txt` | 3 |
| `eight-person/G-timeline/RUN_OUTPUT.json` | 1 |
| `eight-person/G-timeline/RUN_OUTPUT.txt` | 2 |
| `eight-person/orchestrator/VERIFIED_BASELINE.md` | 2 |
| `prereg-008/B-cmdscan/out/TRANSCRIPT.txt` | 4 |
| `prereg-008/DEEPTECH_PARALLEL_008_REPORT.md` | 1 |
| `prereg-008/orchestrator/DR10_FINDING.md` | 1 |
| `prereg-008/orchestrator/ENVIRONMENT_HAZARD.md` | 1 |
| `prereg-008/orchestrator/RECONCILIATION_LOG.md` | 4 |
| `registration/ERRATA.md` | 1 |

Grouped by wave, because every file in each of these trees is historical for the same reason (57 files,
149 occ):

| Group | Files | occ | Why historical |
|---|---|---|---|
| `human-min/**` — the rejected two-human wave, incl. `DEEPTECH_HUMAN_MIN_001_REPORT.md`, `B-reference/*` (and its `prototype/*`), `C-rating/prototype/*`, `D-frame/prototype/*` (incl. `test_derive_frame.mjs`, §4.1), `F-statistics/05_assemble_docs.mjs` (§4.3), `orchestrator/*` | **33** | **54** | The two-human model was found not defensible; a second enumerator was added instead. The whole wave is a closed analysis |
| `prereg-009/**` — the closure wave that produced the candidate, incl. `DEEPTECH_PARALLEL_009_REPORT.md`, `orchestrator/BEFORE_aggregate.txt`, `orchestrator/CANDIDATE.md`, `orchestrator/DECISION_RECORD.md`, `orchestrator/RECONCILIATION_LOG.md`. *(`F-enumerators/PENDING_PERSONNEL_REGISTER.json` is excluded — it is CURRENT EXECUTABLE)* | **15** | **39** | Decision records of a completed wave; `BEFORE_aggregate.txt` records the *before* value by construction |
| `prereg-010/**` — the rehearsal wave, incl. `DEEPTECH_PARALLEL_010_REPORT.md`, `B-leaves/*`, `F-manifest/ARTEFACT_MANIFEST.md`, `F-manifest/SUPERSEDED_VALUES.md` (**36 occ alone** — the prior register of this same problem) | **9** | **56** | Rehearsal artefacts and the wave-010 superseded-values register |

15 + 33 + 15 + 9 = **72 files**; 25 + 54 + 39 + 56 = **174 occ**. Consistent with §1.

*(The grouped rows expand to the individual paths in `_manifest.tsv` beside this file: one
`CLASS<TAB>PATH<TAB>OCC` row per file, 167 rows, the machine-readable form of this whole section.)*

---

## 8. Correction sequence — do not reorder

1. **Wait** for the live 404-mutant certification run against `C:/tmp/dt009-merge/tooling` to complete.
2. Apply the nine README corrections in **one** in-tree edit session.
3. Recompute the aggregate **once**; re-run certification against the new tree. This yields `<NEW_AGG>`
   and `<NEW_N>`.
4. Apply this manifest's CURRENT EXECUTABLE / CURRENT TEST / CURRENT DOC corrections with those values,
   and re-attest every "VERIFIED (recomputed…)" claim against the new value. **Old attestations must not
   be relabelled** — they attested a different tree.
5. Resolve the four UNKNOWN files by owner decision.
6. Correct the 12 transposed abbreviations.
7. Fix the git-tracking hazard **before** step 4, so that corrected files cannot silently fail to be
   committed.
8. Register.
