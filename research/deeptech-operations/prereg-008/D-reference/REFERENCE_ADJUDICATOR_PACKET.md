# REFERENCE_ADJUDICATOR_PACKET — the **reference adjudicator** slot (CPG-U1)

**Classification: PREPARATION.** This document is not evidence. It records no identity, no
recruitment, no commitment, no fee, no decision and no result. **No person has been recruited.**
"Reference adjudicator" is a **slot label** for one position that is currently **UNFILLED**. Every
person-specific field is an `<<UNFILLED: ...>>` marker; a copy that still contains one is not a
completed record.

> **No AI system, agent or language model may hold this role.** The adjudicator is a real,
> independent human being. An AI may not stand in, may not "assist" by producing the decision a
> human then signs, and may not read the packet on the human's behalf. A role ghost-written by an AI
> is not independent work: the §4A.1 consequence applies and the reference truth is published as
> **not independent**. **The preparer of this document is an AI and holds no role in this study.**

Baseline (recomputed; see `README.md`): protocol `c50fc680...f00b719`; instrument aggregate
`f7699f05...b04e5cc5dd` over 593 files at `C:/tmp/dt002/research/cpg-u1/tooling`.

**You also receive** `C:/tmp/dt004-operations/people/REFERENCE_ADJUDICATION_PACKET.md` — Part A is the
blinded-packet walkthrough, Part B is the operator's command sequence and is **not yours**. This
packet does not repeat Part A; it adds eligibility, the §9.1 "Must not" column as an undertaking, the
record format you produce, the conflict rules, the submission procedure and the relative deadline.
See also `REFERENCE_ADJUDICATION_NOTE.md` for two verified facts about your decision space and one
recorded defect in how a `REFERENCE-CONFLICT` row is published.

---

## 1. Eligibility criteria for this slot

This slot has a **stricter** eligibility rule than the two recorders, and one exclusion that is
unique to it.

### 1.1 §9.1 "Must not" column for the reference adjudicator, verbatim

> Hold any other §4A.3 role (including enumerator); introduce a new value

Both halves are binding, and both are enforced:

- **"Hold any other §4A.3 role (including enumerator)"** — §4A.3 states the reason explicitly:
  *"An enumerator may not be the reference adjudicator. The adjudicator decides contested reference
  values, and the enumerator authored the class predictions whose mismatches with reference truth are
  published (§9.2, §9.7)."* `lib/personnel.mjs:34` refuses the register with
  `ROLE COLLISION — <id> already holds <role>; all independent roles are mutually exclusive`, and
  `lib/reconcile.mjs:59` refuses `adjudicator must differ from both author and confirmer`.
- **"introduce a new value"** — see §6. Your decision space has exactly three members and none of
  them is a value of your own (§9.5: the adjudicator *"cannot supply a third value"*).

### 1.2 §4A.1 independence from the developing organisation

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
   custodian), or **any holder of another §4A.3 role** — for this slot that means **both recorders,
   every enumerator, both raters, the rating adjudicator and the operator**.

> **"An unknown answer is not 'no.'"** (§4A.1, verbatim.)

**Item 6 collides with §9.2.1 and the operator must resolve the collision, not paper over it.** You
must be unrelated to the Author and the Confirmer, yet §9.2.1 forbids you ever to learn *"the
identities or pseudonyms of Author and Confirmer"*. You therefore cannot personally verify item 6
against them. The permitted resolutions are recorded in
`REFERENCE_MATERIAL_RELEASE_GATE.md` §4; `<<UNFILLED: operator selects and records the resolution:
(i) the operator cross-checks the identities from the restricted register against this declarant's
stated relationships, so the declarant never learns the names; or (ii) the operator discloses the
role-holders' identities under confidentiality and re-takes item 6, accepting that the blinding of
identity is then broken and must be published as such; or (iii) other — describe>>`. Option (ii)
breaks §9.2.1 blinding and is **not** the default.

### 1.3 The seven declaration keys, each the literal `"no"`

`DECLARATION_KEYS`, `lib/personnel.mjs:8`: `employed_by_developing_organisation`,
`contract_or_work_for_developing_organisation`, `payment_other_than_study_fee`,
`financial_interest_in_developing_organisation`,
`close_relationship_with_developer_operator_or_role_holder`,
`implemented_cpg_protocol_tooling_or_registry`, `ran_or_saw_cpg_output`. `:37` refuses anything but
`"no"`.

`ran_or_saw_cpg_output = no` is not a formality for this slot: §9.2.1 lists *"any CPG output
(including pilot and instrument check)"* first among the things you must never receive. A person who
has already seen CPG output cannot be blinded to it afterwards, and is not eligible.

