# RECRUITMENT_PACKAGE_RATING — the twelve items, for Rater 1, Rater 2 and the Rating Adjudicator

**CLASSIFICATION: PREPARATION.** No person exists. All three slots are UNFILLED. Nobody has been
recruited, approached or engaged, and no fee figure, signature, declaration, confirmation or calendar
date appears anywhere below.

Register role strings: `rater-1`, `rater-2`, `rating-adjudicator` (`lib/personnel.mjs:6`). Each is held
by **exactly one** person (`:26`).

> ## THE ORDERING CONSTRAINT THAT GOVERNS THIS TRIO
>
> §4A.3: *"The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is
> recorded in the personnel register, and its SHA-256 fingerprint is published, **before the held-out
> commitment transaction is broadcast** (§12.1)."*
>
> Everything else in this file is ordinary recruitment. **This is the one item that cannot be done late
> and cannot be repaired.** `check-personnel` has no clock and no chain and knows nothing of it.

---

## 1. Role descriptions

§12: **≥ 2 independent raters** [NORMATIVE]. Each rater applies the §10.1 decision procedure with the
§10.2 agreement rules to every held-out company × field, from the §12 rater packet. The **rating
adjudicator** resolves rater disagreements from the blinded §12.2 packet; *"adjudicated values are
flagged"*.

Rating covers **held-out only** — 60–300 observations per rater, since the held-out set is 20–100
companies × 3 fields (dt008 `RATING_WORKLOAD_NOTE.md` §1, verified mechanically there). The operator
cannot choose where in the range to sit; the sizing rule does.

Presentation order is **derived, not seeded**: `order_key(label, candidate_id, field) =
SHA-256("cpg-u1-rater-order/v1|" + ho_record_sha256 + "|" + label + "|" + candidate_id + "|" + field)`,
sorted ascending as hex strings (§12.1). Each label gets its **own** order, and `ho_record_sha256`
*"cannot be known before the held-out drand round exists"*.

## 2. Eligibility requirements

§12's Eligibility row, verbatim: *"Must not have implemented CPG, the protocol or the tooling; must hold
no other §4A.3 role; must satisfy §4A.1."*

Mechanically enforced distinctness, in two places each:

| Rule | Where |
|---|---|
| The two sheets were not rated by the same person | `lib/ratings.mjs:97` at resolution time; `analyze` condition 3 (`lib/analysis.mjs:199`) at analysis time |
| The rating adjudicator is neither rater | `lib/ratings.mjs:98` |

## 3. Prohibited relationships

`PROHIBITED_RELATIONSHIPS.md` for the three families and the 36 + 9*d* pair set. Rating-specific:

- adjudicator ∉ {rater-1, rater-2} — refused by `lib/ratings.mjs:98`;
- rater-1 ≠ rater-2 — refused by `lib/ratings.mjs:97`.

As with the reference adjudicator, **the rating adjudicator cannot enumerate the counterparties their
own declaration key 5 is about**: §12.2 forbids them from receiving *"rater identities"*. The pairwise
item-6 check is the operator's.

## 4. Independence declaration

The seven frozen `DECLARATION_KEYS`, every answer the literal `"no"`. Key 7
(`ran_or_saw_cpg_output`) carries §12's blinding-to-the-pilot requirement, and §11 is explicit that
pilot outputs are *"held by the operator, never shown"* — a rater who has seen one answers `yes` and is
disqualified.

## 5. Fee / contract conditions

§4A.1(5) as for every role: fixed fee, in writing, **before any role material is released**, **not
contingent on any result, finding or future engagement**, SHA-256 recorded (`lib/personnel.mjs:38`: 64
lower-case hex or `null`).

**Non-contingency is sharper for raters than for anyone else.** A rater's fee that varied with
agreement, with throughput, or with the study's outcome would give the rater an interest in a label.
dt008 `FEE_AGREEMENT_TEMPLATE.md` §4 lists the terms that void the §4A.1(5) exception; they are refused
at drafting.

