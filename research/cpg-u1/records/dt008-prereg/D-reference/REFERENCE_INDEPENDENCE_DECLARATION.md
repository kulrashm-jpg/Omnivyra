# REFERENCE_INDEPENDENCE_DECLARATION — shared §4A.1 declaration form for the three reference roles

**Classification: PREPARATION. BLANK FORM. This document is not a declaration.**

**No person has been recruited. No declaration has been made, signed, dated or hashed. Nothing below
is an answer.** Every answer field is an `<<UNFILLED: ...>>` marker. A copy of this form that still
contains any marker is **not** a declaration and must never be filed, hashed, entered in the
personnel register, or cited as evidence of independence.

This form serves all three reference slots — **reference Author**, **reference Confirmer**,
**reference adjudicator**. It extends
`C:/tmp/dt004-operations/people/INDEPENDENCE_DECLARATION_TEMPLATE.md` rather than replacing it: the
additions here are the §9.1 role-specific undertakings (section C) and the explicit statement of what
a `"no"` in each key means (section B).

> **No AI system, agent or language model may make, complete, sign or answer this declaration, and
> none may hold any of these roles.** The preparer of this form is an AI and holds no role in this
> study.

---

## A. Identity and role

| Item | Value |
|---|---|
| Role being declared for | `<<UNFILLED: exactly one of reference-author / reference-confirmer / reference-adjudicator>>` |
| Pseudonymous `person_id` | `<<UNFILLED: operator-assigned; 1-64 chars from A-Z a-z 0-9 underscore hyphen; distinct from every other role-holder and from the operator>>` |
| Legal identity | held in the **restricted register only**; it never appears in any study artifact. `<<UNFILLED: recorded by the operator in the restricted register, not here>>` |
| Declaration date | `<<UNFILLED: YYYY-MM-DD, the day the declarant signs; must be on or before the material-release gate is run and must be re-taken if any role-holder changes>>` |
| Signature | `<<UNFILLED: the declarant's signature; an AI may not sign>>` |

---

## B. The seven register keys (§4A.1 items 1–4 and 6, §4A.2(a)–(b))

The register stores exactly these seven keys (`DECLARATION_KEYS`, `lib/personnel.mjs:8`), and
`lib/personnel.mjs:37` refuses **anything** but the literal string `"no"`.

> **"An unknown answer is not 'no.'"** (§4A.1, verbatim.) If you cannot answer an item, write
> `unknown` and describe what you do not know. `unknown` is a correct, honest answer; it makes you
> ineligible for this study and it does not make you dishonest. Guessing `no` would.

**Exclusion period for every item:** from the first repository commit of the developing
organisation's product until publication of this study's results. "Developing organisation" means the
entity that develops, owns or operates CPG or Omnivyra, **and any affiliate**.

| # | Key | The question you are answering | Your answer |
|---|---|---|---|
| 1 | `employed_by_developing_organisation` | At any time in the exclusion period, were you employed by the developing organisation, **in any capacity**? (§4A.1 item 1) | `<<UNFILLED: no / yes / unknown>>` |
| 2 | `contract_or_work_for_developing_organisation` | Did you have **any** contract, engagement or other work for it, **paid or unpaid**, other than this study role? (§4A.1 item 2) | `<<UNFILLED: no / yes / unknown>>` |
| 3 | `payment_other_than_study_fee` | Did you receive **any** payment or benefit from it, other than the fixed study fee in item 5? (§4A.1 item 3) | `<<UNFILLED: no / yes / unknown>>` |
| 4 | `financial_interest_in_developing_organisation` | Do or did you hold equity, options, or **any other financial or organisational interest** in it? (§4A.1 item 4) | `<<UNFILLED: no / yes / unknown>>` |
| 5 | `close_relationship_with_developer_operator_or_role_holder` | Are you the spouse or partner, a family member or a household member of — or do you have a **current or former direct reporting relationship** with — any person who developed CPG, the operator (key custodian), **or any holder of another §4A.3 role**? (§4A.1 item 6) | `<<UNFILLED: no / yes / unknown>>` |
| 6 | `implemented_cpg_protocol_tooling_or_registry` | Did you implement CPG, this protocol, the tooling or the development-only registry? (§4A.2(a), applied to the reference roles by §9.1) | `<<UNFILLED: no / yes / unknown>>` |
| 7 | `ran_or_saw_cpg_output` | Have you run CPG, or seen **any** CPG output — including the development pilot and the §8.5 instrument check? (§4A.2(b), applied by §9.1 and, for the adjudicator, by §9.2.1) | `<<UNFILLED: no / yes / unknown>>` |

**Key 5 cannot be answered from your own knowledge alone**, because you may not know who holds the
other roles — and for the **reference adjudicator**, §9.2.1 forbids you ever to learn the Author's and
Confirmer's identities. The operator's resolution is recorded, not assumed:
`<<UNFILLED: operator selects and records: (i) the operator cross-checks the register identities
against the relationships this declarant has described, so the declarant never learns the names; or
(ii) the operator discloses the role-holders' identities under confidentiality and re-takes key 5,
accepting and publishing that identity blinding is then broken; or (iii) other — describe>>`

