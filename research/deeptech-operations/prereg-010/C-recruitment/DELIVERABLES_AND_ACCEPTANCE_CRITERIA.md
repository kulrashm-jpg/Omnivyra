# DELIVERABLES_AND_ACCEPTANCE_CRITERIA — what each of the eight owes, and how the operator knows it is acceptable

**CLASSIFICATION: PREPARATION.** No person exists. No deliverable has been produced, submitted or
accepted.

**This is new in this wave.** Prior waves described *submission procedures* (how a file reaches the
operator) and *workloads* (how many records). Neither fixed the **deliverable as a contractual object**
nor said what makes it **acceptable**. This file does both, and it adopts one governing principle:

> **Every acceptance criterion is a rebuild or a refusal in the frozen instrument — never an operator's
> opinion of quality.**

The reason is structural. An operator who may reject a deliverable on judgement has a degree of freedom
that can be exercised toward a favourable result. So acceptance is defined as: *the frozen instrument,
at aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, does not refuse it.*
Where no mechanical check exists, this file says so rather than inventing one.

---

## 1. Enumerator A and Enumerator B

### Deliverable
One frame-row set per slot, covering that slot's allocated jurisdiction families, in the **22
`FRAME_COLUMNS`** of `lib/schema.mjs:11-35`:

`candidate_id` · `company_name` · `canonical_domain` · `jurisdiction_family` · `identifier_scheme` ·
`identifier_value` · `wikidata_qid` · `identifier_domain_evidence_url` ·
`identifier_domain_evidence_note` · `expected_outcome_class` · `identity_hazard_note` ·
`a1_operating_legal_entity` · `a2_domain_controlled_https` · `a4_tie_independent_of_cpg` ·
`a6_reference_obtainable` · `c1_2_used_in_cpg_work` · `c1_3_values_derived_from_cpg` ·
`c1_4_prior_cpg_execution` · `c1_5_internal_or_owned` · `enumerated_by` · `enumerated_at` ·
`enumeration_source_url`

### Acceptance criteria

| # | Criterion | Mechanical? | Authority |
|---|---|---|---|
| A-1 | Every one of the 22 columns present on every row | **Yes** — `lib/schema.mjs:95` pushes `missing column <c>` | §5.1 |
| A-2 | Tri-state answers are exactly `yes` / `no` / `unknown`; **UNKNOWN never satisfies a criterion** | **Yes** — `checkFrameRow`, with an exhaustive 81-combination test | §5.1 |
| A-3 | No MALFORMED row. A malformed fixture is *"Refused at `frame`, **before** any draw"* | **Yes** — `loadFrame` refuses | §15.2 |
| A-4 | `candidate_id` unique across **both** slots | **Yes** — `loadFrame` refuses duplicate `candidate_id` | dt008 `ENUMERATOR_AB_DIFFERENCES.md` §4 |
| A-5 | `candidate_id` under the slot's assigned **disjoint prefix** | **No** — the instrument imposes no namespace rule; it catches only collisions, not prefix discipline | dt009 `ENUMERATOR_WORK_ALLOCATION.md` §3.1 |
| A-6 | Frame sufficiency for the maximum quota: ≥ 210 eligible admissible rows before the development commitment | **Yes** — `check-frame-sufficiency` | §5.7.2, §20.22 |
| A-7 | `enumerated_by` is the slot's recorded pseudonym | **No** — a string the enumerator writes; nothing verifies whose hand wrote it | §15.3 (screening-log columns) |
| A-8 | Constructed without any CPG output | **No** — declaration key 7 (`ran_or_saw_cpg_output`) and §4A.2(b) only | §4A.2 |

### Not an acceptance criterion
The **number** of rows a slot contributes, beyond A-6's aggregate floor. The jurisdiction partition is
disjoint and the families differ in density; a per-slot count target would be a quota, and §4A.2 says
enumerators *"never receive … quotas"*.

---

## 2. Reference Author and Reference Confirmer

### Deliverable
One blind record per drawn company × field, **both stages** (development and held-out — dt008
`REFERENCE_WORKLOAD_NOTE.md` §1.1), in the **13 `BLIND_RECORD_COLUMNS`** of `lib/schema.mjs:201`:

