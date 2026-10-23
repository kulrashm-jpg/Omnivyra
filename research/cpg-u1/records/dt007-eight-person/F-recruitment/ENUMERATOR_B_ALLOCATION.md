# ENUMERATOR_B_ALLOCATION — work allocation template, slot B

**Classification: PREPARATION.** Not evidence. **Slot B is UNFILLED. No person has been recruited or
approached.** `Enumerator B` is a slot label, not a person.

**The partition itself is deliberately not in this file.** A separate agent of
DEEPTECH-PARALLEL-007 is designing the partition rule. This document fixes the *form* the rule must
take, what B is told, and what B is never told.

This file is the mirror of `ENUMERATOR_A_ALLOCATION.md`. **The two slots are symmetric by design:**
nothing in either file gives one slot a different standing, a different instruction set or a
different quality expectation. If a future edit makes them asymmetric, that asymmetry is a
methodological decision and must be recorded as one.

Unfilled-marker convention: `<<UNFILLED: ...>>` and `UNASSIGNED` are markers, never data.

- Protocol basis: §4A.2, §4A.3, §5.1–§5.4, §5.5, §5.7.2 — `CPG_U1_PROTOCOL_004.md` sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified).
- Instrument basis: registered aggregate
  `<NEW_AGG>`, <NEW_N> files (verified).

---

## 1. Slot identity

| Field | Value |
|---|---|
| Slot | Enumerator B |
| `person_id` (pseudonym; the only identifier in any study artefact) | `UNASSIGNED` |
| Register role | `enumerator` |
| `enumerated_by` value B writes in every row | `UNASSIGNED` — **B's own pseudonym, exactly as in the register, in every row B submits** |
| Eligibility verdict | `<<UNFILLED: from ENUMERATOR_ELIGIBILITY_CHECK.md §2>>` |
| Release date | `<<UNFILLED: R — not before the OSF registration is published>>` |
| Submission deadline | `<<UNFILLED: R+N>>` |

---

## 2. B's allocation — UNFILLED

| Field | Value |
|---|---|
| Partition rule identifier and its sha256 | `<<UNFILLED: supplied by the partition-rule agent; the same rule document as A's, same hash>>` |
| B's assigned partition | `<<UNFILLED: the partition assigned to slot B by the pre-registered rule>>` |
| Row target for B | `<<UNFILLED: count, derived from the frame-sufficiency requirement by the operator — B is never told the requirement itself>>` |
| Jurisdiction families in scope for B | `<<UNFILLED: a subset of US-SEC / FR-SIRENE / BR-CNPJ / LEI-ONLY, per the rule>>` |
| `candidate_id` prefix reserved to B | `<<UNFILLED: a fixed prefix, disjoint from A's>>` |
| Overlap with A, if the rule prescribes any | `<<UNFILLED: none, or the pre-registered overlap set — identical to the value recorded in A's file>>` |

**Nothing above may be filled by guessing.**

---

## 3. The form the partition rule must take

Identical to `ENUMERATOR_A_ALLOCATION.md` §3, restated so that B's packet is self-contained. The
rule is **deterministic and pre-registered**, and must satisfy all six:

1. **Deterministic** — any outsider recomputes the same partition from the rule and its public
   inputs. No operator discretion, no seed, no judgement-based tie-break.
2. **Fixed before release** — the rule and its sha256 are recorded before any material reaches
   either enumerator and before either names a candidate.
3. **Independent of findings** — a function of the candidate space only; never of admissibility
   outcomes, class predictions, attestations, or progress so far.
4. **Total and unambiguous** — every reachable candidate falls to exactly one slot, or to a
   pre-registered overlap set declared as such in advance together with its reconciliation procedure.
5. **Free of any quota, pilot or sizing input** — the row target B receives is a bare number. The
   requirement it came from (`FRAME_MINIMUM`, `MAX_HELD_OUT_QUOTAS`, `frameSufficiency` in
   `lib/frame.mjs`) is never disclosed or hinted at (§4A.2, §5.7.2).
6. **Collision-proof on `candidate_id`** — `loadFrame` refuses the merged frame on a duplicate
   `candidate_id` (`cpg_u1_data.mjs:99`), so the id prefixes are disjoint per slot.

---

## 4. What B is told

