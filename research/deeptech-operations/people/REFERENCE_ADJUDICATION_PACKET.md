# CPG-U1 — Reference adjudication packet (reference adjudicator)

**Classification: HUMAN-REQUIRED INPUT.** This is the instruction sheet and the blank return format
for the reference adjudicator, plus the operator commands that build, verify and resolve the packet.
It contains **no company, no record, no value and no identity**.

- Protocol: `CPG_U1_PROTOCOL_004.md` §9.1, §9.2, §9.2.1, §9.3, §9.4, §9.5, §12.1
  (sha256 `c50fc680…df00b719`).
- Instrument: tooling v6, aggregate `f7699f05…5eb04e5cc5dd`
  (`lib/packets.mjs` — `buildReferenceAdjudicationPacket`, `checkReferenceAdjudicationPacket`,
  `resolveReferenceDecisions`; `lib/raterOrder.mjs` — `authorIsRecord1`, `presentationOrder`).

> **This work must be done by a human.** No AI system, language model or agent may make, draft or
> suggest any decision here. The value of this role is that a third independent person, who cannot
> see who wrote what, chose between two records.

---

## PART A — For the adjudicator

## A1. Your task

Two people looked up the same fact independently and disagreed. You will see, for each disagreeing
company × field, the **two candidate records side by side and unlabelled**, and you choose one — or
declare that neither can be established.

You will **not** be told who wrote either record. You will not be told anything about the items where
the two agreed. You will not be told how many items you are looking at relative to anything else.

## A2. Exactly what the packet contains (§9.2.1)

> **Contents, for each disagreeing company × field only:**
> - company name, canonical domain, jurisdiction family and decisive identifier;
> - the field definition, §9.3 formats and §9.4 authority table;
> - the two blind records presented **unlabelled** as "Record 1" and "Record 2", each carrying only
>   its value, source and search content (no recorder identity or timestamps).

Mechanically, each packet item carries **exactly** these nine keys (`REFERENCE_ITEM_KEYS`) and
nothing else:

```
candidate_id · field · company_name · canonical_domain · jurisdiction_family ·
identifier_scheme · identifier_value · record_1 · record_2
```

and `record_1` / `record_2` each carry **exactly** these eight keys (`RECORD_KEYS` — the blind-record
columns minus `candidate_id`, `field`, `constructed_without_cpg`, `recorded_by`, `recorded_at`):

```
value_kind · expected_value · authoritative_source_name · source_class ·
source_url · publication_date · as_of_date · search_note
```

Note what is structurally absent: **`recorded_by` and `recorded_at` are not in the record.** The
identity and the timestamp are removed by construction, not by request. Any extra key anywhere in the
packet is refused by `checkReferenceAdjudicationPacket` with
`keys must be exactly … (forbidden information present or field missing)`.

You also receive, unchanged: the three field definitions, the §9.3 STATED value formats, and the
§9.4 authority table — the same material both record-writers had. Reproduce them from
`REFERENCE_TEAM_PACKET.md` §4.1, §4.2 and §5; they are the standard you judge against.

## A3. What the packet must **never** contain (§9.2.1, verbatim)

> **The reference adjudicator never receives:**
> - any CPG output (including pilot and instrument check);
> - class predictions, identity-hazard notes, stratum or split;
> - screening logs, attestations or contamination bases;
> - agreeing records;
> - the identities or pseudonyms of Author and Confirmer;
> - any count or tally of adjudication outcomes.

If any of these reaches you, **stop and tell the operator**: it is a protocol violation, and a
violation discovered mid-run makes the run VOID (`rules/analysis_decisions.json`, **AD-7**
`"value": "VOID"`) and halts it (§18).

## A4. Record 1 / Record 2 are unlabelled, and deliberately scrambled per item

> **Record 1 / Record 2 assignment.** Record 1 is the Author's record iff the first hexadecimal digit
> of `order_key("reference-adjudicator-record-1", candidate_id, field)` is even. Items are presented
> in `order_key("reference-adjudicator", …)` order (§12.1).

Two consequences you must internalise:

1. **"Record 1" is not a person.** Whether Record 1 is the Author's or the Confirmer's is decided
   **independently for every single item** by a hash of the published held-out sampling record. On
   one item Record 1 may be the Author's; on the next it may be the Confirmer's. There is no pattern
   to find, no "Record 1 tends to be better", and preferring Record 1 systematically is meaningless
   rather than biased-in-a-known-direction.
2. **You cannot influence it and neither can the operator.** The assignment derives from
   `ho_record_sha256`, which comes from a Bitcoin commitment plus a drand round that nobody chose,
   and which cannot be known before the held-out draw exists (§12.1). Positions and item order use
   **separate** labels, so order tells you nothing about position.

