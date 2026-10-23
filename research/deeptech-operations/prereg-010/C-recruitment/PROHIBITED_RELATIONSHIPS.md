# PROHIBITED_RELATIONSHIPS — the relationships that disqualify, for all eight roles

**CLASSIFICATION: PREPARATION.** No person exists. No relationship has been assessed, because there is
nobody to assess.

Prior waves covered the enumerator pair (dt009 `NON_DEPENDENCE_CONDITION.md`) and the per-role
declaration forms. This file states the prohibition **as one closed enumeration covering all eight
roles**, in both directions, and separates the three families of prohibited relationship that §4A
actually contains — because they have different scopes and different consequences.

---

## 1. The three families

| Family | Prohibits a relationship with | §4A source | Declaration key |
|---|---|---|---|
| **F-1 — Organisational / economic** | the **developing organisation** (the entity that develops, owns or operates CPG or Omnivyra, **and any affiliate**) | §4A.1(1)–(4) | keys 1–4 |
| **F-2 — Relational** | **another person**: anyone who developed CPG, the operator, or any holder of another §4A.3 role | §4A.1(6) | key 5 |
| **F-3 — Participatory** | the **artefact**: having implemented CPG / the protocol / the tooling / the registry, or having run or seen CPG output | §4A.2(a)–(b) | keys 6–7 |

They differ in an important way: **F-1 and F-3 can be assessed one person at a time. F-2 cannot.** F-2
is a property of a **pair**, so it must be checked over every pair, in both directions, and it must be
re-checked whenever any person is added or replaced.

---

## 2. F-1 — organisational and economic, verbatim

§4A.1, a person is **not independent** and may hold no §4A.3 role if at any time in the exclusion
period the person:

> 1. *is or was employed by the developing organisation, in any capacity;*
> 2. *has or had any contract, engagement or other work (paid or unpaid) for it, other than the
>    engagement in item 5;*
> 3. *received any payment or benefit from it, other than the fee in item 5;*
> 4. *holds equity, options or any other financial or organisational interest in it;*

Four things in that text are easy to under-read, and each one widens the prohibition:

| Phrase | What it widens |
|---|---|
| *"and any affiliate"* (in the definition of developing organisation) | The prohibition is not limited to one legal entity |
| *"in any capacity"* (item 1) | Contractor, intern, advisor, board member, volunteer |
| *"paid or unpaid"* (item 2) | An unpaid engagement disqualifies exactly as a paid one does |
| *"any other financial or organisational interest"* (item 4) | Not only equity and options. An organisational interest need not be financial at all |

**The exclusion period is long:** *"from the first repository commit of the developing organisation's
product until publication of this study's results."* It is retrospective to the product's first commit,
so a relationship that ended years ago still disqualifies.

### The one permitted exception, and its four conditions
§4A.1(5): a fixed fee for the study role, which must be
(a) **agreed in writing**, (b) **before any role material is released**, (c) **not contingent** on any
result, finding or future engagement, and (d) **hash recorded** (SHA-256).

`lib/personnel.mjs:38` checks only (d), and only its shape: `study_fee_agreement_sha256` must be 64
lower-case hex **or the JSON literal `null`** (no fee). (a), (b) and (c) are unverifiable by any tool.
dt008 `FEE_AGREEMENT_TEMPLATE.md` §4 lists the terms that void the exception, and they must be refused
at drafting, not caught at hashing.

---

## 3. F-2 — the relational prohibition, and the pair matrix

§4A.1(6), verbatim:

> *"is the spouse or partner, a family member or a household member of, or has a current or former
> direct reporting relationship with, any person who developed CPG, the operator (key custodian), or
> any holder of another §4A.3 role."*

Four relationship types (spouse/partner · family member · household member · current **or former**
direct reporting relationship) against three counterparty classes (CPG developers · the operator · any
other §4A.3 role holder).

### 3.1 The pair set that must be checked

