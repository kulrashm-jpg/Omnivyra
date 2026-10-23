# ENUMERATOR_ELIGIBILITY_CHECK — the operator's gate before any material is released

**Classification: PREPARATION.** Not evidence. **No person has been recruited or approached; no
candidate exists to run this check against.** This is the empty checklist, run once per enumerator
slot plus once for the pair.

Unfilled-marker convention: `<<UNFILLED: ...>>` and `UNASSIGNED` are markers, never data. **A copy
of this checklist that still contains any marker is not a completed check.**

- Protocol basis: §4A.1 (items 1–6, the exclusion period, the recorded evidence), §4A.2(a)–(e),
  §4A.3, §19.3 item 3 — `CPG_U1_PROTOCOL_004.md` sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified).
- Instrument basis: `lib/personnel.mjs` in the registered instrument, aggregate
  `<NEW_AGG>` / <NEW_N> files (verified).

---

## 0. The hard order of operations

The gate exists because of one clause in §4A.1 item 5: the fee must be *"agreed in writing **before**
any role material is released"*. Once the frame template, §5.1–§5.4, the jurisdiction-family list or
the development-only registry has reached a person, **that release cannot be undone**, and if the
person then turns out to be ineligible, §4A.2(b) is unrecoverable for them.

```
1. Issue the role description and the blank declaration.          (no study material)
2. Sign the fixed, non-contingent fee agreement; hash it.         (no study material)
3. Receive the signed declaration.                                (no study material)
4. Obtain the developing organisation's written confirmation; hash it.
5. RUN THIS CHECKLIST — per slot, then A-to-B.
6. Build the register; run check-personnel.
7. Only now: release study material.
```

Steps 1–6 release **nothing** except this package's own instruction papers, which contain no company
and no CPG output.

---

## 1. Per-slot checklist — run once for A and once for B

Slot under check: `<<UNFILLED: A or B>>` · `person_id`: `UNASSIGNED`

### 1.1 §4A.2 eligibility, (a) through (e)

| Item | §4A.2 requirement | Evidence the operator must hold | Result |
|---|---|---|---|
| (a) | not have implemented CPG, this protocol, the tooling or the development-only registry | declaration key `implemented_cpg_protocol_tooling_or_registry` = `"no"` | `<<UNFILLED: PASS / FAIL>>` |
| (b) | not have run CPG or seen **any** CPG output (including the development pilot and instrument check) **before completing the frame** | declaration key `ran_or_saw_cpg_output` = `"no"`, **and** the operator's own record that no CPG output has been sent to this person, **and** the release log showing the person received only the §4A.2 list | `<<UNFILLED: PASS / FAIL>>` |
| (c) | not be the operator (key custodian) | `person_id` ≠ `operator.person_id`; also asked directly in declaration §B1 | `<<UNFILLED: PASS / FAIL>>` |
| (d) | hold no other §4A.3 role | the person appears in exactly one assignment in the register; asked directly in §B1; **and** explicitly not the reference adjudicator (§4A.3) | `<<UNFILLED: PASS / FAIL>>` |
| (e) | satisfy §4A.1 | §1.2 and §1.3 below | `<<UNFILLED: PASS / FAIL>>` |

Note on (b): it is a condition about the state of the world **at the time the frame is completed**,
not only at declaration time. It is therefore not a one-off check — the operator must *keep* it true
for the whole enumeration window by never sending CPG output, and must re-confirm it at submission.
Recorded below as item 5.1.

### 1.2 §4A.1 items 1–4 — the developing-organisation relationship

Exclusion period: **from the first repository commit of the developing organisation's product until
publication of this study's results.** Every item asks about *any time* in that period.

| Item | Question | Declaration key | Org confirmation covers it? | Result |
|---|---|---|---|---|
| 1 | employed by the developing organisation, in any capacity | `employed_by_developing_organisation` | **yes** | `<<UNFILLED: PASS / FAIL>>` |
| 2 | any contract, engagement or other work for it, paid or unpaid, other than the item-5 fee | `contract_or_work_for_developing_organisation` | **yes** | `<<UNFILLED: PASS / FAIL>>` |
| 3 | any payment or benefit from it other than the item-5 fee | `payment_other_than_study_fee` | **yes** | `<<UNFILLED: PASS / FAIL>>` |
| 4 | equity, options, or any other financial or organisational interest in it | `financial_interest_in_developing_organisation` | **yes** | `<<UNFILLED: PASS / FAIL>>` |

Every answer must be the string `"no"`. **§4A.1: "An unknown answer is not 'no'."** An `unknown` on
any of these four is a **FAIL** for the slot, not a question to be resolved by judgement.

### 1.3 §4A.1 item 6 — the relational exclusions

One declaration key, `close_relationship_with_developer_operator_or_role_holder`, carries **five
relationship types** against **three counterparty sets**. Both dimensions must be checked, because
the key is a single `"no"` and hides the detail.

