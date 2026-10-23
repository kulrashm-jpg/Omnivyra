# CPG-U1 — UPDATE SET (PREPARED, NOT APPLIED)

**DEEPTECH-PARALLEL-011, identity-sweep stream. CLASSIFICATION: PREPARATION / READ-ONLY.**

**NOTHING IN THIS DOCUMENT HAS BEEN APPLIED.** No file in any tree was modified. Nothing was written
under `C:/tmp/dt009-merge/tooling`. No suite, selftest, mutation run or aggregate recomputation was
executed. Every edit below is written out so it can be applied in **one** session, once the owner has
ruled on all five outstanding decisions.

---

## 0. The precondition that governs every edit here

`dt011-closure/orchestrator/STOP_CONDITIONS.md` records that **five** decisions each move the tooling
aggregate, and that **two of the five are OWNER DECISION REQUIRED** (DR-11 and `EVIDENCE_SCHEMA`; plus
DR-12, `TOOL_VERSION` and the README wording). So:

1. **`638d68e6…` / 594 is PROVISIONAL.** Substituting it now would propagate a *second* wrong value
   across the same 167 files, and would guarantee at least one extra ~18 h certification cycle.
2. **Recompute, never copy.** Whoever applies these edits runs `toolingManifest()` in the exact tree
   about to be frozen and uses that output. `toolingManifest` hashes whatever tree it walks, so a value
   copied from prose can be confidently right about a tree nobody is holding. **This document is
   corroboration, never a source.**
3. Throughout, `<NEW_AGG>` = the recomputed 64-hex aggregate and `<NEW_N>` = the recomputed file count
   (594 if no further decision lands, but it must be read from the tree, not assumed).

Applying any subset of the pins **before** the owner rules is the third and worst ordering identified
in `STOP_CONDITIONS.md`. The edits below are therefore a single atomic set.

---

## 1. LIST ONE — CERTIFICATION-PATH PINS THAT MUST BE UPDATED IN THE SINGLE FINAL EDIT SESSION

**Count: 16 executable files + 3 data records = 19 files.**
Of the 16 executables, **14 need a text change** (P13 self-corrects by import; P16 is cosmetic and its
recommended treatment is a historical reframing rather than a substitution).

**Definition used.** A pin is on the certification path if a human must run the file, or the document
naming it, at or before one of these gates: DAG steps **S00** (tooling aggregate certified), **S01**
(`registration-fields`), **S02** (`check-funding-prerequisites`), **S03** (registration — the one-way
door), or any **material-release gate** that must pass before an independent participant receives
material and before frame construction begins. Source for the gate sequence:
`prereg-010/A-dag/REGISTRATION_TO_EXECUTION_DAG.md` (32 rows, S00–S31).