Nine named parties: the operator, ENUMERATOR_A, ENUMERATOR_B, REFERENCE_AUTHOR, REFERENCE_CONFIRMER,
REFERENCE_ADJUDICATOR, RATER_1, RATER_2, RATING_ADJUDICATOR — that is **C(9,2) = 36 unordered pairs**,
plus a pair between each of the nine and **every** member of the development team (size *d*), giving
**36 + 9d** pairs in total.

| # | Pair class | Count | Note |
|---|---|---|---|
| P-1 | Among the eight independent role holders | C(8,2) = **28** | Includes ENUMERATOR_A ↔ ENUMERATOR_B, which dt009 `NON_DEPENDENCE_CONDITION.md` treats in its own right |
| P-2 | Each independent role holder ↔ the operator | **8** | §4A.1(6) names the operator explicitly |
| P-3 | Each of the nine ↔ each CPG developer | **9d** | *"any person who developed CPG"* — not the organisation, the people |

### 3.2 Direction

*"is the spouse or partner … of, or has a … direct reporting relationship with"* — spouse, partner,
family and household are symmetric, but **a reporting relationship is not**. "A reported to B" and "B
reported to A" are different facts, and *"current or former"* makes both historical. So the check runs
**in both directions for every pair**, giving 2 × (36 + 9d) ordered questions. dt008
`ENUMERATOR_B_AUTHORIZATION.md` §5.2 established the direction point; it is restated here because it
applies to all 36 pairs and not only to the enumerator pair.

### 3.3 Why the declaration alone is not enough
Key 5 (`close_relationship_with_developer_operator_or_role_holder`) is a **single** answer, signed by
one person, about a set of counterparties that person may not know. §9.2.1 forbids telling the
reference adjudicator the Author's and Confirmer's identities; §12.2 forbids telling the rating
adjudicator the raters' identities. **So at least two of the eight cannot enumerate the counterparties
their own declaration is about.**