**Relationship types** (§4A.1 item 6): spouse **or** partner · family member · household member ·
**current** direct reporting relationship · **former** direct reporting relationship.

**Counterparty sets** (§4A.1 item 6): any person who developed CPG · the operator (key custodian) ·
**any holder of another §4A.3 role**.

| Relationship × counterparty | Any person who developed CPG | The operator (key custodian) | Any holder of another §4A.3 role (incl. the other enumerator) |
|---|---|---|---|
| spouse or partner | `<<UNFILLED: no / yes / unknown>>` | `<<UNFILLED: no / yes / unknown>>` | `<<UNFILLED: no / yes / unknown>>` |
| family member | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| household member | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| current direct reporting relationship | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| former direct reporting relationship | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |

All fifteen cells must be `no`. Any `yes` or `unknown` in any cell is a **FAIL** for the slot.

> ### **No tool can verify that any of these fifteen answers is true.**
>
> This is the central honest limitation of this checklist, and it must not be softened. The
> instrument's own header says it (`lib/personnel.mjs:1–3`):
>
> > Personnel register checks (CPG_U1_PROTOCOL_004 §4A). The register itself is restricted; the
> > tooling checks its **STRUCTURE**: every independent role filled, seven roles mutually exclusive,
> > the operator in none, every §4A.1 declaration answered "no", and the §4A.1 evidence fingerprints
> > present. **It cannot verify that declarations are true.**
>
> `check-personnel` sees one string per person for the whole of item 6. It cannot see a marriage, a
> household, a family tie, or a reporting line that ended years ago. Neither can the developing
> organisation's written confirmation, which covers **items 1–4 only**. There is no database to
> query, no check to automate, and no amount of tooling that closes this. §4A.1 states the standing
> of the whole apparatus: *"These are **procedural evidence, not proof**."* The only remedies are
> the signature, the operator's own knowledge, and the published consequence if a declaration is
> later found false — for an enumerator, **the frame is not independent** (§4A.1, §20.18).

### 1.4 Recorded evidence, §4A.1 "Recorded per person"

| Required item | Field | State |
|---|---|---|
| a signed declaration answering items 1–4 and 6 and §4A.2(a)–(b) with "no" | the seven `DECLARATION_KEYS` | `<<UNFILLED: obtained? yes / no>>` |
| the fee-agreement hash (or none) | `study_fee_agreement_sha256` — 64 lowercase hex or the literal `null` | `UNASSIGNED` |
| the developing organisation's written confirmation that its records show no item 1–4 relationship | `organisation_confirmation_sha256` — 64 lowercase hex, **never** `null` | `UNASSIGNED` |

Fee-agreement sub-checks (§4A.1 item 5 — all three, or the exception does not apply):

| Condition | Result |
|---|---|
| The fee is **fixed** | `<<UNFILLED: yes / no>>` |
| Agreed **in writing before any role material was released** — verify against the release log, not against memory | `<<UNFILLED: yes / no>>` |
| **Not contingent** on any result, finding or future engagement | `<<UNFILLED: yes / no>>` |
| The recorded hash is the sha256 of the **signed** agreement | `<<UNFILLED: yes / no>>` |

### 1.5 No-AI and no-ghost-writing

| Condition | Result |
|---|---|
| The person is a real, identified human being, known to the operator outside this study's artefacts | `<<UNFILLED: yes / no>>` |
| No part of the work will be produced, drafted, suggested or checked by an AI system, agent or language model | `<<UNFILLED: yes / no>>` |
| The `person_id` pseudonym denotes a distinct real person — **the tooling cannot check this**; the README states it does not prove *"that pseudonymous IDs denote distinct real people"* | `<<UNFILLED: operator attests yes / no>>` |

---

## 2. Slot verdict

| Slot | Verdict | Signed by the operator |
|---|---|---|
| Enumerator A | `<<UNFILLED: ELIGIBLE / NOT ELIGIBLE>>` | `<<UNFILLED>>` |
| Enumerator B | `<<UNFILLED: ELIGIBLE / NOT ELIGIBLE>>` | `<<UNFILLED>>` |

**No material is released to a slot whose verdict is not `ELIGIBLE`.**

---

## 3. A-to-B relational independence — the check the seven-person package did not have to make

With **two** enumerators, each is *"a holder of another §4A.3 role"* with respect to the other.
§4A.1 item 6 therefore applies **between A and B**, in both directions, and this pairwise check is
new in the eight-person configuration.

