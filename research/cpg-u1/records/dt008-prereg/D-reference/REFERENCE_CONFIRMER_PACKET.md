# REFERENCE_CONFIRMER_PACKET — the reference **Confirmer** slot (CPG-U1)

**Classification: PREPARATION.** This document is not evidence. It records no identity, no
recruitment, no commitment, no fee and no result. **No person has been recruited.** "Confirmer" is a
**slot label** for one position that is currently **UNFILLED**. Every person-specific field is an
`<<UNFILLED: ...>>` marker; a copy that still contains one is not a completed record.

> **No AI system, agent or language model may hold this role.** The Confirmer is a real, independent
> human being. A role ghost-written by an AI is not independent work: the §4A.1 consequence applies
> and the reference truth is published as **not independent**.
> **The preparer of this document is an AI and holds no role in this study.**

Baseline (recomputed; see `README.md`): protocol `c50fc680...f00b719`; instrument aggregate
`<NEW_AGG>` over <NEW_N> files at `C:/tmp/dt002/research/cpg-u1/tooling`.

**Working instructions you also receive:** `C:/tmp/dt004-operations/people/REFERENCE_TEAM_PACKET.md`
(the §9.3/§9.4 field-work guide, shared with the Author).

---

## 0. The one thing that distinguishes this slot from the Author's

The Confirmer's work product, rules, formats, authority table, submission form and deadline are
**identical** to the Author's. §9.1 describes the Confirmer as a *"Different independent person"* who
*"constructs a **separate blind** record for every company × field"*.

The **only** substantive differences are:

1. §9.1 adds one prohibition for the Confirmer — **"see the Author's record before submitting"** — on
   top of everything the Author must not do ("Same as Author");
2. the register `role` is `reference-confirmer`;
3. in the reconciled output your `person_id` lands in the `confirmer` column, and an adjudicator
   choosing your record yields `ADJUDICATED_CONFIRMER`.

**You are not a checker of the Author's work.** You never see it. "Confirmer" names your position in
the double-entry design, not a reviewing function. If you were shown the Author's record, the
measurement would be destroyed and the reference truth would not be independent.

---

## 1. Eligibility criteria for this slot

Identical to the Author's, plus the extra §9.1 bar. Each is **necessary**; the operator verifies
each before any material is released (`REFERENCE_MATERIAL_RELEASE_GATE.md`).

### 1.1 §4A.1 independence from the developing organisation

"Developing organisation" means the entity that develops, owns or operates CPG or Omnivyra, and any
affiliate. **Exclusion period:** from the first repository commit of the developing organisation's
product until publication of this study's results. The candidate is **not independent** if, at any
time in that period, the person:

1. is or was **employed** by it, in any capacity;
2. has or had **any contract, engagement or other work** (paid or unpaid) for it, other than the
   engagement in item 5;
3. **received any payment or benefit** from it, other than the fee in item 5;
4. **holds equity, options or any other financial or organisational interest** in it;
5. — *permitted exception:* a **fixed fee for the study role**, agreed **in writing before any role
   material is released**, **not contingent** on any result, finding or future engagement; the
   agreement's **SHA-256 is recorded**;
6. is the **spouse or partner, a family member or a household member** of, or has a **current or
   former direct reporting relationship with**, any person who developed CPG, the operator (key
   custodian), or **any holder of another §4A.3 role** — which explicitly includes **the Author and
   the reference adjudicator**.

> **"An unknown answer is not 'no.'"** (§4A.1, verbatim.)

Item 6 makes this slot's eligibility **dependent on who holds the other slots**: an
Author–Confirmer pair who are partners, household members, family, or in a current or former direct
reporting relationship is **not eligible**, however independent each is of the developing
organisation. See `REFERENCE_MATERIAL_RELEASE_GATE.md` §4.

### 1.2 §9.1 "Must not" column for the Confirmer, verbatim