### 1.4 Recorded evidence

- signed declaration (`REFERENCE_INDEPENDENCE_DECLARATION.md`, unfilled);
- `study_fee_agreement_sha256` — 64 lowercase hex **or the literal `null`** (`lib/personnel.mjs:38`);
- `organisation_confirmation_sha256` — 64 lowercase hex, **required** (`:39`).

### 1.5 Register fields for this slot

| Register field | Value |
|---|---|
| `role` | `reference-adjudicator` (`INDEPENDENT_ROLES`, `lib/personnel.mjs:6`) |
| `person_id` | `<<UNFILLED: pseudonymous id matching the register pattern of 1-64 chars from A-Z a-z 0-9 underscore hyphen; must differ from the Author's, the Confirmer's, every enumerator's, both raters', the rating adjudicator's and the operator's>>` |
| `declaration` | `<<UNFILLED: all seven keys, each the literal string "no">>` |
| `study_fee_agreement_sha256` | `<<UNFILLED: 64 lowercase hex, or the literal null when no fee>>` |
| `organisation_confirmation_sha256` | `<<UNFILLED: 64 lowercase hex, required>>` |

`role reference-adjudicator must be held by exactly one person` (`:26`), and
`role reference-adjudicator is UNFILLED` is the blocker `check-personnel` reports until it is filled
(`:25`).

---

## 2. Exactly what you receive (§9.2.1, verbatim)

§9.2 first: *"The reference adjudicator receives only the materials in §9.2.1."* Then §9.2.1:

> **Contents, for each disagreeing company × field only:**
> - company name, canonical domain, jurisdiction family and decisive identifier;
> - the field definition, §9.3 formats and §9.4 authority table;
> - the two blind records presented **unlabelled** as "Record 1" and "Record 2", each carrying only
>   its value, source and search content (no recorder identity or timestamps).

As the instrument builds it (`lib/packets.mjs`), each item carries exactly the nine
`REFERENCE_ITEM_KEYS`: `candidate_id`, `field`, `company_name`, `canonical_domain`,
`jurisdiction_family`, `identifier_scheme`, `identifier_value`, `record_1`, `record_2`. Any added key
is refused with `keys must be exactly ... (forbidden information present or field missing)`.

Each of `record_1` and `record_2` carries exactly the eight `RECORD_KEYS` — `BLIND_RECORD_COLUMNS`
minus `candidate_id`, `field`, `recorded_by`, `recorded_at` and `constructed_without_cpg`:

| Key you see | Key you do **not** see |
|---|---|
| `value_kind` | `candidate_id` (given once, at item level) |
| `expected_value` | `field` (given once, at item level) |
| `authoritative_source_name` | `recorded_by` — **recorder identity** |
| `source_class` | `recorded_at` — **timestamp** |
| `source_url` | `constructed_without_cpg` |
| `publication_date` | |
| `as_of_date` | |
| `search_note` | |

A packet in which any record carries a ninth key is refused:
`records must carry exactly ... (no recorder identity)`.

### 2.1 Record 1 / Record 2 are scrambled per item, on purpose (§9.2.1)

> **Record 1 / Record 2 assignment.** Record 1 is the Author's record iff the first hexadecimal digit
> of `order_key("reference-adjudicator-record-1", candidate_id, field)` is even. Items are presented
> in `order_key("reference-adjudicator", ...)` order (§12.1).

So **Record 1 is not "the Author" and Record 2 is not "the Confirmer"**, and the assignment flips
item by item. Any theory of the form "Record 1 is usually the careful one" is a theory about a coin.
The operator re-derives the mapping from the sealed held-out sampling record after your decisions
(`authorIsRecord1`, `lib/raterOrder.mjs:49`; `resolveReferenceDecisions`, `lib/packets.mjs:60`) — **there
is no mapping file for anyone to trust or to leak.**

### 2.2 Items are only the disagreements

`buildReferenceAdjudicationPacket` skips every pair where `agreementKey(a) === agreementKey(c)`:
*"agreeing records are never released"*. You therefore cannot count agreements, cannot infer the
disagreement rate, and cannot tell how many companies were drawn.

---

## 3. Exactly what you never receive (§9.2.1, verbatim and exhaustive)

> **The reference adjudicator never receives:**
> - any CPG output (including pilot and instrument check);
> - class predictions, identity-hazard notes, stratum or split;
> - screening logs, attestations or contamination bases;
> - agreeing records;
> - the identities or pseudonyms of Author and Confirmer;
> - any count or tally of adjudication outcomes.

