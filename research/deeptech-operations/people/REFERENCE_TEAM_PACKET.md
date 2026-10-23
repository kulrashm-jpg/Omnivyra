# CPG-U1 — Reference team packet (Author and Confirmer)

**Classification: HUMAN-REQUIRED INPUT.** This is the complete instruction sheet plus the blank
return format. It contains **no company, no value and no identity**. The blank CSV has a header row
and nothing else.

- Protocol: `CPG_U1_PROTOCOL_004.md` §9.1, §9.2, §9.3, §9.4, §9.5, §9.6
  (sha256 `c50fc680…df00b719`).
- Instrument: tooling v6, aggregate `f7699f05…5eb04e5cc5dd`
  (`lib/schema.mjs` — `BLIND_RECORD_COLUMNS`, `VALUE_FORMAT`, `AUTHORITY`, `FORBIDDEN_KINDS`,
  `checkBlindRecord`, `agreementKey`).
- One copy goes to the **Author**, one to the **Confirmer**. The two copies are identical. Neither
  person is told the other's pseudonym.

> **This work must be done by a human.** No AI system, language model or agent may produce, draft,
> suggest or check any record you return. The study is measuring an independently constructed
> reference value; a value an AI produced is not one. `constructed_without_cpg` must be `yes` and it
> means what it says.

---

## 1. Your task

You and one other person, working **separately and without contact**, each construct **one record for
every company × field on your list**. Three fields per company:

| Field | What it means |
|---|---|
| `founded_year` | The year the legal entity was founded |
| `employee_count` | The company's headcount |
| `revenue_range` | The company's revenue |

There is no partial submission: **every** company × field gets a record. Where no authoritative
source states the value, the record says so explicitly — that is a complete, correct record, not a
gap.

## 2. What you receive, and only that (§9.2)

> The Author and Confirmer each receive only: company name, canonical domain, jurisdiction family,
> decisive identifier, the three field definitions, the value-format rules (§9.3), and the authority
> table (§9.4). **They never receive CPG output, each other's records, or the class prediction.**

Your work list, therefore, carries per company exactly:

| Item | Value |
|---|---|
| `candidate_id` | `UNASSIGNED` |
| company name | `UNASSIGNED` |
| canonical domain | `UNASSIGNED` |
| jurisdiction family | `UNASSIGNED` |
| decisive identifier (scheme + value) | `UNASSIGNED` |

Nothing else. If anything else reaches you — a software output, a prediction of what the answer
"should" be, the other person's record, a count of anything — **stop and tell the operator.** That is
a protocol violation, and a discovered mid-run protocol violation makes the run VOID
(`rules/analysis_decisions.json`, **AD-7** `"value": "VOID"`).

## 3. The rule that binds the two of you (§9.1)

> Author: *"communicate with the Confirmer before both have submitted"* — **must not.**
> Confirmer: *"Same as Author; see the Author's record before submitting"* — **must not.**

So, exactly:

- **You do not communicate with the other reference person about anything in this study until both of
  you have submitted complete record sets.** Not the companies, not a method, not a hard case, not
  "did you find anything for X".
- You do not see, request or receive the other's records before submitting.
- You do not revise your records after seeing the other's. There is no reconciliation step for you;
  disagreements go to a third person you never meet.
- Both of you must be **complete and submitted** before adjudication begins and before the seal
  (§9.2.1 Timing).

Your duplicate work **is** the measurement. If the two of you coordinate, there is only one
measurement and the study has nothing to reconcile.

## 4. The §9.3 record format

Each blind record holds: `value_kind` (`STATED` | `NOT_AVAILABLE_FROM_SOURCE`), `expected_value`,
`authoritative_source_name`, `source_class`, `source_url`, `publication_date` (or `NOT_STATED`),
`as_of_date`, `search_note`, `constructed_without_cpg` (must be `yes`), `recorded_by`, `recorded_at`.

### 4.1 STATED value formats [NORMATIVE; enforced]

| Field | Format | Example |
|---|---|---|
| `founded_year` | four-digit year | `1999` |
| `employee_count` | positive integer | `3682` |
| `revenue_range` | ISO 4217 code, space, positive integer in whole units | `USD 1300000000` |

The tooling enforces these exactly (`lib/schema.mjs` `VALUE_FORMAT`):

| Field | Accepted |
|---|---|
| `founded_year` | `^[12][0-9]{3}$` — *"a four-digit year, e.g. 1999"* |
| `employee_count` | `^[1-9][0-9]*$` — *"a positive integer without separators, e.g. 3682"* |
| `revenue_range` | `^[A-Z]{3} [1-9][0-9]*$` — *"an ISO 4217 code, one space, and a positive integer in whole units, e.g. USD 1300000000"* |

Consequences you must respect:

- **No separators.** `3,682` and `3 682` are refused; write `3682`.
- **No approximations or ranges.** `~3700`, `3600-3700`, `about 3682` are refused. If the source
  states only a range or an approximation, there is no STATED value — use
  `NOT_AVAILABLE_FROM_SOURCE` and describe the range in `search_note`.
- **Revenue is in whole units, never compacted.** `USD 1.3B`, `USD 1300M`, `$1300000000`, `usd
  1300000000` are all refused. Write `USD 1300000000`. Convert the source's own presentation into
  whole units yourself; do **not** convert between currencies — record the currency the source
  states.
- **`founded_year` takes no month or day.**

### 4.2 The forbidden value kinds [enforced]

> Targets, projections, run-rates, order books and estimates are **never** an expected value.
> Where only such a figure exists, the record is `NOT_AVAILABLE_FROM_SOURCE`, with the figure
> described in `search_note`.

`lib/schema.mjs` `FORBIDDEN_KINDS` = `TARGET`, `PROJECTION`, `RUN_RATE`, `ORDER_BOOK`, `ESTIMATE`.
Writing one of these as a `value_kind` is refused with the instruction to record
`NOT_AVAILABLE_FROM_SOURCE` and put the figure in `search_note`.

In practice: a guided figure, a forecast, an "annualised" or "ARR" run-rate, a signed-order backlog,
an analyst's or aggregator's estimate, a "we expect to reach" number — **none** of these is an
expected value, even when it is the only figure that exists and even when it looks precise. Record
`NOT_AVAILABLE_FROM_SOURCE` and describe what you found.

### 4.3 Field-by-field rules the tooling enforces

| Condition | Requirement |
|---|---|
| `value_kind = STATED` | `expected_value` non-empty and matching the field's format; `source_class` from the closed list; `source_class` must be **authoritative for that field**; `authoritative_source_name` non-empty; `source_url` an **https** URL |
| `value_kind = STATED`, `field = employee_count`, Tier 2 source (`ENTITY_OWN_PAGE`) | `publication_date` must **not** be `NOT_STATED` — *"employee_count from the entity's own page requires a stated publication_date"* |
| `value_kind = NOT_AVAILABLE_FROM_SOURCE` | `expected_value` must be **empty**; `search_note` **required** — what you searched |
| every record | `publication_date` is `YYYY-MM-DD` or the literal `NOT_STATED`; `as_of_date` is `YYYY-MM-DD`; `constructed_without_cpg` = `yes`; `recorded_by` non-empty (your pseudonym); `recorded_at` is `YYYY-MM-DD` |

`as_of_date` is **the date the value describes** (the headcount date, the fiscal-period end, the
registry record date) — not the date you looked it up. It matters: a temporal rule downstream
excludes values whose `as_of_date` is more than 24 months before the run date, and that rule is
applied to `employee_count` and `revenue_range` using **calendar months**
(`rules/analysis_decisions.json`, **AD-5** `"value": "CALENDAR_MONTHS"`). Record the most recent
authoritative value you can find, and get `as_of_date` right.

`publication_date` is **the date the source document was published**.

## 5. The §9.4 authority table, verbatim [NORMATIVE; enforced]

| Field | Tier 1 | Tier 2 | Not authoritative |
|---|---|---|---|
| `founded_year` | `REGISTRY_RECORD` | `ENTITY_OWN_PAGE` | everything else |
| `employee_count` | `REGULATORY_FILING` | `ENTITY_OWN_PAGE` **with a stated publication date** | everything else |
| `revenue_range` | `AUDITED_FINANCIAL_FILING`, `REGULATORY_FILING` | `ENTITY_OWN_FINANCIAL_STATEMENT` | everything else |

**The full closed list of `source_class` values** (`lib/schema.mjs` `SOURCE_CLASSES`):

```
REGISTRY_RECORD · REGULATORY_FILING · AUDITED_FINANCIAL_FILING · ENTITY_OWN_PAGE ·
ENTITY_OWN_FINANCIAL_STATEMENT · PRESS · ENCYCLOPAEDIA · AGGREGATOR · JOB_BOARD
```

`PRESS`, `ENCYCLOPAEDIA`, `AGGREGATOR` and `JOB_BOARD` are **never authoritative for any field**.
So: a newspaper profile, an encyclopaedia entry, a company-data aggregator, a jobs-site company page
— none of them can support a STATED value, for any of the three fields, however reliable they look.
If that is all that exists, the record is `NOT_AVAILABLE_FROM_SOURCE`, with what you found in
`search_note`.

Also note what is **not** in any Tier: `ENTITY_OWN_PAGE` cannot support `revenue_range` (only an
`ENTITY_OWN_FINANCIAL_STATEMENT` can, at Tier 2), and `AUDITED_FINANCIAL_FILING` is listed only for
`revenue_range`. The tooling computes `authorityOf(field, source_class)` and refuses anything that
returns `NOT_AUTHORITATIVE`.