## A5. The three permitted decisions — and the value you may not supply

`RECORD_1` · `RECORD_2` · `REFERENCE-CONFLICT`

| Decision | Use it when |
|---|---|
| `RECORD_1` | Record 1 is the one that correctly states the fact under §9.3 and §9.4 |
| `RECORD_2` | Record 2 is |
| `REFERENCE-CONFLICT` | Neither record can be established as correct — for example both cite authoritative sources that genuinely differ, both misread their source, or the two describe different entities and neither is clearly the expected one |

> **§9.5: "The adjudicator chooses between the two records or declares a conflict, and cannot supply a
> third value."**

So, explicitly: **no third value may be supplied.** If you know, or believe, or can find, that the
true figure is a third number, you may not enter it. Your options are these two records or a
conflict. A `REFERENCE-CONFLICT` row is **excluded from every denominator and published** (§9.5,
§10.3) — it is a clean, honest outcome, not a failure, and choosing it is always available to you.

Also fixed by §9.5: an **`AGREED`** row — where the two records matched — **"an adjudication may not
override it."** Agreed items never reach you, and you have no power over them.

How to decide, in order:

1. Does each record's `source_class` sit in a Tier for that field under §9.4? A record resting on a
   non-authoritative class (`PRESS`, `ENCYCLOPAEDIA`, `AGGREGATOR`, `JOB_BOARD`) cannot be correct.
2. Does each record's `expected_value` meet the §9.3 format for the field?
3. Does the cited `source_url` / `authoritative_source_name` actually support the stated value, for
   the **expected entity** named by `company_name`, `canonical_domain` and the decisive identifier?
4. Is either value a forbidden kind — a target, projection, run-rate, order book or estimate — dressed
   as a stated fact? If so it cannot be correct.
5. Where both records survive 1–4 and still differ: prefer **Tier 1 over Tier 2**; then prefer the
   record whose `as_of_date` is the **most recent** authoritative value. If they remain
   irreconcilable, `REFERENCE-CONFLICT`.
6. A `NOT_AVAILABLE_FROM_SOURCE` record against a `STATED` record is a normal disagreement: decide
   whether the STATED record genuinely rests on an authoritative source for that field. If it does,
   choose it; if it does not, choose the `NOT_AVAILABLE_FROM_SOURCE` record.

## A6. What you return

Exactly these six columns (`ADJUDICATION_COLUMNS`, `templates/adjudication.template.csv`):

```
candidate_id,field,decision,rationale,adjudicated_by,adjudicated_at
```

| Column | You write |
|---|---|
| `candidate_id` | exactly as the packet item gives it |
| `field` | exactly as the packet item gives it |
| `decision` | `RECORD_1` \| `RECORD_2` \| `REFERENCE-CONFLICT` — nothing else |
| `rationale` | why, in your own words, referring to the §9.4 tier and the §9.3 format; **required** |
| `adjudicated_by` | your **pseudonym** |
| `adjudicated_at` | `YYYY-MM-DD` |

One row per packet item. **Every packet item needs exactly one row**: the operator's tooling refuses
a decision set that does not *"cover exactly the packet items (missing, extra or duplicated
decision)"*. Do not add rows for items you were not given — a decision on an item outside the packet
is refused as *"record for undrawn company"* / an unknown item.