That list is the whole list, and the packet is enforced against it by rebuilding
(`checkReferenceAdjudicationPacket`: *"packet differs from the deterministic build (extra or missing
items, agreeing records, order or Record 1/2 assignment)"*). §9.2.1 is explicit that the artifact is
what the tooling can police: *"What the adjudicator learns outside the packet is controlled
procedurally (§4A)."* So the last three bullets are, in practice, **the operator's discipline and
yours** — do not ask, and refuse if told.

You also never receive: the reconciled reference file, the seal or seal hash, the number of drawn
companies, the held-out quotas, the sizing output, or any statement about how your earlier decisions
came out.

---

## 4. Role-specific instructions

1. You decide **only the items in the packet**, and **every** item in it. The operator's check refuses
   a decision set that is not exactly the packet's items:
   `the blind decisions do not cover exactly the packet items (missing, extra or duplicated decision)`.
2. For each item, read the field definition, the §9.3 format rule, the §9.4 authority table, and the
   two records' value / source / search content. Decide **which of the two records is the better
   reference record for that field**, or that neither can be preferred.
3. Your grounds are the ones the protocol gives you, in this order: does the record satisfy §9.3
   (value kind, format, empty value for an abstention); is its `source_class` **authoritative** for
   that field under §9.4, and at which tier; for `employee_count` from `ENTITY_OWN_PAGE`, is there a
   stated `publication_date`; for `employee_count` and `revenue_range`, does `as_of_date` satisfy the
   §10.2 24-month rule relative to the run `asOf`
   (`<<UNFILLED: operator-supplied run asOf anchor — supplied as a date only, never with any result>>`);
   and is the `search_note` consistent with the value claimed.
4. **A Tier-1 source outranks a Tier-2 source** for the same field (§9.4). That is the only ranking
   the protocol gives. It does not give you a tie-break between two Tier-1 records that disagree — for
   that, see §6 on `REFERENCE-CONFLICT`.
5. **You may not introduce a value** (§9.1, §9.5). Not as a decision, not as a "correction", not in
   the rationale. If you believe both records are wrong, the decision is `REFERENCE-CONFLICT`; it is
   not an invitation to supply the right answer.
6. **You may not ask who wrote which record**, and you may not ask for a third record, more sources,
   the agreeing records, or any total.
7. Write a **rationale for every decision** — `reconcile` refuses a row without one
   (`rationale is required`). Write it from the packet only: a rationale that names a recorder, cites
   CPG, or refers to anything outside the packet reveals a leak and must be reported.
8. If you are ever shown something on the §3 never-receive list, **stop, do not decide that item, and
   tell the operator.** A late discovery is published (§4A.1).

---

## 5. The record format you must produce, field by field

You do **not** write `BLIND_RECORD_COLUMNS` and you do **not** write `REFERENCE_COLUMNS` — the latter
is *"produced **ONLY** by reconcile (never hand-written)"* (`lib/schema.mjs:213`). You write
**`ADJUDICATION_COLUMNS`** (`lib/schema.mjs:207`), **six columns, one row per packet item**:

| # | Column | Rule, as the instrument enforces it |
|---|---|---|
| 1 | `candidate_id` | Copied exactly from the packet item. A row for a company or field not in the packet is refused: `adjudication for <id>\|<field>: not a drawn company/field`, and separately `the blind decisions do not cover exactly the packet items`. |
| 2 | `field` | Copied exactly from the packet item: `founded_year`, `employee_count` or `revenue_range`. |
| 3 | `decision` | **`RECORD_1`**, **`RECORD_2`** or **`REFERENCE-CONFLICT`** — exactly these three spellings, uppercase, underscore in the first two, hyphen in the third. `resolveReferenceDecisions` (`lib/packets.mjs:64`) throws `blind decision must be RECORD_1\|RECORD_2\|REFERENCE-CONFLICT` for anything else. **Never write `AUTHOR` or `CONFIRMER`:** those are what the operator's mechanical resolution *produces* from your blind decision, and a file typed by role name without a blind packet is refused (`BLIND_ADJUDICATION_REFUSED`). |
| 4 | `rationale` | **Required, non-empty** (`rationale is required`). One or two sentences, grounded only in §9.3 / §9.4 / §10.2 and the two records' own content. No recorder name, no CPG reference, no external value. |
| 5 | `adjudicated_by` | **Required, non-empty** (`adjudicated_by is required`): your pseudonymous `person_id`. `lib/reconcile.mjs:59` refuses it if it equals either recorder's `recorded_by`. |
| 6 | `adjudicated_at` | `YYYY-MM-DD` (`adjudicated_at must be YYYY-MM-DD`). |

