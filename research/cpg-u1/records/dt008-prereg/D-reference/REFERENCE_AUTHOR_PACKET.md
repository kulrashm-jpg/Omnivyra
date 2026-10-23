# REFERENCE_AUTHOR_PACKET — the reference **Author** slot (CPG-U1)

**Classification: PREPARATION.** This document is not evidence. It records no identity, no
recruitment, no commitment, no fee and no result. **No person has been recruited.** "Author" is a
**slot label** for one position that is currently **UNFILLED**. Every person-specific field is an
`<<UNFILLED: ...>>` marker; a copy of this document that still contains one is not a completed
record and must never be filed, hashed or cited as one.

> **No AI system, agent or language model may hold this role.** The Author is a real, independent
> human being. An AI may not stand in, may not "assist" by producing a record the human then signs,
> and may not be the source of any value in any blind record. A role ghost-written by an AI is not
> independent work: the §4A.1 consequence applies and the reference truth is published as **not
> independent** (§4A.1, "reference work: the reference truth is not independent").
> **The preparer of this document is an AI and holds no role in this study.**

Baseline (recomputed; see `README.md` for the verification and the recorded 587-file worktree
discrepancy): protocol `c50fc680...f00b719`; instrument aggregate `<NEW_AGG>` over <NEW_N>
files at `C:/tmp/dt002/research/cpg-u1/tooling`.

**Working instructions you also receive:** `C:/tmp/dt004-operations/people/REFERENCE_TEAM_PACKET.md`
(the §9.3/§9.4 field-work guide, shared with the Confirmer). This packet does not repeat it; it adds
eligibility, the receive / never-receive lists as checkable lists, the corrected record-format
derivation, the conflict rules, the submission procedure and the relative deadline.

---

## 1. Eligibility criteria for this slot

All of the following must hold. Each is a **necessary** condition; the operator verifies each one
before any material is released (`REFERENCE_MATERIAL_RELEASE_GATE.md`).

### 1.1 §4A.1 independence from the developing organisation

"Developing organisation" means the entity that develops, owns or operates CPG or Omnivyra, and any
affiliate. **Exclusion period:** from the first repository commit of the developing organisation's
product until publication of this study's results.

The candidate is **not independent** and may hold no §4A.3 role if, at any time in the exclusion
period, the person:

1. is or was **employed** by the developing organisation, in any capacity;
2. has or had **any contract, engagement or other work** (paid or unpaid) for it, other than the
   engagement in item 5;
3. **received any payment or benefit** from it, other than the fee in item 5;
4. **holds equity, options or any other financial or organisational interest** in it;
5. — *permitted exception:* a **fixed fee for the study role**, agreed **in writing before any role
   material is released**, **not contingent** on any result, finding or future engagement; the
   agreement's **SHA-256 is recorded**;
6. is the **spouse or partner, a family member or a household member** of, or has a **current or
   former direct reporting relationship with**, any person who developed CPG, the operator (key
   custodian), or **any holder of another §4A.3 role**.

> **"An unknown answer is not 'no.'"** (§4A.1, verbatim.) An item the candidate cannot answer is not
> satisfied. It blocks release; it does not pass.

Item 6 is **pairwise** and therefore cannot be checked against this candidate alone: it must be
checked against **every other role-holder** — enumerator(s), Confirmer, reference adjudicator,
rater 1, rater 2, rating adjudicator, and the operator. See the gate document, §4.

### 1.2 §9.1 "Must not" column for the Author, verbatim

> Have implemented CPG, the protocol or the tooling; see any CPG output (including the development
> pilot); communicate with the Confirmer before both have submitted

### 1.3 §4A.3 mutual exclusion

The seven independent roles are mutually exclusive — **minimum 7 independent persons**. The Author
holds **no other** §4A.3 role, and **the operator (key custodian) may hold no independent role**.
`lib/personnel.mjs:33` refuses the register with
`ROLE COLLISION — the operator may hold no independent role`; `:34` refuses a person who already
holds another role.

### 1.4 The seven declaration keys that must each read `"no"`

`lib/personnel.mjs:8` (`DECLARATION_KEYS`), all seven required for **every** role, not only
enumerators:

