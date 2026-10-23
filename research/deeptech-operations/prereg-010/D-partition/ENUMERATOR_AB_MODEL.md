# ENUMERATOR_AB_MODEL — the two-enumerator operational model, and its nine verification points

**CLASSIFICATION: PREPARATION / REHEARSAL. NOT REGISTERED. NOT EVIDENCE.**
DEEPTECH-PARALLEL-010 · STREAM D · 2026-09-24

**A model over SLOTS, not an assignment to persons.** No person exists. **No one has been recruited,
approached, engaged, named or pseudonymised.** `SYN-ENUM-A` and `SYN-ENUM-B` are synthetic register
tokens used in a rehearsal and denote nobody. No real company, no real frame, no real enumeration.
**Nothing here amends the protocol or the instrument;** conflicts are raised and referred.

Baseline: candidate instrument `C:/tmp/dt009-merge/tooling`, aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files, recomputed unchanged
after every command. Protocol `CPG_U1_PROTOCOL_004.md`
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.

---

## 1. The model in one page

| | Enumerator A | Enumerator B |
|---|---|---|
| Register role string | `enumerator` | `enumerator` (the same literal string; `enumerator-2` is refused as `unknown role`) |
| Jurisdiction families | `US-SEC`, `LEI-ONLY` | `FR-SIRENE`, `BR-CNPJ` |
| Identifier schemes reachable | CIK, LEI | SIREN, CNPJ, LEI |
| `candidate_id` prefix | `A-` (pre-registered; **nothing enforces it**) | `B-` |
| `enumerated_by` written on every row | A's register `person_id` | B's register `person_id` |
| May see the other's rows, counts, progress or identity | **No** | **No** |

Carried forward unchanged from `C:/tmp/dt009-closure/F-enumerators/ENUMERATOR_WORK_ALLOCATION.md` §1
(itself from `dt007` `B-partition/PARTITION_DESIGN.md` §3: 100.4 h vs 96.1 h, 97.9 % efficiency, and
`LEI-ONLY` co-located with `US-SEC` to remove the largest source of cross-enumerator entity collision).
This stream did not re-derive the pairing and did not change it.

### The pipeline as actually rehearsed

```
 A researches US-SEC + LEI-ONLY ──▶ enum_a_submission.csv ──┐
                                                            ├─▶ merge (deterministic, order-free)
 B researches FR-SIRENE + BR-CNPJ ─▶ enum_b_submission.csv ─┘        │
                                                                    ▼
                          frame --personnel   ──▶ attribution gate (§4A.2 / §20.18)
                                                                    ▼
                          scan --repo --registry ──▶ C1(1) + C1(6)
                                                                    ▼
                          check-frame-sufficiency ──▶ E ≥ 126 / 52 / 32  (§5.7.2)
                                                                    ▼
                          [operator-side]  partition_coverage  ──▶ the one gap (see VP-2)
```

Each enumerator's submission validates **alone** against the shared register — proved: `frame` on A's
112 rows alone exits 0, and on B's 112 rows alone exits 0.
`checkEnumerationAttribution` asks whether each row's `enumerated_by` is *an* eligible registered
enumerator, never *which* partition is being checked. **That is the structural fact that makes the
information boundary operable:** a per-enumerator pre-check leaks nothing about the other partition.

### Where the personnel binding actually bites

`lib/enumeration.mjs` is a **structural** check against the restricted register and adds no rule of
its own. Three properties worth stating, all observed:

1. **`enumerated_by` is inside `frame_hash`.** It is one of the 22 `FRAME_COLUMNS`, and
   `frame_hash = hashRecords(frame, 'candidate_id')` covers every column. Forging attribution changes
   the hash (`a09dea7e…` vs `2812d45c…`), so a forged frame is detectable after the fact against a
   published `frame_hash`, not merely refused at the gate.