One row per item, no duplicates (`duplicate adjudication`), no row for an item the packet does not
contain, and **no row for an agreeing item** — `reconcile` refuses that with
`adjudication supplied for an AGREED record — an adjudicator may not override agreement`. Since
agreeing records are never released to you, you cannot write such a row without being given something
you should not have.

---

## 6. Conflict rules

### 6.1 Your decision space is exactly three members

| Decision | Means | Becomes, after the operator's mechanical resolution |
|---|---|---|
| `RECORD_1` | the record presented first for **this item** is the better reference record | `AUTHOR` or `CONFIRMER`, depending on `authorIsRecord1` for this item |
| `RECORD_2` | the record presented second for **this item** is the better reference record | `AUTHOR` or `CONFIRMER`, likewise |
| `REFERENCE-CONFLICT` | neither record can be preferred on §9.3 / §9.4 / §10.2 grounds | `REFERENCE_CONFLICT` — the observation is **excluded from every denominator and published** (§9.5, §15.1, §15.2) |

There is **no fourth option**. §9.5: *"The adjudicator chooses between the two records or declares a
conflict, and **cannot supply a third value**."* §9.1: *"introduce a new value"* is in your "Must not"
column.

### 6.2 When `REFERENCE-CONFLICT` is the right decision

When the two records cite sources of the **same tier** for the same field and the protocol gives no
basis to prefer one; when both fail §9.3 or §9.4; when one asserts `STATED` and the other
`NOT_AVAILABLE_FROM_SOURCE` and the cited evidence does not settle which is right; when the §10.2
temporal rule cannot be applied from the packet's content. `REFERENCE-CONFLICT` is a **legitimate
outcome, not a failure to decide**, and it is published as such. Choosing a record you cannot justify
in order to avoid a conflict is the one thing that corrupts the endpoint silently.

### 6.3 What you cannot do, restated as refusals

| If this happened | The instrument refuses with |
|---|---|
| You are also the Author or the Confirmer | `adjudicator must differ from both author and confirmer` (`lib/reconcile.mjs:59`) |
| You hold another §4A.3 role | `ROLE COLLISION — ... all independent roles are mutually exclusive` (`lib/personnel.mjs:34`) |
| You are the operator | `ROLE COLLISION — the operator may hold no independent role` (`:33`) |
| You decide an item that was not a disagreement | `adjudication supplied for an AGREED record — an adjudicator may not override agreement` |
| You leave an item undecided | `the blind decisions do not cover exactly the packet items`, and at reconcile `author and confirmer disagree (...) — independent adjudication required` — **`cmdReconcile` exits 1 and no seal is possible** |
| You write `AUTHOR` / `CONFIRMER` instead of `RECORD_1` / `RECORD_2` | `BLIND_ADJUDICATION_REFUSED: blind decision must be RECORD_1\|RECORD_2\|REFERENCE-CONFLICT` |
| Your rationale or `adjudicated_by` is blank, or the date is malformed | `rationale is required` / `adjudicated_by is required` / `adjudicated_at must be YYYY-MM-DD` |
| The packet you were given was not the deterministic packet | `BLIND_ADJUDICATION_REFUSED: the reference adjudication packet is not the deterministic packet` |

### 6.4 One recorded defect you should know about, and must not design around

For a `REFERENCE-CONFLICT` row, the published row still carries the **Author's** value and source
columns, because `src` is never reassigned on that branch of `lib/reconcile.mjs`. The row is flagged
`ambiguity_flag = REFERENCE-CONFLICT` and excluded from every denominator, so it does not affect any
endpoint — but the published columns are asymmetric. **Do not adjust your decision because of it.**
Deciding `RECORD_1` or `RECORD_2` to control which value gets published would be exactly the
value-introduction §9.1 forbids. The defect is recorded in `REFERENCE_ADJUDICATION_NOTE.md` §4 for the
operator and the eventual publication, not for you.

---

## 7. Submission procedure

1. **Receive the packet** — the JSON built by `reference-adjudication-packet` and verified by
   `verify-adjudication-packet` **before** it reaches you. Ask the operator to state that the
   verification passed; a packet that was not rebuilt and matched is not a packet you should read.
   Channel: `<<UNFILLED: operator-specified channel; must not be a channel the developing
   organisation can read, and must not be shared with either recorder>>`.
2. **Decide every item.** Work from the packet alone.
3. **Fill the six `ADJUDICATION_COLUMNS`**, one row per item, in the packet's own item order.
   `decision` is `RECORD_1`, `RECORD_2` or `REFERENCE-CONFLICT`.
