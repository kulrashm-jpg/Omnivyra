# CPG-U1 — EVERY PLACE THE SUPERSEDED INSTRUMENT IDENTITY STILL APPEARS

**DEEPTECH-PARALLEL-010, STREAM F. CLASSIFICATION: PREPARATION.** Read-only search. Nothing was corrected
here — this document exists so the correction can be made in **one pass at registration** rather than
discovered piecemeal. Nothing registered, published, broadcast, committed or pushed.

---

## 0. THE TWO VALUES

| | Value | Files | Status |
|---|---|---|---|
| **Superseded** | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | 593 | **NO LONGER REGISTRABLE.** DR-1 = option (B) and DR-10 = fix-before-registration both change instrument files, as does the authorised `enumerated_by` binding |
| **Candidate (PROVISIONAL)** | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` | 594 | Provisional engineering result at `C:/tmp/dt009-merge/tooling`. **Not registrable** until the 404-mutant run completes with zero survivors, the integrity gate holds, two independent clean rebuilds agree and the owner authorises |
| **Stale trap — never use** | `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` | 587 | A worktree's own `research/cpg-u1/tooling`. Runs cleanly and produces a self-consistent **wrong** value that every check the instrument can perform will pass |

**The scale of the problem, measured:** **158 files** across the six directories quote
`f7699f05…`, in **266 occurrences**. Only **2** files anywhere also mention the successor
(`dt009-closure/DEEPTECH_PARALLEL_009_REPORT.md` and `dt009-closure/orchestrator/CANDIDATE.md`).

| Directory | Files quoting `f7699f05…` |
|---|---|
| `dt004-operations` | 35 |
| `dt005-orchestration` | 1 |
| `dt006-human-min` | 33 |
| `dt007-eight-person` | 32 |
| `dt008-prereg` | 41 |
| `dt009-closure` | 16 |
| **Total** | **158** |

**Two existing estimates in the corpus are both wrong and should not be used to scope the correction pass:**

- `dt008-prereg/F-registration/OPERATOR_REGISTRATION_SEQUENCE.md:79` — "rebuild the identity table in all
  **five** documents that quote `f7699f05...`".
- `dt006-human-min/G-amendment/AMENDMENT_ORDERING.md:18` — "a rebuild of the identity table in the **eight
  dt004 documents** that quote `f7699f05...`".

The true figures are **158 files in total** and **35 in `dt004-operations` alone**. Anyone working from
either estimate will leave most of the corpus stale, including every executable pin in §2 below.

---

## 1. CLASS A — THE VALUE IS A REGISTRATION FIELD OR A STRUCTURED RECORD FIELD

**These must be corrected, or the wrong instrument is registered. This is the class that cannot be repaired
afterwards** (the aggregate is inside the on-chain commitment digest; a second registration differing in a
`SAMPLING_FIELDS` member is a VOID).

| # | Path (under `C:/tmp/`) | Line | What it holds |
|---|---|---|---|
| A1 | `dt004-operations/registration/registration_record.DRAFT.json` | `:6` | `"tooling_aggregate_sha256": "f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd"` — **the field itself** |
| A2 | `dt004-operations/registration/registration_fields.TEMPLATE.json` | `:6` | the same key, same value |
| A3 | `dt009-closure/F-enumerators/PENDING_PERSONNEL_REGISTER.json` | `:9`, `:208` | `"instrument_aggregate_sha256"` and `"instrument_aggregate_sha256_before_and_after"` — a `check-personnel` input pinned to the superseded tree |
| A4 | `dt006-human-min/B-reference/coverage_arithmetic.json` | `:4` | `"instrument_aggregate"` in a machine-generated arithmetic artefact |
| A5 | `dt007-eight-person/G-timeline/RUN_OUTPUT.json` | `:6` | `"instrument_aggregate_sha256"` in a machine-generated timeline artefact |

**A1 and A2 are deliberately left unedited today**, per `PROVISIONAL_AGGREGATE_HANDLING.md` §5(3): a record
carrying the literal marker `<<PROVISIONAL: …>>` is refused with exit 1 and
`ERROR tooling_aggregate_sha256 must be 64 lowercase hex characters`, which fails *louder* than a plausible
wrong digest would. That discipline is correct and should be kept — the correction happens once, at
registration, by **recomputing** `toolingManifest()` in the exact tree being frozen, never by copying a value
out of any document including this one.

---

## 2. CLASS B — EXECUTABLE PINNED CONSTANTS **(the finding the six-document estimate misses entirely)**

These are not prose. They are **hard-coded comparison constants inside instrument-guard code**. Every one of
them will **refuse to run** against the merged candidate instrument, because each tool's guard exists
precisely to reject a tree whose aggregate does not match. The tooling in `dt004-operations` and
`dt008-prereg` is therefore **inoperable against the instrument that will actually be registered** until
these 14 lines are updated, and the accompanying test assertions will fail.

| # | Path (under `C:/tmp/`) | Line | Constant |
|---|---|---|---|
| B1 | `dt004-operations/dataset/tools/instrument.mjs` | `:18` | `export const EXPECTED_AGGREGATE = 'f7699f05…'` |
| B2 | `dt004-operations/execution/tools/instrument.mjs` | `:22` | `export const REGISTERED_TOOLING_AGGREGATE = 'f7699f05…'` |
| B3 | `dt004-operations/execution/wikidata_snapshot_conformance.mjs` | `:30` | `const REGISTERED_TOOLING_AGGREGATE = 'f7699f05…'` |
| B4 | `dt004-operations/people/tools/instrument.mjs` | `:23` | `export const REGISTERED_TOOLING_AGGREGATE = 'f7699f05…'` |
| B5 | `dt004-operations/reference/tools/lib/instrument.mjs` | `:19` | `export const REQUIRED_AGGREGATE = 'f7699f05…'` |
| B6 | `dt006-human-min/B-reference/coverage_arithmetic.mjs` | `:12` | `const AGG = 'f7699f05…'` |
| B7 | `dt006-human-min/B-reference/prototype/resolver.mjs` | `:30` | `export const INSTRUMENT_AGGREGATE = 'f7699f05…'` |
| B8 | `dt006-human-min/D-frame/prototype/derive_frame.mjs` | `:30` | `const TOOLING_AGGREGATE = 'f7699f05…'` |
| B9 | `dt007-eight-person/G-timeline/g_calendar.mjs` | `:271` | `const EXPECT_AGG = 'f7699f05…'` |
| B10 | `dt008-prereg/D-reference/REFERENCE_PACKET_VALIDATOR.mjs` | `:38` | `export const REQUIRED_AGGREGATE = 'f7699f05…'` |
| B11 | `dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs` | `:42`, `:71` | `export const REGISTERED_TOOLING_AGGREGATE = 'f7699f05…'` plus the value in the user-facing error string |
| B12 | `dt008-prereg/H-automation/tools/instrument.mjs` | `:23` | `export const REGISTERED_TOOLING_AGGREGATE = 'f7699f05…'` |

**Test assertions that will fail with these constants (or with them alone updated):**

| # | Path (under `C:/tmp/`) | Line | What it asserts |
|---|---|---|---|
| B13 | `dt004-operations/people/tools/test_tools.mjs` | `:369`, `:373` | asserts `toolingManifest(TOOLING).aggregate === 'f7699f05…'`, and asserts the literal refusal message `'not the registered f7699f05…'` |
| B14 | `dt004-operations/dataset/tools/test_tools.mjs` | `:100`, `:112` | asserts the expected-aggregate message and the `'f7699f05… VERIFIED'` line |
| B15 | `dt004-operations/reference/tools/test_tools.mjs` | `:165` | comment + assertion that a mismatching tree is refused because it "is simply not f7699f05…" |
| B16 | `dt006-human-min/B-reference/prototype/test/resolver.test.mjs` | `:71` | `T1.1 instrument aggregate verified` against the literal |
| B17 | `dt006-human-min/D-frame/prototype/test_derive_frame.mjs` | `:28` | `instrument_aggregate: 'f7699f05…'` in a fixture object |

**Consequence to state plainly:** the personnel, dataset, reference and execution tool suites were all
*verified green against the superseded tree*. Those green results do not carry over. Re-running them against
the merged instrument requires updating B1–B17 first, and the re-run is an `ENGINEERING TEST`, not evidence.

---

## 3. CLASS C — PROSE THAT ASSERTS THE FIELD IS FILLED, FINAL, OR "THE VALUE TO REGISTER"

These are the documents an operator reads while filling the record. Each states or implies that
`f7699f05…` is the aggregate to register.

| # | Path (under `C:/tmp/`) | Lines | The assertion to correct |
|---|---|---|---|
| C1 | `dt008-prereg/F-registration/REGISTRATION_READINESS_TABLE.md` | `:23`, `:80`, `:159`, `:160` | `tooling_aggregate_sha256` is "**FILLED** `f7699f05...` (593 files)", with "Nothing **if DR-1 and DR-2 are settled as no-change**". **Its own condition has failed:** DR-1 was settled as option (B). Already superseded for STATUS purposes by `REGISTRATION_FIELD_STATUS.md` group 1a |
| C2 | `dt008-prereg/F-registration/OSF_METADATA_PREPARED.md` | `:49`, `:119` | The recomputed identity table lists the aggregate as verified over 593 files, and `:119` says "no aggregate change is pending from this source". The aggregate row is superseded; the protocol, registry, treatment and evaluation-tree rows stand |
| C3 | `dt008-prereg/F-registration/OPERATOR_REGISTRATION_SEQUENCE.md` | `:45`, `:58`, `:60`, `:79`, `:92` | "Expect `f7699f05…` over **593 files** if S1 and S2 both …"; and the "**five** documents that quote `f7699f05...`" undercount (see §0) |
| C4 | `dt004-operations/registration/REGISTRATION_PACKAGE.md` | `:20`, `:37`, `:54`, `:71` | Lists the aggregate as **VERIFIED** for the submission package and as the run-time expectation |
| C5 | `dt004-operations/registration/REGISTRATION_RECORD_NOTES.md` | `:31`, `:53`, `:227` | Reproduces the field value and marks it **VERIFIED**; `:227` says the aggregate "already contains" the decided AD values |
| C6 | `dt004-operations/registration/OPERATOR_CHECKLIST.md` | `:9`, `:46`, `:76` | Names it as the current aggregate; `:76` does anticipate a move but does not name the new value |
| C7 | `dt004-operations/registration/REGISTRATION_SEQUENCE.md` | `:259` | Records `registration-fields` printing the aggregate as **VERIFIED** |
| C8 | `dt004-operations/registration/REMAINING_FIELDS.md` | `:46` | "Whether the registered aggregate is `f7699f05...` or a new value" — now settled: a new value |
| C9 | `dt004-operations/registration/ERRATA.md` | `:29` | "the aggregate `f7699f05…` **already contains** these values, so no [change]" |
| C10 | `dt004-operations/registration/DR1_DRAND_RELAY_FLOOR_MEMO.md` | `:8`, `:125`, `:207`, `:215`, `:229`, `:231`, `:338`, `:365`, `:385`, `:403` | Presents option (a) as "Aggregate impact: **None** … stays `f7699f05…`". **Option (a) was not chosen** — option (B) was. `:229` is the line that correctly records the move off `f7699f05…` and names the five files |
| C11 | `dt004-operations/registration/DR2_CERTENV_WORDING_MEMO.md` | `:11`, `:194`, `:274`, `:330` | "**Tooling aggregate impact: None.** `f7699f05…` unchanged." True **of DR-2 in isolation** — DR-2 genuinely moves nothing — but the sentence reads as a statement about the registrable aggregate and will be read that way |
| C12 | `dt005-orchestration/DAG.md` | baseline block | "instrument aggregate `f7699f05…` (593 files)" in the re-verified baseline that gates the whole DAG |

---

## 4. CLASS D — MATERIAL THAT WOULD BE RELEASED TO INDEPENDENT PEOPLE STATING A FALSE INSTRUMENT IDENTITY

Each of these is a packet, declaration, gate or workload note intended for a person who is independent of the
developing organisation. Releasing it while it names `f7699f05…` tells an independent participant that the
study runs an instrument it does not run — and several of the material-release gates are **self-defeating**,
because they instruct the releaser to verify the tree's aggregate equals `f7699f05…` before release, which
the real tree will not.

**Personnel packets and declarations (24 files):**

`dt004-operations/people/ROLE_DESCRIPTIONS.md:11` · `REFERENCE_TEAM_PACKET.md:9` ·
`REFERENCE_ADJUDICATION_PACKET.md:9` · `RATING_ADJUDICATION_PACKET.md:9` ·
`RATER_PACKET_INSTRUCTIONS.md:9` · `INDEPENDENCE_DECLARATION_TEMPLATE.md:9` ·
`HUMAN_DEPENDENCY_MAP.md:7` · `ELIGIBILITY_AND_ASSIGNMENT_WORKFLOW.md:8` ·
`dt008-prereg/D-reference/README.md:34` · `REFERENCE_AUTHOR_PACKET.md:17` ·
`REFERENCE_CONFIRMER_PACKET.md:14` · `REFERENCE_ADJUDICATOR_PACKET.md:16` ·
`REFERENCE_ADJUDICATION_NOTE.md:8` · `REFERENCE_WORKLOAD_NOTE.md:9` ·
`dt008-prereg/E-rating/RATER_1_PACKET.md:14` · `RATER_2_PACKET.md:14` ·
`RATING_ADJUDICATOR_PACKET.md:13` · `RATING_INTEGRITY_NOTES.md:25` · `RATING_WORKLOAD_NOTE.md:10` ·
`dt008-prereg/C-enumerators/ENUMERATOR_AB_DIFFERENCES.md:18` · `ENUMERATOR_B_AUTHORIZATION.md:20` ·
`ENUMERATOR_DEADLINES.md:19` · `FEE_AGREEMENT_TEMPLATE.md:16` ·
`dt004-operations/dataset/ENUMERATOR_WORKSPACE.md:11`

**Material-release gates that check the aggregate as a release precondition (4 files):**

`dt008-prereg/C-enumerators/MATERIAL_RELEASE_GATE.md:18`, `:184` ·
`dt008-prereg/D-reference/REFERENCE_MATERIAL_RELEASE_GATE.md:152` ·
`dt008-prereg/E-rating/RATING_MATERIAL_RELEASE_GATE.md:6` ·
`dt009-closure/F-enumerators/MATERIAL_RELEASE_JOINT_GATE.md`

**Enumerator recruitment package (`dt007-eight-person/F-recruitment/`, 9 files):**
`ENUMERATOR_A_ALLOCATION.md` · `ENUMERATOR_B_ALLOCATION.md` · `ENUMERATOR_CONTAMINATION_RULES.md` ·
`ENUMERATOR_ELIGIBILITY_CHECK.md` · `ENUMERATOR_EVIDENCE_HANDLING.md` ·
`ENUMERATOR_INDEPENDENCE_DECLARATION.md` · `ENUMERATOR_ROLE_DESCRIPTION.md` ·
`ENUMERATOR_SUBMISSION_PROCEDURE.md` · `RECRUITMENT_DELTA.md`

**Eight-person enumeration rules (`dt009-closure/F-enumerators/`, 5 files):**
`ENUMERATOR_WORK_ALLOCATION.md` · `ENUMERATOR_B_ROLE_AUTHORIZATION.md` · `KNOWLEDGE_WINDOW_RULE.md` ·
`NON_DEPENDENCE_CONDITION.md` · `MATERIAL_RELEASE_JOINT_GATE.md`

**No material has been released and no person exists**, so nothing false has reached anyone. The correction
must land before the first release, not after.

---

## 5. CLASS E — HISTORICAL BASELINE REFERENCES: CORRECT AS RECORDED, **NO CORRECTION NEEDED**

Roughly **90 files** quote `f7699f05…` as the value of the tree they actually measured, at the time they
measured it. Those statements are true and must not be "fixed"; editing them would destroy the audit trail
and invalidate their own recorded digests. They include:

- Wave baseline blocks and orchestration logs: `dt009-closure/orchestrator/DECISION_RECORD.md` (which
  explicitly labels it "Instrument aggregate **before** this wave … **expected to change, and only this**"),
  `BEFORE_aggregate.txt`, `BEFORE_manifest.txt`, `RECONCILIATION_LOG.md` in dt006/dt007/dt008/dt009,
  `dt008-prereg/orchestrator/ENVIRONMENT_HAZARD.md`, `dt007-eight-person/orchestrator/VERIFIED_BASELINE.md`,
  `dt006-human-min/orchestrator/VERIFIED_GROUND_TRUTH.md`.
- Measurement records: `dt009-closure/G-registration/VERIFIER_STATE.md` (§0 states outright that the
  measurements are against the **pre-wave** instrument), `dt008-prereg/orchestrator/DR10_FINDING.md`,
  `dt008-prereg/H-automation/PERSONNEL_AUTOMATION_AUDIT.md`,
  `dt004-operations/execution/EXECUTION_READINESS.md`.
- Run transcripts and tool output: `dt007-eight-person/E-scan-sufficiency/out/TRANSCRIPT.txt`,
  `dt008-prereg/B-cmdscan/out/TRANSCRIPT.txt`, `dt007-eight-person/G-timeline/RUN_OUTPUT.txt`,
  `dt006-human-min/F-statistics/*` (which honestly records "as stated in the assignment; not recomputed
  here").
- Re-freeze cost analysis: `dt006-human-min/G-amendment/REFREEZE_COST.md` (11 occurrences) and
  `AMENDMENT_ORDERING.md`, which measure what moving the aggregate costs — the analysis is the point.
- `dt008-prereg/A-decisions/DR8_OPERATIONAL_RULE.md:10` and `DR9_DECISION_MEMO.md:10`, which record it as
  the pre-wave baseline they read.
- `dt009-closure/G-registration/PROVISIONAL_AGGREGATE_HANDLING.md` (9 occurrences) and
  `DEEPTECH_PARALLEL_009_REPORT.md` / `orchestrator/CANDIDATE.md`, which name it **in order to supersede
  it**. These are the corrective documents, not documents needing correction.

---

## 6. DR-7's "Objects affected: NONE" CLAUSE — FLAGGED, WITH THE DISTINCTION KEPT STRAIGHT

**Where it is.** `dt008-prereg/A-decisions/DR7_DECISION_MEMO.md`, §4.1, lines `:102`–`:104`:

```
Objects affected: NONE. protocol_sha256 c50fc680…00b719
unchanged; tooling_aggregate_sha256 f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
unchanged; registry_sha256 unchanged; no field of cpg-u1-registration/v1 added, removed or altered.
```

The same clause is reproduced at `DR7_DECISION_MEMO.md:124` (the §5 table row "Instrument aggregate
`f7699f05…` | **No**") and — critically — is carried verbatim into
`dt009-closure/G-registration/DECISION_DISCLOSURES.md` §4.1 as a **paste-verbatim decision-log entry for
publication**.

**What DR-1 and DR-10 falsify, precisely.** Two readings must not be conflated:

| Reading | Verdict |
|---|---|
| "DR-7 itself changes no object" — DR-7 is a reading of §19.3(3) ("Seven mutually exclusive independent persons" is a minimum, not a cap), it edits no protocol byte and adds no registration key | **STILL TRUE.** DR-7 is causally inert. Nothing about DR-1 or DR-10 touches that |
| "`tooling_aggregate_sha256` is `f7699f05…` and it is unchanged" — a factual assertion about the registrable aggregate, embedded inside the clause | **FALSE AS OF DR-1 AND DR-10.** DR-1 = option (B) changes `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/selftest.mjs`, `test/mutate.mjs`, `README.md`; DR-10 changes `cpg_u1_data.mjs` plus a regression fixture and negative controls; the `enumerated_by` binding adds `lib/enumeration.mjs`. Seven paths, 593 -> 594 files, aggregate `f7699f05…` -> provisionally `638d68e6…` |

**Why this is not a pedantic point.** The clause is queued for **publication verbatim** in the OSF
decision log. Publishing it as written would put a superseded instrument identity into the public
registration narrative, inside a sentence whose rhetorical force is "nothing changed". A reader would take
the study to have registered an instrument that does not enforce the relay floor and still contains the scan
defect.

**Already-correct handling to preserve:** `DECISION_DISCLOSURES.md` §4.1 does flag this, and prescribes the
right fix — publish the "Objects affected: NONE" clause **intact** with the aggregate value **omitted**, since
the clause's claim does not depend on reciting the value. **`DR7_DECISION_MEMO.md` itself carries no such
annotation**, so anyone reading the memo directly rather than the disclosure document gets the false value
with no warning. That is the gap to close.

---

## 7. THE CORRECTION PASS, IN THE ORDER IT MUST HAPPEN

1. **Do not correct anything yet.** The value to substitute does not exist: `638d68e6…` is provisional until
   the 404-mutant run finishes with zero survivors, timeouts and errors, the integrity gate holds, two
   independent clean rebuilds agree, and the owner authorises. Correcting to a provisional value would
   propagate a second wrong value across 158 files.
2. **Recompute, never copy.** Whoever fills `tooling_aggregate_sha256` runs `toolingManifest()` in the exact
   tree about to be frozen and compares it against the orchestrator's published value.
   `toolingManifest` hashes whatever tree it walks, so a value copied from prose can be confidently right
   about a tree nobody is holding. This document is corroboration, never a source.
3. **Class A first** (5 files) — the record, the template and the three structured records.
4. **Class B next** (17 files) — without these the dataset, personnel, reference and execution tool suites
   cannot run at all against the registered instrument, and their green results must be re-earned.
5. **Class C** (12 files) — the operator-facing prose, so nobody re-derives the old value from a readiness
   table.
6. **Class D** (~42 files) — before the first material release to any independent person, and before the
   release gates are used, since several gates check the aggregate as a precondition.
7. **Class E** (~90 files) — **leave alone.** Preserve unedited under the `ERRATA.md` discipline.
8. **DR-7 §4.1** — publish the clause with the value omitted, per `DECISION_DISCLOSURES.md` §4.1, and add the
   same annotation to `DR7_DECISION_MEMO.md` so the memo cannot be read standalone and believed.
9. **Then freeze, and never touch the instrument tree again** — not for a typo, a comment, a README line or a
   lint fix. Each moves the aggregate, and after registration there is no instrument that both differs from
   the registered aggregate and can run anything.
