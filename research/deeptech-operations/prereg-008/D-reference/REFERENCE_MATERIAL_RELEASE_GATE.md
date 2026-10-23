# REFERENCE_MATERIAL_RELEASE_GATE — the operator's fail-closed checklist before releasing material to any reference role

**Classification: PREPARATION. This document is not a gate record.** It is the blank checklist.
**No person has been recruited, no gate has been run, and no line below has been passed.** Every
verdict is an `<<UNFILLED: ...>>` marker. A copy that still contains one is **not** a gate record.

**Fail-closed.** The gate's default verdict is **BLOCKED**. It passes only when **every** line below
is explicitly PASS for the slot in question. A line that is unknown, unanswered, "probably fine",
"pending", or answered by someone other than the party named is **FAIL**. §4A.1, verbatim:
**"An unknown answer is not 'no.'"**

**Scope of "material".** This gate governs release of **any** of the following to a candidate for the
reference Author, reference Confirmer or reference adjudicator slot:

- the drawn-company sheet (company name, canonical domain, jurisdiction family, decisive identifier);
- the blank blind-record CSV;
- the §9.3 formats and §9.4 authority table **as a working instrument for this study**, i.e. the
  `REFERENCE_TEAM_PACKET.md` / `REFERENCE_ADJUDICATION_PACKET.md` working guides;
- the blinded §9.2.1 adjudication packet;
- anything else that discloses the drawn sample, or that engages the person in the role.

The **role description and this gate's own requirements** may be shown to a candidate before the gate
passes — a person cannot consent to, or be screened for, a role they have not been described. §4A.1
item 5 is the hard boundary: the **fee agreement must be signed before any role material is
released**, so recruitment conversation precedes the gate and material follows it.

Run this gate **once per slot**, and **re-run it for every slot** whenever any role-holder is added or
changed (see §8).

---

## 0. Slot under gate

| Item | Value |
|---|---|
| Slot | `<<UNFILLED: exactly one of reference-author / reference-confirmer / reference-adjudicator>>` |
| Candidate `person_id` | `<<UNFILLED: operator-assigned pseudonym; 1-64 chars from A-Z a-z 0-9 underscore hyphen>>` |
| Gate run by | `<<UNFILLED: the operator's person_id — the operator runs this gate and holds no independent role>>` |
| Gate run on | `<<UNFILLED: YYYY-MM-DD>>` |
| Material proposed for release | `<<UNFILLED: enumerate exactly what would be released if this gate passes>>` |
| Overall verdict | `<<UNFILLED: BLOCKED (default) / RELEASE PERMITTED — only if every line below is PASS>>` |

---

## 1. Declaration complete, and every key the literal `"no"`

| # | Check | Verdict |
|---|---|---|
| 1.1 | A signed `REFERENCE_INDEPENDENCE_DECLARATION.md` exists for this candidate, with a real signature and a date, and contains **no** `<<UNFILLED:` marker. | `<<UNFILLED: PASS / FAIL>>` |
| 1.2 | `employed_by_developing_organisation` is the literal string `"no"`. | `<<UNFILLED: PASS / FAIL>>` |
| 1.3 | `contract_or_work_for_developing_organisation` is `"no"`. | `<<UNFILLED: PASS / FAIL>>` |
| 1.4 | `payment_other_than_study_fee` is `"no"`. | `<<UNFILLED: PASS / FAIL>>` |
| 1.5 | `financial_interest_in_developing_organisation` is `"no"`. | `<<UNFILLED: PASS / FAIL>>` |
| 1.6 | `close_relationship_with_developer_operator_or_role_holder` is `"no"` — **and** §4 below has been completed, because this key is pairwise. | `<<UNFILLED: PASS / FAIL>>` |
| 1.7 | `implemented_cpg_protocol_tooling_or_registry` is `"no"`. | `<<UNFILLED: PASS / FAIL>>` |
| 1.8 | `ran_or_saw_cpg_output` is `"no"`. For the **adjudicator** this is doubly binding: §9.2.1 lists CPG output first among what they must never receive, and a person who has already seen it cannot be blinded afterwards. | `<<UNFILLED: PASS / FAIL>>` |
| 1.9 | No key is `unknown`, blank, `n/a`, `No`, `NO`, `false` or any variant. The register accepts **only** the lowercase string `"no"` (`lib/personnel.mjs:37`). | `<<UNFILLED: PASS / FAIL>>` |
| 1.10 | The declaration's date is **on or before** this gate's date, and **no** role-holder has been added or changed since it was signed. If one has, the declaration is **stale** and key 5 must be re-taken (§8). | `<<UNFILLED: PASS / FAIL>>` |

