# CPG-U1 — Rating instruction sheet (Rater 1 / Rater 2)

**Classification: HUMAN-REQUIRED INPUT.** This is the complete instruction sheet and the blank return
format. It contains **no company, no value, no label and no identity**. One identical copy goes to
each rater; neither is told the other's pseudonym.

- Protocol: `CPG_U1_PROTOCOL_004.md` §10.1, §10.2, §10.3, §12, §12.1, §12.3, §15
  (sha256 `c50fc680…df00b719`).
- Instrument: tooling v6, aggregate `f7699f05…5eb04e5cc5dd`
  (`lib/ratings.mjs` — `RATING_COLUMNS`, `SUB_REASONS`, `checkRating`, `ingestRatings`;
  `lib/packets.mjs` — `RATING_LABELS`, `PENDING`; `lib/raterPackets.mjs`).
- Owner-approved methodological decisions quoted below: `rules/analysis_decisions.json`
  **AD-5** and **AD-6**.

> **This work must be done by a human.** No AI system, language model or agent may produce, draft,
> suggest or check any label you return. Two independent **human** judgements are the endpoint's
> evidential basis; an AI substitute would remove exactly the property the study claims.

---

## 1. What you receive

Your packet is a list of **observations**. One observation = one company × one field. For each, in a
fixed presentation order you did not choose, you are given exactly:

| Item | Meaning |
|---|---|
| `position` | 1, 2, 3 … your order. It carries no meaning; it is derived from a public random beacon. |
| `candidate_id` | the company's study id |
| `field` | `founded_year` \| `employee_count` \| `revenue_range` |
| `cpg_value` | **the value the software reported, or `null`** if it reported nothing for this field |
| `cpg_source_urls` | the source URLs the software cited **for that value** — possibly an empty list |
| `reference_record` | the **sealed** reference record for this observation: what an independent lookup found, in a fixed format |

Nothing else is in the packet. The format mechanically excludes *"class, split, pilot or rater
information"* (`lib/raterPackets.mjs:55`), so there is no field in it that could tell you what the
study expects, which stratum or split an item belongs to, or anything about the other rater.

### 1.1 About `cpg_source_urls` (§12.3)

The URL set is **the ordered, deduplicated set of URLs carried by that field's final evidence records
in the software's response** — rule id `cpg-u1-cited-urls/field-evidence-union/v1`. Facts about it
you can rely on:

- **Every** qualifying URL is there, *"including records whose own value differs from the reported
  value."* Nothing was selected, removed, reordered or filtered by value agreement, source authority,
  identity class, provider, rater result, or any expected or observed outcome. *"Post-hoc favourable
  selection is prohibited."*
- Order is response order, first occurrence first. Byte-identical duplicates appear once. URLs
  differing in any byte are both present; **no normalisation was performed.**
- An evidence record with a null URL contributed nothing; **none was invented or substituted**.
- An empty list is a real state: the field's evidence list was empty, or there was no response. The
  item is still presented.

So an empty or thin URL list is information about the software, not an omission by the operator.

### 1.2 About `reference_record`

It is the sealed reference row, exactly as sealed — `value_kind` (`STATED` or
`NOT_AVAILABLE_FROM_SOURCE`), `expected_value`, `authoritative_source_name`, `source_class`,
`source_url`, `publication_date`, `as_of_date`, `search_note`, `ambiguity_flag`,
`independence_class`, plus the reconciliation bookkeeping (`resolution`, and the pseudonyms of the
people who produced it).

Two things follow:

- **The reference record was constructed before the software was ever run**, by two independent people
  who never saw its output, and it was hashed and published in the seal before execution (§9.6). It
  cannot have been adjusted to suit a result.
