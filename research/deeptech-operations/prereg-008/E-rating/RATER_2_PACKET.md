# RATER_2_PACKET — onboarding package, label `rater-2`

**Classification: PREPARATION ONLY. NOT REGISTERED. NOT RECRUITED. NO IDENTITY EXISTS.**
DEEPTECH-PARALLEL-008, Agent 5. No protocol byte and no instrument byte was changed. No registration,
no frame, no held-out draw, no execution, no network call, no company data.

**Nobody holds this role.** Every person-specific field below is an unfilled marker. A filled marker in
this file would be a fabrication. The marker convention is the one established in
`C:/tmp/dt007-eight-person/F-recruitment/`: `<<UNFILLED: …>>` and `UNASSIGNED` are markers, never data.

| Baseline | Value |
|---|---|
| Protocol | `CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (recomputed by this agent) |
| Instrument | `C:/tmp/dt002/research/cpg-u1/tooling`, **593 files**, aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (recomputed with the instrument's own `lib/aggregate.mjs`, read-only) |
| Sections governing this role | §4A.1, §4A.3, §10.1, §10.2, §10.3, §10.5, §12, §12.1, §12.3, §15.1, §15.2, §15.5 |
| Working instructions already written | `C:/tmp/dt004-operations/people/RATER_PACKET_INSTRUCTIONS.md` — the shared instruction sheet. **This file does not replace it; it is the per-label onboarding wrapper around it, and the two are released together.** |

> **This work must be done by a human.** No AI system, language model or agent may produce, draft,
> suggest or check any label returned under this label. Two independent **human** judgements are the
> endpoint's evidential basis; an AI substitute would remove exactly the property the study claims.

---

## 1. Slot identity — UNFILLED

| Field | Value |
|---|---|
| Study label | `rater-2` (one of `ASSIGNED_LABELS`, `lib/assignment.mjs:13`) |
| `person_id` (pseudonym; the only identifier that appears in any study artefact) | `UNASSIGNED` |
| Register role | `rater-2` (`INDEPENDENT_ROLES`, `lib/personnel.mjs:6`) |
| `rated_by` value written in **every** row submitted | `UNASSIGNED` — this person's own pseudonym, exactly as in the register and exactly as the published assignment fingerprint names for `rater-2` |
| Legal identity | **never in any study artefact.** It lives only in the restricted register (§4A.1) |
| Eligibility verdict | `<<UNFILLED: from RATING_MATERIAL_RELEASE_GATE.md — all gates PASS>>` |
| Signed declaration, all seven keys `"no"` | `<<UNFILLED: date received; the declaration itself is restricted>>` |
| Fee agreement sha256 (§4A.1 item 5), or `null` for no fee | `<<UNFILLED: 64 lowercase hex, or null — agreed in writing BEFORE any role material is released>>` |
| Developing organisation's written no-relationship confirmation, sha256 | `<<UNFILLED: 64 lowercase hex — required, never null>>` |
| Assignment artefact fingerprint this label appears in | `<<UNFILLED: sha256(canonicalJson(assignment)), published BEFORE the held-out commitment is broadcast>>` |
| Presentation-order label | `rater-2` (§12.1; `ORDER_LABELS`, `lib/raterOrder.mjs:9`) |
| The other rater | exists; **pseudonym, identity, packet order, labels and progress are never disclosed to this person** |

### 1.1 What differs from `rater-1`, and what does not

The two rater packages are deliberately **symmetric in substance**: identical eligibility, identical
received / never-received lists, the identical §10.1 tree and §10.2 rules, the identical six-column
return format, identical conflict rules and the identical relative schedule. `RATER_LABELS`
(`lib/raterPackets.mjs:17`) is exactly `['rater-1', 'rater-2']`, and `buildRaterPacket` treats the two
labels identically in every respect but order.

| Differs | How |
|---|---|
| Presentation order | `order_key("rater-2", candidate_id, field)` instead of `order_key("rater-1", …)` — a different domain-separated preimage, so the two packets are differently ordered **by construction**. There is no shared `position` the two raters could compare notes on (§12.1) |
| `rated_by` | must equal the person the published assignment fingerprint names for `rater-2`; `lib/ratings.mjs:57` refuses any other value, so a `rater-1` sheet cannot be submitted as this one |
| Sheet binding | `checkSheet` (`lib/ratings.mjs:78`) refuses a sheet whose `label` is not `rater-2`: *"sheet is for `<x>`, not `rater-2`"* |

| Does **not** differ | Why |
|---|---|
| The item set | both packets are *every* held-out company × field (§12.1, "Items per list"). Identical membership, different order |
| Seniority, weight or tie-break authority | none exists. `alphaNominal` receives the pair `[rater_1_label, rater_2_label]` symmetrically (`lib/analysis.mjs:181`), and a disagreement goes to the rating adjudicator, never to `rater-1` |
| The Label A / Label B position in adjudication | derived per item from `order_key("rating-adjudicator-label-a", …)`, whose first hex digit decides whether Label A is `rater-1`'s or `rater-2`'s (`lib/raterOrder.mjs:51`). Being `rater-2` confers no fixed position |

**`rater-1` and `rater-2` must be two different people.** That is enforced in three independent places:
`lib/assignment.mjs:33` (the assignment artefact), `lib/ratings.mjs:97` (adjudication intake) and
`lib/analysis.mjs:199` (§15.5(3), which makes the run INCONCLUSIVE). See `RATING_INTEGRITY_NOTES.md` §1.

---

## 2. Eligibility — every condition, and who checks it

§12's Eligibility row, quoted in full:

> **Eligibility** — "Must not have implemented CPG, the protocol or the tooling; must hold no other
> §4A.3 role; must satisfy §4A.1"

§4A.3's exclusivity rule, quoted in full:

> "**Every independent role is held by a different person, and no independent role is held by the
> operator.**
> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**."

| # | Condition | Source | Checked by |
|---|---|---|---|
| 1 | Not employed by the developing organisation in the exclusion period | §4A.1 item 1 | declaration key `employed_by_developing_organisation` = `"no"` |
| 2 | No contract or other work, paid or unpaid, for it (other than the item-5 fee) | §4A.1 item 2 | `contract_or_work_for_developing_organisation` = `"no"` |
| 3 | No payment or benefit from it other than the item-5 fee | §4A.1 item 3 | `payment_other_than_study_fee` = `"no"` |
| 4 | No equity, options or other financial or organisational interest | §4A.1 item 4 | `financial_interest_in_developing_organisation` = `"no"` |
| 5 | Not spouse/partner/family/household member of, and no current or former direct reporting relationship with, **any** CPG developer, the operator, **or any holder of another §4A.3 role** | §4A.1 item 6 | `close_relationship_with_developer_operator_or_role_holder` = `"no"` — **pairwise**, see `RATING_MATERIAL_RELEASE_GATE.md` §4 |
| 6 | Has not implemented CPG, the protocol, the tooling or the development-only registry | §12 Eligibility; §4A.2(a) as carried into the register | `implemented_cpg_protocol_tooling_or_registry` = `"no"` |
| 7 | Has not run CPG or seen any CPG output | §4A.2(b) as carried into the register | `ran_or_saw_cpg_output` = `"no"` |
| 8 | Holds **no other** §4A.3 role, and is not the operator | §4A.3 | `lib/personnel.mjs:33-34` ROLE COLLISION; `lib/assignment.mjs:33` distinctness |
| 9 | Fee agreed in writing **before** any role material is released, not contingent on any result, hash recorded | §4A.1 item 5 | `study_fee_agreement_sha256`, `lib/personnel.mjs:38` |
| 10 | Developing organisation's written confirmation that its records show no item 1–4 relationship | §4A.1 "Recorded per person" | `organisation_confirmation_sha256`, `lib/personnel.mjs:39` |

**"An unknown answer is not \"no\"."** (§4A.1). `lib/personnel.mjs:37` refuses any value other than the
exact string `"no"` — including `"unknown"`, `"n/a"`, `false`, `null` and a missing key.

These are **"procedural evidence, not proof"** (§4A.1). No tool can verify a declaration is true. If one
is later found false, §4A.1 applies the **§12 UNADJUDICATED consequences** to this person's rater work,
and the finding is published.

---

## 3. Exactly what this person receives

§12's Rater-packet row, quoted in full:

> **Rater packet** — "Field; CPG's value or null; the source URLs CPG cited for that value (**§12.3**);
> the sealed reference record"

Mechanically, `EVALUATION_ITEM_KEYS` (`lib/packets.mjs:15`) is exactly
`candidate_id, field, cpg_value, cpg_source_urls, reference_record`, plus the derived `position` and
`order_key` that `buildRaterPacket` adds (`lib/raterPackets.mjs:74`). `checkItem`
(`lib/raterPackets.mjs:55`) refuses any other key: *"keys must be exactly … (no class, split, pilot or
rater information)"*.

| Received | Source |
|---|---|
| The `rater-2` packet: **every held-out company × field**, in `order_key("rater-2", …)` order (§12.1) | `rater-packet`, byte-verified by `verify-rater-packet` |
| `cpg_value` — the value the software reported, or `null` | the archived response |
| `cpg_source_urls` — §12.3 Rule A's ordered, deduplicated field-evidence URL union; rule id `cpg-u1-cited-urls/field-evidence-union/v1` recorded in the packet | `extractCitedUrls`, `lib/raterPackets.mjs:31` |
| `reference_record` — the **sealed** reference row, exactly as sealed (`REFERENCE_COLUMNS`, `lib/schema.mjs:213`) | the seal |
| The §10.1 decision procedure and the §10.2 agreement rules (§10.2 is *"published to raters"*) | §5 and §6 below |
| The run `asOf` date and the derived 24-month cutoff date | the operator, **alongside** the rules — never inside a packet item, whose key set is fixed |
| This person's own pseudonym | the operator |
| `RATER_PACKET_INSTRUCTIONS.md` and this file | this package |
| That a second rater exists, and that the person-to-label assignment was fixed and fingerprinted before the held-out commitment | needed to answer declaration item 6 honestly, and to see that order cannot have been chosen for them |
| The published assignment fingerprint and the held-out sampling record, so this person can recompute their own order (`verify-rater-order`) | §12.1 Reproducibility |

## 4. Exactly what this person **never** receives

§12's Blinding row, quoted in full:

> **Blinding** (single-arm) — "Raters are blind to each other's labels, to running tallies and
> aggregates, and to the development pilot. There is no arm label to blind"

| Never received | Why |
|---|---|
| The other rater's labels, on any item, at any time | §12 Blinding |
| The other rater's pseudonym, legal identity, packet, order, progress or item count | §12 Blinding; the two orders differ by construction (§12.1) |
| Any tally, aggregate, running count, rate or provisional endpoint value — including a breakdown of this person's own labels | §12 Blinding. `ingest-ratings` prints only item count, pending count and the sheet hash |
| Anything about the development pilot or the instrument check | §12 Blinding; §11 — pilot outputs are held by the operator and *"never used for any purpose except sizing and harness debugging"* |
| Class prediction, stratum, split or identity-hazard note | `checkItem` refuses those keys (`lib/raterPackets.mjs:55`) |
| Which items are machine `INVALID`, `REFERENCE-STALE` or sealed `REFERENCE-CONFLICT` | §10.3, §15.2 — machine dispositions |
| The number of disagreements, or that any specific item disagreed | §12.2's never-receive list protects the adjudicator; a rater has no use for it either |
| Whether G1, P1, P2 or P3 is currently met | §12 Blinding |
| The rating adjudicator's decisions | adjudication happens only after both sheets are complete and hashed |

**Known observation, recorded rather than designed around** (`RATING_INTEGRITY_NOTES.md` §5):
`checkItem` (`lib/raterPackets.mjs:60`) requires the reference record to be *exactly* the sealed row,
and `REFERENCE_COLUMNS` includes `author`, `confirmer`, `resolution` and `adjudicated_by`. So this
person **does** see the reference team's pseudonyms and whether each row was contested. That is a
property of the frozen instrument, not a choice of this package. It is disclosed here so the person
knows it is expected, and so §8's prohibition on acting on it can be explicit.

---

## 5. The §10.1 decision procedure, reproduced verbatim

> Applied by raters with this **decision procedure**, in order:
>
> ```
> CPG returned a value?
> ├─ no  → reference holds an authoritative value?  yes → MISSED-FILL          no → CORRECT-ABSTENTION
> └─ yes → value attributable to the EXPECTED entity? no → MISATTRIBUTED-FILL
>          └─ yes → reference holds an authoritative value? no → UNSUPPORTED-FILL
>                   └─ yes → value agrees (§10.2)?          yes → SUPPORTED-FILL   no → INCORRECT-FILL
> Reference insufficient to decide → REFERENCE-AMBIGUOUS (excluded; published)
> ```
>
> `INVALID` is machine-assigned for observations that could not be scored (§15).

**Walk the branches in order. Do not form an overall impression and then pick a label.**

The **first branch is mechanical and enforced**: `checkRating` (`lib/ratings.mjs:37-38`) refuses the
whole sheet if a fill label is used where `cpg_value === null`, or an abstention label where
`cpg_value !== null`. `REFERENCE-AMBIGUOUS` and `pending` are exempt from that check and may be used on
either side of the first branch.

Only **two** nodes of this tree are genuinely judgemental — *is the value attributable to the EXPECTED
entity?* and *is the reference insufficient to decide?* Everything else is arithmetic or a lookup in the
sealed record. See `RATING_WORKLOAD_NOTE.md` §3.

## 6. The §10.2 agreement rules, reproduced verbatim

> ### 10.2 Agreement rules [NORMATIVE; published to raters]
>
> | Field | Agrees when | Else |
> |---|---|---|
> | `founded_year` | same four-digit year | INCORRECT-FILL |
> | `employee_count` | \|CPG − reference\| ≤ 10% of reference | INCORRECT-FILL |
> | `revenue_range` | CPG states a currency (`$` = USD) equal to the reference currency, **and** the parsed amount (K=10³, M=10⁶, B=10⁹) is within 10% of reference | a value with **no currency marker** → UNSUPPORTED-FILL (sub-reason `CURRENCY_NOT_STATED`); a stated but different currency or amount → INCORRECT-FILL |
>
> **Temporal rule** for `employee_count` and `revenue_range`: reference truth is the most recent
> authoritative value with `as_of_date` no more than **24 months** before the run `asOf` [NORMATIVE]. If
> none exists that recent, the observation is `REFERENCE-STALE` (excluded; published). A CPG value that
> matches only an *older* authoritative value is INCORRECT-FILL, sub-reason `STALE_VALUE`.
>
> *Rationale for the currency rule* [STRUCTURAL]: the adapter emits a `$` only for USD and otherwise
> drops the currency (`wikidataAdapter.ts:172`). A revenue figure without its currency is not an
> established fact as displayed to the user. *Rationale for 10%:* the adapter compacts revenue to one
> decimal of M/B, which alone introduces up to about 5% rounding, and headcounts are reported at
> differing dates and definitions.

The cutoff arithmetic (owner-approved `AD-5`, `CALENDAR_MONTHS`), the `REFERENCE-STALE` scope
(owner-approved `AD-6`, `STATED_REFERENCE_VALUES_ONLY`) and the worked consequences of these rules are
in `RATER_PACKET_INSTRUCTIONS.md` §2.3–§2.5 and are not restated here. **That sheet and this file are
released together, or neither is.**

`REFERENCE-STALE` is **not a label this person writes** — it is machine-derived from the sealed
`as_of_date`. Neither is `INVALID` or `REFERENCE-CONFLICT`. §10.3: *"Raters never convert them into a
scored label."*

---

## 7. What this person returns

The six columns of `RATING_COLUMNS` (`lib/ratings.mjs:17`) — **verified against the frozen instrument by
this agent, in this order**:

```
candidate_id,field,label,sub_reason,rated_by,rated_at
```

| Column | Written |
|---|---|
| `candidate_id` | exactly as the packet item gives it |
| `field` | `founded_year` \| `employee_count` \| `revenue_range` |
| `label` | one of the seven `RATING_LABELS`, or `pending` |
| `sub_reason` | empty, or `CURRENCY_NOT_STATED` (only `UNSUPPORTED-FILL` × `revenue_range`) or `STALE_VALUE` (only `INCORRECT-FILL` × `employee_count`/`revenue_range`) — `SUB_REASONS`, `lib/ratings.mjs:21-24` |
| `rated_by` | `UNASSIGNED` — this person's pseudonym. `lib/ratings.mjs:57` refuses any row whose `rated_by` is not the person the published assignment fingerprint names for `rater-2` |
| `rated_at` | `YYYY-MM-DD`; **empty** on a `pending` row (`lib/ratings.mjs:44`) |

§12's Scale row, quoted in full:

> **Scale** — "Categorical: SUPPORTED-FILL, UNSUPPORTED-FILL, INCORRECT-FILL, MISATTRIBUTED-FILL,
> CORRECT-ABSTENTION, MISSED-FILL, REFERENCE-AMBIGUOUS — applied by the §10.1 procedure with the §10.2
> rules"

`ingestRatings` (`lib/ratings.mjs:49-62`) refuses the sheet **whole**, writing nothing, on any of: a
missing item (*"no row — every packet item needs a label or \"pending\" (never silently missing)"*), an
extra or unknown item, a duplicate, a wrong `rated_by`, an unknown label, an illegal sub-reason, a
first-branch violation, or a malformed `rated_at`.

§12's Missing-ratings row, quoted in full:

> **Missing ratings** — "`pending` — never imputed, never scored"

`pending` is not free. §12's Minimum-valid-ratings row, quoted in full:

> **Minimum valid ratings** — "Every scored observation needs ≥ 2 independent ratings; ≥ 90% of held-out
> observations must be completely rated, else INCONCLUSIVE"

Run `C:/tmp/dt004-operations/people/tools/rating_precheck.mjs` **before** handing the sheet over: it
applies the instrument's own `checkRating` and `ingestRatings`, lists every problem addressed to the
rater, and prints no tallies.

---

## 8. Conflict rules

| Rule | Basis |
|---|---|
| **No other §4A.3 role, ever** — not before, not after. A later role would retroactively break §4A.3 exclusivity | §4A.3; `lib/personnel.mjs:34` |
| **Not the operator**, and no work for the developing organisation beyond the item-5 fee | §4A.1, §4A.3 |
| **No contact with the other rater** about any item, label, count or progress; no request for anyone's labels | §12 Blinding |
| **No contact with the reference team or either adjudicator** about any item — process questions go to the operator only | §9.1, §12.2 |
| **Do not act on the reference record's `author` / `confirmer` / `resolution` / `adjudicated_by` fields.** None is an input to §10.1 or §10.2. Rate the record's *content* | §10.1, §10.2; §4 above |
| **No AI**, in any part of the work | standing prohibition of this package |
| **No revision after submission.** The sheet is hashed and bound to the packet, the evaluation artefact, the seal and the assignment fingerprint (`lib/ratings.mjs:63-70`) | §13.2 |
| **A fee may not be contingent** on any result, finding or future engagement | §4A.1 item 5 |
| **If forbidden material arrives, stop and tell the operator.** A protocol violation discovered mid-run halts the run (§18) and triggers §15.5(7) | §15.5(7), §18 |
| **If any declaration answer changes** — a new engagement, a new relationship, any CPG exposure — say so immediately. It is not this person's job to judge whether it matters | §4A.1 |

---

## 9. Deadline — relative to operator-supplied anchors only

**No calendar date appears in this package.** Every date below is an offset from an anchor the operator
supplies after the gate of `RATING_MATERIAL_RELEASE_GATE.md` passes.

| Anchor | Meaning | Value |
|---|---|---|
| **E** | Eligibility complete for this person: declaration all-`"no"`, fee agreement signed **and hashed**, organisation confirmation received | `<<UNFILLED: YYYY-MM-DD>>` |
| **M** | Role material released (this file, `RATER_PACKET_INSTRUCTIONS.md`, §10.1/§10.2). **M ≥ E, always** (§4A.1 item 5) | `<<UNFILLED: YYYY-MM-DD, on or after E>>` |
| **A** | Person-to-label assignment recorded and its SHA-256 fingerprint **published** | `<<UNFILLED: YYYY-MM-DD, on or after E>>` |
| **C** | Held-out commitment transaction broadcast. **A < C is a hard gate** (§4A.3, §12.1) | `<<UNFILLED: YYYY-MM-DD, strictly after A>>` |
| **X** | Held-out execution complete; evaluation artefact built and bound to the seal | `<<UNFILLED: YYYY-MM-DD>>` |
| **P** | This person's `rater-2` packet released; `verify-rater-packet` byte-identical | `<<UNFILLED: YYYY-MM-DD, on or after X>>` |
| **N** | Rating window length in days, set by the operator from the real observation count (60–300; `RATING_WORKLOAD_NOTE.md`) | `<<UNFILLED: integer days>>` |

| Relative day | Act |
|---|---|
| E+0 | Declaration, fee agreement and organisation confirmation complete. **Nothing is released before this.** |
| M+0 | Role material released. This person reads §4A, §10.1, §10.2, §10.3, §12, §15.1–§15.2, this file and `RATER_PACKET_INSTRUCTIONS.md` **before** seeing any packet. |
| M+1 | Written confirmation of having read them. Every outstanding question about the §10.1 tree, the §10.2 arithmetic or the cutoff is resolved **before** P. |
| A+0 | Assignment fingerprint published. This person may confirm it names them for `rater-2` and for nothing else. |
| P+0 | Packet released with the run `asOf` and the derived cutoff. This person recomputes their own order (`verify-rater-order`) and the packet hash. |
| P+0 … P+N | Rating. No contact with the other rater. |
| **P+N** | **Submission deadline.** The sheet covers **every** packet item with a label or `pending`. |
| P+N+1 | Operator runs `ingest-ratings`. Refusal is all-or-nothing. |
| P+N+2 | Operator returns the refusal messages verbatim. This person corrects **their own** rows; the operator may never fix a label. |
| P+N+4 | Corrections returned. Repeat until the sheet is accepted. |
| after both sheets accepted | Rating adjudication begins (§12.2 Timing: *"after both raters submit complete sheets"*). This person is told nothing about it. |

**Ordering constraints that are not negotiable:** `E ≤ M`, `E ≤ A`, `A < C`, `C < X`, `X ≤ P`.
A slipped deadline is a resourcing problem; a violated ordering constraint is a protocol violation.

---

## 10. Unavailability — the honest consequence

§12's closing paragraph, quoted in full:

> **If independent raters are unavailable:** execution may occur, but every primary endpoint is labelled
> **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of independent
> validation may be made.** The protocol is not weakened to accommodate unavailability.

There is no substitute for this person — not the operator, not the other rater, not the rating
adjudicator, not an AI. §15.5(3) makes fewer than two independent raters a run-level **INCONCLUSIVE**
condition, checked in code at `lib/analysis.mjs:199`.

## Human dependency

| Item | Class |
|---|---|
| Packet construction, order derivation, cited-URL extraction, intake validation, sheet hashing | **H0** — fully mechanical, deterministic, rebuildable |
| Applying §10.1/§10.2 to each observation | **H2** — the protocol reserves the label to a human |
| That a **second, distinct** independent human rater exists | **H3** — §12's Rung-2 ceiling; `lib/ratings.mjs:97` and `lib/analysis.mjs:199` enforce distinctness mechanically |
| Blinding to the other rater, tallies and the pilot | **H2** — procedural; the tooling enforces packet contents, not human conduct |
| Truth of the declaration | **H3** — unverifiable by any tool (§4A.1; `lib/personnel.mjs:3`) |