**Any FAIL here blocks release. A `yes` or `unknown` on keys 1.2–1.8 means the person is not
independent and may hold no §4A.3 role (§4A.1).**

---

## 2. Fee agreement signed and hashed — **before** any material is released

§4A.1 item 5, verbatim: *"a fixed fee for the study role, agreed in writing **before** any role
material is released, **not contingent** on any result, finding or future engagement; the agreement's
SHA-256 is recorded"*.

| # | Check | Verdict |
|---|---|---|
| 2.1 | Either **(a)** a written fee agreement exists, signed by both parties, **dated before** the release this gate authorises; or **(b)** there is **no fee**, and that is recorded. | `<<UNFILLED: (a) agreement exists / (b) no fee / FAIL>>` |
| 2.2 | If (a): the fee is **fixed** — a stated amount, not an hourly open-ended arrangement whose total depends on what is found. | `<<UNFILLED: PASS / FAIL / N-A (no fee)>>` |
| 2.3 | If (a): the fee is **not contingent** on any result, finding, value, agreement rate, conflict rate, or future engagement. The agreement says so in terms. | `<<UNFILLED: PASS / FAIL / N-A>>` |
| 2.4 | If (a): the agreement is the **only** engagement between this person and the developing organisation — items 2 and 3 of §4A.1 exclude every other. | `<<UNFILLED: PASS / FAIL / N-A>>` |
| 2.5 | If (a): `study_fee_agreement_sha256` is recorded as **64 lowercase hex** of the signed agreement. If (b): it is recorded as the **literal `null`**. `lib/personnel.mjs:38` refuses anything else. | `<<UNFILLED: 64 lowercase hex, or the literal null — not recorded>>` |
| 2.6 | The recorded hash was computed **from the signed file that exists**, and recomputing it now still matches. | `<<UNFILLED: PASS / FAIL>>` |
| 2.7 | **Ordering check:** the agreement's signature date is strictly **before** the date on which any material in §0 is handed over. A fee agreed after material was released does **not** satisfy item 5, and the exception it grants is then unavailable — which makes item 3 (`payment_other_than_study_fee`) fail retroactively. | `<<UNFILLED: PASS / FAIL>>` |

---

## 3. Developing organisation's written confirmation

§4A.1, verbatim: *"the developing organisation's written confirmation that its records show no
item 1–4 relationship"*.

| # | Check | Verdict |
|---|---|---|
| 3.1 | A **written confirmation from the developing organisation** exists for **this** candidate. | `<<UNFILLED: PASS / FAIL>>` |
| 3.2 | It states that the organisation's **records show no item 1–4 relationship** — employment, contract or work, payment or benefit, financial or organisational interest — during the exclusion period. | `<<UNFILLED: PASS / FAIL>>` |
| 3.3 | It is a statement about the organisation's **own records**, not a restatement of the candidate's declaration. Two copies of the same claim are one piece of evidence, not two. | `<<UNFILLED: PASS / FAIL>>` |
| 3.4 | `organisation_confirmation_sha256` is recorded as **64 lowercase hex**. It is **required and may never be `null`** (`lib/personnel.mjs:39`) — unlike the fee hash. | `<<UNFILLED: 64 lowercase hex, required — not obtained>>` |
| 3.5 | Recomputing the hash from the confirmation file still matches. | `<<UNFILLED: PASS / FAIL>>` |
| 3.6 | The confirmation covers the **exclusion period** as §4A.1 defines it — from the first repository commit of the product to publication of results — not merely "the last N years". A shorter window is **FAIL**. | `<<UNFILLED: PASS / FAIL>>` |

