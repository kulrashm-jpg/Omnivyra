# ENUMERATOR_DEADLINES — the relative schedule for both enumerator slots

**Classification: PREPARATION. Relative schedule only.** **No calendar date appears anywhere in this
file, and none may be added except by the operator, as an anchor value.** No person exists. **No one has
been recruited or approached.**

Every date in this schedule is an **offset** from an anchor the operator supplies. The offsets are
design; the anchors are facts about the world that do not yet exist. A schedule with invented calendar
dates would be a fabricated commitment, and — because §4A.1 item 5 turns on the *order* of dated acts —
a fabricated date here would corrupt the one condition the whole package is built to protect.

**Marker convention:** `<<UNFILLED: …>>` and `UNASSIGNED` are markers, never data.

Baseline, recomputed by the author of this file:

| Basis | Value |
|---|---|
| Protocol | `CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **verified** |
| Instrument | aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, **593** files, at `C:/tmp/dt002/research/cpg-u1/tooling` — **verified** |

**Relationship to what already exists.** `F-recruitment/ENUMERATOR_ROLE_DESCRIPTION.md` §9 gives a
candidate-facing relative schedule on two anchors, `S` (issue) and `R` (registration published / registry
frozen). This file is the **operator-facing** schedule: it keeps that shape, adds the third anchor the
two-enumerator configuration needs, makes the **both-slots-before-either-release** ordering of
`MATERIAL_RELEASE_GATE.md` explicit in the timeline, and states which offsets are protocol-forced and
which are operator choices.

---

## 1. The three anchors — supplied by the operator, invented by no one

| Anchor | Definition | Value |
|---|---|---|
| **D** | The day the operator **issues** the role description, the blank independence declaration and the draft fee agreement to the candidates. This is the first contact that hands anyone a document. It releases **no** study material. | `<<UNFILLED: operator supplies. A single D for BOTH slots — see §3.>>` |
| **R** | The day the **OSF registration is published** (§19.3 item 1; §5.5.1–§5.5.2). Also the point by which the development-only registry must be **frozen** (§5.3) at its registered `registry_sha256`. | `<<UNFILLED: operator supplies. Not knowable before registration.>>` |
| **W** | The day the **enumeration window opens** — the earliest day on which study material may be in an enumerator's hands. | `<<UNFILLED: operator supplies.>>` |

**Anchor constraints, which the operator must satisfy when filling them in:**

- **R ≤ W.** No material may be released before the registration is published
  (`ENUMERATOR_ROLE_DESCRIPTION.md` §9: *"study material may not be released before R"*).
- **D may precede R.** Nothing in §4A.1 or §4A.2 requires the declaration or the fee agreement to wait
  for registration, and item 5 pushes the fee agreement **as early as possible**. Issuing D early is the
  cheapest way to protect item 5.
- **D is not itself a release.** See `MATERIAL_RELEASE_GATE.md` §3: the role description, the blank
  declaration and the blank fee agreement are NOT-MATERIAL. If any §3-MATERIAL item is attached at D,
  the schedule has already failed and item 5 is unrecoverable for whoever received it.
- **W and R may be the same day.** They are separate anchors because they are separate facts, not
  because they must differ.

| Derived anchor | Definition |
|---|---|
| **G** | The **gate day** — the day `MATERIAL_RELEASE_GATE.md` closes with every box checked for **both** slots. `G = max(D + k_ready, W)`, where `k_ready` is the day both slots are complete. **G is an outcome, not a plan.** It is not scheduled; it is observed. |

---

## 2. The offsets — what is forced and what the operator chooses

Offsets are written `D+n`, `G+n`, in **days**. Two kinds, and the file keeps them apart because only one
kind is negotiable:

| Kind | Meaning |
|---|---|
| **FORCED** | Fixed by the protocol or by the instrument. Changing it breaks a rule. |
| **CHOICE** | An operator parameter. The letter is a placeholder; the operator supplies the number. |

| Parameter | Kind | Value |
|---|---|---|
| `n_decl` — days a candidate has to return the signed declaration and the signed fee agreement | CHOICE | `<<UNFILLED: integer days>>` |
| `n_org` — days to obtain the developing organisation's written no-relationship confirmation | CHOICE | `<<UNFILLED: integer days>>` |
| `n_check` — days for the operator to run the eligibility checks, the pairwise item-6 matrix, the register and the validator | CHOICE | `<<UNFILLED: integer days>>` |
| `N_enum` — the enumeration period, from release to submission | CHOICE | `<<UNFILLED: integer days>>` |
| `n_val` — days for frame validation, merge and the sufficiency computation after both submissions | CHOICE | `<<UNFILLED: integer days>>` |
| material release **not before W** | FORCED | §19.3, §6.5 |
| fee agreement **strictly before** any release | FORCED | §4A.1 item 5 |
| partition rule fixed **before** any release | FORCED | `PARTITION_DESIGN.md` §1 T2 / §3 clause 2 |
| both slots complete **before either** release | FORCED **by GATE-R1** (this package's conservative rule) — see §3 | `MATERIAL_RELEASE_GATE.md` §2 |

---

## 3. The schedule — one timeline, two slots, one release

The two slots run their paperwork **in parallel** and reach the gate **together**. This is the
`MATERIAL_RELEASE_GATE.md` GATE-R1 rule expressed as a schedule.

| When | Act | Who | Slot A | Slot B |
|---|---|---|---|---|
| **D+0** | Issue `ENUMERATOR_ROLE_DESCRIPTION.md`, the blank `ENUMERATOR_INDEPENDENCE_DECLARATION.md`, the blank `FEE_AGREEMENT_TEMPLATE.md` and the draft fee agreement. **No study material.** | operator | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **D+0 … D+`n_decl`** | Candidate signs the fixed, non-contingent fee agreement (or the operator records that there is no fee) and returns the signed declaration. | candidate | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **on signature** | Operator hashes the signed fee agreement to 64 **lower-case** hex and records it against **that** assignment. | operator | `UNASSIGNED` | `UNASSIGNED` |
| **D+0 … D+`n_org`** | Obtain the developing organisation's written no-relationship confirmation; hash it (no `null` path). | operator | `UNASSIGNED` | `UNASSIGNED` |
| **after both returns, ≤ `n_check` days** | Run `ENUMERATOR_ELIGIBILITY_CHECK.md` §1 per slot; then §3 A-to-B pairwise; then `ENUMERATOR_B_AUTHORIZATION.md` §5 against **every** other role-holder; then §4's question-5 coverage closure. | operator | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **then** | Re-ask question 5 of every **already-declared** role-holder, now that B exists — a declaration signed before B existed cannot have covered B (`ENUMERATOR_B_AUTHORIZATION.md` §5.2). | operator | — | — |
| **then** | Build the register; run `check-personnel` against the **593-file** instrument; expect `BLOCKED … UNFILLED` for the unrecruited roles and **zero** `ERROR` lines. | operator | — | — |
| **then** | Run `ENUMERATOR_PACKET_VALIDATOR.mjs` on the candidate packet. | operator | — | — |
| **not before R** | Publish the OSF registration; freeze the development-only registry at its registered hash. | operator | — | — |
| **not before W** | Enumeration window opens. | — | — | — |
| **G = max(D + k_ready, W)** | **THE GATE.** Run `MATERIAL_RELEASE_GATE.md` end to end. Any unchecked box **blocks both**. | operator | — | — |
| **G+0** | **Release, to A and B in one act**: frame template; §4A and §5.1–§5.4; the jurisdiction-family list; the frozen development-only registry; the filled `ENUMERATOR_{A,B}_ALLOCATION.md`; `ENUMERATOR_SUBMISSION_PROCEDURE.md`; `ENUMERATOR_CONTAMINATION_RULES.md`; `ENUMERATOR_EVIDENCE_HANDLING.md`. Append every item, with its sha256, to the release log. | operator | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **G+0 … G+`N_enum`** | Enumeration. Standing checks at every contact (`ENUMERATOR_ELIGIBILITY_CHECK.md` §5). | enumerators | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **G+`N_enum`** | **Submission deadline, the same day for both slots.** Each re-confirms `ran_or_saw_cpg_output` = `no` at submission, because §4A.2(b) reaches *"before completing the frame"*. | enumerators | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **G+`N_enum` … +`n_val`** | Validate each submission; merge; reconcile every row's `enumerated_by` against the register (no tool does this — `RECRUITMENT_DELTA.md` §9 Q4); run `check-frame-sufficiency` on the merged frame. | operator | — | — |
| **if short** | Top-up: *"produce more rows in **your** families"*. Carries no class count and no ratio — §5.5.3's Enumerator barrier and `PARTITION_DESIGN.md` test T2. New deadline: `G+`N_enum`+`<<UNFILLED: integer days>>`. | operator → enumerators | `<<UNFILLED>>` | `<<UNFILLED>>` |