---

## C. §9.1 role-specific undertakings

Answer only the block for the role in section A. These are **undertakings about future conduct**, not
register keys; the register has no column for them, so the operator records them with this form.

### C.1 If the role is `reference-author` (§9.1, verbatim: *"Have implemented CPG, the protocol or the tooling; see any CPG output (including the development pilot); communicate with the Confirmer before both have submitted"*)

| Undertaking | Accepted? |
|---|---|
| I will not see, run, request or accept any CPG output, including the development pilot and the instrument check, at any time before the study's results are published. | `<<UNFILLED: accepted / not accepted>>` |
| I will not communicate with the Confirmer about any company, field, source or value before **both** of us have submitted our complete record sets. | `<<UNFILLED: accepted / not accepted>>` |
| I will record `constructed_without_cpg = yes` truthfully on every row, and will construct every value from public sources I find myself. | `<<UNFILLED: accepted / not accepted>>` |
| I will not accept any class prediction, stratum, split, quota, sizing output or tally. | `<<UNFILLED: accepted / not accepted>>` |
| I will not let any AI system produce, draft or check a value I record. | `<<UNFILLED: accepted / not accepted>>` |

### C.2 If the role is `reference-confirmer` (§9.1: *"Same as Author; see the Author's record before submitting"*)

| Undertaking | Accepted? |
|---|---|
| Every undertaking in C.1. | `<<UNFILLED: accepted / not accepted>>` |
| **I will not see any part of the Author's record before I submit** — not the value, not the source, not the URL, not the search note, not any count or summary of it. | `<<UNFILLED: accepted / not accepted>>` |
| If any part of the Author's record reaches me, I will stop, not submit, and tell the operator. | `<<UNFILLED: accepted / not accepted>>` |

### C.3 If the role is `reference-adjudicator` (§9.1: *"Hold any other §4A.3 role (including enumerator); introduce a new value"*)

| Undertaking | Accepted? |
|---|---|
| I hold **no other** §4A.3 role — not enumerator, not Author, not Confirmer, not rater 1 or 2, not rating adjudicator — and I am not the operator. | `<<UNFILLED: accepted / not accepted>>` |
| **I will not introduce a new value** — in a decision, a rationale, a note or a conversation. My decision space is `RECORD_1`, `RECORD_2`, `REFERENCE-CONFLICT` and nothing else (§9.5). | `<<UNFILLED: accepted / not accepted>>` |
| I will not seek or accept anything on the §9.2.1 never-receive list: CPG output; class predictions, identity-hazard notes, stratum or split; screening logs, attestations or contamination bases; agreeing records; the identities or pseudonyms of the Author and Confirmer; any count or tally of adjudication outcomes. | `<<UNFILLED: accepted / not accepted>>` |
| I will not ask which record is the Author's, and I will report it if I am told. | `<<UNFILLED: accepted / not accepted>>` |
| I will not let any AI system read the packet for me or produce a decision or rationale. | `<<UNFILLED: accepted / not accepted>>` |

---

## D. The two hashes the register also requires

Neither is part of this declaration; both are recorded beside it. Neither may be invented.

| Register field | Rule | Value |
|---|---|---|
| `study_fee_agreement_sha256` | 64 lowercase hex **or the literal `null`** when there is no fee (`lib/personnel.mjs:38`). §4A.1 item 5 requires the written agreement **before any role material is released**, a **fixed** fee, **not contingent** on any result, finding or future engagement. | `<<UNFILLED: 64 lowercase hex of the signed fee agreement, or the literal null — not agreed>>` |
| `organisation_confirmation_sha256` | 64 lowercase hex, **required, never null** (`lib/personnel.mjs:39`): the developing organisation's **written confirmation that its records show no item 1–4 relationship**. | `<<UNFILLED: 64 lowercase hex — not obtained>>` |

---

## E. What this declaration is, and is not

§4A.1, verbatim: *"These are **procedural evidence, not proof**."*

- `check-personnel` verifies only that **each string is `"no"`** and that the two hash fields are
  well-formed. §4A.3, verbatim: *"It cannot verify that declarations are true."*
- It **cannot** detect a declaration that was true when signed and is false now (a role-holder added
  after this form was signed changes the answer to key 5), and it **cannot** detect a false one.
- If a declaration is later found false, §4A.1 applies: for **reference work**, *"the reference truth
  is not independent"*, and the finding is **published**.
- This is a **methodological rule; it is not a legal determination** (§4A.1).

## F. Declarant's statement

`<<UNFILLED: "I have read §4A.1, §4A.3 and §9.1 of CPG_U1_PROTOCOL_004. Every answer above is
complete and true to my knowledge as at the declaration date. Where I did not know, I wrote unknown
rather than no. I accept the undertakings in section C for my role. I am a human being and no AI
produced any answer above." — then signature and date>>`