4. **Send** the CSV to `<<UNFILLED: operator-specified submission address or drop>>`.
5. **Confirm** in writing: "I decided only the items in the packet and all of them; I received
   nothing on the §9.2.1 never-receive list; I introduced no value of my own; I do not know which
   record is the Author's; I hold no other §4A.3 role."
6. **No revisions after submission.** The operator resolves your blind decisions mechanically
   (`resolve-reference-adjudication`) and `seal` binds both the packet hash and your decisions hash.
   A changed decision changes the seal hash, which then will not match the published one.
7. **You are never told the outcome** — §9.2.1 forbids you *"any count or tally of adjudication
   outcomes"*. Do not ask how your decisions resolved.

---

## 8. Deadline — relative to operator-supplied anchors only

**No date appears in this document.** Let:

| Anchor | Meaning | Value |
|---|---|---|
| `R` | the day the OSF registration is published | `<<UNFILLED: R — operator-supplied; not before the registration is published>>` |
| `S_both` | the day the operator holds **both** complete blind record sets | `<<UNFILLED: S_both — operator-supplied; it is D_draw + W_ref at the earliest, and is not known until both sets are in>>` |
| `P_built` | the day the deterministic packet is built **and verified by rebuilding** and released to you — on or after `S_both`, and on or after the material-release gate passes for this slot | `<<UNFILLED: P_built — operator-supplied, on or after S_both>>` |
| `W_adj` | your decision window in working days, sized from `REFERENCE_WORKLOAD_NOTE.md` for the **actual** number of packet items | `<<UNFILLED: W_adj — operator-supplied working days; the item count is not knowable before the records exist, so this window cannot be fixed in advance>>` |

Then:

- **Adjudication opens at `P_built`** — never earlier. §9.2.1 "Timing": *"adjudication occurs after
  both blind record sets are submitted and before `seal`."*
- **Adjudication deadline: `P_built + W_adj`.**
- **`seal` cannot run before your decisions are in**, because every difference must be adjudicated
  (`lib/reconcile.mjs:58`) and `seal` refuses a reference file with any error. Your deadline is
  therefore on the critical path to the published seal hash and to held-out execution (§9.6).
- **Held-out execution begins only after the seal hash is published** (§9.6).

Your window cannot be sized before the records exist: the number of items is the number of
disagreements, which is not known until both sets are in. The operator must therefore either hold
`W_adj` open, or publish a contingency — `<<UNFILLED: operator's stated contingency if the
disagreement count exceeds what W_adj assumed; it may not be "adjudicate a subset">>`.

A deadline the operator has not anchored is not a deadline.

---

## 9. Standing prohibitions

- Never receive, seek or accept **any CPG output**, including the development pilot and the §8.5
  instrument check.
- Never receive, seek or accept **class predictions, identity-hazard notes, stratum or split**.
- Never receive, seek or accept **screening logs, attestations or contamination bases**.
- Never receive, seek or accept **agreeing records**.
- Never learn or ask for **the identities or pseudonyms of the Author and the Confirmer**.
- Never receive, seek or accept **any count or tally of adjudication outcomes**, including your own.
- Never **introduce a value** — in a decision, a rationale, a note or a conversation.
- Never write `AUTHOR` or `CONFIRMER` in the `decision` column.
- Never decide an item that is not in the packet, and never leave one in it undecided.
- Never hold **any other** §4A.3 role, including enumerator, and never be the operator.
- Never let an **AI** read the packet for you or produce a decision or rationale.
- Never treat an **unknown** eligibility answer as "no".

---

## 10. What is still blocked on the operator for this slot

| Blocked item | Why it cannot be prepared here |
|---|---|
| The person | No identity may be invented. The slot is UNFILLED. |
| `person_id` | Operator-assigned; must be distinct from all six other role-holders and the operator. |
| The signed declaration | Requires a real person's signature. |
| Fee agreement + SHA-256 | §4A.1 item 5: written **before** any role material is released. |
| Organisation confirmation + SHA-256 | Only the developing organisation can issue it. |
| **The §4A.1 item 6 / §9.2.1 collision** | Item 6 requires a pairwise check against the two recorders; §9.2.1 forbids this slot ever to learn their identities. The operator must choose and record a resolution; option (ii) breaks identity blinding and must be published. **This is the single most likely blocker for this slot.** |
| `R`, `S_both`, `P_built`, `W_adj` | Operator-supplied anchors; `S_both` and the item count are not knowable until the records exist. |
| The contingency for more disagreements than `W_adj` assumed | A resourcing decision; it may not be "adjudicate a subset", because an unadjudicated difference blocks the seal outright. |
| A channel disjoint from both recorders' | Operator-supplied. |