| Key | Covers |
|---|---|
| `employed_by_developing_organisation` | §4A.1 item 1 |
| `contract_or_work_for_developing_organisation` | §4A.1 item 2 |
| `payment_other_than_study_fee` | §4A.1 item 3 |
| `financial_interest_in_developing_organisation` | §4A.1 item 4 |
| `close_relationship_with_developer_operator_or_role_holder` | §4A.1 item 6 |
| `implemented_cpg_protocol_tooling_or_registry` | §4A.2(a), applied to this role by §9.1 |
| `ran_or_saw_cpg_output` | §4A.2(b), applied to this role by §9.1 |

`lib/personnel.mjs:37` refuses anything but the exact string `"no"`.

### 1.5 Recorded evidence (all three, none of them fabricated here)

- a **signed declaration** answering items 1–4 and 6 and §4A.2(a)–(b) with "no" —
  `REFERENCE_INDEPENDENCE_DECLARATION.md`, currently unfilled;
- the **fee-agreement SHA-256** (or none): `study_fee_agreement_sha256` is 64 lowercase hex **or the
  literal `null`** when there is no fee (`lib/personnel.mjs:38`);
- the **developing organisation's written confirmation** that its records show no item 1–4
  relationship: `organisation_confirmation_sha256`, 64 lowercase hex, **required, never null**
  (`lib/personnel.mjs:39`).

### 1.6 Register fields for this slot

| Register field | Value |
|---|---|
| `role` | `reference-author` (one of the seven in `INDEPENDENT_ROLES`, `lib/personnel.mjs:6`) |
| `person_id` | `<<UNFILLED: pseudonymous id matching the register pattern of 1-64 chars from A-Z a-z 0-9 underscore hyphen, assigned by the operator, distinct from every other role-holder and from the operator>>` |
| `declaration` | `<<UNFILLED: all seven keys, each the literal string "no">>` |
| `study_fee_agreement_sha256` | `<<UNFILLED: 64 lowercase hex, or the literal null when no fee>>` |
| `organisation_confirmation_sha256` | `<<UNFILLED: 64 lowercase hex, required>>` |

`role reference-author must be held by exactly one person` — `lib/personnel.mjs:26` permits several
enumerators and **exactly one** holder of every other role.

---

## 2. Exactly what you receive (§9.2, verbatim)

> The Author and Confirmer each receive only: company name, canonical domain, jurisdiction family,
> decisive identifier, the three field definitions, the value-format rules (§9.3), and the authority
> table (§9.4).

As a checkable list, per drawn company × field:

| You receive | Source |
|---|---|
| company name | drawn manifest entry |
| canonical domain | drawn manifest entry |
| jurisdiction family (one of `US-SEC`, `FR-SIRENE`, `BR-CNPJ`, `LEI-ONLY`) | drawn manifest entry |
| the decisive identifier (`identifier_scheme`, `identifier_value`) | drawn manifest entry |
| the three field definitions — `founded_year`, `employee_count`, `revenue_range` (`lib/schema.mjs:175`) | §9.3 |
| the value-format rules | §9.3 / `VALUE_FORMAT`, `lib/schema.mjs:192` |
| the authority table | §9.4 / `AUTHORITY`, `lib/schema.mjs:183` |
| public sources you find yourself | your own search |

## 3. Exactly what you never receive (§9.2, verbatim)

> **They never receive CPG output, each other's records, or the class prediction.**

Expanded, and each item is a release-gate line:

- **no CPG output of any kind**, including the development pilot and the §8.5 instrument check;
- **no record of the Confirmer**, in whole or in part, before or after your submission;
- **no `expected_outcome_class` / class prediction, stratum or split.** The stratum is the
  enumerator's *prediction* for sampling balance only; reference truth, never the stratum,
  determines every label (§5.2, §9.7, and the comment in `lib/reconcile.mjs` above
  `stratumMismatches`);
- **no sizing output, quotas, pilot results or any tally.**

You also never receive the reconciled reference file, the seal, or any count of agreements or
disagreements.

---

## 4. Role-specific instructions

1. You produce **one blind record for every drawn company × field**, for **both stages** —
   development and held-out. There is **no partial submission**: a missing record is refused by
   name (`lib/reconcile.mjs`: `missing author record`). See `REFERENCE_WORKLOAD_NOTE.md` for the
   **90–330** record range.
2. You work **alone**. You may not communicate with the Confirmer about any company, field, source
   or value **before both of you have submitted** (§9.1). This is not a courtesy: it is the
   measurement. Two records that were discussed measure nothing.