### Why the two slots share one release day and one deadline

- **One release day** is GATE-R1 (`MATERIAL_RELEASE_GATE.md` §2): the conservative reading of §4A.1
  item 5's *"before any role material is released"*, adopted because it is safe under **both** readings
  of that clause, while the permissive reading is not recoverable if it turns out to be wrong. The formal
  DR-8 ruling is Agent 1's; until it exists, the schedule assumes one release day.
- **One submission deadline** keeps the partition from becoming outcome-dependent. Staggered deadlines
  give the operator the first enumerator's rows while the second is still working, and any instruction to
  the second that is informed by the first's output is a partition that moved because of what someone
  found — the §5.5 defect protocol-004 §0.0 item 1 exists to close.

### If one slot completes and the other does not

The gate blocks. The operator's options, in order of preference:

1. **Wait.** Extend `n_decl` / `n_org` / `n_check` and hold the release. Costs schedule only.
2. **Replace the incomplete slot** and restart that slot's paperwork at a new `D` for that slot alone.
   The completed slot's fee agreement stays valid — it was signed before any release, and no release has
   happened. The pairwise item-6 matrix must be **re-run in full** against the new candidate, in both
   directions, and question 5 re-asked of every other role-holder.
3. **Drop to one enumerator.** Protocol-valid (§4A.3: `enumerator (≥ 1)`), but the partition was designed
   for two: re-derive the single-enumerator work allocation **before** release, record the change and its
   reason, and do not release a two-enumerator allocation to one person.

