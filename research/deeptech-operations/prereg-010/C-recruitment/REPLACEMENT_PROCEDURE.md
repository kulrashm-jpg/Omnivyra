# REPLACEMENT_PROCEDURE — what happens when a role holder becomes ineligible, per role

**CLASSIFICATION: PREPARATION.** No person exists. Nobody has been recruited, so nobody can yet be
replaced. This file fixes the rule **before** anyone is engaged, because the rule's whole value is
that it was written while no outcome was known.

**This is the gap this wave closes.** dt004/people, dt008-prereg/C, D and E and dt009-closure/F all
cover role descriptions, eligibility, declarations, release gates and information boundaries. None of
them says what happens when a person is lost **mid-study**. The frozen protocol never uses the word
"replacement" about a person — only about a **company** (§5.9) — so the rule has to be derived, and
every derivation step below carries its citation.

---

## 0. The three triggers

A role holder becomes **ineligible** when any of these occurs:

| Trigger | Description | Detected by |
|---|---|---|
| **T-1 — declaration falsified** | A `DECLARATION_KEYS` answer that was recorded as `"no"` is found to have been untrue when signed | disclosure; the developing organisation's records; an outsider |
| **T-2 — eligibility lost during the exclusion period** | An answer that was true when signed becomes false — a new contract, a new payment, a new financial interest, a new item-6 relationship, or the person runs or sees CPG output | the periodic re-run of the material-release gate (dt008 `MATERIAL_RELEASE_GATE.md` §8 "a passed gate does not stay passed") |
| **T-3 — unavailability** | Withdrawal, incapacity, non-response, or refusal to complete the deliverable. **Not** an independence defect | the deadline passing |

The **consequences differ sharply**, and conflating them is the main hazard this file exists to
prevent. T-1 is never a replacement problem; it is a publication problem.

---

## 1. T-1 — a false declaration is NOT repaired by replacing the person

§4A.1, verbatim:

> *"These are **procedural evidence, not proof**. If a declaration is later found false, that person's
> work is non-independent, and the finding is published:*
> - *rater work: the §12 UNADJUDICATED consequences apply;*
> - *enumerator work: the frame is not independent (§20.18);*
> - *reference work: the reference truth is not independent."*

Read that carefully. It says the **work** is non-independent and the **finding is published**. It does
not say the work is discarded, re-done by someone else, or corrected. Three consequences follow:

1. **The finding is published unconditionally.** There is no threshold, no materiality test and no
   discretion. §15.2's floor rule applies with full force: *"No observation may be excluded because
   its result is unfavourable."*
2. **Substituting a fresh person and re-doing the artefact does not remove the finding.** The original
   engagement happened; the artefact was produced by a non-independent person; that fact is now part
   of the study's record and is published whatever else is done.
3. **§4A.1 closes with** *"This is a methodological rule; it is not a legal determination."* The
   operator records the methodological consequence and stops there.

### 1.1 Per-role consequence of T-1, from the frozen text

| Role | §4A.1 consequence | What that costs, from the protocol |
|---|---|---|
| Enumerator A or B | *"the frame is not independent (§20.18)"* | §20.18: cryptographic sampling integrity "is **not** independent candidate selection (the frame is unbiased); the latter rests on enumerator independence only." The sampling proof survives; the **unbiased-frame claim does not**. There is one frozen frame F for both stages (§5.5.3, §19.1), so the loss is not confinable to one stage or one jurisdiction family |
| Reference Author, Confirmer or Adjudicator | *"the reference truth is not independent"* | Every label in §10.1 is computed against sealed reference truth. §9.8's `SOURCE-COINCIDENT` cap and §14's R4 level both presuppose reference independence. The endpoints still compute; the claim that they were scored against independent truth does not survive |
| Rater 1, Rater 2 or Rating Adjudicator | *"the §12 UNADJUDICATED consequences apply"* | §12: *"every primary endpoint is labelled **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of independent validation may be made.**"* §15.5(3) is separate and additive: fewer than 2 independent raters is a run-level INCONCLUSIVE condition |

### 1.2 The §12 wording is about unavailability, and §4A.1 routes a falsified rater to it anyway