**Prefer Tier 1.** Where both tiers have a value, record the Tier 1 value.

## 6. `search_note` — what to write

`search_note` is required whenever you record `NOT_AVAILABLE_FROM_SOURCE`, and is useful on every
record. It is read later by a third person deciding between two disagreeing records, who sees your
search content but **not** who you are. Write:

- which authoritative sources you checked, by name, and what each did or did not state;
- any figure you found that you **rejected**, and why — especially a forbidden kind ("2027 revenue
  target of …", "ARR run-rate of …", "aggregator estimate of …");
- any ambiguity about which entity the figure describes (parent vs subsidiary, group vs operating
  company);
- the date basis of the figure, if the source is imprecise.

Do **not** write: your name, employer or contact details; the other person; any opinion about the
study; any software output.

## 7. What you return — the blank blind-record CSV

Exactly these thirteen columns, in this order (`BLIND_RECORD_COLUMNS`,
`templates/blind_record.template.csv`):

```
candidate_id,field,value_kind,expected_value,authoritative_source_name,source_class,source_url,publication_date,as_of_date,search_note,constructed_without_cpg,recorded_by,recorded_at
```

| # | Column | You write |
|---|---|---|
| 1 | `candidate_id` | exactly as given on your work list |
| 2 | `field` | `founded_year` \| `employee_count` \| `revenue_range` |
| 3 | `value_kind` | `STATED` \| `NOT_AVAILABLE_FROM_SOURCE` |
| 4 | `expected_value` | the §9.3-formatted value, or **empty** for `NOT_AVAILABLE_FROM_SOURCE` |
| 5 | `authoritative_source_name` | the source document / register, by name |
| 6 | `source_class` | one of the nine `SOURCE_CLASSES`, authoritative for this field |
| 7 | `source_url` | an **https** URL |
| 8 | `publication_date` | `YYYY-MM-DD` or `NOT_STATED` |
| 9 | `as_of_date` | `YYYY-MM-DD` — the date the **value** describes |
| 10 | `search_note` | see §6 |
| 11 | `constructed_without_cpg` | `yes` (the only accepted value) |
| 12 | `recorded_by` | your **pseudonym**, never your legal name |
| 13 | `recorded_at` | `YYYY-MM-DD`, the date you recorded it |

One row per company × field. No extra columns, no reordered columns, no blank rows, no summary row,
no totals. A malformed sheet is refused whole and nothing is written.

## 8. What happens to your records (so you know what your record cannot do)

1. Both record sets are submitted, complete. Neither of you has seen the other's.
2. The two sets are compared on a normalised key — `value_kind` plus the value with whitespace
   collapsed and case folded (`agreementKey`). **Same kind and same value → `AGREED`**, and §9.5 is
   explicit: *"an adjudication may not override it."* Nobody can change an agreed value later.
3. **Different → must be adjudicated** by a third independent person who sees the two records
   **unlabelled** and chooses one, or declares `REFERENCE-CONFLICT`. That person **cannot supply a
   third value** (§9.5). So if you both record something wrong in different ways, the outcome is one
   of your two records or a published conflict — never a corrected third value.
4. A `REFERENCE_CONFLICT` row is **excluded from every denominator and published** (§9.5, §10.3).
5. The reconciled reference file is produced **only** by `reconcile`; `seal` refuses any reference
   file that is not byte-identical to the reconciliation of the blind records (§9.5).
6. The seal is published, timestamped, **before** the software is ever run against these companies
   (§9.6). **The operator receives the seal hash only**; your reference file stays with the reference
   team until execution and archiving are complete. Any later change to reference truth yields a
   different seal hash, which will not match the published one — *"so the results are invalid on
   their face."*
7. Your records are **never** judged against the software's output, and never corrected to match it.
   Where reference truth contradicts a company's class prediction, **the mismatch is recorded in the
   seal and published**; it is not an error and it is never corrected by editing (§9.7).

That is why your record does not need to be "right" in hindsight; it needs to be **honestly and
independently constructed from an authoritative source, in the stated format**.

---

## 9. Standing prohibitions

- **No CPG output, ever** — including the development pilot, whose outputs §11 says are *"never shown
  to the reference team"*, and the instrument check.
- **No contact with the other reference person about this study before both have submitted.**
- **No class prediction.** You are never told whether a value is expected to exist.
- **No AI.** No part of any record may be produced, drafted, suggested or checked by an AI system.
- **No guessing.** `NOT_AVAILABLE_FROM_SOURCE` is always available and is never penalised.
- **No forbidden kinds as values** — targets, projections, run-rates, order books, estimates.
- **No legal names** in a returned file; your pseudonym only.
- **No revisions after submission.** Once submitted, the set is fixed.

**Human dependency: H3** — two independent human constructions, built without CPG, are the
anti-circularity evidence of the entire study. Nothing automatable substitutes for either of them,
and an AI substitute would destroy exactly the property being claimed.