Three separate agreements with three distinct hashes — verified by hand, because nothing in
`checkPersonnelRegister` compares them (`CHECK_PERSONNEL_EVIDENCE.md`, experiment 2).

## 6. Material-release conditions

dt008 `RATING_MATERIAL_RELEASE_GATE.md`. Its §6 is the **hard gate** and is the reason this trio's
release differs in kind from the other five:

> the person-to-label assignment **fingerprint must be published BEFORE the held-out commitment is
> broadcast** (§4A.3, §12.1).

A BLOCK there stops the commitment broadcast, not the rating. And §6.4 of that gate names the one thing
that must not be done to work around it — back-dating or re-publishing the fingerprint, which destroys
exactly the property the fingerprint exists to create.

Order of operations, from that gate's §8: fee → declaration → organisation confirmation → pairwise
check → `check-personnel` → assignment artefact → `rater-assignment-fingerprint` → **publish the
fingerprint** → held-out commitment broadcast → (much later) packet release.

The assignment artefact carries a 256-bit nonce (dt004 `ELIGIBILITY_AND_ASSIGNMENT_WORKFLOW.md` step 4),
so publishing the fingerprint does not let anyone brute-force the assignment from the small label space.

## 7. Permitted information

§12's rater-packet row: *"Field; CPG's value or null; the source URLs CPG cited for that value (§12.3);
the sealed reference record"*, plus the §10.1 decision procedure and §10.2 agreement rules (§10.2 is
marked *"[NORMATIVE; published to raters]"*), in the label's own §12.1-derived order.

§12.3 defines the URL set exactly: the **ordered, deduplicated set of URLs carried by that field's final
evidence records** — `grounding.facts[<field>].evidence[i].sourceUrl` and nothing else. *"Post-hoc
favourable selection is prohibited"* and would be a §18.3 violation. `verify-rater-packet` rebuilds the
packet and requires byte identity, so a hand-edited URL set is refused.

The adjudicator receives only the §12.2 packet: the identical rater packet per **disagreeing**
observation, the §10.1 procedure, the §10.2 rules, and the two labels **unlabelled** as Label A / Label
B. Label A is rater 1's iff the first hex digit of `order_key("rating-adjudicator-label-a", …)` is even.

## 8. Prohibited information

§12's Blinding row: raters are blind *"to each other's labels, to running tallies and aggregates, and to
the development pilot"*.

§12.2, the adjudicator *"never receives"*:

> *which rater gave which label, or rater identities; other observations' labels; tallies, aggregates or
> provisional endpoint values; class prediction, stratum, split or identity-hazard note; pilot outputs;
> the number of disagreements.*

§12.2 also states **what cannot be hidden**, and it must be said to candidates rather than glossed:
*"U1 is single-arm, so the company and the CPG output for the item are necessarily visible, and no arm
identity exists."*

One noted-not-designed-around item: the rater packet carries the reference team's pseudonyms and each
row's contest status (dt008 `RATING_INTEGRITY_NOTES.md` §5). It is recorded, and it is not worked around.

## 9. Confidentiality requirements

`CONFIDENTIALITY_REQUIREMENTS.md` K-1…K-7 plus the role's K-8:

- **Rater 1 / Rater 2**: no disclosure of labels to the other rater or to the adjudicator; no seeking of
  the other's labels, any running tally or any aggregate.
- **Rating Adjudicator**: no seeking which rater gave which label, rater identities, other observations'
  labels, any tally or provisional endpoint value, or **the number of disagreements**.

**K-3 has a tail for this trio specifically.** §6.5(a): for a held-out company, a preview occurs if CPG
is executed or its stored output read *"at any time before the authorised run starts, **or after it
completes**"*. Raters see held-out companies **after** the run. A rater who looks a held-out company up
in CPG out of curiosity, after rating, has caused `STUDY_VOID_PREVIEW` — the study is VOID, and
*"nothing is repaired or replaced"*.

