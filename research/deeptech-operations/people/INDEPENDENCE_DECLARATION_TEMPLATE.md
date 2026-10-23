# CPG-U1 — Independence declaration (BLANK TEMPLATE)

**Classification: HUMAN-REQUIRED INPUT.** This is a blank form. Nothing in it is filled, and nothing
in it may be filled by the study operator, by anyone in the developing organisation, or by any AI
system. **Only the declaring person completes and signs it.**

- Protocol basis: `CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2 (sha256 `c50fc680…df00b719`).
- Key set: the seven `DECLARATION_KEYS` of `lib/personnel.mjs` (tooling aggregate
  `f7699f05…5eb04e5cc5dd`). The register carries exactly these keys, no more and no fewer.

---

## A. Identity block (the person completes; the operator assigns only the pseudonym)

| Field | Value |
|---|---|
| `person_id` (pseudonym used in every study artifact; must match `[A-Za-z0-9_-]{1,64}`) | `UNASSIGNED` |
| Role applied for (one of: `enumerator`, `reference-author`, `reference-confirmer`, `reference-adjudicator`, `rater-1`, `rater-2`, `rating-adjudicator`) | `UNASSIGNED` |
| Legal name (held **only** in the restricted register, never in a study artifact) | |
| Date of declaration (YYYY-MM-DD) | |
| Signature | |

The real identity stays in the restricted register. Study artifacts carry the pseudonym only.

---

## B. The seven declaration questions

**Every answer must be `no`.** A `yes` to any question means the person is **not independent** and
may hold **no** role in §4A.3. §4A.1: **"An unknown answer is not 'no'."** Leave nothing blank; if
you do not know, write `unknown` and say why in section D — `unknown` is a disqualifying answer,
not a neutral one.

**Exclusion period** (§4A.1): from the **first repository commit of the developing organisation's
product** until **publication of this study's results**. Every question below asks about *any time*
in that period.

**"Developing organisation"** means the entity that develops, owns or operates CPG or Omnivyra, and
**any affiliate**.

| # | Register key | Question — answer `no` / `yes` / `unknown` | Your answer |
|---|---|---|---|
| 1 | `employed_by_developing_organisation` | At any time in the exclusion period, were you employed by the developing organisation, **in any capacity**? | |
| 2 | `contract_or_work_for_developing_organisation` | Did you have any contract, engagement or other work for it, **paid or unpaid**, other than the study-role fee in section C? | |
| 3 | `payment_other_than_study_fee` | Did you receive any payment or benefit from it, other than the study-role fee in section C? | |
| 4 | `financial_interest_in_developing_organisation` | Do or did you hold equity, options, or any other financial or organisational interest in it? | |
| 5 | `close_relationship_with_developer_operator_or_role_holder` | Are you the spouse or partner, a family member or a household member of — or do you have a current or former **direct reporting relationship** with — any person who developed CPG, the study operator (key custodian), or any holder of another §4A.3 role? | |
| 6 | `implemented_cpg_protocol_tooling_or_registry` | Did you implement CPG, this protocol, the study tooling, or the development-only registry? | |
| 7 | `ran_or_saw_cpg_output` | Have you run CPG, or seen **any** CPG output — including the development pilot and the instrument check? | |

Mapping: questions 1–4 and 5 are §4A.1 items 1–4 and 6; questions 6 and 7 are §4A.2(a) and (b),
applied to **every** role, not only enumerators (`lib/personnel.mjs:7`).

### B1. Additional declaration, all roles

| Question | Your answer (`no` / `yes`) |
|---|---|
| Will any part of your work in this role be produced, drafted, suggested or checked by an AI system, language model or agent? | |
| Are you the study operator (key custodian)? | |
| Do you hold, or have you applied for, any other §4A.3 role in this study? | |

These three must also be `no`. They are procedural conditions of §4A.2(c)–(d), §4A.3 and the
no-AI-stand-in rule; they are recorded alongside the register but are **not** part of the seven
machine-checked keys.

---

## C. Fee arrangement (§4A.1 item 5 — the only permitted payment)

§4A.1 item 5 is a **permitted exception**: a **fixed fee** for the study role, agreed **in writing
before any role material is released**, and **not contingent** on any result, finding or future
engagement. The agreement's SHA-256 is recorded.

| Field | Value |
|---|---|
| Is a fee agreed? (`yes` / `no`) | |
| `study_fee_agreement_sha256` — 64 lowercase hex of the signed written agreement, or `null` if no fee | `UNASSIGNED` |
| Date the written agreement was signed (must precede release of any role material) | |
| Confirm the fee is **fixed** and **not contingent** on any result, finding or future engagement (`yes`) | |

The tooling accepts `null` only as an explicit "no fee" (`lib/personnel.mjs:38`); an empty string,
a placeholder or a malformed hash is refused.

---

## D. Notes, and any `unknown`

Explain any answer that is not `no`, and anything a reader would need to judge the answer. An
`unknown` here is a **blocker**, not a footnote.

```
(blank)
```

---

## E. Developing organisation's confirmation (NOT completed by the declaring person)

§4A.1 requires, per person, **the developing organisation's written confirmation that its records
show no item 1–4 relationship.** This is a separate document, produced by the developing
organisation, hashed, and recorded in the register.

| Field | Value |
|---|---|
| `organisation_confirmation_sha256` — 64 lowercase hex; **required**, never `null` | `UNASSIGNED` |
| Date of the confirmation | |

---

## F. What the register stores per person

The restricted personnel register (`cpg-u1-personnel/v1`) holds, for each assignment, exactly:

```
role, person_id, declaration { the seven keys above, each "no" },
study_fee_agreement_sha256 (64 hex or null), organisation_confirmation_sha256 (64 hex)
```

and, once, `operator.person_id`. `check-personnel` refuses the register if any of the seven
declaration keys is anything other than the string `"no"`, if the operator appears in any
assignment, if a person holds two independent roles, or if a confirmation hash is missing.

---

## G. What this declaration is, and is not

- It is **procedural evidence, not proof** (§4A.1).
- The tooling checks **structure only**: that each key is present and equals `"no"` and that the
  hashes are well-formed. **It can never verify that a declaration is true**
  (`lib/personnel.mjs:3`; README: "What the tooling does not prove — that personnel declarations
  are true, or that pseudonymous IDs denote distinct real people").
- If a declaration is later found false, the person's work is non-independent and **the finding is
  published**: rater work takes the §12 UNADJUDICATED consequences; enumerator work makes the frame
  non-independent (§20.18); reference work makes the reference truth non-independent.
- **This is a methodological rule; it is not a legal determination.** (§4A.1)

**Human dependency: H1** — the operator prepares this form completely; the person only answers and
signs. The *truth* of the answers is **H3**: the declaration is the only thing standing behind the
independence claim, and nothing automatable can replace it.