§12's paragraph begins *"If independent raters are unavailable"*, i.e. it is written for T-3. §4A.1
nevertheless directs falsified **rater** work to *"the §12 UNADJUDICATED consequences"*. So a rater
whose declaration is found false is treated exactly as if that rater had never been available — which
is the conservative reading, and is the reading the protocol states. Recorded here so no one later
argues that a falsified rater is *less* damaging than an absent one.

### 1.3 T-1 discovered after publication

The exclusion period runs *"from the first repository commit of the developing organisation's product
until publication of this study's results"* (§4A.1). A relationship formed **after** publication is
outside the exclusion period and is not a T-1. A relationship formed **before** publication and
discovered after it is a T-1, and §4A.1's "the finding is published" then means a published correction
against the already-published result. No mechanism in the protocol un-publishes anything.

---

## 2. T-3 — the salvage test

For withdrawal or incapacity, a replacement is sometimes permissible. The test has **two conditions,
both required**:

> **S-1 — the lost person's artefact is not yet sealed or committed.**
> **S-2 — no held-out outcome information exists that the replacement could be selected against.**

S-2 is the reason S-1 is not sufficient on its own, and it is the condition that prior waves did not
state. It is derived from the same reasoning §5.9 gives for companies:

> *"Reason: replacement after the draw lets the reference team reject hard-to-document companies, and
> documentation difficulty plausibly correlates with CPG's own difficulty."* (§5.9)

§5.9 is about companies, so it does not govern people by its terms. Its **reasoning** transfers
exactly: a substitution made once outcomes are visible is a degree of freedom that can be exercised
toward a favourable result, and the protocol's whole architecture is the removal of such degrees of
freedom. §15.2 states the general prohibition: *"Exclusion rules may not change after any held-out
result is seen."* This file therefore treats S-2 as an **operating default under DR-8**, not as a
protocol ruling — it is the conservative reading, and it is recorded as a reading.

### 2.1 The three sealing/commitment boundaries, in order