| # | File | Gate it serves |
|---|---|---|
| P01 | `dt004-operations/dataset/tools/instrument.mjs` | enumerator/frame tooling, released at the enumerator material-release gate |
| P02 | `dt004-operations/dataset/tools/test_tools.mjs` | the suite that certifies P01 before release |
| P03 | `dt004-operations/execution/tools/instrument.mjs` | S02a → S31 operator tools (drand round selection, schedules, consensus) |
| P04 | `dt004-operations/execution/wikidata_snapshot_conformance.mjs` | §13.1/§13.3 conformance, an instrument test that must pass on the frozen pair |
| P05 | `dt004-operations/people/tools/instrument.mjs` | `check-personnel` / assignment paperwork, S02 and §4A.3 |
| P06 | `dt004-operations/people/tools/test_tools.mjs` | the suite that certifies P05, including its no-write proof |
| P07 | `dt004-operations/reference/tools/lib/instrument.mjs` | reference-researcher tools, reference material-release gate |
| P08 | `dt004-operations/reference/tools/test_tools.mjs` | the suite that certifies P07 |
| P09 | `dt004-operations/reference/tools/blind_record_precheck.mjs` | pre-submission check handed to a reference researcher |
| P10 | `dt008-prereg/D-reference/REFERENCE_PACKET_VALIDATOR.mjs` | `REFERENCE_MATERIAL_RELEASE_GATE.md` item 6.3 |
| P11 | `dt008-prereg/D-reference/test/test_reference_packet_validator.mjs` | the suite that certifies P10 |
| P12 | `dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs` | `RATING_MATERIAL_RELEASE_GATE.md` |
| P13 | `dt008-prereg/E-rating/test/test_rating_packet_validator.mjs` | the suite that certifies P12 — **no edit, must be re-run** |
| P14 | `dt008-prereg/H-automation/tools/instrument.mjs` | `enumerated_by` binding (`lib/enumeration.mjs`, one of the seven moved files) |
| P15 | `dt008-prereg/H-automation/tools/bind.mjs` | same |
| P16 | `dt008-prereg/C-enumerators/ENUMERATOR_PACKET_VALIDATOR.mjs` | `MATERIAL_RELEASE_GATE.md` — **not a functional pin** |
| R01 | `dt004-operations/registration/registration_record.DRAFT.json` | **S03 itself** — leave the `<<PROVISIONAL>>` marker |
| R02 | `dt004-operations/registration/registration_fields.TEMPLATE.json` | **S01** — regenerate, do not hand-edit |
| R03 | `dt009-closure/F-enumerators/PENDING_PERSONNEL_REGISTER.json` | `check-personnel` input; `$baseline` only, `:208` is historical |

### The exact edits

`<OLD>` = `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`.