- **`source_class` tells you the authority tier.** For each field, only these classes are
  authoritative (§9.4):

  | Field | Tier 1 | Tier 2 | Not authoritative |
  |---|---|---|---|
  | `founded_year` | `REGISTRY_RECORD` | `ENTITY_OWN_PAGE` | everything else |
  | `employee_count` | `REGULATORY_FILING` | `ENTITY_OWN_PAGE` **with a stated publication date** | everything else |
  | `revenue_range` | `AUDITED_FINANCIAL_FILING`, `REGULATORY_FILING` | `ENTITY_OWN_FINANCIAL_STATEMENT` | everything else |

  `PRESS`, `ENCYCLOPAEDIA`, `AGGREGATOR` and `JOB_BOARD` are never authoritative for any field.

"**Reference holds an authoritative value**", in the decision procedure below, means: `value_kind` is
`STATED`, **and** the value passes the temporal rule of §2.3. A `NOT_AVAILABLE_FROM_SOURCE` reference
record means the reference does **not** hold an authoritative value.

---

## 2. The decision procedure

### 2.1 §10.1, as given

```
CPG returned a value?
├─ no  → reference holds an authoritative value?  yes → MISSED-FILL          no → CORRECT-ABSTENTION
└─ yes → value attributable to the EXPECTED entity? no → MISATTRIBUTED-FILL
         └─ yes → reference holds an authoritative value? no → UNSUPPORTED-FILL
                  └─ yes → value agrees (§10.2)?          yes → SUPPORTED-FILL   no → INCORRECT-FILL
Reference insufficient to decide → REFERENCE-AMBIGUOUS (excluded; published)
```

**Apply it in order. Do not form an overall impression and then pick a label.** Walk the branches.

### 2.2 The first branch is mechanical, and the tooling enforces it

> **`cpg_value === null` → you are on the "no" branch. `cpg_value !== null` → you are on the "yes"
> branch. There is no judgement in this step and no exception to it.**

`checkRating` (`lib/ratings.mjs:36-38`) refuses your sheet outright if you cross the branch:

| Your label | Refused when |
|---|---|
| `SUPPORTED-FILL`, `UNSUPPORTED-FILL`, `INCORRECT-FILL`, `MISATTRIBUTED-FILL` (the four **fill** labels) | `cpg_value` is `null` — *"`<label>` for an item where CPG returned no value (§10.1)"* |
| `CORRECT-ABSTENTION`, `MISSED-FILL` (the two **abstention** labels) | `cpg_value` is **not** `null` — *"`<label>` for an item where CPG returned a value (§10.1)"* |

So: never label an item `CORRECT-ABSTENTION` because the software's value was useless or empty-looking
— if a value is present, you are on the fill side. And never label an item `UNSUPPORTED-FILL` because
the software returned nothing — with no value there is no fill. `REFERENCE-AMBIGUOUS` and `pending`
are exempt from this check: either may be used on either side of the first branch.

### 2.3 §10.2 agreement rules [NORMATIVE; published to raters]

| Field | Agrees when | Else |
|---|---|---|
| `founded_year` | same four-digit year | INCORRECT-FILL |
| `employee_count` | \|CPG − reference\| ≤ **10%** of reference | INCORRECT-FILL |
| `revenue_range` | CPG states a currency (`$` = USD) equal to the reference currency, **and** the parsed amount (K=10³, M=10⁶, B=10⁹) is within **10%** of reference | a value with **no currency marker** → **UNSUPPORTED-FILL** (sub-reason `CURRENCY_NOT_STATED`); a stated but different currency or amount → **INCORRECT-FILL** |

Worked consequences:

- `founded_year` is **exact**. `1998` against a reference `1999` is INCORRECT-FILL; there is no
  tolerance.
- `employee_count`: the 10% is **of the reference value**. Reference `3682` admits CPG values from
  `3313.8` to `4050.2` inclusive.
- `revenue_range`: parse the software's compacted figure with **K = 10³, M = 10⁶, B = 10⁹** before
  comparing. `$1.3B` = `USD 1300000000`. The reference is always ISO 4217 + whole units.
- **The currency rule.** `$` counts as a stated currency and means **USD**. A revenue figure with
  **no currency marker at all** — a bare number, or a number with only a magnitude suffix such as
  `1.3B` — is **UNSUPPORTED-FILL with sub-reason `CURRENCY_NOT_STATED`**, *not* INCORRECT-FILL, and
  *not* an assumption that the currency matches. A figure with a currency that is stated but
  **different** from the reference currency is **INCORRECT-FILL**. §10.2's rationale
  [STRUCTURAL]: *"the adapter emits a `$` only for USD and otherwise drops the currency … A revenue
  figure without its currency is not an established fact as displayed to the user."*