3. Every value must be **constructed without CPG**. You record
   `constructed_without_cpg = yes`, and any other value is refused with
   `constructed_without_cpg must be "yes" (§9.3 anti-circularity)` (`lib/schema.mjs`,
   `checkBlindRecord`).
4. Where the only figure available is a **target, projection, run-rate, order book or estimate**
   (`FORBIDDEN_KINDS`, `lib/schema.mjs:189`), the record is **`NOT_AVAILABLE_FROM_SOURCE`** and the
   figure is **described in `search_note`**. It is never an expected value.
5. Where no authoritative value exists at all, the record is **`NOT_AVAILABLE_FROM_SOURCE`** with a
   `search_note` saying **what you searched**. An abstention is a real finding, never a gap.
6. A source class that is **not authoritative for that field** is refused, even when the number is
   obviously right (§9.4; `source_class X is not authoritative for Y (§9.2)`).
7. You never revise a submitted set.
8. If you realise at any point that you have seen CPG output, or have implemented CPG / the protocol
   / the tooling / the registry, you **stop and tell the operator**. The consequence of a false
   declaration discovered later is published (§4A.1).

---

## 5. The record format you must produce, field by field

### 5.1 Correction — you do **not** write `REFERENCE_COLUMNS`

The brief for this package asked for the format "derived from `REFERENCE_COLUMNS`". Read from the
verified instrument, that is **not** the Author's format:

- **`REFERENCE_COLUMNS`** (`lib/schema.mjs:213`, 16 columns) is the **reconciled, sealable** file,
  and its own comment reads *"produced **ONLY** by reconcile (never hand-written)"*. `seal` refuses
  a reference file that is not byte-identical to the reconciliation
  (`--reference is not byte-identical to the reconciliation of the blind records`).
- **What you write is `BLIND_RECORD_COLUMNS`** (`lib/schema.mjs:201`, **13 columns**), checked by
  `checkBlindRecord`.

The relation is exact: `BLIND_RECORD_COLUMNS` = the first 10 of `REFERENCE_COLUMNS`, plus
`constructed_without_cpg`, `recorded_by`, `recorded_at`. The remaining 6 reference columns —
`ambiguity_flag`, `independence_class`, `author`, `confirmer`, `resolution`, `adjudicated_by` — are
**machine-set by `reconcile`** and are **never yours to write**.

### 5.2 Your 13 columns, in order

| # | Column | Rule, as the instrument enforces it |
|---|---|---|
| 1 | `candidate_id` | The drawn company's id, exactly as the manifest gives it. An id not in a drawn manifest is refused: `candidate_id is not in a drawn manifest`. One record per company-and-field pair; a second is `duplicate record`. |
| 2 | `field` | Exactly one of `founded_year`, `employee_count`, `revenue_range` (`FIELDS`, `lib/schema.mjs:175`). |
| 3 | `value_kind` | `STATED` **or** `NOT_AVAILABLE_FROM_SOURCE`, and nothing else. `TARGET`, `PROJECTION`, `RUN_RATE`, `ORDER_BOOK`, `ESTIMATE` are refused by name (`FORBIDDEN_KINDS`). |
| 4 | `expected_value` | `STATED` → required and must match the §9.3 format for the field (table 5.3). `NOT_AVAILABLE_FROM_SOURCE` → must be **empty**. |
| 5 | `authoritative_source_name` | `STATED` → required, non-empty. |
| 6 | `source_class` | `STATED` → one of the nine `SOURCE_CLASSES` (`lib/schema.mjs:177`), **and** authoritative for that field per §9.4 (table 5.4). |
| 7 | `source_url` | `STATED` → an **https** URL (`STATED requires an https source_url`). |
| 8 | `publication_date` | `YYYY-MM-DD` **or** the literal `NOT_STATED`. **Exception:** `employee_count` from a Tier-2 `ENTITY_OWN_PAGE` **requires a stated publication date** — `NOT_STATED` is refused (§9.2/§9.4). |
| 9 | `as_of_date` | `YYYY-MM-DD`, always required, both value kinds. See §5.5 on the 24-month temporal rule. |
| 10 | `search_note` | **Required** whenever `value_kind = NOT_AVAILABLE_FROM_SOURCE`: what you searched. Also where a forbidden-kind figure is described. |
| 11 | `constructed_without_cpg` | Must be the literal `yes`. |
| 12 | `recorded_by` | Your pseudonymous `person_id` from the register. Required, non-empty. **It must differ from the Confirmer's** — `lib/reconcile.mjs:52` refuses `author and confirmer must be different people (§9.4)`. |
| 13 | `recorded_at` | `YYYY-MM-DD`. |