**Not an option:** releasing to the complete slot while the other is pending. That is the one act this
schedule exists to prevent.

---

## 4. Ordering constraints, as assertions the operator can check

Stated as inequalities so they can be checked against the release log rather than recalled:

| # | Constraint | Basis |
|--:|---|---|
| O1 | `fee_signed(A) < first_release(A)` **and** `fee_signed(B) < first_release(B)`, strictly | §4A.1 item 5 — required under **both** readings |
| O2 | `fee_signed(A) < G` **and** `fee_signed(B) < G`, and `first_release(A) = first_release(B) = G` | GATE-R1, the conservative reading |
| O3 | `declaration_signed(x) ≤ G` for every slot `x` | §4A.1 "Recorded per person" |
| O4 | `org_confirmation(x) ≤ G` for every slot `x` | §4A.1; `organisation_confirmation_sha256` has no `null` path |
| O5 | `partition_rule_hash_recorded < G` | `PARTITION_DESIGN.md` §3 clause 2 |
| O6 | `registry_frozen ≤ R ≤ W ≤ G` | §5.3, §19.3 |
| O7 | `registration_published = R < G` | §19.3 item 1; `ENUMERATOR_ROLE_DESCRIPTION.md` §9 |
| O8 | `candidate_id` prefixes recorded `< G` | `ENUMERATOR_AB_DIFFERENCES.md` §3 |
| O9 | `submission(A) = submission(B) = G + N_enum` | §5.5 / §0.0 item 1 — outcome-independent composition |
| O10 | No CPG output, pilot result, sizing output or quota reaches either slot at **any** time | §4A.2, §5.5.3, §5.7.2 — not a schedule constraint but a standing one |

**No tool checks any of O1–O10.** They are checked by reading the release log against the dated
documents, at the gate. That is why the release log must be append-only and must record each item's
sha256.

---

## 5. Filled-in schedule — blank

The operator fills the anchors and the choice parameters, and derives the rest. **Nothing below is
filled, and no value here may be guessed.**

| Anchor / parameter | Value |
|---|---|
| D — issue day | `<<UNFILLED: YYYY-MM-DD, operator-supplied>>` |
| R — registration published | `<<UNFILLED: YYYY-MM-DD, operator-supplied>>` |
| W — enumeration window opens | `<<UNFILLED: YYYY-MM-DD, operator-supplied>>` |
| `n_decl` | `<<UNFILLED: integer days>>` |
| `n_org` | `<<UNFILLED: integer days>>` |
| `n_check` | `<<UNFILLED: integer days>>` |
| `N_enum` | `<<UNFILLED: integer days>>` |
| `n_val` | `<<UNFILLED: integer days>>` |
| G — gate day, observed as `max(D + k_ready, W)` | `<<UNFILLED: not scheduled; recorded when the gate closes>>` |
| Submission deadline, both slots | `<<UNFILLED: G + N_enum>>` |
| Slot A `person_id` | `UNASSIGNED` |
| Slot B `person_id` | `UNASSIGNED` |

---

## 6. What this schedule does not do

- It does not commit anyone to anything. There is no counterparty.
- It does not assert that D, R or W are near, scheduled or achievable.
- It does not assume any anchor is in the future or the past relative to today; it states only the
  relations among the anchors.
- It does not schedule anything after frame merge. Sizing, the development commitment, the held-out
  commitment and the §6.5 execution window are outside this package and outside what any enumerator may
  ever be told.