| Boundary | Artefact fixed | Protocol / instrument authority |
|---|---|---|
| **B-1 — frame committed** | The single frozen frame F, named in the development commitment payload and required identical in the held-out one | §5.5.3; §19.1 "single frozen frame"; `STAGE_VOID_BINDING_MISMATCH` (§5.10) if a held-out frame differs from the development / registered one |
| **B-2 — rater/label fingerprint published** | The `rater-1` / `rater-2` / `rating-adjudicator` person-to-label assignment | §4A.3, §12.1; published **before** the held-out commitment is broadcast |
| **B-3 — seal computed and published** | Both manifests, both screening logs, sizing, the three blind-record files and the reconciled reference file | §9.6; §6.5 (the window opens at the published seal record's registry timestamp) |

### 2.2 The salvage table

| Role | Lost **before** its boundary | Lost **after** its boundary |
|---|---|---|
| **Enumerator A / B** | Replaceable. A new enumerator with the same §4A.2 receive-list re-enumerates the **allocated families of the lost slot only**; the other slot's rows are untouched. `enumerated_by` changes for those rows, `frame_hash` changes, and the frame is re-committed. Cheap because nothing is committed yet | **Not replaceable in any way that keeps the study.** The frame is named in the committed payload; a different frame is a different `frame_hash`, which is `STAGE_VOID_BINDING_MISMATCH` → study VOID (§5.10) and §18(5). Re-enumerating is not an option, and a missing row is not an option either: §5.7.2 frame sufficiency was checked against the committed frame |
| **Reference Author** | Replaceable. Blind records are per company × field and are not yet bound. The replacement re-authors **the full set** — not the remainder — because a set part-authored by two people is neither one person's independent record, and §9.5 compares *the Author's* record to *the Confirmer's* | **Not replaceable.** §9.6: *"Any post-execution change to reference truth yields a different seal hash, which does not match the published one, so the results are invalid on their face."* The `author` column is in `REFERENCE_COLUMNS` (`lib/schema.mjs:213`), so the identity is inside the sealed bytes |
| **Reference Confirmer** | Replaceable, on the same terms — full re-confirmation, and the §9.1 no-communication undertaking restarts. If the Author has already submitted, the replacement Confirmer must not have seen that record | **Not replaceable**, same as the Author. `confirmer` is also a `REFERENCE_COLUMNS` member |
| **Reference Adjudicator** | Replaceable **only if no decision has been submitted**. If some decisions were submitted, the replacement re-decides **the whole disagreement set**: the §9.2.1 packet is built deterministically from the whole set, and a packet containing a subset is refused by `verify-adjudication-packet` (*"any added information, extra or agreeing item, reordering or reassignment is refused"*, §9.2.1) | **Not replaceable.** `adjudicated_by` is a `REFERENCE_COLUMNS` member and the reconciled file is bound by the seal. §9.5: `seal` *"refuses any reference file that is not byte-identical to the reconciliation of the blind records"* |
| **Rater 1 / Rater 2** | Replaceable **only before B-2**, the published fingerprint. Once the fingerprint is published, the person-to-label assignment **is** the published artefact | **After B-2: no replacement.** A substitute under the same label contradicts a fingerprint published before the commitment broadcast; a substitute under a new label is a different assignment and the published fingerprint no longer describes the study. The §12 route is the only one left: `pending` labels are *"never imputed, never scored"*, and if the result is fewer than 2 independent ratings or under 90% complete, §15.5(3) makes the run INCONCLUSIVE. **That is the designed outcome, and it is not a defect to be engineered around** |
| **Rating Adjudicator** | Replaceable before B-2 | **After B-2: no replacement.** Same fingerprint argument. Without an adjudicator, disagreements stay unresolved; §12's *"If independent raters are unavailable"* ceiling applies — every primary endpoint UNADJUDICATED, Rung 2 maximum, no claim of independent validation |
| **Operator** | Out of scope of the eight roles, and noted because it is the sharpest case: the operator is the Bitcoin wallet-key custodian (§19.1, §19.3(2)). Losing the operator after funding but before a commitment can leave `O_dev` / `O_ho` unspendable, and §5.10 `STUDY_ABANDONED` then triggers at **180 days** — *"a restart needs a new registration citing this one"* | |

### 2.3 The uncomfortable case the table has to state plainly

**A rater lost between B-2 and the completion of rating is the case with no good outcome.** The
fingerprint binds the label assignment; the protocol forbids a substitute; and §15.5(3) then likely
makes the run INCONCLUSIVE. There is no salvage. The correct operator response is to record the
unavailability, leave the labels `pending`, run `analyze`, and report the INCONCLUSIVE outcome.

§12's last sentence is the one that settles it:

> *"The protocol is not weakened to accommodate unavailability."*

### 2.4 What is salvageable in every case

Even where the run is VOID or INCONCLUSIVE, these are retained and published, because nothing in the
protocol permits their destruction:

- the archive (§13.1) and the sampling archive (§13.2A) — both mandatory;
- the published registration, both commitment payloads and both sampling records (§13.2), from which
  both seeds remain recomputable by any outsider;
- the finding itself: §4A.1 *"the finding is published"*; §6.5 *"the finding is published"*.

§6.5 states the discipline for the VOID case in five words: *"nothing is repaired or replaced."*

---

## 3. What a replacement must NOT do — five refusals

| # | Prohibited | Why |
|---|---|---|
| R-1 | Reuse the lost person's `person_id` or pseudonym for the replacement | The register would then assert that one person did work two people did. `lib/personnel.mjs` compares `person_id` strings only (`:34`) and cannot see the substitution |
| R-2 | Have the replacement complete a partly-finished artefact | Splits one independent artefact between two people. §9.5 compares *the Author's* record with *the Confirmer's*; a half-and-half record is neither |
| R-3 | Release material to the replacement before the release gate has been run **for the replacement** | §4A.1(5) requires the fee agreed in writing *"before any role material is released"*. A gate passed for the lost person says nothing about the replacement. dt008 `MATERIAL_RELEASE_GATE.md`: release is the act that cannot be undone |
| R-4 | Choose the replacement after seeing any held-out outcome information | S-2; §15.2 *"Exclusion rules may not change after any held-out result is seen"*; §5.9's reasoning |
| R-5 | Re-publish the §4A.3 fingerprint to match a post-B-2 substitution | The fingerprint's entire evidential value is that it preceded the commitment broadcast. Re-publishing destroys exactly the property it existed to create |

---

## 4. The procedure, as an ordered sequence

1. **Classify** the trigger as T-1, T-2 or T-3. If T-1, go to step 8 — no replacement is being
   considered, only publication.
2. **Record** the ineligibility: role, trigger class, the boundary state (before/after B-1, B-2, B-3)
   and the date it was established. Written into the register as a `$replacement` entry. `$`-prefixed
   root and per-assignment keys are ignored by `checkPersonnelRegister`, so recording this **moves no
   instrument byte**.
3. **Apply the salvage test.** S-1 and S-2 both, from §2.2's table. If either fails, no replacement is
   permitted; go to step 7.
4. **Recruit** under the full gate for the replacement, from zero: eligibility, the seven declaration
   keys each the literal `"no"`, prohibited-relationship check against **every** current role holder
   in both directions, the confidentiality undertaking, a **separate** fee agreement with its own
   distinct SHA-256, and the developing organisation's confirmation.
5. **Re-run the pairwise check over the whole set.** The replacement changes every §4A.1 item-6 pair.
   A check performed before the replacement does not cover the replacement.
6. **Re-run `check-personnel`** on the amended register. It is instantaneous. It catches a reused
   `person_id` only if the string is literally identical (`:34`), so also compare fee-agreement hashes
   by hand — `check-personnel` passes a register in which two enumerators share one fee-agreement hash
   with **0 errors and 0 blockers** (`CHECK_PERSONNEL_EVIDENCE.md`, experiment 2).
7. **Where no replacement is permitted:** record the consequence from §2.2, leave the affected
   deliverable incomplete rather than imputed (§12 *"Missing ratings: `pending` — never imputed, never
   scored"*), and let `analyze` and §15.5 produce the outcome they produce.
8. **Publish** the finding. §4A.1 for a false declaration; §15.2's exclusion table and both screening
   logs for everything else. The outcome vocabulary is §10.5's — *"exactly one"* — and neither VOID
   nor INCONCLUSIVE may be described as anything else.

---

## 5. What remains blocked on the operator

| # | Blocked item | Why it cannot be settled here |
|---|---|---|
| B-1 | Whether S-2 is adopted as a standing rule or as a DR-8 operating default | It is a reading of §5.9's reasoning applied outside §5.9's terms. The operator records the disposition |
| B-2 | Whether a replacement enumerator re-enumerates only the lost slot's families or the whole frame | §2.2 proposes the lost slot's families only, since the partition is disjoint by `candidate_id` prefix (dt009 `ENUMERATOR_WORK_ALLOCATION.md`). The operator confirms |
| B-3 | The three anchor dates from which any replacement window is measured | No calendar date may appear in this package |
| B-4 | Whether a T-2 trigger discovered between B-3 and execution halts under §18(3) | §18(3) covers *"a protocol violation found mid-run"*. Whether a lapse in eligibility is such a violation is the operator's determination, and it is the difference between VOID and a published limitation |

## 6. Risks

1. **S-2 is a derivation, not a quotation.** §5.9 speaks of companies. If a reviewer rejects the
   transfer, the only written rule left is S-1, which permits substitutions the reasoning of §5.9
   argues against.
2. **"Sealed or committed" is three different boundaries** (§2.2), and a role can be past one and
   before another. The salvage table is per role for exactly this reason; a single global cut-off
   would be wrong for at least three roles.
3. **Nothing here is machine-checked.** `check-personnel` cannot see that a `person_id` is a
   replacement, that a fee hash is reused, or that a boundary was crossed. Every rule in this file is
   procedural, and §20.23 is the protocol's own statement of that limit.
4. **The rule was written before any person existed, which is its strength and its weakness.** No
   outcome could have shaped it; equally, no real ineligibility case has tested it.

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2, §4A.3, §5.5.3, §5.7.2, §5.9, §5.10, §6.5, §9.1, §9.2.1, §9.5, §9.6, §9.8, §10.5, §12, §12.1, §12.2, §13.1, §13.2, §13.2A, §14, §15.2, §15.5, §18, §19.1, §19.3, §20.18, §20.23
- `C:/tmp/dt009-merge/tooling/lib/personnel.mjs`, `lib/schema.mjs`, `lib/ratings.mjs`, `cpg_u1_data.mjs`
- `C:/tmp/dt008-prereg/C-enumerators/MATERIAL_RELEASE_GATE.md`, `D-reference/REFERENCE_MATERIAL_RELEASE_GATE.md`, `E-rating/RATING_MATERIAL_RELEASE_GATE.md`
- `C:/tmp/dt009-closure/F-enumerators/MATERIAL_RELEASE_JOINT_GATE.md`, `NON_DEPENDENCE_CONDITION.md`, `ENUMERATOR_WORK_ALLOCATION.md`