---

## 4. §4A.1 item 6 — the pairwise check against **every** other role-holder

Item 6 is not a property of one person. It is a property of **each pair**. It must be checked between
this candidate and: every person who developed CPG; the operator (key custodian); and **every holder
of another §4A.3 role** — each enumerator, the reference Author, the reference Confirmer, the
reference adjudicator, rater 1, rater 2, the rating adjudicator.

The relationships that disqualify: **spouse or partner; family member; household member; current or
former direct reporting relationship** — in either direction.

| Counterparty | Pair verdict |
|---|---|
| Each person who developed CPG | `<<UNFILLED: for each developer — unrelated / RELATED (disqualifying) / unknown (= FAIL)>>` |
| The operator (key custodian) | `<<UNFILLED: unrelated / RELATED / unknown>>` |
| Enumerator(s) — one line per enumerator | `<<UNFILLED: one verdict per enumerator; several enumerators are permitted (§4A.3)>>` |
| reference Author | `<<UNFILLED: unrelated / RELATED / unknown — N-A if this candidate IS the Author>>` |
| reference Confirmer | `<<UNFILLED: unrelated / RELATED / unknown — N-A if this candidate IS the Confirmer>>` |
| reference adjudicator | `<<UNFILLED: unrelated / RELATED / unknown — N-A if this candidate IS the adjudicator>>` |
| rater 1 | `<<UNFILLED: unrelated / RELATED / unknown>>` |
| rater 2 | `<<UNFILLED: unrelated / RELATED / unknown>>` |
| rating adjudicator | `<<UNFILLED: unrelated / RELATED / unknown>>` |

| # | Check | Verdict |
|---|---|---|
| 4.1 | Every pair above has an explicit verdict, and **none** is `RELATED` or `unknown`. | `<<UNFILLED: PASS / FAIL>>` |
| 4.2 | **The check was actually performed against identities**, not inferred from the candidate's `"no"`. The candidate's `"no"` on key 5 is evidence only that they know of no such relationship **among the people they know about**. | `<<UNFILLED: PASS / FAIL>>` |
| 4.3 | **The §9.2.1 collision is resolved and recorded** where the candidate is the **reference adjudicator**: item 6 needs a check against the two recorders, while §9.2.1 forbids the adjudicator ever to learn *"the identities or pseudonyms of Author and Confirmer"*. | `<<UNFILLED: operator selects and records: (i) the operator cross-checks register identities against the relationships the declarant described, so the declarant never learns the names — PREFERRED; or (ii) the operator discloses the identities under confidentiality and re-takes item 6, and the study PUBLISHES that identity blinding was broken; or (iii) other — describe>>` |
| 4.4 | Some slots are **not yet filled**, so some pairs cannot be checked. Every unfillable pair is recorded as **`unknown` = FAIL for now**, and the gate for this slot **stays BLOCKED** until the counterpart exists. Releasing material to a recorder before the adjudicator is known means item 6 was never checked for that pair. | `<<UNFILLED: PASS (all counterparts exist and are checked) / BLOCKED (list the missing counterparts)>>` |
| 4.5 | The candidate's `person_id` is **distinct** from the operator's and from every other role-holder's (`lib/personnel.mjs:33`, `:34`), and the slot is held by **exactly one** person (`:26`). | `<<UNFILLED: PASS / FAIL>>` |

---

## 5. The §9.1 no-communication undertaking

