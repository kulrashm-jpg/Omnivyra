# ENUMERATOR_A_ALLOCATION — work allocation template, slot A

**Classification: PREPARATION.** Not evidence. **Slot A is UNFILLED. No person has been recruited or
approached.** `Enumerator A` is a slot label, not a person.

**The partition itself is deliberately not in this file.** A separate agent of
DEEPTECH-PARALLEL-007 is designing the partition rule. This document fixes the *form* the rule must
take, what A is told, and what A is never told, so that the rule can be dropped in without
renegotiating any of it.

Unfilled-marker convention: `<<UNFILLED: ...>>` and `UNASSIGNED` are markers, never data.

- Protocol basis: §4A.2, §4A.3, §5.1–§5.4, §5.5, §5.7.2 — `CPG_U1_PROTOCOL_004.md` sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified).
- Instrument basis: registered aggregate
  `<NEW_AGG>`, <NEW_N> files (verified).

---

## 1. Slot identity

| Field | Value |
|---|---|
| Slot | Enumerator A |
| `person_id` (pseudonym; the only identifier in any study artefact) | `UNASSIGNED` |
| Register role | `enumerator` |
| `enumerated_by` value A writes in every row | `UNASSIGNED` — **A's own pseudonym, exactly as in the register, in every row A submits** |
| Eligibility verdict | `<<UNFILLED: from ENUMERATOR_ELIGIBILITY_CHECK.md §2>>` |
| Release date | `<<UNFILLED: R — not before the OSF registration is published>>` |
| Submission deadline | `<<UNFILLED: R+N>>` |

---

## 2. A's allocation — UNFILLED

| Field | Value |
|---|---|
| Partition rule identifier and its sha256 | `<<UNFILLED: supplied by the partition-rule agent; the rule document and its hash>>` |
| A's assigned partition | `<<UNFILLED: the partition assigned to slot A by the pre-registered rule>>` |
| Row target for A | `<<UNFILLED: count, derived from the frame-sufficiency requirement by the operator — A is never told the requirement itself>>` |
| Jurisdiction families in scope for A | `<<UNFILLED: a subset of US-SEC / FR-SIRENE / BR-CNPJ / LEI-ONLY, per the rule>>` |
| `candidate_id` prefix reserved to A | `<<UNFILLED: a fixed prefix, so A's and B's ids can never collide>>` |
| Overlap with B, if the rule prescribes any | `<<UNFILLED: none, or the pre-registered overlap set>>` |

**Nothing above may be filled by guessing.** An allocation invented here would be an unregistered
allocation, and the partition is part of what makes the two-enumerator frame auditable.

---

## 3. The form the partition rule must take

The rule is **deterministic and pre-registered**. Concretely, it must satisfy all six of these, and
the partition-rule agent's design is checked against them:

1. **Deterministic.** Given the rule and the public inputs, any outsider recomputes the same
   partition. No operator discretion, no `--seed` argument, no tie broken by judgement.
2. **Fixed before release.** The rule and its sha256 are recorded **before** any material reaches
   either enumerator, and before either enumerator names a single candidate. A partition that can
   move after enumeration starts is a partition that can be moved *because of* what someone found.
3. **Independent of findings.** The rule is a function of the *candidate space* (for example: a
   jurisdiction family, a registry listing, a public ordering), never of what an enumerator
   discovered about a company. It may not reference admissibility outcomes, class predictions,
   contamination attestations, or row counts achieved so far.
4. **Total and unambiguous.** Every candidate the two enumerators could reach falls to exactly one
   slot — or, if the design chooses deliberate double-enumeration, to a **pre-registered** overlap
   set that is declared as such in advance, with the reconciliation procedure declared with it.
5. **Free of any quota, pilot or sizing input.** §4A.2 forbids enumerators receiving quotas, sizing
   output or pilot results. The row target the operator hands A is a bare number; the *requirement*
   it was derived from — `FRAME_MINIMUM`, `MAX_HELD_OUT_QUOTAS`, `frameSufficiency`
   (`lib/frame.mjs`) — is never disclosed, discussed, or hinted at.
6. **Collision-proof on `candidate_id`.** `loadFrame` refuses the merged frame on a duplicate
   `candidate_id` (`cpg_u1_data.mjs:99`), so the rule must reserve disjoint id prefixes per slot.