Never write `AUTHOR` or `CONFIRMER` in `decision`. You do not know which is which; the mapping happens
mechanically **after** your decision (§9.2.1: *"They are mapped mechanically to AUTHOR / CONFIRMER
after the decision"*), by recomputing the Record 1/2 assignment from the held-out record — there is
no mapping file for anyone to trust or tamper with (`lib/packets.mjs:60`).

## A7. Timing

> **§9.2.1 Timing:** adjudication occurs **after both blind record sets are submitted** and **before
> `seal`.**

You therefore work in a window that closes before the study's inputs are frozen and before the
software is ever run. Your decisions are **inside** the seal: the seal binds the reference
adjudication packet and your blind decisions, so neither can be changed afterwards without producing
a different, published-mismatching seal hash.

---

## PART B — Operator commands

Shared argument group used below:

```sh
DRAWN="--dev-manifest dev/manifest.json --held-out-manifest ho/manifest.json --author a.csv --confirmer c.csv"
```

Note that the reference adjudication happens **BEFORE the seal**, so its inputs are the **drawn
manifests, never a seal** (`cpg_u1_data.mjs`, `drawnHeldOut`). The Record 1/2 assignment and the item
order still derive from the held-out sampling record, which exists from the held-out draw onwards.

### B1. Build the packet

```sh
node cpg_u1_data.mjs reference-adjudication-packet $DRAWN --out ref_packet.json
```

- Prints: `reference adjudication packet: <n> disagreeing item(s); no class, split, CPG output or recorder identity`
- Exit `0` on success, `1` refused (nothing written). Output is **write-once**.
- Built deterministically: **agreeing records are never released** (`lib/packets.mjs:31`); a record
  for an undrawn company is refused; a missing confirmer record is refused.

### B2. Verify the packet before it goes to the adjudicator

```sh
node cpg_u1_data.mjs verify-adjudication-packet --type reference $DRAWN --packet ref_packet.json
# after sealing, additionally bind-check it:
node cpg_u1_data.mjs verify-adjudication-packet --type reference $DRAWN --packet ref_packet.json --seal SEAL.json
```

- Exit `0`: `reference adjudication packet verified against the deterministic build`.
- Exit `1`: `FORBIDDEN_OR_ALTERED_PACKET: …` — an added key, an extra or **agreeing** item, a
  reordering, a reassigned Record 1/2, a recorder identity present, or (with `--seal`)
  `the seal binds a different reference adjudication packet`.
- §9.2.1 Enforcement: the packet is *"built deterministically … and verified by rebuilding … any
  added information, extra or agreeing item, reordering or reassignment is refused. What the
  adjudicator learns outside the packet is controlled procedurally (§4A)."* Verification is a
  **rebuild-and-compare**, not an inspection.

### B3. Resolve the blind decisions

```sh
node cpg_u1_data.mjs resolve-reference-adjudication \
  --dev-manifest dev/manifest.json \
  --held-out-manifest ho/manifest.json \
  --decisions blind.csv \
  --out j.csv
```

- `blind.csv` is the adjudicator's returned file (`ADJUDICATION_COLUMNS`), holding only
  `RECORD_1` / `RECORD_2` / `REFERENCE-CONFLICT`.
- Prints: `resolved <n> blind decision(s) to AUTHOR / CONFIRMER / REFERENCE-CONFLICT`.
- Exit `1` on `blind decision must be RECORD_1|RECORD_2|REFERENCE-CONFLICT`.
- The mapping is **recomputed** from the held-out record per item (`authorIsRecord1`); `j.csv` is the
  mechanical resolution and is never hand-written.

### B4. Reconcile and seal — the seal binds the packet and the blind decisions

```sh
node cpg_u1_data.mjs reconcile $DRAWN --adjudication j.csv --out reference.csv

node cpg_u1_data.mjs seal --dev-dir dev --held-out-dir ho --sizing sizing.json \
  --author a.csv --confirmer c.csv \
  --adjudication j.csv --reference-packet ref_packet.json --blind-decisions blind.csv \
  --reference reference.csv --out SEAL.json
```

`seal` re-derives the whole chain (`blindReferenceAdjudication`) and refuses with
`BLIND_ADJUDICATION_REFUSED` if:

- the supplied `ref_packet.json` is not the deterministic packet;
- the blind decisions do not cover **exactly** the packet items (missing, extra or duplicated);
- `j.csv` is not the **mechanical resolution** of those blind decisions.

It then records the packet's and the decisions' file hashes in the seal — so the seal **binds the
packet and the blind decisions**, and the resolution cannot be substituted afterwards. §9.5 also
holds: *"The reconciled reference file is produced **only** by `reconcile`: `seal` refuses any
reference file that is not byte-identical to the reconciliation of the blind records."* And a dataset
is never sealed with reference-truth errors.

Reconciliation outcomes (§9.5): `AGREED` · `ADJUDICATED_AUTHOR` · `ADJUDICATED_CONFIRMER` ·
`REFERENCE_CONFLICT`.

### B5. What the operator must not do

- Not see reference values: §9.6 — **the operator receives the seal hash only**; the reference file
  stays with the reference team until execution and archiving are complete.
- Not adjudicate, not write a record, not re-run the adjudication with a different person, not
  "help" the adjudicator with any of the §9.2.1 forbidden material.
- Not use an AI as the adjudicator.

---

## Human dependency

| Item | Class |
|---|---|
| Building, verifying and resolving the packet; the Record 1/2 assignment; the seal binding | **H0** — fully mechanical and rebuildable |
| The adjudicator's decision on each disagreeing item | **H2** — the protocol reserves this judgement to a human and permits no third value |
| That the adjudicator is a third person, independent of Author, Confirmer, enumerators and operator | **H3** — this independence is the evidence; §4A.3 forbids an enumerator from holding the role precisely so the class predictions cannot leak into it |
| Controlling what the adjudicator learns **outside** the packet | **H2** — §9.2.1: *"controlled procedurally (§4A)"*; the tooling checks the artifact only |