## 10. Deliverables

`DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` §4 and §5:

| Slot | Deliverable |
|---|---|
| Rater 1 / Rater 2 | one sheet over **every** held-out company × field — 6 `RATING_COLUMNS` (`lib/ratings.mjs:17`), label from the closed seven-member `RATING_LABELS` set (`lib/packets.mjs:8`) or `pending` |
| Rating Adjudicator | one decision per disagreeing item — `LABEL_A` / `LABEL_B` / `REFERENCE-AMBIGUOUS`, `rationale` required, `adjudicated_at` as `YYYY-MM-DD` |

The adjudicator does **not** write `sub_reason`: it is carried over mechanically from whichever rater's
label was chosen (`lib/ratings.mjs:116-118`).

## 11. Acceptance criteria

`DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` §4 (RT-1…RT-6) and §5 (AD-1…AD-8).

**The criterion that must be stated as a negative:** acceptance is **not** agreement with the other
rater. α is a run-level condition (§12, §15.5(3)), it is computed on the raters' **own** labels so
adjudication cannot change it (dt008 `RATING_INTEGRITY_NOTES.md` §3), and rejecting or re-briefing a
rater for disagreeing would manufacture the agreement α exists to measure. The correct response to low
α is to report INCONCLUSIVE under §15.5(3).

`pending` is a permitted value — *"never imputed, never scored"* — and a rater may not be pressed to
replace one with a label.

The adjudicator's workload is **structurally unknowable**, because the disagreement count is information
they may never receive (dt008 `RATING_WORKLOAD_NOTE.md` §5). No "N items in M days" criterion can exist
for that slot.

## 12. Replacement if a slot holder becomes ineligible

`REPLACEMENT_PROCEDURE.md` §2.2 and §2.3. This trio has the hardest case in the study:

| When | Outcome |
|---|---|
| **Before the fingerprint is published** | Replaceable under the ordinary gate |
| **After the fingerprint is published** | **No replacement.** A substitute under the same label contradicts a fingerprint published before the commitment broadcast; a substitute under a new label means the published fingerprint no longer describes the study. Re-publishing it is prohibited (R-5) |
| **Consequence of no replacement** | Labels stay `pending`; §15.5(3) — fewer than 2 independent raters, or under 90% of observations completely rated, or α < 0.667 — makes the run **INCONCLUSIVE**. For the adjudicator: §12's ceiling — every primary endpoint **UNADJUDICATED**, *"the evidence rung cannot exceed Rung 2"*, and *"no claim of independent validation may be made"* |
| **A false declaration (T-1)** | §4A.1 routes falsified **rater** work to *"the §12 UNADJUDICATED consequences"* — the same ceiling as unavailability, which is the conservative reading and the one the protocol states |

§12's closing sentence is the rule for all of it: **"The protocol is not weakened to accommodate
unavailability."**

---

## What remains blocked on the operator for these three slots

| # | Blocked | Why |
|---|---|---|
| T-1 | Three people | No candidate exists. §19.3(3) names ≥ 2 raters and a rating adjudicator as prerequisites, *"or a recorded absence of raters with the §12 ceiling"* |
| T-2 | The assignment artefact, its 256-bit nonce, and the fingerprint — **published before the held-out commitment broadcast** | The hard gate. It cannot be done late |
| T-3 | Three separately hashed fee agreements, hand-compared for distinctness | Nothing in the instrument compares them |
| T-4 | Three organisation confirmations | Issued by the developing organisation |
| T-5 | Whether §19.3(3)'s *"recorded absence of raters"* path is being held open as a fallback | §12 permits execution without raters at the Rung 2 ceiling. Deciding this **after** seeing results would be a §15.2 violation, so it must be decided now |
| T-6 | The three anchor dates | No calendar date may appear in this package |