**Independence rationale for partitioning at all.** Two enumerators working the same space would
produce duplicate entities under different `candidate_id`s, and the merged frame's uniqueness
constraints (`candidate_id`, and at the admissible-row level `canonical_domain` and
`scheme:value`) would fail in a way that can only be resolved by someone choosing which row
survives — a discretionary edit to a frame that is supposed to be frozen. A pre-registered
partition removes that choice before it can be made.

---

## 4. What A is told

| Told | Source |
|---|---|
| A's own partition, row target and `candidate_id` prefix | this file, §2 |
| A's own pseudonym `person_id` | the operator |
| The 22-column frame template, `templates/candidate_frame.template.csv` | §4A.2 |
| Protocol §4A and §5.1–§5.4 — and only those sections | §4A.2 |
| The jurisdiction-family list | §4A.2 |
| The frozen development-only registry, at the registered `registry_sha256` | §4A.2, §5.3 |
| `ENUMERATOR_ROLE_DESCRIPTION.md`, `ENUMERATOR_SUBMISSION_PROCEDURE.md`, `ENUMERATOR_CONTAMINATION_RULES.md`, `ENUMERATOR_EVIDENCE_HANDLING.md` | this package |
| That a second enumerator exists, and that the partition was fixed before release | this file — A needs this to understand why the scope is bounded, and to answer declaration question 5 honestly |
| The partition rule document itself, and its hash | so A can verify A's own scope was not adjusted mid-flight |

---

## 5. What A is never told

| Never told | Why |
|---|---|
| Pilot results | §4A.2 exhaustive never-receive list |
| Sizing output | §4A.2 |
| Quotas of any kind — development quotas, held-out quotas, frame minimums, pool multipliers | §4A.2, §5.7.2 |
| Any CPG output, including the development pilot and the instrument check | §4A.2, §4A.2(b) |
| The development / held-out split, or that any specific row is on either side | §5.5; drawn after the frame is committed |
| **B's rows, B's candidates, B's findings, B's progress or B's row count** | A must not converge on B's judgements; two independent judgements are the point of having two enumerators |
| B's legal identity | unless the operator discloses it to close the question-5 gap, and records the disclosure (`ENUMERATOR_ELIGIBILITY_CHECK.md` §4) |
| Reference truth, blind records, adjudications | §9; A's class predictions are compared against them (§9.7) |
| The repository, the frozen resolver SHA clone, or the scan output | the scan is an operator task over the repository, which enumerators never see |
| Why the row target is the number it is | it is derived from the frame-sufficiency rule, which is withheld |

**A and B must not communicate about this work.** Not about candidates, not about how to read an
attestation, not about a borderline domain. Questions go to the operator, who answers both slots
identically **only** when the answer is a restatement of §5.1–§5.4 or of the submission procedure,
and who records every question and answer. An answer that would reveal B's content is not given.

---

## 6. A's deliverable

One CSV, header exactly the 22 columns of `FRAME_COLUMNS` in order, no extras and none missing, one
row per legal entity within A's partition, every cell filled per `ENUMERATOR_SUBMISSION_PROCEDURE.md`.

| Field | Value |
|---|---|
| Filename A submits | `<<UNFILLED: operator-specified>>` |
| Delivery channel | `<<UNFILLED: operator-specified; must not be a channel the developing organisation can read>>` |
| Row count submitted | `<<UNFILLED>>` |
| `enumerated_by` used in every row | `UNASSIGNED` |
| Submission date | `<<UNFILLED: YYYY-MM-DD, on or before R+N>>` |
| Re-confirmation that `ran_or_saw_cpg_output` is still `no` at submission (§4A.2(b)) | `<<UNFILLED: yes>>` |

The operator merges A's and B's files, then runs `frame` over the merged file. A never sees the
merged file.

---

## 7. Relative schedule for slot A

Keyed to the operator-supplied **R** (registration published, registry frozen) and **N**
(enumeration window in days, `<<UNFILLED>>`).

| Day | Act |
|---|---|
| R+0 | Material released to A. A reads §4A, §5.1–§5.4, this file and the submission procedure **before** naming any candidate. |
| R+1 | A confirms in writing that A has read them and has no outstanding question about a tri-state rule. |
| R+1 … R+N | Enumeration within A's partition. |
| R+N | Submission. |
| R+N+2 | Operator returns every `MALFORMED` line verbatim, if any. |
| R+N+5 | A returns corrections. Repeat until zero malformed rows. |

No calendar date appears here; R and N are supplied by the operator.

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

