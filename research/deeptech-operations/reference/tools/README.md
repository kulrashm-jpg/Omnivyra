# CPG-U1 — reference-truth operating environment

**Classification: ENGINEERING ARTIFACT** (this README, and the five tools it documents). The
worksheets a tool produces are **HUMAN-REQUIRED INPUT**; a precheck, coverage or preview run is
**EXECUTION EVIDENCE**; the sealing rehearsal is **PREPARATION**. Nothing here is a REGISTERED
ARTIFACT and nothing here is an ANALYTICAL RESULT.

These tools exist so that, the moment the held-out draw exists, the **Author** and the **Confirmer**
can work independently and concurrently with no further engineering. They add **no rule of their
own**: every rule they apply is imported from the verified instrument.

- Protocol: `CPG_U1_PROTOCOL_004.md` §9.1–§9.8, §10.2, §15.2 (sha256 `c50fc680…df00b719`).
- Instrument: tooling v6, aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`.
- Human-facing instructions (unchanged, authoritative): `REFERENCE_TEAM_PACKET.md` and
  `REFERENCE_ADJUDICATION_PACKET.md`. **These tools do not replace either packet**; they make it
  operable.

> **Reference construction itself remains H3.** Two independent humans, each constructing a record
> for every company × field without CPG output and without seeing each other's work, are the
> anti-circularity evidence of the whole study. No tool here constructs, drafts, suggests, repairs or
> checks a *value*. They prepare the work, validate the *form* of what a human wrote, count coverage
> and rehearse the chain. An AI substitute for either person would destroy exactly the property being
> claimed, and the adjudicator's choice (H2) is likewise reserved to a human.

---

## 0. The instrument gate — required for every tool

Every tool loads the instrument **read-only**, from the path in `CPG_U1_INSTRUMENT`, and **refuses to
run unless that tree's aggregate is `f7699f05…5eb04e5cc5dd`**.

```sh
export CPG_U1_INSTRUMENT=/path/to/research/cpg-u1/tooling     # POSIX
$env:CPG_U1_INSTRUMENT = 'C:\path\to\research\cpg-u1\tooling' # PowerShell
```

- Not set, or not a tooling tree → `ERROR: CPG_U1_INSTRUMENT …`, exit **2**.
- Wrong tree → `ERROR: INSTRUMENT_NOT_VERIFIED: the tree at … has aggregate … which is not the
  verified instrument …`, exit **2**.
- No tool ever writes inside the instrument tree, and no tool runs an instrument command that writes
  into it. `test_tools.mjs` re-computes the aggregate after the whole suite and asserts it is
  unchanged.

**Exit codes, all five tools**

| Code | Meaning |
|---|---|
| `0` | clean — nothing to fix, or the artefact was written |
| `1` | refused — findings present, malformed input, a usage error, or an output that already exists |
| `2` | `INSTRUMENT_NOT_VERIFIED` — `CPG_U1_INSTRUMENT` missing or not the verified instrument |
| `3` | blinding refusal — an operator-only tool invoked without its explicit acknowledgement (`disagreement_preview.mjs` without `--both-submitted`) |

No network. No dependency. Node ESM only.

---

## 1. The ordering rule — memorise this

```
draw exists
  → worksheets generated separately for Author and Confirmer         (operator)
  → each constructs every company x field, alone, no contact         (H3, two humans)
  → each self-checks:  blind_record_precheck.mjs, coverage_report.mjs (each researcher, own file only)
  → BOTH submissions final and submitted                             <-- the gate
  → disagreement_preview.mjs                                         (operator only, to size the work)
  → reference-adjudication-packet + verify-adjudication-packet       (operator, instrument)
  → the adjudicator decides RECORD_1 / RECORD_2 / REFERENCE-CONFLICT (H2, a third human)
  → resolve-reference-adjudication                                   (operator, instrument)
  → reconcile                                                        (operator, instrument)
  → seal                                                             (operator, instrument)
  → seal hash published, timestamped, BEFORE any held-out execution
```

**Adjudication happens after both submissions and before the seal** (§9.2.1 Timing). Nothing in this
directory can be used to shorten that: `reconcile` refuses while a disagreement is unadjudicated, the
packet is rebuilt and compared rather than inspected, and `seal` binds the packet **and** the blind
decisions and refuses an adjudication that is not their mechanical resolution.

---

## 2. `worksheet_generate.mjs` — the work list (operator, before the work starts)

```sh
node worksheet_generate.mjs --manifest <drawn manifest.json> [--manifest <more>] \
     --role author|confirmer --out <worksheet.json> [--csv <blank_return.csv>]
