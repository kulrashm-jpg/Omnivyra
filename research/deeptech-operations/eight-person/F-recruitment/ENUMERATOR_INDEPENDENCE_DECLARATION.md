# ENUMERATOR_INDEPENDENCE_DECLARATION — blank form, to be signed by the declaring person

**Classification: HUMAN-REQUIRED INPUT.** This is a **blank** form. Nothing in it is filled.
**No person has signed it, no person has been asked to sign it, and no person named or implied in
this package exists as a recruited participant.** It may not be completed by the study operator, by
anyone in the developing organisation, or by any AI system. **Only the declaring person completes
and signs it.**

Unfilled-marker convention: every field the person or the operator must supply is
`<<UNFILLED: ...>>`, or the register's own token `UNASSIGNED`. Neither is data. **A copy of this
form that still contains any `<<UNFILLED: ...>>` marker is not a declaration.**

- Protocol basis: `CPG_U1_PROTOCOL_004.md` §4A.1 (items 1–4, 5, 6), §4A.2(a)–(b), §4A.3 — sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`, **verified by recomputation**.
- Instrument basis: `lib/personnel.mjs` of the registered instrument, aggregate
  `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files), **verified by
  recomputation**. The file is byte-identical in the worktree this form was written in.
- This form is for an `enumerator`. It is the **same declaration set** every other independent role
  signs — the seven keys are not role-specific (`lib/personnel.mjs:7`). See `RECRUITMENT_DELTA.md`.

---

## 0. The seven `DECLARATION_KEYS`, verified against the code

Read from `C:/tmp/dt004-frozen-instrument/research/cpg-u1/tooling/lib/personnel.mjs`, lines 8–12,
in the registered 593-file instrument. The array is frozen and is exactly, in this order:

```js
export const DECLARATION_KEYS = Object.freeze([
  'employed_by_developing_organisation', 'contract_or_work_for_developing_organisation', 'payment_other_than_study_fee',
  'financial_interest_in_developing_organisation', 'close_relationship_with_developer_operator_or_role_holder',
  'implemented_cpg_protocol_tooling_or_registry', 'ran_or_saw_cpg_output',
]);
```

Listed, with the protocol item each one carries:

| # | Key name, exactly as in code | Protocol source |
|--:|---|---|
| 1 | `employed_by_developing_organisation` | §4A.1 item 1 |
| 2 | `contract_or_work_for_developing_organisation` | §4A.1 item 2 |
| 3 | `payment_other_than_study_fee` | §4A.1 item 3 |
| 4 | `financial_interest_in_developing_organisation` | §4A.1 item 4 |
| 5 | `close_relationship_with_developer_operator_or_role_holder` | §4A.1 item **6** (item 5 is the permitted fee exception, not a question) |
| 6 | `implemented_cpg_protocol_tooling_or_registry` | §4A.2 **(a)** |
| 7 | `ran_or_saw_cpg_output` | §4A.2 **(b)** |

Seven keys, seven questions, one per key, **no more and no fewer**. The code comment states the
mapping itself (`lib/personnel.mjs:7`):

> `/** §4A.1 items 1–4 and 6, and §4A.2 (a)/(b) for enumerators and all roles alike. Every answer must be "no". */`

**Every answer must be `no`.** `check-personnel` refuses the register, per key, with
`declaration <key> must be "no" (got <value>) — not independent` (`lib/personnel.mjs:37`).

**§4A.1, verbatim: "An unknown answer is not 'no'."** (protocol line 145). `unknown` is a
**disqualifying** answer, not a neutral one, and not a placeholder to be tidied up later: the string
must literally be `"no"` or the register is refused. Leave nothing blank — a blank is also not `"no"`.

**Exclusion period** (§4A.1): from the **first repository commit of the developing organisation's
product** until **publication of this study's results**. Every question asks about *any time* in
that period.

**"Developing organisation"** (§4A.1): the entity that develops, owns or operates CPG or Omnivyra,
**and any affiliate**.

---

## A. Identity block

The operator assigns the pseudonym and nothing else. The legal identity stays in the restricted
register; **study artefacts carry the pseudonym only**.

| Field | Value |
|---|---|
| `person_id` — pseudonym used in every study artefact; must match `[A-Za-z0-9_-]{1,64}` (`lib/personnel.mjs:14`) | `UNASSIGNED` |
| Role applied for | `enumerator` |
| Enumerator slot | `<<UNFILLED: A or B — assigned by the operator>>` |
| Legal name (restricted register only, never in a study artefact) | `<<UNFILLED: the declaring person writes this>>` |
| Date of declaration (YYYY-MM-DD) | `<<UNFILLED: the declaring person writes this>>` |
| Signature | `<<UNFILLED: the declaring person signs here>>` |