> Same as Author; see the Author's record before submitting

and therefore, expanded from the Author's row:

> Have implemented CPG, the protocol or the tooling; see any CPG output (including the development
> pilot); communicate with the Confirmer [i.e. with the other recorder] before both have submitted;
> **see the Author's record before submitting**

### 1.3 §4A.3 mutual exclusion

Seven mutually exclusive independent roles, **minimum 7 independent persons**; the operator holds
none (`lib/personnel.mjs:33`), and no person holds two (`:34`).
`role reference-confirmer must be held by exactly one person` (`:26`).

### 1.4 The seven declaration keys, each the literal `"no"`

`DECLARATION_KEYS`, `lib/personnel.mjs:8` — `employed_by_developing_organisation`,
`contract_or_work_for_developing_organisation`, `payment_other_than_study_fee`,
`financial_interest_in_developing_organisation`,
`close_relationship_with_developer_operator_or_role_holder`,
`implemented_cpg_protocol_tooling_or_registry`, `ran_or_saw_cpg_output`.
`:37` refuses anything but `"no"`.

### 1.5 Recorded evidence

- signed declaration (`REFERENCE_INDEPENDENCE_DECLARATION.md`, unfilled);
- `study_fee_agreement_sha256` — 64 lowercase hex **or the literal `null`** (`:38`);
- `organisation_confirmation_sha256` — 64 lowercase hex, **required** (`:39`).

### 1.6 Register fields for this slot

| Register field | Value |
|---|---|
| `role` | `reference-confirmer` |
| `person_id` | `<<UNFILLED: pseudonymous id matching the register pattern of 1-64 chars from A-Z a-z 0-9 underscore hyphen; must differ from the Author's, the adjudicator's, every other role-holder's and the operator's>>` |
| `declaration` | `<<UNFILLED: all seven keys, each the literal string "no">>` |
| `study_fee_agreement_sha256` | `<<UNFILLED: 64 lowercase hex, or the literal null when no fee>>` |
| `organisation_confirmation_sha256` | `<<UNFILLED: 64 lowercase hex, required>>` |

---

## 2. Exactly what you receive (§9.2, verbatim)

> The Author and Confirmer each receive only: company name, canonical domain, jurisdiction family,
> decisive identifier, the three field definitions, the value-format rules (§9.3), and the authority
> table (§9.4).

Per drawn company × field: company name; canonical domain; jurisdiction family (`US-SEC`,
`FR-SIRENE`, `BR-CNPJ` or `LEI-ONLY`); the decisive identifier (`identifier_scheme`,
`identifier_value`); the three field definitions (`FIELDS`, `lib/schema.mjs:175`); the §9.3 value
formats (`VALUE_FORMAT`, `:192`); the §9.4 authority table (`AUTHORITY`, `:183`). Plus public
sources you find yourself.

## 3. Exactly what you never receive (§9.2, verbatim)

> **They never receive CPG output, each other's records, or the class prediction.**

- **No CPG output of any kind**, including the development pilot and the §8.5 instrument check.
- **No part of the Author's record** — not the value, not the source, not the URL, not the
  `search_note`, not the count of their `NOT_AVAILABLE_FROM_SOURCE` rows, not "how far they got".
  §9.1 bars you from seeing it **before submitting**; the operator's release gate bars it absolutely
  until both sets are in, because a partial hint is a hint.
- **No class prediction, stratum or split.**
- **No sizing output, quotas, pilot results, tally, reconciled reference file or seal.**
- **Not the Author's identity or pseudonym**, for as long as the operator can withhold it. §9.2.1
  requires the *adjudicator* never to learn it; for the Confirmer the binding rule is the
  no-communication bar, which is easiest to keep when there is no one to contact.

---

## 4. Role-specific instructions

1. You produce **one blind record for every drawn company × field**, for **both stages** —
   development and held-out. No partial submission: a missing row is refused by name
   (`lib/reconcile.mjs`: `missing confirmer record`). **90–330 records** — see
   `REFERENCE_WORKLOAD_NOTE.md`.