- Why 10%: *"the adapter compacts revenue to one decimal of M/B, which alone introduces up to about
  5% rounding, and headcounts are reported at differing dates and definitions."*

### 2.4 The temporal rule (§10.2) — `employee_count` and `revenue_range` only

> **Temporal rule** for `employee_count` and `revenue_range`: reference truth is the most recent
> authoritative value with `as_of_date` no more than **24 months** before the run `asOf` [NORMATIVE].
> If none exists that recent, the observation is `REFERENCE-STALE` (excluded; published). A CPG value
> that matches only an *older* authoritative value is INCORRECT-FILL, sub-reason `STALE_VALUE`.

How to apply it:

1. **Only these two fields.** `founded_year` has no temporal rule — a founding year does not go stale.
2. Compute the cutoff as **the same calendar day 24 months before the run `asOf`, clamped to month
   end** — *not* `asOf` minus 730 days. This is owner-approved:
   `rules/analysis_decisions.json` **AD-5**, topic *"24-month temporal rule arithmetic"*,
   `"value": "CALENDAR_MONTHS"`. §10.2 is *"published to raters"*, so the operator supplies the run
   `asOf` date and the resulting cutoff date **alongside** the §10.2 rules — not inside the packet
   items, whose key set is fixed. Use the cutoff exactly as given; do not recompute it a different
   way.
3. If the reference record's `as_of_date` is **on or after** the cutoff, the reference holds an
   authoritative value and you continue down the branch.
4. If it is **before** the cutoff, the observation is **`REFERENCE-STALE`** — excluded and published.
   **`REFERENCE-STALE` is not a label you write.** It is a machine exclusion applied from the sealed
   `as_of_date`. You do not need to compute it in order to rate; the cutoff is given to you so you can
   recognise a stale reference and so you can apply point 5.
5. **`STALE_VALUE`**: the software's value matches only an **older** authoritative value — i.e. it
   does not agree with the in-window reference value, but you can see from `search_note` /
   `publication_date` / the cited URLs that it corresponds to a superseded authoritative figure. Label
   **INCORRECT-FILL** with sub-reason **`STALE_VALUE`**.
6. The temporal rule applies **only to STATED reference values**: `rules/analysis_decisions.json`
   **AD-6**, topic *"REFERENCE-STALE scope"*, `"value": "STATED_REFERENCE_VALUES_ONLY"`. A
   `NOT_AVAILABLE_FROM_SOURCE` record holds no value, so it is never stale — it simply means the
   reference does not hold an authoritative value, and the branch goes to UNSUPPORTED-FILL (if the
   software filled) or CORRECT-ABSTENTION (if it did not).

### 2.5 "Attributable to the EXPECTED entity"

The expected entity is the one named by the packet's company identity. If the software's value is a
real fact about a **different** entity — a parent, a subsidiary, a same-named company in another
jurisdiction, a different legal entity in the group — the label is **MISATTRIBUTED-FILL**, regardless
of how accurate the number is for that other entity. This label is counted in P1 **and** separately in
P3, where **any count above zero fails the run outright** (§10.3). Use it when it applies and never
when it does not.

---

## 3. The labels

Seven labels (`RATING_LABELS`), plus `pending`:

| Label | Use |
|---|---|
| `SUPPORTED-FILL` | value present, right entity, reference authoritative, value agrees (§10.2) |
| `UNSUPPORTED-FILL` | value present, right entity, reference holds **no** authoritative value — **or** revenue with no currency marker (sub-reason `CURRENCY_NOT_STATED`) |
| `INCORRECT-FILL` | value present, right entity, reference authoritative, value **disagrees** (§10.2) |
| `MISATTRIBUTED-FILL` | value present but attributable to some **other** entity |
| `CORRECT-ABSTENTION` | **no** value, and the reference holds no authoritative value |
| `MISSED-FILL` | **no** value, but the reference holds an authoritative value |
| `REFERENCE-AMBIGUOUS` | the **reference material is insufficient to decide** the item |
| `pending` | you could not complete this item (see §4) |