```

One run produces **one role's** worksheet, with one item per company × field. Each item carries only
what §9.2 permits: `candidate_id`, company name, canonical domain, jurisdiction family, the decisive
identifier (scheme + value), the field, its §9.3 format rule, its §9.4 authority tiers — and empty
answer fields.

Withheld **by construction** (allowlist, then a leak self-scan that refuses the run and writes
nothing if it trips): stratum, split, class prediction, identity-hazard note, contamination basis,
secondary identifier, any CPG output, and the other role's work.

- The worksheet body carries **no role name**: the Author's and the Confirmer's worksheets are
  **byte-identical**, so neither artefact can reveal anything about the other. The role is named on
  the command line, printed for the operator's log, and expressed only in the filename you choose.
  Generate them in two separate runs and hand them out separately.
- Items are sorted by `candidate_id` then by field, so the manifest's own (draw-ordered) row order
  cannot carry information into the worksheet.
- Outputs are **write-once**; a second run to the same path is refused (exit 1).
- `--csv` additionally writes the blank return sheet: the thirteen `BLIND_RECORD_COLUMNS`, with
  `candidate_id` and `field` pre-filled and every other cell empty. Nothing about a value is
  pre-filled, ever.

Run it **twice**, once per role. Give each person the worksheet, the blank CSV and
`REFERENCE_TEAM_PACKET.md`. Give them nothing else.

## 3. `blind_record_precheck.mjs` — the researcher's self-check (each researcher, own file only)

```sh
node blind_record_precheck.mjs --records <filled.csv> [--json]
```

Validates a filled blind-record CSV **before** submission, using the instrument's own
`checkBlindRecord` / `checkValueFields`, and prints a per-row, plain-language fix list. This is what
lets a researcher self-correct instead of the whole set failing at `reconcile`.

What it checks (all the instrument's rules): value-kind rules; the STATED format per field; the
closed `source_class` list; the §9.4 authority tier per source class per field; the `employee_count`
Tier-2 stated-`publication_date` requirement; the forbidden value kinds (`TARGET`, `PROJECTION`,
`RUN_RATE`, `ORDER_BOOK`, `ESTIMATE`); an **https** `source_url`; calendar `publication_date` /
`as_of_date` / `recorded_at`; `constructed_without_cpg` = `yes`; a non-empty `recorded_by`. Plus
duplicate company × field rows and a non-template column set, both of which `reconcile` refuses.

- Exit `0`: `READY TO SUBMIT`. Exit `1`: `NOT READY TO SUBMIT` with the fix list.
- It **takes no manifest**, so a researcher's own check cannot put a stratum or a split anywhere near
  them.
- It never writes, never repairs and never suggests a value. It tells a human what to fix.

## 4. `coverage_report.mjs` — is my set complete? (each researcher, own file only)

```sh
node coverage_report.mjs --records <one_role.csv> --manifest <drawn manifest.json> [--manifest <more>] [--json]
```

Reports, for **one** submission: expected records, present, **missing**, **duplicated**, and any
record naming a company that was never drawn. Keys and counts only — no value, no source, no
`search_note`.

- Exit `0` `COMPLETE`; exit `1` `INCOMPLETE`.
- Passing `--author`, `--confirmer`, `--other` or `--both-submitted` is **refused**: it reads exactly
  one submission per run, so the other role's file is not merely hidden from the output, it is never
  opened (§9.1).

## 5. `disagreement_preview.mjs` — sizing the adjudication (OPERATOR ONLY)

```sh
node disagreement_preview.mjs --author <a.csv> --confirmer <c.csv> \
     --manifest <drawn manifest.json> [--manifest <more>] --both-submitted [--json]