`candidate_id` · `field` · `value_kind` · `expected_value` · `authoritative_source_name` ·
`source_class` · `source_url` · `publication_date` · `as_of_date` · `search_note` ·
`constructed_without_cpg` · `recorded_by` · `recorded_at`

### Acceptance criteria

| # | Criterion | Mechanical? | Authority |
|---|---|---|---|
| R-1 | All 13 columns present on every record | **Yes** — `lib/schema.mjs:254` | §9.3 |
| R-2 | `value_kind` ∈ `STATED` / `NOT_AVAILABLE_FROM_SOURCE` | **Yes** | §9.3 |
| R-3 | A `STATED` value matches its field's format: four-digit year · positive integer · ISO 4217 code + space + positive integer in whole units | **Yes** — `VALUE_FORMAT`, `lib/schema.mjs:192` | §9.3 |
| R-4 | Targets, projections, run-rates, order books and estimates are **never** an expected value; where only such a figure exists the record is `NOT_AVAILABLE_FROM_SOURCE` with the figure described in `search_note` | **Yes** — `FORBIDDEN_KINDS` in `checkValueFields` | §9.3 |
| R-5 | `source_class` is authoritative for the field per the §9.4 tier table | **Yes** — `AUTHORITY` / `authorityOf`, `lib/schema.mjs:183` | §9.4 |
| R-6 | `constructed_without_cpg` = `yes` | **Yes** — column check. **But it is a self-report** | §9.3 |
| R-7 | Coverage is **complete**: a record for every drawn company × field | **Yes** — `reconcile` cannot pair a missing record | §9.5 |
| R-8 | The Confirmer's set was constructed **blind** to the Author's | **No** — §9.1 undertaking only | §9.1 |
| R-9 | No communication between Author and Confirmer before both submitted | **No** — §9.1 undertaking only | §9.1 |

### What is explicitly NOT a defect
**Disagreement with the other recorder.** §9.5 routes every difference to adjudication; it is a
designed path, not a quality failure. Neither recorder may be marked down for it, and neither may be
told the disagreement rate — telling the adjudicator any *"count or tally of adjudication outcomes"* is
prohibited outright (§9.2.1).

Likewise `NOT_AVAILABLE_FROM_SOURCE`: §5.9 says *"A reference value of `NOT_AVAILABLE_FROM_SOURCE` is a
valid outcome, not inadmissibility."*

### What neither recorder produces
The **reconciled reference file**. It is *"produced **only** by `reconcile`"*, and `seal` *"refuses any
reference file that is not byte-identical to the reconciliation of the blind records"* (§9.5). Its 16
`REFERENCE_COLUMNS` (`lib/schema.mjs:213`) are never hand-written by anyone.

---

## 3. Reference Adjudicator

### Deliverable
One decision row per **disagreeing** item, in the **6 `ADJUDICATION_COLUMNS`** of `lib/schema.mjs:207`:
`candidate_id` · `field` · `decision` · `rationale` · `adjudicated_by` · `adjudicated_at`

### Acceptance criteria

| # | Criterion | Mechanical? | Authority |
|---|---|---|---|
| RA-1 | `decision` ∈ `RECORD_1` / `RECORD_2` / `REFERENCE-CONFLICT` | **Yes** — `lib/packets.mjs:64` refuses anything else | §9.2.1 |
| RA-2 | **No third value is introduced.** The adjudicator chooses between the two records or declares a conflict | **Yes** — the decision vocabulary has no slot for a value | §9.5 |
| RA-3 | `rationale` non-empty | **Yes** | §9.5 |
| RA-4 | **Every** disagreement decided — an undecided difference is refused outright | **Yes** — `reconcile` refuses; fatal in both commands that matter | dt008 `REFERENCE_ADJUDICATION_NOTE.md` §2 |
| RA-5 | No decision on an **agreeing** item: *"an adjudication may not override it"* | **Yes** — the packet contains only disagreements, and `verify-adjudication-packet` refuses an *"extra or agreeing item"* | §9.5, §9.2.1 |
| RA-6 | Decided from the packet as built — no reordering, no reassignment | **Yes** — `verify-adjudication-packet` rebuilds and requires identity | §9.2.1 |
| RA-7 | Decided before `seal` | **No** — a sequencing obligation with no clock in the instrument | §9.2.1 "Timing" |