---

## B. The seven declaration questions

Answer each with exactly one of `no` / `yes` / `unknown`. **Only `no` is a passing answer.**

| # | Register key | Question | Your answer |
|---|---|---|---|
| 1 | `employed_by_developing_organisation` | At any time in the exclusion period, were you employed by the developing organisation or any affiliate, **in any capacity**? | `<<UNFILLED: no / yes / unknown>>` |
| 2 | `contract_or_work_for_developing_organisation` | At any time in the exclusion period, did you have any contract, engagement or other work for it, **paid or unpaid**, other than the study-role fee in section C? | `<<UNFILLED: no / yes / unknown>>` |
| 3 | `payment_other_than_study_fee` | At any time in the exclusion period, did you receive any payment or benefit from it, other than the study-role fee in section C? | `<<UNFILLED: no / yes / unknown>>` |
| 4 | `financial_interest_in_developing_organisation` | Do you, or did you at any time in the exclusion period, hold equity, options, or any other financial or organisational interest in it? | `<<UNFILLED: no / yes / unknown>>` |
| 5 | `close_relationship_with_developer_operator_or_role_holder` | Are you, or were you at any time in the exclusion period, the **spouse or partner**, a **family member** or a **household member** of — or do you have, or did you have, a **current or former direct reporting relationship** with — any person who developed CPG, the study operator (key custodian), **or any holder of another §4A.3 role** (including the other enumerator)? | `<<UNFILLED: no / yes / unknown>>` |
| 6 | `implemented_cpg_protocol_tooling_or_registry` | Did you implement CPG, this protocol, the study tooling, or the development-only registry? | `<<UNFILLED: no / yes / unknown>>` |
| 7 | `ran_or_saw_cpg_output` | Have you run CPG, or seen **any** CPG output — including the development pilot and the instrument check? | `<<UNFILLED: no / yes / unknown>>` |