```

Reports how many company × field pairs disagree under the instrument's own `agreementKey`, and their
keys — **nothing else about them**. It prints a prominent blinding warning and **refuses without
`--both-submitted`** (exit `3`, nothing read).

- Never for either reference researcher: running it before both sets are final, or showing it to
  either of them, is a blinding violation of §9.1, and a violation discovered mid-run makes the run
  **VOID** (AD-7).
- Never for the adjudicator: §9.2.1 forbids the adjudicator "any count or tally of adjudication
  outcomes". This output is exactly such a count. It belongs in the operator's log only.
- No reference value can be printed by it (§9.6: the operator receives the seal hash only).

## 6. `sealing_rehearsal.mjs` — rehearse the chain on synthetic data (operator, any time)

```sh
node sealing_rehearsal.mjs [--dir <empty dir>]
```

Runs the whole reference chain with the instrument's **real commands** in a temporary directory, on
**synthetic data only** — `SYNTHETIC-` names, `.example` domains, `UNASSIGNED-TEST-` pseudonyms — with
a planted disagreement, and asserts the outcome:

```
reconcile (no adjudication)                  → refused: a disagreement must be adjudicated
reference-adjudication-packet                → 2 disagreeing items; agreeing records never released
verify-adjudication-packet --type reference  → rebuild-and-compare
[blind human decision]                       → RECORD_1 / RECORD_2 / REFERENCE-CONFLICT
resolve-reference-adjudication               → mechanical AUTHOR / CONFIRMER mapping
reconcile --adjudication                     → the reference file (AGREED + adjudicated + conflict)
seal                                         → binds the packet and the blind decisions
verify-adjudication-packet … --seal           → the seal binds THIS packet
seal with a substituted resolution           → BLIND_ADJUDICATION_REFUSED
```

Exit `0` if every assertion holds. **This rehearsal is PREPARATION and must never be mixed with real
reference data**: no artefact from it may enter a real run, and no real manifest, record, packet,
decision or seal may ever be given to it.

## 7. Operator commands that are the instrument's, not these tools'

Building, verifying and resolving the packet, reconciling and sealing are done with the **instrument
itself**, exactly as `REFERENCE_ADJUDICATION_PACKET.md` Part B sets out. These tools never wrap them.
The rehearsal shows the order; the packet document is the authority.

```sh
DRAWN="--dev-manifest dev/manifest.json --held-out-manifest ho/manifest.json --author a.csv --confirmer c.csv"

node cpg_u1_data.mjs reference-adjudication-packet $DRAWN --out ref_packet.json
node cpg_u1_data.mjs verify-adjudication-packet --type reference $DRAWN --packet ref_packet.json
node cpg_u1_data.mjs resolve-reference-adjudication --dev-manifest dev/manifest.json \
     --held-out-manifest ho/manifest.json --decisions blind.csv --out j.csv
node cpg_u1_data.mjs reconcile $DRAWN --adjudication j.csv --out reference.csv
node cpg_u1_data.mjs seal --dev-dir dev --held-out-dir ho --sizing sizing.json \
     --author a.csv --confirmer c.csv --adjudication j.csv \
     --reference-packet ref_packet.json --blind-decisions blind.csv \
     --reference reference.csv --out SEAL.json
node cpg_u1_data.mjs verify-adjudication-packet --type reference $DRAWN --packet ref_packet.json --seal SEAL.json
```

Instrument outputs are **write-once**, and `seal` hands the operator **the seal hash only**: the
reference file stays with the reference team until execution and archiving are complete (§9.6).

## 8. Tests

```sh
CPG_U1_INSTRUMENT=<verified instrument tree> node test_tools.mjs
```

Synthetic only, negative cases included: a STATED record with a bad value format, a Tier-2
`employee_count` without a publication date, a forbidden value kind, an `http` source, a
non-authoritative source class, a non-calendar date, `constructed_without_cpg` = `no`, a missing
record, a duplicated record, an undrawn company, a worksheet leak attempt (and a control proving the
leak scanner catches an injected leak), an unverified instrument tree, and the blinding refusal. It
also runs `sealing_rehearsal.mjs` for real and asserts the instrument tree is unchanged afterwards.

## 9. Standing prohibitions these tools do not relax

- **No AI anywhere in a reference value, a search note or an adjudication decision.**
  `constructed_without_cpg` = `yes` means what it says.
- **No contact between Author and Confirmer about the study before both have submitted**, and no tool
  here reads both files until the operator asserts `--both-submitted`.
- **No CPG output, no class prediction, no stratum, no split and no contamination basis** to any of
  the three people, at any time.
- **No third value** from the adjudicator; a conflict is a clean, published outcome.
- **No hand-written reference file**: it comes only from `reconcile`, and `seal` refuses anything else.
- **No revision after submission**, and no editing of reference truth after a seal — a changed value
  yields a different seal hash, which will not match the published one.
- **Pseudonyms only** in any returned file.