### The one thing the adjudicator must not be judged on
`RECORD_1` / `RECORD_2` is **scrambled per item** — Record 1 is the Author's iff the first hex digit of
`order_key("reference-adjudicator-record-1", candidate_id, field)` is even (§9.2.1). A tally of
"how often the adjudicator picked the Author" is therefore both meaningless as a quality signal and
prohibited information (§9.2.1).

---

## 4. Rater 1 and Rater 2

### Deliverable
One rating sheet covering **every** held-out company × field, in the **6 `RATING_COLUMNS`** of
`lib/ratings.mjs:17`: `candidate_id` · `field` · `label` · `sub_reason` · `rated_by` · `rated_at`

### Acceptance criteria

| # | Criterion | Mechanical? | Authority |
|---|---|---|---|
| RT-1 | Every `label` from the closed seven-member set (`RATING_LABELS`, `lib/packets.mjs:8`) — `SUPPORTED-FILL`, `UNSUPPORTED-FILL`, `INCORRECT-FILL`, `MISATTRIBUTED-FILL`, `CORRECT-ABSTENTION`, `MISSED-FILL`, `REFERENCE-AMBIGUOUS` — or `pending` | **Yes** — `checkRating` | §12 |
| RT-2 | One row per packet item, no duplicates, no rows for items not in the packet | **Yes** — `lib/ratings.mjs:89-92` | §12 |
| RT-3 | `pending_count` and `item_count` agree with the rows | **Yes** — `lib/ratings.mjs:92` refuses *"sheet counts do not match its ratings"* | — |
| RT-4 | `rated_by` is the assigned person | **Partly** — `lib/ratings.mjs:97` refuses two sheets with the **same** `rated_by`; it cannot tell whether the string names the assigned human | §12, §4A.3 |
| RT-5 | Labels applied by the §10.1 procedure with the §10.2 rules | **No** — the procedure is what a human applies; the instrument checks only the resulting vocabulary | §10.1, §10.2 |
| RT-6 | Completeness ≥ 90% of held-out observations | **Yes, at run level** — §15.5(3) makes it a run-level INCONCLUSIVE condition, not a per-rater rejection | §12, §15.5(3) |

### Acceptance is NOT agreement with the other rater
This has to be stated because it is the most natural thing for an operator to get wrong.

- Krippendorff's α (nominal, ≥ 0.667) is a **run-level** condition (§12, §15.5(3)), not a per-rater
  acceptance test.
- α is computed on the raters' **own** labels, so adjudication cannot change it (dt008
  `RATING_INTEGRITY_NOTES.md` §3, `lib/analysis.mjs`).
- Consequently: **a rater whose labels disagree often has still delivered an acceptable sheet.**
  Rejecting or re-briefing a rater for disagreeing would manufacture agreement, which is the one thing
  α exists to measure. The correct response to low α is to report INCONCLUSIVE under §15.5(3).
- `pending` is a permitted value: *"Missing ratings: `pending` — never imputed, never scored"* (§12).
  A rater may not be pressed to replace `pending` with a label.

---

## 5. Rating Adjudicator

### Deliverable
One decision per disagreeing held-out observation: `decision` ∈ `LABEL_A` / `LABEL_B` /
`REFERENCE-AMBIGUOUS`, plus `rationale` and `adjudicated_at`.

### Acceptance criteria

| # | Criterion | Mechanical? | Authority |
|---|---|---|---|
| AD-1 | `decision` ∈ the three values; **never a new label** | **Yes** — `lib/packets.mjs:112` throws otherwise | §12.2 |
| AD-2 | Every disagreement decided — *"disagreement without a decision"* is refused | **Yes** — `lib/ratings.mjs:114` | §12.2 |
| AD-3 | No decision on an item not in the packet — *"agreeing, pending or unknown item"* is refused | **Yes** — `lib/ratings.mjs:105` | §12.2 |
| AD-4 | No duplicate decision | **Yes** — `lib/ratings.mjs:107` | — |
| AD-5 | `adjudicated_by` is the assigned adjudicator, and is **neither rater** | **Yes** — `lib/ratings.mjs:98` and `:109` | §4A.3 |
| AD-6 | `rationale` required and non-blank | **Yes** — `lib/ratings.mjs:110` | — |
| AD-7 | `adjudicated_at` is `YYYY-MM-DD` | **Yes** — `isCalendarDate`, `lib/ratings.mjs:111` | — |
| AD-8 | Decided after both raters submitted complete sheets | **No** — sequencing; the instrument has no clock | §12.2 "Timing" |