| Direction and relationship | Result |
|---|---|
| A is the spouse or partner of B | `<<UNFILLED: no / yes / unknown>>` |
| A is a family member of B | `<<UNFILLED>>` |
| A is a household member of B | `<<UNFILLED>>` |
| A has a **current** direct reporting relationship with B (either direction) | `<<UNFILLED>>` |
| A has a **former** direct reporting relationship with B (either direction) | `<<UNFILLED>>` |
| B is the spouse or partner of A | `<<UNFILLED>>` |
| B is a family member of A | `<<UNFILLED>>` |
| B is a household member of A | `<<UNFILLED>>` |
| Same employer, same team, or a shared line manager at any time in the exclusion period | `<<UNFILLED>>` — *not itself an item-6 exclusion; record it, and record the operator's reasoning, because it is the common route to a former reporting relationship* |

**Pairwise verdict:** `<<UNFILLED: A and B are relationally independent / NOT independent>>`

Two further consequences of having two enumerators, both to be recorded here:

| Condition | Result |
|---|---|
| A and B are **distinct real people**, not one person holding two slots | `<<UNFILLED: operator attests yes / no>>` |
| Neither A nor B is, or will become, the **reference adjudicator** (§4A.3) | `<<UNFILLED: yes / no>>` |
| Neither A nor B holds any other §4A.3 role — the register shows each in exactly one assignment | `<<UNFILLED: yes / no>>` |

> **`check-personnel` catches only the last of these.** It compares `person_id` strings
> (`lib/personnel.mjs:33–35`), so it detects the same *pseudonym* used twice and nothing more. Two
> pseudonyms for one human, or two married humans, pass every structural check. **No tool can verify
> A-to-B relational independence.** It rests entirely on the two declarations and on the operator's
> own knowledge of the two people.

---

## 4. The question-5 coverage gap the operator must close

Declaration question 5 asks the person about *"any holder of another §4A.3 role"* — people whose
identities the operator holds and the declarant generally does not. A declarant who answers `no`
about a set they cannot see has written an unknown as a `no`, which §4A.1 forbids in substance even
though the register cannot detect it.

The operator closes the gap, and records **which** method was used:

| Field | Value |
|---|---|
| Method used | `<<UNFILLED: (i) operator cross-checks the identities from the restricted register against each declarant's stated relationships / (ii) operator discloses the role-holders' identities to the declarant under confidentiality and re-takes question 5 / (iii) other — describe>>` |
| If any identity was disclosed to a declarant: to whom, which identities, and on what date | `<<UNFILLED>>` |
| Residual set the operator could **not** close | `<<UNFILLED: describe, or "none">>` |
| Operator's signature on this closure | `<<UNFILLED>>` |

Method (ii) is a disclosure of study personnel and must be recorded even though it is permitted —
it is not CPG output and not study material, so it does not touch §4A.2(b).

---

## 5. Standing checks after release — item (b) is not a one-off

| Check | When | Result |
|---|---|---|
| No CPG output, pilot result, sizing output, quota or held-out count has been sent to this enumerator since release | at each contact, and at submission | `<<UNFILLED: confirmed / breach>>` |
| The enumerator re-confirms `ran_or_saw_cpg_output` = `no` **at submission**, because §4A.2(b) reaches "before completing the frame" | at submission | `<<UNFILLED: confirmed / breach>>` |
| No enumerator has been told the other's partition content, rows, or findings | at each contact | `<<UNFILLED: confirmed / breach>>` |
| The development-only registry supplied is still the registered `registry_sha256` | at release, and at submission | `<<UNFILLED: confirmed / mismatch>>` |

A breach of any of these is recorded and published; it is not fixed by re-taking the declaration.

---

## 6. Register step, and what its output will say

After both slots are `ELIGIBLE`, add both assignments and run:

```bash
node cpg_u1_data.mjs check-personnel --personnel <register>.json
```

Expect, while the other five roles are unfilled:

```
  BLOCKED role reference-author is UNFILLED
  BLOCKED role reference-confirmer is UNFILLED
  BLOCKED role reference-adjudicator is UNFILLED
  BLOCKED role rater-1 is UNFILLED
  BLOCKED role rater-2 is UNFILLED
  BLOCKED role rating-adjudicator is UNFILLED
```

with exit code `EXIT.BLOCKED` (`cpg_u1_data.mjs:716`). **That is the expected state of this
package**, not a defect: §19.3 item 3 requires all seven roles before the respective stage, and this
package fills only the enumerator slots. Any line beginning `ERROR` is a real defect in the register
and must be fixed before release.

---

## 7. What remains impossible

- Verifying that any declaration is true (`lib/personnel.mjs:3`).
- Verifying that two pseudonyms denote two people (tooling README, "What the tooling does not prove").
- Verifying any of the fifteen item-6 cells, in either slot, or any of the nine A-to-B cells.
- Verifying that a person has never seen CPG output somewhere the operator cannot observe.

These are **H3-class dependencies**: the person's independence *is* the evidence. §4A.1 says what
that is worth — procedural evidence, not proof — and what follows if it is false.

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