```
P01  dt004-operations/dataset/tools/instrument.mjs:18
-    export const EXPECTED_AGGREGATE = '<OLD>';
+    export const EXPECTED_AGGREGATE = '<NEW_AGG>';

P02  dt004-operations/dataset/tools/test_tools.mjs:100
-      3, 'INSTRUMENT_MISMATCH', 'expected aggregate <OLD>');
+      3, 'INSTRUMENT_MISMATCH', 'expected aggregate <NEW_AGG>');
     dt004-operations/dataset/tools/test_tools.mjs:112
-      0, '<OLD> VERIFIED');
+      0, '<NEW_AGG> VERIFIED');
     dt004-operations/dataset/tools/test_tools.mjs:96  (class-E label, ADD one clause)
-    // The repository's own checked-out copy of the tooling is NOT the verified instrument.
+    // The repository's own checked-out copy of the tooling is NOT the verified instrument: it is the
+    // known-stale 587-file tree (aggregate 640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f),
+    // which imports and runs and yields a self-consistent WRONG value. This case exists to prove it is refused.

P03  dt004-operations/execution/tools/instrument.mjs:22
-    export const REGISTERED_TOOLING_AGGREGATE = '<OLD>';
+    export const REGISTERED_TOOLING_AGGREGATE = '<NEW_AGG>';
     (leave PROTOCOL_SHA256, PROVIDER_CONFIGURATION_SHA256 c9a7e9aa…, FROZEN_RESOLVER_SHA f01a7eb4…,
      INSTRUMENT_REGISTRY_SHA256 untouched — none of them moved)

P04  dt004-operations/execution/wikidata_snapshot_conformance.mjs:30
-    const REGISTERED_TOOLING_AGGREGATE = '<OLD>';
+    const REGISTERED_TOOLING_AGGREGATE = '<NEW_AGG>';
     dt004-operations/execution/wikidata_snapshot_conformance.mjs:6  (narrative, same session)
-    // WHY THIS EXISTS. The registered tooling (aggregate <OLD>)
+    // WHY THIS EXISTS. The registered tooling (aggregate <NEW_AGG>)

P05  dt004-operations/people/tools/instrument.mjs:23
-    export const REGISTERED_TOOLING_AGGREGATE = '<OLD>';
+    export const REGISTERED_TOOLING_AGGREGATE = '<NEW_AGG>';

P06  dt004-operations/people/tools/test_tools.mjs:369
-      'not the registered <OLD>');
+      'not the registered <NEW_AGG>');
     dt004-operations/people/tools/test_tools.mjs:373
-    ok(toolingManifest(TOOLING).aggregate === '<OLD>',
+    ok(toolingManifest(TOOLING).aggregate === '<NEW_AGG>',
     dt004-operations/people/tools/test_tools.mjs:~363  (class-E label, ADD one clause)
+    // The synthetic fake-tooling tree below computes an honest aggregate that is not the registered one.
+    // The digest quoted in the expected message is the REGISTERED value, not the tree under test.

P07  dt004-operations/reference/tools/lib/instrument.mjs:19
-    export const REQUIRED_AGGREGATE = '<OLD>';
+    export const REQUIRED_AGGREGATE = '<NEW_AGG>';
     :18 doc-comment: keep the cross-reference to REFERENCE_TEAM_PACKET.md and
     REFERENCE_ADJUDICATION_PACKET.md, and update BOTH of those class-C documents in the same session,
     or the cross-reference becomes a lie.

P08  dt004-operations/reference/tools/test_tools.mjs:165  (comment only; assertion is code-based)
-    // aggregate is computed honestly and is simply not <OLD>, so every tool must refuse.
+    // aggregate is computed honestly and is simply not the registered <NEW_AGG>, so every tool must refuse.

P09  dt004-operations/reference/tools/blind_record_precheck.mjs:8  (comment; ALSO fixes a wrong abbrev.)
-    // the verified instrument (aggregate f7699f05…5eb04e5cc5dd). This tool adds no rule. …
+    // the verified instrument (aggregate <NEW_AGG_PREFIX8>…<NEW_AGG_SUFFIX8>). This tool adds no rule. …
     NOTE: the existing abbreviation "f7699f05…5eb04e5cc5dd" is WRONG — the real digest ends
     "…5ed0dbb04e5cc5dd". Do not carry the transposition forward.

P10  dt008-prereg/D-reference/REFERENCE_PACKET_VALIDATOR.mjs:38
-    export const REQUIRED_AGGREGATE = '<OLD>';
+    export const REQUIRED_AGGREGATE = '<NEW_AGG>';

P11  dt008-prereg/D-reference/test/test_reference_packet_validator.mjs:56
-    const REGISTERED_FILE_COUNT = 593;
+    const REGISTERED_FILE_COUNT = <NEW_N>;
     :34-35  header
-    // INSTRUMENT: this suite REFUSES TO RUN without the REGISTERED tooling tree (593 files, aggregate
-    // f7699f05...e5cc5dd). Each worktree carries a STALE 587-file copy (640510782a08...d8e45b613f) that
+    // INSTRUMENT: this suite REFUSES TO RUN without the REGISTERED tooling tree (<NEW_N> files, aggregate
+    // <NEW_ABBREV>). Each worktree carries a STALE 587-file copy (640510782a08...d8e45b613f) that
     :38-39  RUN example — repoint CPG_U1_TOOLING from C:/tmp/dt002/research/cpg-u1/tooling to the frozen tree
     :57    DO NOT TOUCH  — const STALE_AGGREGATE = '640510782a08…d8e45b613f';   (class E, correctly labelled)
     :63, :72, :529  DO NOT TOUCH — the 587-trap messages and the E3 assertion
     :529  E3 also hard-codes a relative hop to 'dt5-ref/research/cpg-u1/tooling'; leave it, it
           degrades honestly ("assertion vacuous here") when the tree is absent.

P12  dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs:42
-    export const REGISTERED_TOOLING_AGGREGATE = '<OLD>';
+    export const REGISTERED_TOOLING_AGGREGATE = '<NEW_AGG>';
     dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs:43   ** DO NOT MISS THIS LINE **
-    export const REGISTERED_TOOLING_FILE_COUNT = 593;
+    export const REGISTERED_TOOLING_FILE_COUNT = <NEW_N>;
     dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs:71
-      … REGISTERED tooling tree (593 files, aggregate f7699f05…e5cc5dd).' };
+      … REGISTERED tooling tree (<NEW_N> files, aggregate <NEW_ABBREV>).' };
     dt008-prereg/E-rating/RATING_PACKET_VALIDATOR.mjs:87
       the template already interpolates REGISTERED_TOOLING_FILE_COUNT and REGISTERED_TOOLING_AGGREGATE,
       so it self-corrects. KEEP the trailing 587-trap sentence verbatim.
     :32-34 RUN example — repoint CPG_U1_TOOLING off C:/tmp/dt002.

P13  dt008-prereg/E-rating/test/test_rating_packet_validator.mjs
     NO EDIT. It imports loadInstrument from ../RATING_PACKET_VALIDATOR.mjs and inherits both values.
     ACTION: re-run it against the frozen tree and record the result as an ENGINEERING TEST.

P14  dt008-prereg/H-automation/tools/instrument.mjs:23
-    export const REGISTERED_TOOLING_AGGREGATE = '<OLD>';
+    export const REGISTERED_TOOLING_AGGREGATE = '<NEW_AGG>';
     Keep this file byte-identical to P05 after the edit.

P15  dt008-prereg/H-automation/tools/bind.mjs:17  (comment only)
-    // f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd.
+    // <NEW_AGG>.

P16  dt008-prereg/C-enumerators/ENUMERATOR_PACKET_VALIDATOR.mjs:23-27
     RECOMMENDED (reframe as historical — the honest edit, since the author really did recompute
     against dt002 and no verification against the new tree has happened):
-    // Baseline this file was written against (recomputed by its author):
-    //   protocol   CPG_U1_PROTOCOL_004.md  c50fc680…00b719
-    //   instrument tooling aggregate       f7699f05…  (593 files)
-    //                                      read at C:/tmp/dt002/research/cpg-u1/tooling — NOT from the
-    //                                      stale 587-file tree, whose aggregate is 640510…
+    // Baseline this file was written against, AT TIME OF AUTHORING (recomputed by its author then;
+    // SUPERSEDED — see prereg-011/sweep/SUPERSEDED_IDENTITY_SWEEP.md):
+    //   protocol   CPG_U1_PROTOCOL_004.md  c50fc680…00b719   (unchanged)
+    //   instrument tooling aggregate       f7699f05…  (593 files), read at
+    //                                      C:/tmp/dt002/research/cpg-u1/tooling — NOT the stale
+    //                                      587-file tree (640510…). The instrument now registered is
+    //                                      <NEW_AGG> (<NEW_N> files); this file compares no digest, so
+    //                                      it is unaffected. --verify-keys checks whatever tree it is given.
     This file needs NO functional change: verified, it performs no aggregate comparison.

R01  dt004-operations/registration/registration_record.DRAFT.json:6
     NO EDIT NOW. Keep "<<PROVISIONAL: …>>" so check-registration exits 1 with
     "ERROR tooling_aggregate_sha256 must be 64 lowercase hex characters".
     At S03: paste the value recomputed in the frozen tree, and nothing else.

R02  dt004-operations/registration/registration_fields.TEMPLATE.json:6
     NO HAND-EDIT. Regenerate with `registration-fields` (DAG S01) in the frozen tree; S01 computes
     toolingManifest(ROOT).aggregate itself.

R03  dt009-closure/F-enumerators/PENDING_PERSONNEL_REGISTER.json
     :9   "$baseline.instrument_aggregate_sha256"  → the frozen value, WHEN the register is completed
     :10  "instrument_file_count": 593              → <NEW_N>
     :11  "instrument_read_only_path"               → the frozen tree's path
     :12  "stale_tree_not_used"                     → LEAVE VERBATIM (the 587 warning is still true)
     :208 "instrument_aggregate_sha256_before_and_after" → LEAVE VERBATIM. It records a real run
          against dt002. Append a SECOND $check_personnel_refusal block for the new run instead of
          overwriting the old one.
```