2. **Downstream blockers are deliberately not propagated.** `checkEnumerationAttribution` drops
   `reg.blockers` because §4A appoints each role *before its own stage* and enumeration is the first;
   an unfilled rater slot must not block frame attribution. But the **enumerator** slot being unfilled
   is raised as an *error* — `role enumerator is UNFILLED — nobody in the register can have enumerated
   this frame (§4A.3)` — so the one blocker that matters at this stage is not lost.
3. **Two independent collision guards.** `checkPersonnelRegister` catches a duplicate role-holder
   generically; `lib/enumeration.mjs` adds the A/B-specific
   `ROLE COLLISION: one person occupies both enumerator slots`. Both fire on the collision fixture.
   The second is not redundant: it is the only message that names the A/B slot pair, and it is the one
   that would survive a register schema in which two `enumerator` assignments were otherwise lawful
   (which they are — `lib/personnel.mjs:26` exempts `enumerator` from the exactly-one rule).

---

## 2. THE NINE VERIFICATION POINTS

The directive names **seven** failure modes; read together with the positive path — whose two gates
are `frame` and `check-frame-sufficiency`, each of which must exit 0 — that is **nine** verification
points. Counted that way explicitly, so the accounting is checkable rather than asserted. Full
transcripts in `PARTITION_REHEARSAL.md`.

| # | Verification point | What must happen | Enforced by | Observed | Exit |
|---|---|---|---|---|---|
| **VP-1** | **Duplicates detected** | any repeated `candidate_id`, within or across partitions, refuses | `loadFrame` (`duplicate candidate_id` → `MALFORMED_ROW`); `cmdScan` DR-10 occurrence report, **writes nothing**; `refuseMalformed`; merger cross-enumerator collision | 4 independent refusals | 1 |
| **VP-2** | **Omitted jurisdiction detected** | an allocated family producing 0 rows refuses | **NOTHING in the candidate, protocol or merger.** `frameSufficiency` counts `expected_outcome_class` only; the merger checks rows are *inside* allocation, never that allocation is *covered*; `orderedClass` tolerates an empty family by design | frozen pipeline exits **0** on a frame with `LEI-ONLY` entirely absent; `partition_coverage.mjs` (this stream, a proposal) refuses | 0 / **1** |
| **VP-3** | **Forged enumerator id** | an `enumerated_by` absent from the register refuses | `checkEnumerationAttribution` + `registeredEnumerators` | `ENUMERATION_ATTRIBUTION_REFUSED: 1 error(s)`; `frame_hash` also changed | 1 |
| **VP-4** | **Inactive / ineligible enumerator id** | an id in an enumerator slot whose §4A.1/§4A.2 declarations are not all `"no"` refuses; likewise an unfilled slot | `checkPersonnelRegister` errors, propagated verbatim with a `personnel register:` prefix | `declaration ran_or_saw_cpg_output must be "no" (got "yes") — not independent`; and `role enumerator is UNFILLED` | 1 |
| **VP-5** | **Wrong-role id** | an id that exists but holds another §4A.3 role refuses | `registeredEnumerators` filters `role === 'enumerator'` | `SYN-REF-AUTHOR is not an eligible enumerator` | 1 |
| **VP-6** | **Missing `enumerated_by`** | a blank refuses; it is never inferred from the submission it arrived in | `checkFrameRow` (`enumerated_by is required`) **and** `checkEnumerationAttribution` (`enumerated_by is missing`) | both fire on the same row | 1 |
| **VP-7** | **A/B identity collision** | one person in both enumerator slots refuses | `checkPersonnelRegister` mutual exclusion **and** `lib/enumeration.mjs` slot-distinctness | 114 errors, both collision messages present | 1 |
| **VP-8** | **Positive gate 1** — `frame` accepts the combined frame | 224 rows, 0 malformed, attribution accepted | candidate | `frame_hash 2812d45c…`, attribution line printed | **0** |
| **VP-9** | **Positive gate 2** — `check-frame-sufficiency` accepts it | 132 / 56 / 36 ≥ 126 / 52 / 32 | candidate (`FRAME_MINIMUM` derived, not typed) | `frame sufficient for every permitted pilot outcome` | **0** |