### What the adjudicator does not write, and must not be asked for
`sub_reason` is carried over **mechanically** from whichever rater's label was chosen
(`lib/ratings.mjs:116-118`); the adjudicator neither writes it nor can override it (dt008
`RATING_INTEGRITY_NOTES.md` §7.2). And `REFERENCE-AMBIGUOUS` at `lib/packets.mjs:109` is
**unconditional** — it is always available, and choosing it is never a failure to decide.

### The workload is structurally unknowable
The adjudicator's item count is the number of disagreements, which nobody may know in advance and
which the adjudicator may never be told (§12.2: never *"the number of disagreements"*). So an
acceptance criterion of the form "decided N items in M days" cannot exist for this role (dt008
`RATING_WORKLOAD_NOTE.md` §5).

---

## 6. Cross-role acceptance rules

| # | Rule | Authority |
|---|---|---|
| X-1 | **A deliverable is never rejected because its content is unfavourable to CPG.** *"No observation may be excluded because its result is unfavourable"*; *"Exclusion rules may not change after any held-out result is seen"* | §15.2 |
| X-2 | **Acceptance is not re-negotiable after the fact.** These criteria are fixed before recruitment and do not change once any deliverable is seen | §15.2, by the same logic |
| X-3 | **Outputs are write-once.** `writeOnce` (`cpg_u1_data.mjs:81-84`) refuses an existing path — *"outputs are write-once (no re-roll). Use a new output path."* `newDir` (`:85-88`): *"draws are write-once."* A "corrected resubmission" over the same path is refused by the instrument | `cpg_u1_data.mjs:81-88` |
| X-4 | **A refusal is information, not a rejection of the person.** Where the instrument refuses a submission on a format criterion, the correct path is a corrected submission at a **new output path**, not an argument about quality |
| X-5 | **Acceptance never depends on a count of agreements or disagreements** for any role. Three separate prohibitions: §9.2.1 (no tally to the reference adjudicator), §12.2 (no number of disagreements to the rating adjudicator), §12 (no running tallies to raters) | §9.2.1, §12, §12.2 |

## 7. What remains blocked on the operator

| # | Blocked item | Why |
|---|---|---|
| D-1 | Whether a slot may make a corrected resubmission at all, and how many times | X-3 makes the same path impossible; the number of fresh paths permitted is a policy nobody has set |
| D-2 | Who runs the acceptance checks — the operator holds the instrument, but the operator must not see reference values before the seal (§9.6) | Running `reconcile` reveals reconciled values. The separation needs a named holder |
| D-3 | The three anchor dates any deadline is measured from | No calendar date may appear in this package |
| D-4 | Whether A-5 (prefix discipline) becomes a contractual obligation, given that no tool checks it | dt009 `ENUMERATOR_WORK_ALLOCATION.md` §3.1 established that it is operational only |

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.2, §5.1, §5.7.2, §5.9, §15.3, §9.1–§9.5, §9.2.1, §10.1, §10.2, §12, §12.2, §15.2, §15.5, §20.22
- `C:/tmp/dt009-merge/tooling/lib/schema.mjs`, `lib/ratings.mjs`, `lib/packets.mjs`, `lib/personnel.mjs`, `cpg_u1_data.mjs`
- `C:/tmp/dt008-prereg/D-reference/REFERENCE_WORKLOAD_NOTE.md`, `REFERENCE_ADJUDICATION_NOTE.md`; `E-rating/RATING_INTEGRITY_NOTES.md`, `RATING_WORKLOAD_NOTE.md`; `C-enumerators/ENUMERATOR_AB_DIFFERENCES.md`
- `C:/tmp/dt009-closure/F-enumerators/ENUMERATOR_WORK_ALLOCATION.md`