**Honest note on question 5.** You are being asked about *"any holder of another §4A.3 role"* — a
set of people whose identities the operator holds and you may not. You cannot answer this reliably
about people you have not been told about. Answer it about everyone you *can* assess (the developing
organisation's people, the operator, the other enumerator if the operator has told you who that is),
and write in section D exactly which parts of the set you were **not** in a position to assess. The
operator must then close the gap from the register — see `ENUMERATOR_ELIGIBILITY_CHECK.md` §4. Do
**not** write `no` to cover a set you could not see; that would be an unknown dressed as a `no`.

### B1. Additional declaration, recorded alongside the register

These are §4A.2(c)–(d), §4A.3 and the no-AI-stand-in rule. They must also be `no`. They are **not**
part of the seven machine-checked keys, so nothing refuses the register if they are wrong — only a
human reading this form catches them.

| Question | Your answer |
|---|---|
| Will any part of your work in this role be produced, drafted, suggested or checked by an AI system, language model or agent? | `<<UNFILLED: no / yes>>` |
| Are you the study operator (key custodian)? — §4A.2(c) | `<<UNFILLED: no / yes>>` |
| Do you hold, or have you applied for, any other §4A.3 role in this study? — §4A.2(d) | `<<UNFILLED: no / yes>>` |
| Specifically: are you, or might you become, the **reference adjudicator**? — §4A.3 prohibits an enumerator from holding that role | `<<UNFILLED: no / yes>>` |

---

## C. Fee arrangement — §4A.1 item 5, the only permitted payment

§4A.1 item 5, verbatim:

> — *permitted exception:* a fixed fee for the study role, agreed in writing **before** any role
> material is released, **not contingent** on any result, finding or future engagement; the
> agreement's SHA-256 is recorded.

Three conditions, all of them: **fixed**, **agreed in writing before any role material is
released**, **not contingent** on any result, finding or future engagement. A fee agreed after the
frame template reaches the enumerator does not satisfy item 5, and the exception then does not
apply — which puts the payment back under item 3.

| Field | Value |
|---|---|
| Is a fee agreed? (`yes` / `no`) | `<<UNFILLED: yes / no>>` |
| `study_fee_agreement_sha256` — 64 **lowercase** hex of the signed written agreement, or the JSON literal `null` if there is no fee | `UNASSIGNED` |
| Date the written agreement was signed — must precede release of any role material | `<<UNFILLED: YYYY-MM-DD>>` |
| Confirm the fee is **fixed** and **not contingent** on any result, finding or future engagement | `<<UNFILLED: yes>>` |

`check-personnel` requires this field to be **either 64 lowercase hex or exactly `null`**
(`lib/personnel.mjs:38`):

```js
if (a.study_fee_agreement_sha256 !== null && !HEX64.test(a.study_fee_agreement_sha256 ?? ''))
  errors.push(`${where}: study_fee_agreement_sha256 must be 64 hex or null (no fee)`);
```

An empty string, a missing field, `"none"`, `"N/A"` or an upper-case hash is **refused**. `null`
means "no fee", and it means only that.

---

## D. Notes, and any answer that is not `no`

Explain every answer that is not `no`, every part of question 5 you were not in a position to
assess, and anything a reader would need in order to judge an answer. **An `unknown` here is a
blocker, not a footnote.**

```
<<UNFILLED: the declaring person writes here>>
```

---

## E. Developing organisation's written confirmation — NOT completed by the declaring person

§4A.1 requires, per person, **the developing organisation's written confirmation that its records
show no item 1–4 relationship.** This is a separate document produced by the developing
organisation, hashed, and recorded in the register. It is **required** and can never be `null`
(`lib/personnel.mjs:39`):

```js
if (!HEX64.test(a.organisation_confirmation_sha256 ?? ''))
  errors.push(`${where}: organisation_confirmation_sha256 (developing organisation's no-relationship confirmation) required`);
```

| Field | Value |
|---|---|
| `organisation_confirmation_sha256` — 64 lowercase hex; **required**, never `null` | `UNASSIGNED` |
| Date of the confirmation (YYYY-MM-DD) | `<<UNFILLED: operator records this>>` |
| Confirmation covers items 1–4 for this person, by name, over the whole exclusion period | `<<UNFILLED: yes>>` |

Note the asymmetry, and it is deliberate: the organisation confirms **items 1–4 only**. Item 6 (the
relational exclusions) and §4A.2(a)–(b) rest on the person's own declaration and on the operator's
check. The organisation's records cannot see a marriage, a household, or who once reported to whom.

---

## F. Exactly what the register stores for this person

Schema `cpg-u1-personnel/v1` (`lib/personnel.mjs:5`). Per assignment, exactly:

```json
{
  "role": "enumerator",
  "person_id": "UNASSIGNED",
  "declaration": {
    "employed_by_developing_organisation": "<<UNFILLED: must be \"no\">>",
    "contract_or_work_for_developing_organisation": "<<UNFILLED: must be \"no\">>",
    "payment_other_than_study_fee": "<<UNFILLED: must be \"no\">>",
    "financial_interest_in_developing_organisation": "<<UNFILLED: must be \"no\">>",
    "close_relationship_with_developer_operator_or_role_holder": "<<UNFILLED: must be \"no\">>",
    "implemented_cpg_protocol_tooling_or_registry": "<<UNFILLED: must be \"no\">>",
    "ran_or_saw_cpg_output": "<<UNFILLED: must be \"no\">>"
  },
  "study_fee_agreement_sha256": "<<UNFILLED: 64 lowercase hex, or the literal null>>",
  "organisation_confirmation_sha256": "<<UNFILLED: 64 lowercase hex, required>>"
}
```

and, once at the top of the register, `operator.person_id`. **This snippet is a template. It is not
a register, and the markers are not values — a register containing them is refused, which is the
intended behaviour.**

`check-personnel` refuses the register if any of the seven keys is anything other than the string
`"no"`, if the operator's `person_id` appears in any assignment, if one person holds two independent
roles, if a fee hash is neither 64 hex nor `null`, or if a confirmation hash is missing. It reports
`BLOCKED` — separately from `ERROR` — for each of the seven roles that is **unfilled**
(`lib/personnel.mjs:25`, `cpg_u1_data.mjs:711–718`).

---

## G. What this declaration is, and is not

- **Procedural evidence, not proof** (§4A.1).
- The tooling checks **structure only**. Its own header (`lib/personnel.mjs:1–3`): *"It cannot
  verify that declarations are true."* Nothing automatable can replace the signature.
- If a declaration is later found false, the person's work is non-independent and **the finding is
  published**. For an enumerator: **the frame is not independent** (§4A.1, §20.18).
- **This is a methodological rule; it is not a legal determination.** (§4A.1)
