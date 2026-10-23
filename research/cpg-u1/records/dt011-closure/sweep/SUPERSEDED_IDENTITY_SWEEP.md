# CPG-U1 — SUPERSEDED-IDENTITY SWEEP (DEEPTECH-PARALLEL-011, identity-sweep stream)

**CLASSIFICATION: PREPARATION / READ-ONLY AUDIT.** Nothing was corrected, committed, pushed,
registered, published or broadcast. No tree was written to. In particular **nothing under
`C:/tmp/dt009-merge/tooling` was written**, and no mutation suite, selftest or aggregate
recomputation was run — the 404-mutant certification run was live throughout (see
`dt011-closure/orchestrator/FIREWALL_MEASURED.md`). Every observation below comes from
`grep`, `find` and `sed -n`.

**The goal of this sweep is NOT "zero mentions."** It is: *no current executable and no current
certification path may pin the superseded aggregate.* Historical records that correctly state
what was true when they were written are **left alone**, deliberately.

---

## 0. The three identities

| Role | Aggregate | Files | Location |
|---|---|---|---|
| **Superseded** | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | **593** | `C:/tmp/dt002/research/cpg-u1/tooling` |
| **Current candidate (PROVISIONAL)** | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` | **594** | `C:/tmp/dt009-merge/tooling` |
| **Stale trap — never use** | `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` | **587** | every dt4-*/dt5-* worktree's own `research/cpg-u1/tooling` |

**All three values are taken from the directive and from prior artefacts; none was recomputed here.**
Recomputing any of them means walking a tree with the instrument's own `toolingManifest()`, which the
firewall forbids while the mutation run is live. What *was* verified mechanically:

- The **587-file trap tree physically exists** in the worktrees. `find <wt>/research/cpg-u1/tooling -type f | wc -l`
  returns exactly **587** in `dt4-corp`, `dt4-exec` and `dt5-ref`. Its aggregate was **not** recomputed.
- `C:/tmp/dt009-merge` contains **684 files** total; its `tooling/` subtree was not counted or hashed.
- **Neither instrument tree quotes any of the three hashes anywhere.** `grep -rIl` for `f7699f05`,
  `638d68e6`, `640510`, `593 file`, `594 file` over `C:/tmp/dt002/research` and over all of
  `C:/tmp/dt009-merge` returns **nothing**. The instrument never names its own identity; every pin lives
  outside it. That is why this sweep can be complete without touching either tree.

---

## 1. Scope actually searched

Two distinct corpora, which must not be conflated:

**(a) The staging directories** (`C:/tmp/dt002`, `dt004-operations`, `dt005-orchestration`,
`dt006-human-min`, `dt007-eight-person`, `dt008-prereg`, `dt009-closure`, `dt009-merge`,
`dt010-rehearsal`, `dt011-closure`) — uncommitted scratch.

**(b) The worktrees' in-repo trees** at `<worktree>/research/deeptech-operations/`, present in
`dt4-corp`, `dt4-exec`, `dt4-frame`, `dt4-people`, `dt4-reg`, `dt4-uncert`, `dt5-ref`, `dt5-u4`, all at
base commit `af2fb6e99ce461894bf16f18c2251f75088eba18`. **VERIFIED, and it corrects an assumption worth
correcting: these are UNTRACKED working-tree files, not committed.** `git ls-files
research/deeptech-operations` returns **0** in `dt4-corp`, `dt4-exec` and `dt5-ref`; `git status --short`
shows only `?? research/deeptech-operations/`. So the eight worktrees hold **147 distinct untracked
paths**, in eight separate physical copies, none of them in any commit — a second uncommitted corpus,
not a durable one.

By contrast `research/cpg-u1/` **is** tracked: `git ls-files research/cpg-u1` returns **588** in every
worktree checked (587 tooling files plus `CPG_U1_PROTOCOL_004.md`). That is exactly why the 587-file
`640510…` tree is the trap it is — it is the only instrument tree git will hand you, it is present in
every checkout without anyone fetching it, and nothing in the repo marks it as superseded.

Search terms: the full 64-hex superseded digest · `f7699f05` · `593 file` / `593-file` /
`593 files` · `640510` · `587 file` / `587-file` · `594 file`. `dt002` was searched whole (12 343
files) as well as `dt002/research`.

### Reconciliation of the two corpora

| | Files | Occurrences of `f7699f05` |
|---|---|---|
| Staging dirs | **162** | **277** |
| Worktree in-repo trees (untracked) | **147** | **281** |
| Present in both | 142 | — |
| Staging-only (no worktree twin) | **20** | — |
| Worktree-only (no staging twin) | **5** | — |
| **Distinct logical files swept** | **167** | — |

The 20 staging-only files are the wave reports and orchestrator logs
(`DEEPTECH_PARALLEL_00{7,8,9}_REPORT.md`, `DEEPTECH_PARALLEL_010_REPORT.md`,
`DEEPTECH_HUMAN_MIN_001_REPORT.md`, every `orchestrator/*`, `registration/ERRATA.md`,
`dt005-orchestration/DAG.md`). The 5 repo-only files are `prereg-010/B-leaves/{OWNER_INPUT_SHEET,
VERIFIER_MESSAGING_NOTES,VERIFIER_REHEARSAL}.md` and `prereg-010/F-manifest/{ARTEFACT_MANIFEST,
SUPERSEDED_VALUES}.md`.

### Per-directory (staging)

| Directory | Files | Occurrences |
|---|---|---|
| `dt002` (incl. `research/cpg-u1/tooling`) | **0** | 0 |
| `dt004-operations` | 35 | 58 |
| `dt005-orchestration` | 1 | 1 |
| `dt006-human-min` | 33 | 54 |
| `dt007-eight-person` | 32 | 41 |
| `dt008-prereg` | 41 | 70 |
| `dt009-closure` | 16 | 41 |
| `dt009-merge` | **0** | 0 |
| `dt010-rehearsal` | 4 | 12 |
| `dt011-closure` | **0** | 0 |
| **Total** | **162** | **277** |

### Prior counts, reconciled — not contradicted

- `prereg-010/F-manifest/SUPERSEDED_VALUES.md` reports **158 files / 266 occurrences**. That figure
  excluded `dt010-rehearsal` (stream F could not count its own wave) and `registration/ERRATA.md`.
  158 + 4 (dt010) = 162. **Consistent.**
- `DEEPTECH_PARALLEL_010_REPORT.md:179` reports **133 files, 23 executable `.mjs`**. That was a
  narrower directory scope. This sweep finds **167 files** and **27 `.mjs` + 2 `.sh` = 29 executables**
  carrying a literal hit, plus **1** executable that inherits the pin by import with no literal.
- `dt008-prereg/F-registration/OPERATOR_REGISTRATION_SEQUENCE.md:79` ("**five** documents") and
  `dt006-human-min/G-amendment/AMENDMENT_ORDERING.md:18` ("**eight** dt004 documents") and
  `dt010-rehearsal/orchestrator/HUMAN_ACTIONS.md:34` ("roughly six registration documents") are all
  **wrong by one to two orders of magnitude**. Do not scope the correction pass from any of them.

### The 587/`640510…` pair

**26 files** name the stale trap, and every one of them names it **in order to warn against it**.
No file anywhere treats `640510…` as an instrument to use. Distribution: `dt007-eight-person` 6,
`dt008-prereg` 21, `dt009-closure` 7, `dt010-rehearsal` 1 (overlapping the `f7699f05` set). The
trap is handled correctly in the corpus; **it needs no correction, only preservation.**

---

## 2. Classification — counts per class

| Class | Meaning | Files |
|---|---|---|
| **A** | current executable source (or current-path machine-read input) | **14** |
| **B** | current test | **4** (+1 with no literal hit; see §3) |
| **C** | current README / documentation | **64** |
| **D** | historical report | **80** |
| **E** | fixture intentionally testing the old identity | **0 standalone files; 4 fixture *sites*, all inside class-B files** |
| **F** | external / snapshot artefact | **5** |
| | **Total distinct files** | **167** |

**Why E has no files of its own.** Every deliberate old-identity fixture in the corpus is a *block*
inside a test file that is otherwise class B. Counting those files twice would inflate the totals, so
they are counted once as B and the fixture sites are enumerated separately in §3.

**The A-versus-D rule applied.** A file is A/B/C **only if it claims to describe the instrument that
will actually be registered**. An executable that self-consistently targets the superseded tree —
hard-codes `C:/tmp/dt002/research/cpg-u1/tooling` *and* expects `f7699f05…`, and is labelled
`PROPOSAL` / `prototype` / `_rehearsal` / a one-off study run — is recording a historical
measurement and is **class D even though it is executable**. Fourteen executables fall that way; see
§4 of `UPDATE_SET.md`.

---

## 3. CLASS A — current executable source and current-path machine-read input (14)

Every one of these presents itself, in the present tense, as the guard for **the registered
instrument**. Each names the value it will compare against, and each therefore fails closed against
the candidate. **Failing closed is correct behaviour, not a defect** — verified empirically by the
caller: `dt008-prereg/E-rating/test/test_rating_packet_validator.mjs` pointed at the candidate emits
`INSTRUMENT PRECONDITION FAILED: … 594 files, aggregate 638d68e6…; expected 593 files, f7699f05…`
and exits 2, and passes against the old tree. These guards are doing exactly what they were built to
do: refusing a tree they were never certified against.

- `dt004-operations/dataset/tools/instrument.mjs` — 1 occ
- `dt004-operations/execution/tools/instrument.mjs` — 1 occ
- `dt004-operations/execution/wikidata_snapshot_conformance.mjs` — 2 occ
- `dt004-operations/people/tools/instrument.mjs` — 1 occ
- `dt004-operations/reference/tools/blind_record_precheck.mjs` — 1 occ
- `dt004-operations/reference/tools/lib/instrument.mjs` — 1 occ
- `dt004-operations/registration/registration_fields.TEMPLATE.json` — 1 occ
- `dt004-operations/registration/registration_record.DRAFT.json` — 1 occ
- `dt008-prereg/C-enumerators/ENUMERATOR_PACKET_VALIDATOR.mjs` — 1 occ
- `dt008-prereg/D-reference/REFERENCE_PACKET_VALIDATOR.mjs` — 1 occ
- `dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs` — 2 occ
- `dt008-prereg/H-automation/tools/bind.mjs` — 1 occ
- `dt008-prereg/H-automation/tools/instrument.mjs` — 1 occ
- `dt009-closure/F-enumerators/PENDING_PERSONNEL_REGISTER.json` — 2 occ

Sub-structure worth stating:

- **Hard comparison constants (8 files).** `dataset/tools/instrument.mjs:18`,
  `execution/tools/instrument.mjs:22`, `execution/wikidata_snapshot_conformance.mjs:30`,
  `people/tools/instrument.mjs:23`, `reference/tools/lib/instrument.mjs:19`,
  `REFERENCE_PACKET_VALIDATOR.mjs:38`, `RATING_PACKET_VALIDATOR.mjs:42` (plus `:71` and `:87`
  user-facing strings, plus `REGISTERED_TOOLING_FILE_COUNT = 593` at `:43`),
  `H-automation/tools/instrument.mjs:23`. These are the lines that make the tools refuse.
- **Comment-only / provenance-only (3 files).** `reference/tools/blind_record_precheck.mjs:8`,
  `H-automation/tools/bind.mjs:17`, `C-enumerators/ENUMERATOR_PACKET_VALIDATOR.mjs:24/:26/:27`.
  `ENUMERATOR_PACKET_VALIDATOR.mjs` performs **no aggregate comparison at all** — verified: a grep for
  `aggregate` and `toolingManifest` over the file returns only comment lines 24 and 26. Its hit is a
  "Baseline this file was written against" provenance note. It is a class-A *file* whose hit is
  class-D *content*; see section 7 of `UPDATE_SET.md`.
- **Structured records (3 files).** `registration_record.DRAFT.json:6` and
  `registration_fields.TEMPLATE.json:6` hold `tooling_aggregate_sha256` — **the registration field
  itself**, the one value that cannot be repaired after registration.
  `PENDING_PERSONNEL_REGISTER.json:9` and `:208` hold the value in `$`-prefixed keys which
  `checkPersonnelRegister` ignores (the file documents this itself), so they are non-functional, but
  the file is a live `check-personnel` input.

## 4. CLASS B — current tests (4 with a literal hit, 5 pins)

- `dt004-operations/dataset/tools/test_tools.mjs` — 2 occ
- `dt004-operations/people/tools/test_tools.mjs` — 2 occ
- `dt004-operations/reference/tools/test_tools.mjs` — 1 occ
- `dt008-prereg/D-reference/test/test_reference_packet_validator.mjs` — 1 occ
- `dt008-prereg/E-rating/test/test_rating_packet_validator.mjs` — **0 literal occurrences.** It
  imports `loadInstrument` from `../RATING_PACKET_VALIDATOR.mjs` (line 17) and so inherits the pin
  entirely. A sweep that greps only for the literal misses it. This is the file the caller ran.

### The 4 class-E fixture sites (each inside a class-B file above)

| Site | What it proves | Labelled as intentional today? |
|---|---|---|
| `test_reference_packet_validator.mjs:57` `STALE_AGGREGATE = 640510…`, used at `:72` and in the **E3** assertion at `:529` | that the 587-file worktree tree is REFUSED as the instrument "even though it imports and runs" | **YES, explicitly and well.** Header `:34–37` names both trees and both counts; `:63` and `:72` say "A 587-file tree is the known-stale worktree copy; it runs, and it is the wrong instrument"; the E3 comment at `:529` states the intent verbatim. It degrades honestly too: if the stale tree is absent the assertion self-reports "vacuous here" rather than passing silently. |
| `dataset/tools/test_tools.mjs:97–101` — `REPO_TOOLING = <wt>/research/cpg-u1/tooling`, asserts `INSTRUMENT_MISMATCH` plus `expected aggregate f7699f05…` | that the repo's own checked-out 587-file copy is refused | **PARTLY.** The comment at `:96` says "The repository's own checked-out copy of the tooling is NOT the verified instrument" — correct and clear — but it never names 587 or `640510…`, and it falls back to a synthetic `fake-instrument` when the tree is absent. The **expected-value string is the superseded digest**, so this site is both an intentional negative control *and* a pin that must move. |
| `reference/tools/test_tools.mjs:163–174` — a synthetic `fake-instrument` (real `lib/` modules plus a stub entry point) | that an honestly-computed non-matching aggregate is refused (`exit 2`, `INSTRUMENT_NOT_VERIFIED`) | **YES in substance**: the comment at `:165` explains the construction and says the aggregate "is computed honestly and is simply not f7699f05…". The assertion itself does **not** depend on the literal, only on the error code — so this site is safe under an update. |
| `people/tools/test_tools.mjs:364–370` — a synthetic `fake-tooling`, asserts the refusal message `not the registered f7699f05…` | that a tree with a non-registered aggregate exits 2 | **PARTLY.** The construction is clearly deliberate, but the label says only "a tree whose aggregate is not the registered one"; it does not say which historical value is being quoted, and the assertion **matches on the literal digest**. |

**Verdict on E.** All four sites may remain — each proves genuine historical or structural
incompatibility, which is exactly what class E is for. Two of the four
(`test_reference_packet_validator.mjs`, `reference/tools/test_tools.mjs`) are already labelled to the
required standard. Two (`dataset/tools/test_tools.mjs`, `people/tools/test_tools.mjs`) are labelled as
*intentional negative controls* but not as *historical*: they quote the superseded digest as a live
expected value, so after the update a reader cannot tell whether the digest is the tree under test or
the tree being rejected. Each needs one added clause, not a redesign.

## 5. CLASS C — current README / documentation (64)

These are read **now**, as instruction, by an operator or by an independent participant, and each
asserts or implies that `f7699f05…` is the identity of the instrument in use. Several are
self-defeating as written: `C-enumerators/MATERIAL_RELEASE_GATE.md:183` ("**G0.5** The instrument to be
used is the **593-file** tree at aggregate `f7699f05…` — **not** a 587-file tree"),
`REFERENCE_MATERIAL_RELEASE_GATE.md:152`, `RATING_MATERIAL_RELEASE_GATE.md:6` and
`MATERIAL_RELEASE_JOINT_GATE.md:152`/`:154` each instruct the releaser to *verify the tree hashes to
`f7699f05…` before release* — a check the tree that will actually be registered cannot pass.

- `dt004-operations/dataset/CONTAMINATION_PROCEDURE.md` — 1 occ
- `dt004-operations/dataset/ENUMERATOR_WORKSPACE.md` — 1 occ
- `dt004-operations/dataset/FRAME_DRY_RUN.md` — 1 occ
- `dt004-operations/dataset/tools/README.md` — 1 occ
- `dt004-operations/execution/DETERMINISTIC_EXECUTION_PACKAGING.md` — 1 occ
- `dt004-operations/people/ELIGIBILITY_AND_ASSIGNMENT_WORKFLOW.md` — 1 occ
- `dt004-operations/people/HUMAN_DEPENDENCY_MAP.md` — 1 occ
- `dt004-operations/people/INDEPENDENCE_DECLARATION_TEMPLATE.md` — 1 occ
- `dt004-operations/people/RATER_PACKET_INSTRUCTIONS.md` — 1 occ
- `dt004-operations/people/RATING_ADJUDICATION_PACKET.md` — 1 occ
- `dt004-operations/people/REFERENCE_ADJUDICATION_PACKET.md` — 1 occ
- `dt004-operations/people/REFERENCE_TEAM_PACKET.md` — 1 occ
- `dt004-operations/people/ROLE_DESCRIPTIONS.md` — 1 occ
- `dt004-operations/reference/tools/README.md` — 2 occ
- `dt004-operations/registration/ERRATA.md` — 1 occ
- `dt004-operations/registration/OPERATOR_CHECKLIST.md` — 3 occ
- `dt004-operations/registration/REGISTRATION_PACKAGE.md` — 4 occ
- `dt004-operations/registration/REGISTRATION_RECORD_NOTES.md` — 3 occ
- `dt004-operations/registration/REGISTRATION_SEQUENCE.md` — 1 occ
- `dt004-operations/registration/REMAINING_FIELDS.md` — 1 occ
- `dt005-orchestration/DAG.md` — 1 occ
- `dt007-eight-person/C-partition-tooling/README.md` — 1 occ
- `dt007-eight-person/D-merge/FRAME_IDENTITY_CONTRACT.md` — 2 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_A_ALLOCATION.md` — 1 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_B_ALLOCATION.md` — 1 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_CONTAMINATION_RULES.md` — 1 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` — 1 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_EVIDENCE_HANDLING.md` — 1 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_INDEPENDENCE_DECLARATION.md` — 1 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_ROLE_DESCRIPTION.md` — 1 occ
- `dt007-eight-person/F-recruitment/ENUMERATOR_SUBMISSION_PROCEDURE.md` — 1 occ
- `dt007-eight-person/F-recruitment/RECRUITMENT_DELTA.md` — 1 occ
- `dt008-prereg/C-enumerators/ENUMERATOR_AB_DIFFERENCES.md` — 1 occ
- `dt008-prereg/C-enumerators/ENUMERATOR_B_AUTHORIZATION.md` — 1 occ
- `dt008-prereg/C-enumerators/ENUMERATOR_DEADLINES.md` — 1 occ
- `dt008-prereg/C-enumerators/FEE_AGREEMENT_TEMPLATE.md` — 1 occ
- `dt008-prereg/C-enumerators/MATERIAL_RELEASE_GATE.md` — 2 occ
- `dt008-prereg/D-reference/README.md` — 1 occ
- `dt008-prereg/D-reference/REFERENCE_ADJUDICATION_NOTE.md` — 1 occ
- `dt008-prereg/D-reference/REFERENCE_ADJUDICATOR_PACKET.md` — 1 occ
- `dt008-prereg/D-reference/REFERENCE_AUTHOR_PACKET.md` — 1 occ
- `dt008-prereg/D-reference/REFERENCE_CONFIRMER_PACKET.md` — 1 occ
- `dt008-prereg/D-reference/REFERENCE_MATERIAL_RELEASE_GATE.md` — 1 occ
- `dt008-prereg/D-reference/REFERENCE_WORKLOAD_NOTE.md` — 1 occ
- `dt008-prereg/E-rating/RATER_1_PACKET.md` — 1 occ
- `dt008-prereg/E-rating/RATER_2_PACKET.md` — 1 occ
- `dt008-prereg/E-rating/RATING_ADJUDICATOR_PACKET.md` — 1 occ
- `dt008-prereg/E-rating/RATING_INTEGRITY_NOTES.md` — 1 occ
- `dt008-prereg/E-rating/RATING_MATERIAL_RELEASE_GATE.md` — 1 occ
- `dt008-prereg/E-rating/RATING_WORKLOAD_NOTE.md` — 1 occ
- `dt008-prereg/F-registration/OPERATOR_REGISTRATION_SEQUENCE.md` — 5 occ
- `dt008-prereg/F-registration/OSF_METADATA_PREPARED.md` — 2 occ
- `dt008-prereg/F-registration/REGISTRATION_READINESS_TABLE.md` — 4 occ
- `dt008-prereg/G-randomness/CUSTODIAN_ACTION_SHEET.md` — 2 occ
- `dt008-prereg/H-automation/MANUAL_CHECKS_REMAINING.md` — 2 occ
- `dt009-closure/F-enumerators/ENUMERATOR_B_ROLE_AUTHORIZATION.md` — 2 occ
- `dt009-closure/F-enumerators/ENUMERATOR_WORK_ALLOCATION.md` — 1 occ
- `dt009-closure/F-enumerators/KNOWLEDGE_WINDOW_RULE.md` — 1 occ
- `dt009-closure/F-enumerators/MATERIAL_RELEASE_JOINT_GATE.md` — 3 occ
- `dt009-closure/F-enumerators/NON_DEPENDENCE_CONDITION.md` — 1 occ
- `dt009-closure/G-registration/DECISION_DISCLOSURES.md` — 6 occ
- `dt009-closure/G-registration/ENUMERATOR_B_IN_REGISTRATION.md` — 3 occ
- `<worktree>/research/deeptech-operations/prereg-010/B-leaves/OWNER_INPUT_SHEET.md` — worktree copy only (no staging twin)
- `<worktree>/research/deeptech-operations/prereg-010/B-leaves/VERIFIER_MESSAGING_NOTES.md` — worktree copy only (no staging twin)

## 6. CLASS D — historical reports (80): LEAVE ALONE

Each of these records what its author measured, at the time, in the tree they measured. The statements
are **true**. Rewriting them would destroy the audit trail and, for several, invalidate digests the
documents themselves publish. Several are the *corrective* documents that name `f7699f05…` precisely
in order to supersede it — `dt009-closure/G-registration/PROVISIONAL_AGGREGATE_HANDLING.md`,
`REGISTRATION_FIELD_STATUS.md`, `VERIFIER_STATE.md`, `orchestrator/CANDIDATE.md`,
`orchestrator/DECISION_RECORD.md`, `prereg-010/F-manifest/SUPERSEDED_VALUES.md`. Editing those would
be actively harmful.

- `dt004-operations/dataset/_rehearsal/make_synthetic_frame.mjs` — 1 occ
- `dt004-operations/execution/EXECUTION_READINESS.md` — 1 occ
- `dt004-operations/registration/DR1_DRAND_RELAY_FLOOR_MEMO.md` — 10 occ
- `dt004-operations/registration/DR2_CERTENV_WORDING_MEMO.md` — 4 occ
- `dt006-human-min/A-roles/MODEL_RANKING.md` — 1 occ
- `dt006-human-min/A-roles/ROLE_ELIMINATION_TABLE.md` — 1 occ
- `dt006-human-min/A-roles/SEPARATION_VS_JUDGEMENT.md` — 1 occ
- `dt006-human-min/B-reference/COVERAGE_COST_ARITHMETIC.md` — 2 occ
- `dt006-human-min/B-reference/REFERENCE_TWO_HUMAN_ANALYSIS.md` — 2 occ
- `dt006-human-min/B-reference/RESOLUTION_RULE_ASSESSMENT.md` — 1 occ
- `dt006-human-min/B-reference/coverage_arithmetic.json` — 1 occ
- `dt006-human-min/B-reference/coverage_arithmetic.mjs` — 1 occ
- `dt006-human-min/B-reference/prototype/resolver.mjs` — 1 occ
- `dt006-human-min/B-reference/prototype/test/resolver.test.mjs` — 1 occ
- `dt006-human-min/C-rating/DISAGREEMENT_COST_ARITHMETIC.md` — 1 occ
- `dt006-human-min/C-rating/RATING_TWO_HUMAN_ANALYSIS.md` — 1 occ
- `dt006-human-min/C-rating/prototype/twoRaterRating.mjs` — 1 occ
- `dt006-human-min/D-frame/ATTACK_MATRIX_ENUMERATOR.md` — 1 occ
- `dt006-human-min/D-frame/ENUMERATOR_ELIMINATION_ANALYSIS.md` — 1 occ
- `dt006-human-min/D-frame/MECHANICAL_FRAME_DESIGN.md` — 1 occ
- `dt006-human-min/D-frame/prototype/derive_frame.mjs` — 1 occ
- `dt006-human-min/D-frame/prototype/make_synthetic_snapshot.mjs` — 1 occ
- `dt006-human-min/D-frame/prototype/test_derive_frame.mjs` — 1 occ
- `dt006-human-min/DEEPTECH_HUMAN_MIN_001_REPORT.md` — 4 occ
- `dt006-human-min/E-independence/INDEPENDENCE_ANALYSIS.md` — 1 occ
- `dt006-human-min/E-independence/INFORMATION_FLOW_GRAPH.md` — 1 occ
- `dt006-human-min/E-independence/OUTSIDER_VERIFIABILITY_DELTA.md` — 1 occ
- `dt006-human-min/F-statistics/05_assemble_docs.mjs` — 2 occ
- `dt006-human-min/F-statistics/ALPHA_ANALYSIS.md` — 1 occ
- `dt006-human-min/F-statistics/BREAKEVEN_GRID.md` — 1 occ
- `dt006-human-min/F-statistics/STATISTICAL_CONSEQUENCES.md` — 2 occ
- `dt006-human-min/G-amendment/AMENDMENT_ORDERING.md` — 5 occ
- `dt006-human-min/G-amendment/CLAUSE_IMPACT_TABLE.md` — 1 occ
- `dt006-human-min/G-amendment/PROPOSED_AMENDMENT_TWO_HUMAN.md` — 1 occ
- `dt006-human-min/G-amendment/REFREEZE_COST.md` — 11 occ
- `dt006-human-min/orchestrator/MECHANICAL_FLOOR.md` — 1 occ
- `dt006-human-min/orchestrator/VERIFIED_GROUND_TRUTH.md` — 1 occ
- `dt007-eight-person/A-protocol/AMENDMENT_VERDICT.md` — 1 occ
- `dt007-eight-person/A-protocol/PARTITION_GOVERNANCE.md` — 1 occ
- `dt007-eight-person/A-protocol/SECTION_4A3_VERIFICATION.md` — 1 occ
- `dt007-eight-person/B-partition/PARTITION_DESIGN.md` — 1 occ
- `dt007-eight-person/C-partition-tooling/AUDIT_LOG_DESIGN.md` — 1 occ
- `dt007-eight-person/C-partition-tooling/TOOLING_GAP_AUDIT.md` — 2 occ
- `dt007-eight-person/C-partition-tooling/zero-change-evidence/demo_auditlog.mjs` — 1 occ
- `dt007-eight-person/D-merge/CONFLICT_HANDLING.md` — 2 occ
- `dt007-eight-person/DEEPTECH_PARALLEL_007_REPORT.md` — 1 occ
- `dt007-eight-person/E-scan-sufficiency/README.md` — 1 occ
- `dt007-eight-person/E-scan-sufficiency/RUN.sh` — 2 occ
- `dt007-eight-person/E-scan-sufficiency/SCAN_COMPOSITION_ANALYSIS.md` — 1 occ
- `dt007-eight-person/E-scan-sufficiency/SUFFICIENCY_COMPOSITION.md` — 1 occ
- `dt007-eight-person/E-scan-sufficiency/make_fixtures.mjs` — 1 occ
- `dt007-eight-person/G-timeline/CALENDAR_SAVING_RECOMPUTED.md` — 2 occ
- `dt007-eight-person/G-timeline/RUN_OUTPUT.json` — 1 occ
- `dt007-eight-person/G-timeline/g_calendar.mjs` — 1 occ
- `dt007-eight-person/orchestrator/VERIFIED_BASELINE.md` — 2 occ
- `dt008-prereg/A-decisions/DR7_DECISION_MEMO.md` — 3 occ
- `dt008-prereg/A-decisions/DR8_OPERATIONAL_RULE.md` — 1 occ
- `dt008-prereg/A-decisions/DR9_DECISION_MEMO.md` — 1 occ
- `dt008-prereg/B-cmdscan/RUN.sh` — 2 occ
- `dt008-prereg/DEEPTECH_PARALLEL_008_REPORT.md` — 1 occ
- `dt008-prereg/G-randomness/DR1_RELAY_FLOOR_DECISION.md` — 3 occ
- `dt008-prereg/G-randomness/RANDOMNESS_PREFLIGHT_STATE.md` — 1 occ
- `dt008-prereg/H-automation/PERSONNEL_AUTOMATION_AUDIT.md` — 7 occ
- `dt008-prereg/orchestrator/DR10_FINDING.md` — 1 occ
- `dt008-prereg/orchestrator/ENVIRONMENT_HAZARD.md` — 1 occ
- `dt008-prereg/orchestrator/RECONCILIATION_LOG.md` — 4 occ
- `dt009-closure/DEEPTECH_PARALLEL_009_REPORT.md` — 4 occ
- `dt009-closure/G-registration/PROVISIONAL_AGGREGATE_HANDLING.md` — 9 occ
- `dt009-closure/G-registration/REGISTRATION_FIELD_STATUS.md` — 1 occ
- `dt009-closure/G-registration/VERIFIER_STATE.md` — 2 occ
- `dt009-closure/orchestrator/CANDIDATE.md` — 1 occ
- `dt009-closure/orchestrator/DECISION_RECORD.md` — 1 occ
- `dt009-closure/orchestrator/RECONCILIATION_LOG.md` — 3 occ
- `<worktree>/research/deeptech-operations/prereg-010/B-leaves/VERIFIER_REHEARSAL.md` — worktree copy only (no staging twin)
- `dt010-rehearsal/DEEPTECH_PARALLEL_010_REPORT.md` — 4 occ
- `<worktree>/research/deeptech-operations/prereg-010/F-manifest/ARTEFACT_MANIFEST.md` — worktree copy only (no staging twin)
- `<worktree>/research/deeptech-operations/prereg-010/F-manifest/SUPERSEDED_VALUES.md` — worktree copy only (no staging twin)
- `dt010-rehearsal/orchestrator/HUMAN_ACTIONS.md` — 1 occ
- `dt010-rehearsal/orchestrator/INTEGRITY_RESULT.md` — 1 occ
- `dt010-rehearsal/orchestrator/RECONCILIATION_LOG.md` — 6 occ

**Fourteen of the 80 are executable.** They are class D because each is a `PROPOSAL`, `prototype`,
`_rehearsal` or one-off study run that self-consistently targets the superseded tree — several
hard-code `C:/tmp/dt002/research/cpg-u1/tooling` as an absolute path alongside the expected digest
(`D-frame/prototype/derive_frame.mjs:30`, `dataset/_rehearsal/make_synthetic_frame.mjs:15`,
`B-reference/coverage_arithmetic.mjs:7`), and the rest take the tree as an argument documented as "a
byte-identical copy of `C:/tmp/dt002/...`" (`E-scan-sufficiency/RUN.sh:5`, `B-cmdscan/RUN.sh:7`).
`F-statistics/05_assemble_docs.mjs:328` says so outright: "The tooling aggregate hash was **not
recomputed**. I took `f7699f05...` from the assignment." Their green results were always statements
about the old tree. See `UPDATE_SET.md` section 4.

## 7. CLASS F — external / snapshot artefacts (5): DO NOT MODIFY

Machine-captured output, not authored prose. Editing any of them fabricates a run.

- `dt007-eight-person/C-partition-tooling/zero-change-evidence/enumeration_audit.jsonl` — 1 occ (hash-chained)
- `dt007-eight-person/E-scan-sufficiency/out/TRANSCRIPT.txt` — 3 occ
- `dt007-eight-person/G-timeline/RUN_OUTPUT.txt` — 2 occ
- `dt008-prereg/B-cmdscan/out/TRANSCRIPT.txt` — 4 occ
- `dt009-closure/orchestrator/BEFORE_aggregate.txt` — 1 occ

`enumeration_audit.jsonl` is the strongest case: it is a **hash-chained** append-only log — event 1
carries an all-zero `prev_event_sha256` and an `event_sha256` of
`fa6fb52c24b482377113f76a33091521f7aa87ea3c97d1c226d6f42bfbea10ca` computed over content that
includes `tooling_aggregate_sha256: f7699f05…`. Changing the value breaks the chain, and the chain is
the artefact's entire point.

The D/F boundary used here: **D** = authored, even when machine-readable
(`G-timeline/RUN_OUTPUT.json`, `B-reference/coverage_arithmetic.json` — both carry a
`"classification"` field written by their author). **F** = captured verbatim from a process
(`out/TRANSCRIPT.txt`, `RUN_OUTPUT.txt`, `BEFORE_aggregate.txt`, the chained `.jsonl`). Both classes
are left unedited, so the boundary carries no operational risk; it is drawn only so a later reader can
redraw it.

## 8. Gaps this sweep found that prior sweeps did not

1. **`test_rating_packet_validator.mjs` has no literal hit.** It inherits its pin by import. Any
   future grep-only sweep will miss it, and it is on the certification path.
2. **`RATING_PACKET_VALIDATOR.mjs` pins the file *count* as well as the digest**
   (`REGISTERED_TOOLING_FILE_COUNT = 593`, `:43`), as does
   `test_reference_packet_validator.mjs:56` (`REGISTERED_FILE_COUNT = 593`). Updating only the digest
   leaves both refusing, because `594 !== 593`. Two values per pin, not one.
3. **`ENUMERATOR_PACKET_VALIDATOR.mjs` is not a pin at all** — provenance comment only. Prior material
   lists it among the executables to fix; it needs no functional change.
4. **`g_calendar.mjs` re-implements the aggregate recipe itself** (`:255–266`, its own
   `toolingAggregate()` walk) rather than importing `lib/aggregate.mjs`, and hard-asserts
   `agg.n === 593` at `:273`. Anyone updating only `EXPECT_AGG` at `:271` leaves the file-count
   assertion stale.
5. **The worktree in-repo corpus is a second copy, and it is ALSO uncommitted.** 142 of the 162 staging hits exist a second time
   under `<worktree>/research/deeptech-operations/`. A correction pass applied only under
   `C:/tmp/dt00*` leaves eight worktree copies stale. Verified: `git ls-files research/deeptech-operations`
   returns 0 — so **neither** corpus is durable, and there is no committed copy of any of this to fall
   back on. The tracked 587-file `research/cpg-u1/tooling` is the only instrument tree git holds.
6. **`dt011-closure` and `dt009-merge` are clean.** Zero hits in either. The newest wave has not
   propagated the superseded value, and the candidate instrument does not name its own identity.