Spell them exactly as above, upper case, hyphenated. An unknown label is refused.

### 3.1 `REFERENCE-AMBIGUOUS` — what it is and is not

It means *the reference record does not let you reach a decision* — for instance the record is
internally inconsistent, the cited source plainly does not state what the record says, or the record
cannot be matched to the expected entity. It is **excluded from every denominator and published**
(§10.3).

It is **not** a way to avoid a difficult judgement about the **software's** output, and it is **not**
for "the software's value is hard to interpret". If the reference is clear and the software's value is
odd, the fill labels handle it.

### 3.2 Labels you never write

- **`INVALID`** — *"machine-assigned for observations that could not be scored (§15)"*. You are not
  told which items are INVALID and you rate them like any other; the machine excludes them.
- **`REFERENCE-STALE`** — machine-derived from the sealed `as_of_date` (§2.4).
- **`REFERENCE-CONFLICT`** — sealed at reference time, before you existed to the study.
- §10.3 is explicit: *"REFERENCE-CONFLICT (sealed), REFERENCE-AMBIGUOUS (rater) and REFERENCE-STALE
  are excluded from every denominator, counted and published. **Raters never convert them into a
  scored label.**"*

---

## 4. `pending` — the only way to leave an item undone

`PENDING = 'pending'` (`lib/packets.mjs:10`). §12: **"Missing ratings: `pending` — never imputed,
never scored."**

- **Every item of your packet needs a row.** `ingestRatings` refuses your sheet with
  *"no row — every packet item needs a label or "pending" (never silently missing)"* if any item is
  absent. A blank cell is not `pending`; write the word.
- Use `pending` when you genuinely cannot complete the item. Do **not** use it as a soft
  `REFERENCE-AMBIGUOUS`, and do not use it to signal doubt about a label you did reach.
- A `pending` item **is never adjudicated and never scored**. An item either rater marks `pending` is
  *not* a disagreement and never reaches the rating adjudicator (`lib/packets.mjs:81`).
- A `pending` row carries **no `rated_at`** — leave that cell empty. `checkRating` refuses
  *"a pending row has no rated_at"* otherwise, and requires a `YYYY-MM-DD` date on every
  non-`pending` row.
- `pending` is **not free**: §12 requires **≥ 90% of held-out observations completely rated**, and
  §15.5(3) makes the whole run INCONCLUSIVE below that. Nothing is imputed to cover the gap.

---

## 5. The two sub-reasons, and exactly where each applies

`SUB_REASONS` (`lib/ratings.mjs:21-24`) is a closed set of **two**. `sub_reason` is otherwise
**empty**.

| `sub_reason` | Applies **only** with label | Applies **only** to field(s) | Meaning |
|---|---|---|---|
| `CURRENCY_NOT_STATED` | `UNSUPPORTED-FILL` | `revenue_range` **only** | The software's revenue figure carries **no currency marker** (§10.2 currency rule) |
| `STALE_VALUE` | `INCORRECT-FILL` | `employee_count` **and** `revenue_range` | The software's value matches only an **older** authoritative value (§10.2 temporal rule) |

`checkRating` refuses anything else:

- an unrecognised string → *"sub_reason must be empty, CURRENCY_NOT_STATED or STALE_VALUE"*;
- a valid sub-reason on the wrong label or the wrong field → *"sub_reason `<X>` applies only to
  `<label>` on `<fields>` (§10.2)"*.

So: no `CURRENCY_NOT_STATED` on `employee_count`, and none on `INCORRECT-FILL`. No `STALE_VALUE` on
`founded_year`, and none on `SUPPORTED-FILL`, `UNSUPPORTED-FILL` or any abstention label. Every other
row has an **empty** `sub_reason`.