### Class-C documents that must move in the same session (64 files)

They are enumerated in `SUPERSEDED_IDENTITY_SWEEP.md` §5. Four are **blocking**, because they instruct
the releaser to verify the tree hashes to the superseded value before release, which the frozen tree
cannot do:

- `dt008-prereg/C-enumerators/MATERIAL_RELEASE_GATE.md:18`, `:183`–`:184`, `:231`, `:292`
- `dt008-prereg/D-reference/REFERENCE_MATERIAL_RELEASE_GATE.md:152`
- `dt008-prereg/E-rating/RATING_MATERIAL_RELEASE_GATE.md:6`
- `dt009-closure/F-enumerators/MATERIAL_RELEASE_JOINT_GATE.md:13`, `:152`, `:154`, `:220`

In each, replace the **593-file / `f7699f05…`** pair and **keep every 587/`640510…` warning verbatim**.
Two class-C documents are cross-referenced by name from executable P07 and must not be missed:
`dt004-operations/people/REFERENCE_TEAM_PACKET.md:9` and
`dt004-operations/people/REFERENCE_ADJUDICATION_PACKET.md:9`.

### The second copy

Every edit above must also be applied to the **worktree twin** under
`<worktree>/research/deeptech-operations/…` (142 of the 162 staging hits have one; base commit
`af2fb6e99ce461894bf16f18c2251f75088eba18`). **Both corpora are uncommitted** — `git ls-files
research/deeptech-operations` returns 0 — so a pass applied only in `C:/tmp/dt00*` leaves eight
worktree copies stale and there is no committed copy to fall back on.