| # | Check | Verdict |
|---|---|---|
| 5.1 | **Author and Confirmer:** the undertaking not to *"communicate with the Confirmer before both have submitted"* is recorded in writing and signed (section C of the declaration form). | `<<UNFILLED: PASS / FAIL>>` |
| 5.2 | **Confirmer additionally:** the undertaking not to *"see the Author's record before submitting"* is recorded and signed. | `<<UNFILLED: PASS / FAIL / N-A>>` |
| 5.3 | **Adjudicator:** the undertakings not to *"Hold any other §4A.3 role (including enumerator)"* and not to *"introduce a new value"* are recorded and signed. | `<<UNFILLED: PASS / FAIL / N-A>>` |
| 5.4 | The two recorders have **separate channels and separate drops**. A shared inbox, shared folder, shared spreadsheet or group chat is **FAIL**: it makes the undertaking unenforceable by construction. | `<<UNFILLED: PASS / FAIL>>` |
| 5.5 | The adjudicator's channel is separate from **both** recorders'. | `<<UNFILLED: PASS / FAIL / N-A>>` |
| 5.6 | No channel used for any reference role is one **the developing organisation can read**. | `<<UNFILLED: PASS / FAIL>>` |
| 5.7 | The operator has a recorded procedure for what happens **if** the undertaking is breached, and that procedure is not "carry on". §4A.1: the finding is **published** and the reference truth is **not independent**. | `<<UNFILLED: describe the recorded procedure — not written>>` |
| 5.8 | Both recorders' windows are **concurrent** (same `D_draw`, same `W_ref`). A staggered deadline creates a period in which the earlier submission can leak into the later work, which no undertaking can undo. | `<<UNFILLED: PASS / FAIL>>` |

---

## 6. Material-specific release checks