| Told | Source |
|---|---|
| B's own partition, row target and `candidate_id` prefix | this file, §2 |
| B's own pseudonym `person_id` | the operator |
| The 22-column frame template, `templates/candidate_frame.template.csv` | §4A.2 |
| Protocol §4A and §5.1–§5.4 — and only those sections | §4A.2 |
| The jurisdiction-family list | §4A.2 |
| The frozen development-only registry, at the registered `registry_sha256` | §4A.2, §5.3 |
| `ENUMERATOR_ROLE_DESCRIPTION.md`, `ENUMERATOR_SUBMISSION_PROCEDURE.md`, `ENUMERATOR_CONTAMINATION_RULES.md`, `ENUMERATOR_EVIDENCE_HANDLING.md` | this package |
| That a second enumerator exists, and that the partition was fixed before release | this file — B needs this to understand the bounded scope, and to answer declaration question 5 honestly |
| The partition rule document itself, and its hash | so B can verify B's own scope was not adjusted mid-flight |

---

## 5. What B is never told

| Never told | Why |
|---|---|
| Pilot results | §4A.2 exhaustive never-receive list |
| Sizing output | §4A.2 |
| Quotas of any kind — development quotas, held-out quotas, frame minimums, pool multipliers | §4A.2, §5.7.2 |
| Any CPG output, including the development pilot and the instrument check | §4A.2, §4A.2(b) |
| The development / held-out split, or that any specific row is on either side | §5.5; drawn after the frame is committed |
| **A's rows, A's candidates, A's findings, A's progress or A's row count** | B must not converge on A's judgements |
| A's legal identity | unless the operator discloses it to close the question-5 gap, and records the disclosure (`ENUMERATOR_ELIGIBILITY_CHECK.md` §4) |
| Reference truth, blind records, adjudications | §9; B's class predictions are compared against them (§9.7) |
| The repository, the frozen resolver SHA clone, or the scan output | the scan is an operator task over the repository, which enumerators never see |
| Why the row target is the number it is | derived from the withheld frame-sufficiency rule |

**A and B must not communicate about this work.** Questions go to the operator, who answers both
slots identically **only** when the answer restates §5.1–§5.4 or the submission procedure, records
every question and answer, and withholds anything that would reveal the other slot's content.

---

## 6. B's deliverable

One CSV, header exactly the 22 columns of `FRAME_COLUMNS` in order, no extras and none missing, one
row per legal entity within B's partition, every cell filled per
`ENUMERATOR_SUBMISSION_PROCEDURE.md`.

| Field | Value |
|---|---|
| Filename B submits | `<<UNFILLED: operator-specified>>` |
| Delivery channel | `<<UNFILLED: operator-specified; must not be a channel the developing organisation can read>>` |
| Row count submitted | `<<UNFILLED>>` |
| `enumerated_by` used in every row | `UNASSIGNED` |
| Submission date | `<<UNFILLED: YYYY-MM-DD, on or before R+N>>` |
| Re-confirmation that `ran_or_saw_cpg_output` is still `no` at submission (§4A.2(b)) | `<<UNFILLED: yes>>` |

The operator merges A's and B's files, then runs `frame` over the merged file. B never sees the
merged file.

---

## 7. Relative schedule for slot B

Keyed to the operator-supplied **R** (registration published, registry frozen) and **N**
(enumeration window in days, `<<UNFILLED>>`). Identical to A's, and run concurrently.

| Day | Act |
|---|---|
| R+0 | Material released to B. B reads §4A, §5.1–§5.4, this file and the submission procedure **before** naming any candidate. |
| R+1 | B confirms in writing that B has read them and has no outstanding question about a tri-state rule. |
| R+1 … R+N | Enumeration within B's partition. |
| R+N | Submission. |
| R+N+2 | Operator returns every `MALFORMED` line verbatim, if any. |
| R+N+5 | B returns corrections. Repeat until zero malformed rows. |

No calendar date appears here; R and N are supplied by the operator.

---

## 8. Merge, and the one thing the operator must not do

The operator concatenates A's and B's CSVs into one frame (one header, then all rows) and runs
`node cpg_u1_data.mjs frame --frame <merged>.csv`. The merged file must satisfy, in addition to every
per-row rule:

| Constraint | Enforcement |
|---|---|
| `candidate_id` unique across the whole frame | `loadFrame` appends `duplicate candidate_id` to the row's errors (`cpg_u1_data.mjs:99`), which makes the row `MALFORMED` |
| `canonical_domain` unique across admissible rows | `assertUnique` in the draw path (`lib/select.mjs`, called from `frameSufficiency`) |
| `scheme:value` unique across admissible rows | same |

**If A and B independently enumerate the same entity, the operator must not choose which row
survives.** That would be operator discretion inside a frame whose whole value is that no one chose
its contents. The pre-registered partition rule exists precisely to make the situation impossible;
if it happens anyway, the rule was defective, and the defect and its resolution are recorded and
published rather than quietly edited away (§5.9, §15.2 — no replacement, nothing removed).

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