2. You **construct each value from scratch**. You are not verifying a proposed value; there is no
   proposed value in front of you. Treat every row as if no one else had ever looked at it.
3. **No communication with the Author** about any company, field, source or value before both of you
   have submitted (§9.1). If the Author contacts you, do not answer on substance; tell the operator.
4. `constructed_without_cpg = yes`, always; anything else is refused
   (`constructed_without_cpg must be "yes" (§9.3 anti-circularity)`).
5. Targets, projections, run-rates, order books and estimates (`FORBIDDEN_KINDS`,
   `lib/schema.mjs:189`) are **never** an expected value: record
   `NOT_AVAILABLE_FROM_SOURCE` and describe the figure in `search_note`.
6. Where nothing authoritative exists, record `NOT_AVAILABLE_FROM_SOURCE` with a `search_note` saying
   **what you searched**. An abstention is a finding.
7. A non-authoritative source class is refused for that field even when the number looks right (§9.4).
8. **No revisions after submission.**
9. If you realise you have seen CPG output, or any part of the Author's record, **stop and tell the
   operator** before submitting. A late discovery is published (§4A.1).

---

## 5. The record format you must produce, field by field

**By design this section states the same rules as `REFERENCE_AUTHOR_PACKET.md` §5.** Both recorders
work to one format; divergent instructions would themselves create disagreements.

### 5.1 Correction — you do **not** write `REFERENCE_COLUMNS`

`REFERENCE_COLUMNS` (`lib/schema.mjs:213`, 16 columns) is the **reconciled, sealable** file:
*"produced **ONLY** by reconcile (never hand-written)"*, and `seal` refuses any reference file that is
not byte-identical to the reconciliation. **You write `BLIND_RECORD_COLUMNS`**
(`lib/schema.mjs:201`, **13 columns**), checked by `checkBlindRecord`.

`BLIND_RECORD_COLUMNS` = the first 10 of `REFERENCE_COLUMNS` + `constructed_without_cpg`,
`recorded_by`, `recorded_at`. The 6 you never write — `ambiguity_flag`, `independence_class`,
`author`, `confirmer`, `resolution`, `adjudicated_by` — are machine-set by `reconcile`
(`independence_class` is set to the literal `PENDING_RUN` at seal time, §9.8).

### 5.2 Your 13 columns, in order

| # | Column | Rule, as the instrument enforces it |
|---|---|---|
| 1 | `candidate_id` | Exactly as the manifest gives it. Not in a drawn manifest → `candidate_id is not in a drawn manifest`. A repeat of the same company-and-field pair → `duplicate record`. |
| 2 | `field` | One of `founded_year`, `employee_count`, `revenue_range`. |
| 3 | `value_kind` | `STATED` or `NOT_AVAILABLE_FROM_SOURCE`, nothing else. |
| 4 | `expected_value` | `STATED` → required, and must match §9.3 (table 5.3). `NOT_AVAILABLE_FROM_SOURCE` → **empty**. |
| 5 | `authoritative_source_name` | `STATED` → required, non-empty. |
| 6 | `source_class` | `STATED` → one of the nine `SOURCE_CLASSES`, **and** authoritative for the field (table 5.4). |
| 7 | `source_url` | `STATED` → an **https** URL. |
| 8 | `publication_date` | `YYYY-MM-DD` or the literal `NOT_STATED`; **`employee_count` from Tier-2 `ENTITY_OWN_PAGE` requires a stated date.** |
| 9 | `as_of_date` | `YYYY-MM-DD`, always required. |
| 10 | `search_note` | Required for `NOT_AVAILABLE_FROM_SOURCE`; also where a forbidden-kind figure is described. |
| 11 | `constructed_without_cpg` | The literal `yes`. |
| 12 | `recorded_by` | Your pseudonymous `person_id`. Must differ from the Author's — `lib/reconcile.mjs:52`. |
| 13 | `recorded_at` | `YYYY-MM-DD`. |