| # | Check | Verdict |
|---|---|---|
| 6.1 | The material to be released contains **only** the §9.2 items for a recorder, or **only** the §9.2.1 packet for the adjudicator. Nothing else travels with it — no covering note describing the sample, no counts, no "this one's tricky". | `<<UNFILLED: PASS / FAIL>>` |
| 6.2 | For a recorder: the sheet carries **no** `expected_outcome_class`, stratum, split, screening-log column, contamination basis or identity-hazard note. | `<<UNFILLED: PASS / FAIL>>` |
| 6.3 | For the adjudicator: the packet was built by `reference-adjudication-packet` and **verified by rebuilding** with `verify-adjudication-packet` **before** release, against the verified instrument (`CPG_U1_INSTRUMENT` aggregate equals `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, 593 files). A packet that was not rebuilt and matched is **not released**. | `<<UNFILLED: PASS / FAIL / N-A>>` |
| 6.4 | For the adjudicator: **both** complete blind record sets are already in the operator's hands (§9.2.1 "Timing": adjudication occurs after both sets are submitted and before `seal`). | `<<UNFILLED: PASS / FAIL / N-A>>` |
| 6.5 | No CPG output of any kind — including the development pilot and the §8.5 instrument check — is in, attached to, or reachable from the released material. | `<<UNFILLED: PASS / FAIL>>` |
| 6.6 | The operator has not seen, and does not hold, anything that would let them **choose** reference values later (§9.6: *"The operator receives the seal hash only"*). | `<<UNFILLED: PASS / FAIL>>` |
| 6.7 | The release is recorded: what, to whom (by `person_id`), when, over which channel. | `<<UNFILLED: recorded — not recorded>>` |

---

## 7. What `check-personnel` does and does **not** do

This is the central limitation of the whole gate and it must not be glossed.

**What it does** (`checkPersonnelRegister`, `lib/personnel.mjs:16`):

- refuses a malformed `operator.person_id` and a malformed or missing `person_id`;
- reports `role <name> is UNFILLED` as a **blocker** for each of the seven `INDEPENDENT_ROLES` with no
  assignment (`:25`);
- refuses more than one holder of any role except `enumerator` (`:26`);
- refuses `ROLE COLLISION — the operator may hold no independent role` (`:33`);
- refuses `ROLE COLLISION — <id> already holds <role>` (`:34`);
- refuses any of the seven `DECLARATION_KEYS` whose value is not **exactly** the string `"no"` (`:37`);
- refuses a `study_fee_agreement_sha256` that is neither 64 hex nor `null` (`:38`);
- refuses a missing or malformed `organisation_confirmation_sha256` (`:39`).

**What it cannot do.** The module's own header says it *"checks its STRUCTURE"* and *"cannot verify
that declarations are true"*; §4A.3 repeats it verbatim. Specifically, `check-personnel`:

- **cannot detect a false declaration.** A `"no"` typed by someone who is in fact employed by the
  developing organisation passes every check. §4A.1: these are *"procedural evidence, not proof"*.
- **cannot detect a stale declaration.** It reads the register's current strings; it has no date field
  for the declaration, no notion of when it was signed, and **no way to know that key 5 became false
  when a new role-holder was added**. A register that was honest in week 1 and is wrong in week 6
  passes identically.
- **cannot check item 6 pairwise.** It compares `person_id`s for equality — it has no relationship
  data at all. A married Author and Confirmer with distinct `person_id`s pass.
- **cannot verify the fee's terms.** It checks only that the hash is 64 hex or `null`. A fee that is
  contingent on the finding, or agreed **after** material was released, hashes exactly as well as a
  compliant one.
- **cannot verify what a hash is a hash of.** It never sees the agreement or the confirmation, so a
  64-hex string of an unrelated file passes.
- **cannot verify the confirmation's content or its period.** A confirmation covering three years
  instead of the exclusion period passes.
- **cannot see the no-communication undertaking at all.** There is no register field for it.
- **cannot see this gate.** Nothing in the instrument enforces the §4A.1 item 5 **ordering**
  requirement that the fee be agreed before material is released.

**Therefore:** lines 1.10, 2.1–2.4, 2.7, 3.2, 3.3, 3.6, 4.1–4.4, 5.1–5.8 and 6.1–6.7 are **human
judgements the tooling will never make for you**. A green `check-personnel` is **not** a passed gate.
`REFERENCE_PACKET_VALIDATOR.mjs` in this directory closes a narrow part of the remaining gap — unfilled
markers, missing files, declaration-key strings, hash shape, and the three-distinct-persons rule — and
it is explicit about what it also cannot see.

---

## 8. Re-run triggers (a passed gate does not stay passed)

Re-run this gate for **every** reference slot whenever any of these occurs:

| Trigger | Why |
|---|---|
| Any §4A.3 role is filled, changed or vacated | Item 6 is pairwise; a new role-holder can make an existing `"no"` on key 5 false. `check-personnel` cannot detect this. |
| Any fee agreement is amended | Items 3 and 5 both depend on its terms. |
| A new organisation confirmation is issued | The hash and the covered period change. |
| A role-holder discloses a new relationship, engagement or payment | The declaration is stale by definition. |
| A role-holder reports having seen CPG output | Key 7 is false; for the adjudicator §9.2.1 is breached. |
| A channel changes | Lines 5.4–5.6 must be re-checked. |
| The registration, protocol hash or instrument aggregate changes | Line 6.3 pins the instrument aggregate. |

A re-run that fails **retroactively taints** the material already released. §4A.1: for reference work,
*"the reference truth is not independent"*, and the finding is **published**. There is no remedy that
consists of not publishing it.

---

## 9. What remains blocked on the operator

| Blocked | Why it cannot be prepared here |
|---|---|
| Every verdict on every line | Each requires a real person, a real document or a real identity. |
| Three candidates | No identity may be invented. All three slots are UNFILLED. |
| Three signed declarations | Require real signatures. |
| Fee agreements and their hashes | Must exist **before** release; only the parties can sign them. |
| Three organisation confirmations and their hashes | Only the developing organisation can issue them. |
| The whole of §4 | Needs every role-holder's identity, including roles outside the reference team. |
| The §9.2.1 / item 6 collision resolution (4.3) | A methodological decision with a publication consequence; it is the operator's to make and record, not this document's. |
| The breach procedure (5.7) | An operator commitment. |
| Channels (5.4–5.6) | Operator-supplied infrastructure. |