---

## 2. LIST TWO — HISTORICAL REHEARSAL PINS: RECORD AS SUPERSEDED, DO NOT EDIT

**Count: 14 executable files.** Detail in `EXECUTABLE_PIN_REGISTER.md` §2 (H01–H14).

```
H01  dt004-operations/dataset/_rehearsal/make_synthetic_frame.mjs
H02  dt006-human-min/B-reference/coverage_arithmetic.mjs
H03  dt006-human-min/B-reference/prototype/resolver.mjs
H04  dt006-human-min/B-reference/prototype/test/resolver.test.mjs
H05  dt006-human-min/C-rating/prototype/twoRaterRating.mjs
H06  dt006-human-min/D-frame/prototype/derive_frame.mjs
H07  dt006-human-min/D-frame/prototype/make_synthetic_snapshot.mjs
H08  dt006-human-min/D-frame/prototype/test_derive_frame.mjs
H09  dt006-human-min/F-statistics/05_assemble_docs.mjs
H10  dt007-eight-person/C-partition-tooling/zero-change-evidence/demo_auditlog.mjs
H11  dt007-eight-person/E-scan-sufficiency/make_fixtures.mjs
H12  dt007-eight-person/E-scan-sufficiency/RUN.sh
H13  dt007-eight-person/G-timeline/g_calendar.mjs
H14  dt008-prereg/B-cmdscan/RUN.sh
```

**The one statement that must be recorded, and is the substantive content of this list:**

> Every green result produced by H01–H14 is a statement about the **593-file `f7699f05…`** instrument.
> None of it carries over to the registered instrument. The two-human amendment arithmetic, the
> mechanical frame-derivation proof, the scan-sufficiency composition, the eight-person calendar
> saving and the DR-10 defect reproduction were all measured against the superseded tree. They remain
> valid as historical measurements and **invalid as evidence about the instrument that will be
> registered.**

Three of the fourteen are **actively unsafe to update**, and this is the part a careless sweep gets wrong:

- **H08** `test_derive_frame.mjs:28` — `instrument_aggregate` sits inside a `GOLD` object "recorded from
  the first clean derivation", next to `frame_hash`, `frame_csv_sha256`, `snapshot_sha256`,
  `predicates_sha256`, `records_in: 246`. Every one of those was produced by the superseded instrument.
  Changing one member makes the golden set internally inconsistent while still passing, which is
  precisely the "runs fine and lies" failure class. Either re-derive the whole object or change nothing.
- **H10** `demo_auditlog.mjs:19` — writes the digest **into** a hash-chained log. `enumeration_audit.jsonl`
  event 1 carries `event_sha256 fa6fb52c…` computed over content including that value. Editing the source
  invalidates the committed log; regenerating the log destroys the recorded artefact.