Both sub-reasons are reported in the published per-label breakdown (§10.4 S3), so they are real
findings, not annotations.

---

## 6. What you are blind to (§12)

> **Blinding** (single-arm): *"Raters are blind to each other's labels, to running tallies and
> aggregates, and to the development pilot. There is no arm label to blind."*

Concretely, you will not be told, and must not ask for or accept:

- **the other rater's labels**, on any item, at any time — or the other rater's identity;
- **any tally, aggregate, running count, rate or provisional endpoint value** — including how many
  items you have labelled each way;
- **anything about the development pilot** or the instrument check. §11: pilot outputs are held by the
  operator, *"never shown to the reference team, and never used for any purpose except sizing and
  harness debugging."* Nothing about them belongs in a rating;
- **the class prediction, stratum, split or identity-hazard note** for any company — i.e. whether the
  study expected a value to exist;
- which items are machine-**INVALID**, **REFERENCE-STALE** or sealed **REFERENCE-CONFLICT**;
- how many items are in the other rater's packet, or how many disagreements exist.

You also do not discuss any item with the other rater, the reference team, the adjudicators or the
operator beyond process questions. If forbidden material reaches you, **stop and tell the operator**:
a protocol violation discovered mid-run makes the run VOID (`rules/analysis_decisions.json` **AD-7**)
and halts it (§18).

**Your presentation order is not the other rater's.** Order is derived per label from the published
held-out sampling record (§12.1), so the two packets are differently ordered by construction — there
is no shared position you could compare notes on.

---

## 7. What you return

Exactly these six columns (`RATING_COLUMNS`, `lib/ratings.mjs:17`):

```
candidate_id,field,label,sub_reason,rated_by,rated_at
```

| Column | You write |
|---|---|
| `candidate_id` | exactly as the packet item gives it |
| `field` | exactly as the packet item gives it |
| `label` | one of the seven labels, or `pending` |
| `sub_reason` | empty, or `CURRENCY_NOT_STATED` / `STALE_VALUE` per §5 |
| `rated_by` | your **pseudonym** — it must equal the person the published assignment fingerprint names for your label, or the whole sheet is refused (`lib/ratings.mjs:57`) |
| `rated_at` | `YYYY-MM-DD`, **empty** on a `pending` row |

Rules the intake enforces (`ingestRatings`) — a sheet failing any of them is **refused whole and
nothing is written**:

- **exactly one row per packet item**: no missing item, no extra item, no duplicate, and no item that
  is not yours (*"not an item of the `<label>` packet (unknown or unauthorized item)"*);
- every `label` known; every `sub_reason` legal for its label and field;
- the §10.1 first-branch rule (§2.2 above);
- `rated_by` = the assigned person, for every row;
- `rated_at` present and well-formed except on `pending` rows.

The intake prints your item count and pending count and the sheet hash — *"no tallies are shown"*.
You will not receive a breakdown of your own labels back.

---

## 8. Standing prohibitions

- **No AI**, in any part of the work.
- **No contact with the other rater**, and no request for anyone's labels, counts or results.
- **No revision after submission.** Your sheet is hashed and bound to your packet, the sealed
  evaluation artifact and the seal.
- **No blank cells** where a label belongs — `pending` is the word.
- **No new labels, no new sub-reasons, no new values.** The vocabularies above are closed.
- **No legal name** anywhere in the returned file.
- **No impression-based rating.** Walk §10.1 in order on every item.

---

## Human dependency

| Item | Class |
|---|---|
| Packet construction, order derivation, cited-URL extraction, intake validation | **H0** — fully mechanical, deterministic and rebuildable |
| Applying §10.1 / §10.2 to each observation | **H2** — the protocol reserves the label to a human rater |
| That there are **≥ 2 independent human raters** | **H3** — §12: without them, every primary endpoint is **UNADJUDICATED**, the evidence rung cannot exceed **Rung 2**, and **no claim of independent validation may be made**. *"The protocol is not weakened to accommodate unavailability."* |
| Blinding to the other rater, tallies and the pilot | **H2** — procedural; the tooling enforces packet contents, not human conduct |