### 5.3 STATED value formats (§9.3; `VALUE_FORMAT`, `lib/schema.mjs:192`)

| Field | Pattern | Description | Protocol example |
|---|---|---|---|
| `founded_year` | four digits, first digit 1 or 2 | a four-digit year | `1999` |
| `employee_count` | a positive integer, no leading zero | positive integer **without separators** | `3682` |
| `revenue_range` | three uppercase letters, one space, a positive integer | ISO 4217 code, one space, integer **in whole units** | `USD 1300000000` |

### 5.4 Authority by field (§9.4 verbatim; `AUTHORITY`, `lib/schema.mjs:183`)

| Field | Tier 1 | Tier 2 | Not authoritative |
|---|---|---|---|
| `founded_year` | `REGISTRY_RECORD` | `ENTITY_OWN_PAGE` | everything else |
| `employee_count` | `REGULATORY_FILING` | `ENTITY_OWN_PAGE` **with a stated publication date** | everything else |
| `revenue_range` | `AUDITED_FINANCIAL_FILING`, `REGULATORY_FILING` | `ENTITY_OWN_FINANCIAL_STATEMENT` | everything else |

`PRESS`, `ENCYCLOPAEDIA`, `AGGREGATOR`, `JOB_BOARD` are legal `SOURCE_CLASSES` but authoritative for
**nothing**: `search_note` material only.

### 5.5 The 24-month temporal rule (§10.2 [NORMATIVE])

For `employee_count` and `revenue_range`, reference truth is the most recent authoritative value with
`as_of_date` **no more than 24 months** before the run `asOf`; otherwise the observation is
`REFERENCE-STALE` (excluded, published). Run `asOf`:
`<<UNFILLED: operator-supplied run asOf anchor — the Confirmer is told only the 24-month rule>>`.
Record the document's true `as_of_date`; never adjust it to fit the window.

### 5.6 What agreement actually compares

`agreementKey` is `value_kind` plus `expected_value`, whitespace-collapsed and lower-cased.
**Your source, URL, dates and `search_note` are not compared.** If you and the Author reach the same
value from different documents, the row is `AGREED` — and the published source columns are the
**Author's**, not yours (`src = a`, `lib/reconcile.mjs`). This is a known asymmetry, recorded in
`REFERENCE_ADJUDICATION_NOTE.md`. It is a reason to cite your best source, not your fastest one: your
citation is what the adjudicator reads if the values differ.

---

## 6. Conflict rules

| Situation | Rule |
|---|---|
| You and the Author agree | `AGREED`. **An adjudication may not override it** (§9.5); `reconcile` refuses one supplied for an agreed record. |
| You differ | The difference **must** be adjudicated (§9.5). `lib/reconcile.mjs:58` refuses an unadjudicated difference and `cmdReconcile` exits 1: **no seal is possible** until it is adjudicated. |
| The adjudicator picks your record | `ADJUDICATED_CONFIRMER`. They **choose between the two records and cannot supply a third value** (§9.5). |
| The adjudicator declares a conflict | `REFERENCE_CONFLICT`: excluded from every denominator, **published** (§9.5, §15.1, §15.2). |
| You and the Author share a `person_id` | Refused: `lib/reconcile.mjs:52`. |
| The adjudicator is you or the Author | Refused: `lib/reconcile.mjs:59`. |
| Reference truth contradicts a class prediction | Recorded in the seal and **published** (§9.7); never corrected by editing. You are never told the class. |
| You believe your submitted record is wrong | Tell the operator; do not revise, and do not ask what the Author wrote. |

A disagreement is **not** a failure by either recorder. The disagreement rate is part of what the
study measures. Do not try to guess what the Author would write in order to agree with them: an
agreement manufactured that way is the one outcome the design cannot detect and cannot use.