- **H09** `05_assemble_docs.mjs:44`, `:328` — the file states "as stated in the assignment; **not
  recomputed here**" and, at `:328`, "The tooling aggregate hash was not recomputed." Substituting a new
  digest would convert an honest recorded limitation into a false claim of verification.

And one caveat on **H13** `g_calendar.mjs`: it re-implements the aggregate recipe itself and asserts
`agg.n === 593` at `:273` in addition to `EXPECT_AGG` at `:271`. If it is ever re-run, both lines move.

---

## 3. The two lists, side by side

| | Files | Executables needing a text change | Must precede registration |
|---|---|---|---|
| **List one — certification path** | **19** (16 executable + 3 data records) | **14** | **YES** |
| **List two — historical rehearsal** | **14** (all executable) | **0** | no — record only |
| **Total executable rows** | **30** | 14 | |

---

## 4. Also prepared, not applied — annotations rather than value rewrites

Three class-D documents are misleading when read standalone, but are historical and must **not** be
rewritten. The correct treatment is the precedent already set by
`dt009-closure/G-registration/DECISION_DISCLOSURES.md` §4.1: keep the clause intact, add an
annotation, and omit the value from anything published.

| Document | The sentence | Prepared annotation |
|---|---|---|
| `dt008-prereg/A-decisions/DR7_DECISION_MEMO.md:102`–`:104` (and the §5 row at `:124`) | "Objects affected: NONE … `tooling_aggregate_sha256 f7699f05…` unchanged" | Add above the clause: "**ANNOTATION (post-DR-1/DR-10).** DR-7 remains causally inert: it edits no protocol byte and adds no registration key, and that claim stands. The embedded factual assertion that `tooling_aggregate_sha256` is `f7699f05…` and unchanged is **FALSE as of DR-1 option (B) and DR-10**: seven paths change, 593 → 594 files. When this clause is published, publish it intact **with the aggregate value omitted** per `DECISION_DISCLOSURES.md` §4.1." |
| `dt004-operations/registration/DR1_DRAND_RELAY_FLOOR_MEMO.md` (option (a) "Aggregate impact: **None** … stays `f7699f05…`") | option (a) was **not** chosen | Add a header note: "option (B) was chosen; see `dt008-prereg/G-randomness/DR1_RELAY_FLOOR_DECISION.md`. Every 'Aggregate impact: None' statement in this memo describes the **rejected** option (a). `:229` is the line that correctly records the move." Do **not** rewrite the option-(a) analysis — it is the record of what was weighed. |
| `dt004-operations/registration/DR2_CERTENV_WORDING_MEMO.md` ("**Tooling aggregate impact: None.** `f7699f05…` unchanged.") | true **of DR-2 in isolation** | Add: "true of DR-2 alone — DR-2 moves nothing. It is **not** a statement about the registrable aggregate, which DR-1 and DR-10 move." |

`dt004-operations/registration/ERRATA.md:29` ("the aggregate `f7699f05…` **already contains** these
values, so no change") is class **C**, not D — it is the errata an operator reads while filling the
record — and belongs in list one's class-C set.

---

## 5. Application order, when the owner has ruled

1. Owner rules on all five decisions (DR-11, DR-12, `EVIDENCE_SCHEMA`, `TOOL_VERSION`, README).
2. Apply the five instrument edits; run **one** certification cycle (selftest, anchor count, full
   404-mutant run with zero survivors, adapter conformance, integrity gate, two independent clean
   rebuilds that agree).
3. **Recompute** `toolingManifest()` in that frozen tree. That output is `<NEW_AGG>` / `<NEW_N>`.
4. Apply **list one** — the 16 executables (14 text changes) and the class-C documents — in one session.
   Re-run P02, P06, P08, P11, P13 and record each as an `ENGINEERING TEST`, not as evidence.
5. Leave **list two** untouched; file this document as the record that its results are superseded.
6. Add the three §4 annotations.
7. Regenerate R02 with `registration-fields` (S01). Fill R01 at S03, by recomputation only.
8. Freeze, and never touch the instrument tree again — not for a typo, a comment or a lint fix.