### 5.3 STATED value formats (§9.3; `VALUE_FORMAT`, `lib/schema.mjs:192`)

| Field | Pattern the instrument applies | Description | Example from the protocol |
|---|---|---|---|
| `founded_year` | four digits, first digit 1 or 2 | a four-digit year | `1999` |
| `employee_count` | a positive integer with no leading zero | a positive integer **without separators** | `3682` |
| `revenue_range` | three uppercase letters, one space, a positive integer | an ISO 4217 code, **one** space, and a positive integer **in whole units** | `USD 1300000000` |

So `1,300` is refused, `USD 1.3B` is refused, `usd 1300000000` is refused, `0` is refused.
These are the protocol's own examples; they are not values for any drawn company.

### 5.4 Authority by field (§9.4 verbatim; `AUTHORITY`, `lib/schema.mjs:183`)

| Field | Tier 1 | Tier 2 | Not authoritative |
|---|---|---|---|
| `founded_year` | `REGISTRY_RECORD` | `ENTITY_OWN_PAGE` | everything else |
| `employee_count` | `REGULATORY_FILING` | `ENTITY_OWN_PAGE` **with a stated publication date** | everything else |
| `revenue_range` | `AUDITED_FINANCIAL_FILING`, `REGULATORY_FILING` | `ENTITY_OWN_FINANCIAL_STATEMENT` | everything else |

`authorityOf(field, sourceClass)` returns `NOT_AUTHORITATIVE` for anything unlisted, and the record
is refused. `PRESS`, `ENCYCLOPAEDIA`, `AGGREGATOR` and `JOB_BOARD` are valid `SOURCE_CLASSES` but
are **authoritative for nothing**: they may inform your search and belong in `search_note`, never in
a `STATED` record.

### 5.5 The 24-month temporal rule (§10.2 [NORMATIVE])

For `employee_count` and `revenue_range`, reference truth is **the most recent authoritative value
with `as_of_date` no more than 24 months before the run `asOf`**. If none that recent exists, the
observation becomes `REFERENCE-STALE` (excluded and published). The run `asOf` is not yours to
choose and is not disclosed to you in advance:
`<<UNFILLED: operator-supplied run asOf anchor — the Author is told only the 24-month rule, never a
held-out result>>`. Record the **true** `as_of_date` of the document you used; never adjust it to
fit a window.

### 5.6 What the instrument does with your record (so you know what it cannot do)

`reconcile` compares your record with the Confirmer's on a normalised key only:
`agreementKey` is `value_kind` plus `expected_value`, whitespace-collapsed and lower-cased.
**Source, URL, dates and `search_note` are not part of agreement.** Two records that agree on the
value but cite different documents are `AGREED`, and the row published carries **your** source
columns (`src = a` in `lib/reconcile.mjs`). That asymmetry is recorded in
`REFERENCE_ADJUDICATION_NOTE.md`.

---

## 6. Conflict rules

| Situation | Rule |
|---|---|
| You and the Confirmer agree | `AGREED`. **An adjudication may not override it** (§9.5). `reconcile` refuses an adjudication row supplied for an agreed record: `adjudication supplied for an AGREED record — an adjudicator may not override agreement`. |
| You differ | The difference **must** be adjudicated (§9.5). `lib/reconcile.mjs:58` refuses an unadjudicated difference outright and `cmdReconcile` exits 1. **No seal is possible while one difference is unadjudicated.** |
| The adjudicator picks a record | `ADJUDICATED_AUTHOR` or `ADJUDICATED_CONFIRMER`. The adjudicator **chooses between the two records and cannot supply a third value** (§9.5). |
| The adjudicator declares a conflict | `REFERENCE_CONFLICT`: the observation is excluded from every denominator and **published** (§9.5, §15.1, §15.2). |
| You and the Confirmer turn out to be the same `person_id` | Refused: `lib/reconcile.mjs:52`. |
| The adjudicator turns out to be you or the Confirmer | Refused: `lib/reconcile.mjs:59` — `adjudicator must differ from both author and confirmer`. |
| Reference truth contradicts the class prediction | **Recorded in the seal and published** (§9.7). It is not an error, and it is never corrected by editing. You are not told the class, so you cannot be steered by it. |
| You believe your own submitted record is wrong | Tell the operator. You do **not** revise it, and you do not learn what the Confirmer wrote. |