---

## 7. Submission procedure

1. **Receive** the drawn-company sheet and the blank blind-record CSV over
   `<<UNFILLED: operator-specified channel; must not be a channel the developing organisation can
   read, and must not be a channel shared with the Author>>`.
2. **Work every row**, both stages.
3. **Self-check** with `C:/tmp/dt004-operations/reference/tools/blind_record_precheck.mjs` against the
   verified instrument (`CPG_U1_INSTRUMENT`). It checks **your** file only; it never compares the two
   files, and the operator must report nothing derived from the Author's file.
4. **Send** the CSV with exactly the 13 `BLIND_RECORD_COLUMNS` header names in order, to
   `<<UNFILLED: operator-specified submission address or drop>>`.
5. **Confirm** in writing: "This set is complete and final; no record in it was constructed with, or
   checked against, any CPG output; **I did not see any part of the Author's record before this
   submission**; I did not communicate with the Author about any company, field, source or value."
6. **The no-communication bar lifts** only when the operator confirms both sets are in.
7. **No revisions.**

---

## 8. Deadline — relative to operator-supplied anchors only

**No date appears in this document.** Anchors, shared with the Author packet:

| Anchor | Meaning | Value |
|---|---|---|
| `R` | the day the OSF registration is published | `<<UNFILLED: R — operator-supplied; not before the registration is published>>` |
| `D_draw` | the day the drawn-company sheets are released to **both** recorders | `<<UNFILLED: D_draw — operator-supplied, on or after R and on or after the gate passes for all three reference roles>>` |
| `W_ref` | the recording window in working days, sized from `REFERENCE_WORKLOAD_NOTE.md` | `<<UNFILLED: W_ref — operator-supplied working days; derived from the 90–330-record range, not the 60–300 under-count>>` |

- **Confirmer submission deadline: `D_draw + W_ref`** — the **same** instant as the Author's, and
  deliberately so. §9.1 forbids communication before both submit; a later deadline for one recorder
  would create a window in which the earlier submission could leak into the later work.
- Adjudication starts only after **both** sets are in and completes **before `seal`** (§9.2.1).
- Held-out execution begins only after the **seal hash is published** (§9.6).

A deadline the operator has not anchored is not a deadline.

---

## 9. Standing prohibitions

- Never open, run, request or accept **any CPG output**, including the pilot and instrument check.
- Never see, ask for, or accept **any part of the Author's record** before you submit.
- Never discuss a company, field, source or value **with the Author** before both submissions.
- Never accept the **class prediction, stratum, split, quotas, sizing output or any tally**.
- Never enter a **target, projection, run-rate, order book or estimate** as an expected value.
- Never cite a source class **not authoritative** for the field.
- Never hand-write a row of the **reconciled** reference file.
- Never let an **AI** produce, draft or check a value you record.
- Never treat an **unknown** eligibility answer as "no".

---

## 10. What is still blocked on the operator for this slot

| Blocked item | Why it cannot be prepared here |
|---|---|
| The person | No identity may be invented. The slot is UNFILLED. |
| `person_id` | Operator-assigned from the restricted register; must be distinct from the Author's and the adjudicator's. |
| The signed declaration | Requires a real person's signature. |
| Fee agreement + SHA-256 | §4A.1 item 5: written **before** any role material is released. |
| Organisation confirmation + SHA-256 | Only the developing organisation can issue it. |
| §4A.1 item 6 pairwise check **against the Author and the adjudicator** | Needs all three identities; this is the check most likely to disqualify an otherwise eligible pair. |
| A channel disjoint from the Author's | Operator-supplied; the two recorders must not share a drop. |
| `R`, `D_draw`, `W_ref` | Operator-supplied anchors. |
| Actual held-out quotas | From the §5.6 sizing rule applied to the real pilot, which has not run. |

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