**VP-2 is the only verification point the instrument does not supply, and it is the one a
two-enumerator partition creates.** With a single enumerator there is no allocation to under-cover.
The finding is referred to the owner with a concrete, zero-instrument-byte disposal: publish the
allocation before enumeration and run an operator-side coverage gate against it before the development
commitment. It requires no protocol change because it asserts a property of the operator's own
published allocation document, not a new rule about candidates.

---

## 3. The residual hazards this model does NOT close

Carried forward, not re-litigated.

| # | Hazard | Why it survives | Owner |
|---|---|---|---|
| H-1 | **Same legal entity, different decisive identifier AND different `canonical_domain`, one row each** | `assertUnique` compares only `idKey` and `canonical_domain`; the merger's decisive axes are identifier / domain / QID. Name equality is report-only by design. §5.7's *"one row per legal entity"* is then violated with no throw | **DECISION REQUIRED** — who reconciles cross-partition entity duplicates. Carried forward unresolved from DR-8 §(e) / `INFORMATION_BARRIER_ANALYSIS.md` OQ-5 and `ENUMERATOR_WORK_ALLOCATION.md` §2. An enumerator may not (X-3); the reference adjudicator may not (§4A.3); the operator can but is not independent — §22 row 31 |
| H-2 | **`candidate_id` prefix discipline is unenforced** | `candidate_id` is constrained only by `^[A-Za-z0-9_-]{1,64}$` (`lib/schema.mjs:98`). No namespace rule exists in the protocol or the instrument | The merger's cross-enumerator collision refusal is the only guard, and it only fires if the ids actually collide. A *near*-collision (`A-0001` from B) passes |
| H-3 | **Omitted jurisdiction** (VP-2) | see above | Referred, with a proposal |
| H-4 | **The partition assignment discloses B's scope to A** | Telling A *"your families are `US-SEC` and `LEI-ONLY`"* reveals that someone else holds the other two. Unavoidable under any two-enumerator partition | Bounded: scope only, never identity, never rows. Recommend recording the disclosure in the registration narrative (F-enumerators R-3) |
| H-5 | **A spoken hint about volume** | No tool detects "a few more fill-expected rows would help". §5.7.2 is never-receive, but the channel is informal | Procedural only (F-enumerators R-5) |
| H-6 | **Allocation axis inconsistency between prior streams** | `dt007` C-partition allocates over 12 **family × class** cells; F-enumerators rejects the class axis as quota-adjacent under §4A.2 and allocates over **families** only. Both artefacts are live preparation material | Not a protocol contradiction. Flagged so the owner picks one axis before the allocation is published. This rehearsal used the **family** axis (the later design) |

---

## 4. What the instrument proves, and what only people can

`lib/enumeration.mjs` says it plainly and the rehearsal confirms it: the check is structural. It
verifies that every row names someone the register holds as an eligible enumerator, and that the two
slots are different people. It **cannot** verify that a §4A.1 declaration is true, that the person who
typed the rows is the person the register names, or that the two enumerators did not talk to each
other. §20.18 / limitation 18 stands: *cryptographic sampling integrity says nothing about who chose
the rows*, and the personnel binding narrows that to *who the register says chose the rows*.

The three things the rehearsal shows are genuinely load-bearing:

1. **`frame_hash` binds attribution.** Any later substitution of `enumerated_by` is detectable against
   a published hash. This converts the attribution from a gate into a commitment.
2. **Order-independence is conditional on uniqueness.** See `PARTITION_REHEARSAL.md` §5. The two
   enumerators may work and submit in any order *because* the duplicate guard holds — not because the
   hash is inherently order-free.
3. **Per-partition validation leaks nothing.** Each enumerator's work can be checked before the merge
   without either learning anything about the other, which is what lets the information boundary in
   `INFORMATION_ACCESS_MATRIX.md` survive contact with the operational need to validate early.