That is the structural reason the pairwise check is the **operator's** and not the declarant's, and it
is why a `$pairwise_item6_check` block belongs in the register (dt009's register carries one; this
package's `PENDING_PERSON_REGISTER.json` carries it forward).

### 3.4 The timing consequence
Key 5 is a statement about the other role holders. A declaration signed before the last role holder
existed cannot have been about that person. So either every declaration is signed after the full set is
known, or the earlier signatories re-sign. dt009's register records this as a per-assignment
`$declaration_date` note; this package keeps it.

---

## 4. F-3 — participatory

§4A.2(a)–(b) for enumerators, and keys 6–7 for **every** role because `DECLARATION_KEYS` is one frozen
array applied to all assignments (`lib/personnel.mjs:8-12`, applied at `:36-37`):

| Key | Prohibits |
|---|---|
| `implemented_cpg_protocol_tooling_or_registry` | having implemented CPG, this protocol, the tooling, **or the development-only registry** |
| `ran_or_saw_cpg_output` | having run CPG **or seen any CPG output**, including the development pilot and the instrument check |

§9.1 restates it per reference role (*"Have implemented CPG, the protocol or the tooling; see any CPG
output (including the development pilot)"*), and §12 restates it for raters. The register key is the
same in all three cases.

**"Seen any output" is broader than "ran".** §11: the pilot's outputs are *"held by the operator,
**never** shown to the reference team"*. A person who was shown a pilot result without running anything
answers key 7 `yes` and is disqualified.

---

## 5. The prohibition table, per role

| Role | F-1 | F-2 counterparties | F-3 | Role-specific prohibition beyond §4A |
|---|---|---|---|---|
| Enumerator A | all four items | all 8 others + operator + every CPG developer | keys 6–7, and §4A.2(b)'s *"before completing the frame"* timing | may not be the operator (§4A.2(c)), may hold no other role (§4A.2(d)), **may not be the reference adjudicator** (§4A.3) |
| Enumerator B | same | same | same | same, **plus** the five non-dependence conditions against Enumerator A (dt009 `NON_DEPENDENCE_CONDITION.md` C-1…C-5): separate fee agreements, no sub-contracting either way, neither pays nor employs the other, no shared economic interest in a common entity, item-6 exclusions applied between them |
| Reference Author | same | same | same | no communication with the Confirmer before both have submitted (§9.1) |
| Reference Confirmer | same | same | same | may not see the Author's record before submitting (§9.1) |
| Reference Adjudicator | same | same | same | may hold **no** other §4A.3 role, *"including enumerator"*, and may not introduce a new value (§9.1) |
| Rater 1 | same | same | same | may not be the rating adjudicator (`lib/ratings.mjs:98`) |
| Rater 2 | same | same | same | may not be Rater 1 (`lib/ratings.mjs:97`) |
| Rating Adjudicator | same | same | same | may be neither rater (`lib/ratings.mjs:98`) |

---

## 6. What the instrument catches, and the three gaps

`check-personnel` catches:

| Caught | Line |
|---|---|
| the operator holding an independent role | `lib/personnel.mjs:33` |
| one `person_id` in two roles | `:34` |
| a second holder of a non-enumerator role | `:26` |
| any declaration key that is not the literal `"no"` | `:37` |
| a fee hash that is neither 64 hex nor `null` | `:38` |
| a missing organisation confirmation | `:39` |

**Gap 1 — it compares strings, not people.** Two rows reading `PERSON_1` and `PERSON_2` for one human
pass every check.

**Gap 2 — a malformed `person_id` short-circuits the rest of that assignment.** `:32` executes
`continue`, so `:33`–`:39` — the collision, declaration, fee and organisation-confirmation checks — are
**never reached** for that assignment. Demonstrated in `CHECK_PERSONNEL_EVIDENCE.md` experiment 4: one
malformed `person_id` hides seven `"yes"` declarations, a non-hex fee value and a missing organisation
confirmation, and the tool reports **1 error**. **A refusal list understates incompleteness.**

**Gap 3 — nothing compares two assignments' fee hashes.** An **identical**
`study_fee_agreement_sha256` in both enumerator assignments passes with **0 errors and 0 blockers** —
`CHECK_PERSONNEL_EVIDENCE.md` experiment 2. §4A.1(5) says *"a fixed fee for **the study role**"*,
singular, and one agreement covering two people makes each enumerator's fee conditional on the other's
performance, which is the dependence dt009 `NON_DEPENDENCE_CONDITION.md` C-1 exists to forbid. **Only
the operator's own hash comparison catches it.**

`check-personnel`'s header states the overall limit in one sentence: *"It cannot verify that
declarations are true."* (`lib/personnel.mjs:3`)

---

## 7. Consequence of a prohibited relationship, by when it is found

| Found | Consequence |
|---|---|
| **Before the register is built** | The candidate is not engaged. No finding, nothing to publish |
| **After the declaration is signed, before any material is released** | The engagement stops at the gate. dt008 `MATERIAL_RELEASE_GATE.md`: release is the act that cannot be undone, which is why the gate is fail-closed |
| **After material is released, before the artefact is sealed or committed** | `REPLACEMENT_PROCEDURE.md` §2 salvage test. A false declaration is still a T-1 and is still published |
| **After the artefact is sealed or committed** | No replacement. §4A.1's per-role consequence applies and is published: enumerator → the frame is not independent (§20.18); reference → the reference truth is not independent; rater → the §12 UNADJUDICATED consequences |

§4A.1's closing sentence governs all four rows: *"This is a methodological rule; it is not a legal
determination."*

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2, §4A.3, §9.1, §9.2.1, §11, §12, §12.2, §20.18, §20.23
- `C:/tmp/dt009-merge/tooling/lib/personnel.mjs`, `lib/ratings.mjs`
- `C:/tmp/dt009-closure/F-enumerators/NON_DEPENDENCE_CONDITION.md`
- `C:/tmp/dt008-prereg/C-enumerators/ENUMERATOR_B_AUTHORIZATION.md`, `FEE_AGREEMENT_TEMPLATE.md`, `MATERIAL_RELEASE_GATE.md`
- `C:/tmp/dt004-operations/people/INDEPENDENCE_DECLARATION_TEMPLATE.md`