---

## 7. Submission procedure

1. **Receive** the drawn-company sheet and the blank blind-record CSV from the operator over
   `<<UNFILLED: operator-specified channel; must not be a channel the developing organisation can
   read>>`. The sheet carries only the §9.2 items.
2. **Work every row.** One row per company × field, both stages. Do not leave a row blank.
3. **Self-check before sending.** Ask the operator to run the blind-record pre-check on your file
   in your presence, or accept the operator's report of it:
   `C:/tmp/dt004-operations/reference/tools/blind_record_precheck.mjs`, with `CPG_U1_INSTRUMENT`
   pointed at the verified <NEW_N>-file instrument. It reports format and authority errors. **It cannot
   and does not compare your file with the Confirmer's**, and the operator must not tell you
   anything derived from the Confirmer's file.
4. **Send** the completed CSV, with exactly the 13 `BLIND_RECORD_COLUMNS` header names in order, to
   `<<UNFILLED: operator-specified submission address or drop>>`.
5. **Confirm** in writing: "This set is complete and final; no record in it was constructed with, or
   checked against, any CPG output; I did not communicate with the Confirmer about any company,
   field, source or value before this submission."
6. **After submission** the §9.1 no-communication bar lifts only once the operator confirms that
   **both** sets are in. Until then it stands.
7. **No revisions.** Once submitted, the set is fixed.

---

## 8. Deadline — relative to operator-supplied anchors only

**No date appears in this document.** Let:

| Anchor | Meaning | Value |
|---|---|---|
| `R` | the day the OSF registration is published | `<<UNFILLED: R — operator-supplied; not before the registration is published>>` |
| `D_draw` | the day the drawn-company sheets are released to both recorders — **on or after** the material-release gate passes for **both** recorders and the adjudicator | `<<UNFILLED: D_draw — operator-supplied, on or after R>>` |
| `W_ref` | the recording window in working days, sized from `REFERENCE_WORKLOAD_NOTE.md` for the **actual** held-out quotas | `<<UNFILLED: W_ref — operator-supplied working days; must be derived from the 90–330-record range, not from the 60–300 under-count>>` |

Then:

- **Author submission deadline: `D_draw + W_ref`.**
- The Confirmer's deadline is the **same** `D_draw + W_ref`. The two windows are deliberately
  **concurrent**, because §9.1 forbids communication before both submit: staggering them would let
  the later recorder be influenced.
- Adjudication begins only after **both** sets are in, and must complete **before `seal`** (§9.2.1
  "Timing").
- **Held-out execution begins only after the seal hash is published** (§9.6). Nothing in your
  window may be shortened by pulling execution earlier.

A deadline the operator has not anchored is not a deadline. Do not infer one.

---

## 9. Standing prohibitions

- Never open, run, request or accept **any CPG output**, including the pilot and the instrument check.
- Never seek, accept or infer **the Confirmer's record** or their identity before both submissions.
- Never accept the **class prediction, stratum, split, quotas, sizing output or any tally**.
- Never enter a **target, projection, run-rate, order book or estimate** as an expected value.
- Never cite a source class that is **not authoritative** for the field.
- Never hand-write a row of the **reconciled** reference file; it comes only from `reconcile`.
- Never let an **AI** produce, draft or check a value you record.
- Never treat an **unknown** answer on any eligibility item as "no".

---

## 10. What is still blocked on the operator for this slot

| Blocked item | Why it cannot be prepared here |
|---|---|
| The person | No identity may be invented. The slot is UNFILLED. |
| `person_id` | Assigned by the operator from the restricted register. |
| The signed declaration | Requires a real person's signature. |
| The fee agreement and its SHA-256 | §4A.1 item 5 requires a written agreement **before** any role material is released. |
| The organisation confirmation and its SHA-256 | Only the developing organisation can issue it. |
| The §4A.1 item 6 pairwise check | Needs every other role-holder's identity. |
| `R`, `D_draw`, `W_ref` | Operator-supplied anchors; inventing a date would be fabrication. |
| Actual held-out quotas | Come from the §5.6 sizing rule applied to the real pilot, which has not run. |

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

