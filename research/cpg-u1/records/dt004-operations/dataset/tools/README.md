# tools/ — the enumerator's intake pipeline

**Classification: ENGINEERING ARTIFACT.** These four tools are machinery. They create no part of the
registered frame, assert no fact about any company, and name no company. **Enumeration itself is H3: the
enumerator's independence is the evidence**, so the rows these tools read and write can only ever be written
by an independent, registered enumerator (§4A.2, §5.5 step 3).

> **NOTHING IN THIS DIRECTORY MAY BE RUN AGAINST A REAL COMPANY BEFORE OSF REGISTRATION.**
> Registration is the freeze (§5.5.1). Before it, these tools may be exercised **only** on synthetic rows —
> `SYNTHETIC-` names, `.example` domains, `enumerated_by = UNASSIGNED` — which is exactly what
> `test_tools.mjs` does. A real candidate touched before registration is not a mistake in a file; it is an
> unenumerable frame.

**Study:** CPG-U1-2026-01 · **Protocol:** `CPG_U1_PROTOCOL_004`
(`sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`)
**Verified instrument (read-only):** tooling aggregate
`<NEW_AGG>`

These tools contain **no copy of the instrument and no copy of its rules**. They locate the instrument
through one environment variable, recompute its aggregate on every single run, and refuse to do anything at
all unless it matches the value above. Every verdict — every column, every tri-state rule, every checksum,
every count and the §5.7.2 floor itself — comes from the instrument. Nothing is reimplemented here.

---

## 0. Before the first command

```bash
export CPG_U1_TOOLING=/path/to/research/cpg-u1/tooling     # the VERIFIED instrument tree
node --version                                             # Node 18+ (ESM, no dependencies)
node identifier_check.mjs --help
```

There is no install step, no package.json, no dependency and no network access. If
`CPG_U1_TOOLING` is unset, points somewhere else, or points at a tree whose aggregate differs by one byte,
every tool exits **3** with `INSTRUMENT_MISMATCH` and reads nothing further.

Nothing here can write into the instrument tree: an `--out` path inside it is refused.

## 1. Exit codes — identical in all four tools

| Exit | Meaning | What to do |
|--:|---|---|
| **0** | The tool ran and the input passed. | Continue. |
| **1** | Usage or I/O problem: missing/unknown option, unreadable file, output path already exists. | Fix the command line. |
| **2** | **The data was refused.** The tool worked; the frame or the identifier did not. | Fix the data. Every message names the line/row and the column. |
| **3** | The instrument is missing, unreadable, or **not the verified one**. | Restore the verified instrument. Never work around this. |

Outputs are **write-once**: an existing `--out` path is refused (exit 1), never overwritten.

## 2. The order to run them in

```
   identifier_check.mjs        per candidate, BEFORE any other work on it
            |
   <enumerator writes one JSON line per candidate into candidates.intake.jsonl>
            |
   intake_to_frame.mjs   -->   candidate_frame.csv        (refuses; never guesses)
            |
   row_diagnostics.mjs         per-row verdict + remedy   (fix, re-convert, repeat)
            |
   partition_tracker.mjs       progress toward the §5.7.2 floor
            |
   <hand the CSV to the operator: scan -> check-frame-sufficiency -> commitment>
```

`partition_tracker.mjs` is a **progress** report, not the freeze. The authoritative sufficiency check is the
operator's `check-frame-sufficiency` **after** the repository scan, because the scan (C1(1)) and the frozen
development-only registry (C1(6)) can only *remove* rows from the eligible count. See
`../CONTAMINATION_PROCEDURE.md`.

---

## 3. The intake format

One file. **One JSON object per line.** No YAML, no CSV quoting rules, no dependency, no schema file. Blank
lines and lines whose first non-space character is `#` are ignored, so the enumerator can keep notes and
section headers in the same file.

```
# batch 3, FR-SIRENE, drawn from a public register listing
{"candidate_id":"C-0301","company_name":"...","canonical_domain":"...", ... }
{"candidate_id":"C-0302", ... }
```

### Keys

The keys are **exactly the 23 frame columns**, spelled exactly as in
`templates/candidate_frame.template.csv`. A key that is not one of them is an **error**, not a key that gets
dropped — a typo must never become a silently missing answer.

**Every column is required** except these three:

| Column | When it may be omitted |
|---|---|
| `wikidata_qid` | Always. It is an optional secondary identifier and is never decisive. |
| `identity_hazard_note` | Whenever `expected_outcome_class` is not `identity-hazard`. |
| `identifier_value` | Exactly when `identifier_scheme` is `UNKNOWN` (and then it *must* be omitted or `""`). |

### Values

- Every value is a **JSON string**. A number is refused (`900123` would lose a leading zero and a check
  digit); a boolean is refused (`true`/`false` cannot express the third state); `null` is refused.
- A required key that is **missing, `""`, or whitespace-only** is an error naming the **line** and the
  **column**. It is never defaulted, never inferred and never filled in from a neighbouring column.
- **Not established is written, never left out.** `UNKNOWN` for `canonical_domain`, `jurisdiction_family`,
  `identifier_scheme`; `unknown` for `expected_outcome_class` and for all eight `a*_`/`c1_*` answers. A blank
  cell is always malformed (§5.1), precisely so an omission cannot pass for a deliberate "not established".
- Values are copied **byte-for-byte**. Nothing is trimmed, lower-cased or mapped, so `unknown` can never
  become `no` and `Yes` can never quietly become `yes` (it is refused instead).
- The tool **never infers**: it does not derive `jurisdiction_family` from `identifier_scheme`, does not
  derive `identifier_scheme` from the shape of a value, does not guess a class, and does not invent
  `enumerated_by`, `enumerated_at` or an evidence note.

### One complete record, with every key present

The example below is **synthetic** (`SYNTHETIC-` name, `.example` domain, `UNASSIGNED` enumerator) so that it
can be copied and run before registration without touching the study. A real record has a real name, a real
domain, and the pseudonymous ID of the registered enumerator.

```json
{"candidate_id":"SYN-0001","company_name":"SYNTHETIC-EXAMPLE-CO-1","canonical_domain":"synthetic-example-1.example","jurisdiction_family":"US-SEC","identifier_scheme":"CIK","identifier_value":"900001","wikidata_qid":"","identifier_domain_evidence_url":"https://registry.example/entity/1","identifier_domain_evidence_note":"SYNTHETIC registry record names this domain","expected_outcome_class":"fill-expected","identity_hazard_note":"","a1_operating_legal_entity":"yes","a2_domain_controlled_https":"yes","a4_tie_independent_of_cpg":"yes","a6_reference_obtainable":"yes","c1_2_used_in_cpg_work":"no","c1_3_values_derived_from_cpg":"no","c1_4_prior_cpg_execution":"no","c1_5_internal_or_owned":"no","enumerated_by":"UNASSIGNED","enumerated_at":"2026-09-24","enumeration_source_url":"https://registry.example/candidate-list"}
```

Column meanings, permitted values and the A1–A6 questions in plain language are in
`../ENUMERATOR_WORKSPACE.md` §1–§5. The hand checklist is `../ADMISSIBILITY_CHECKLIST.md`.

---

## 4. `identifier_check.mjs` — one identifier, before anything else

Run it on the decisive identifier **before** writing the evidence URL, the note, the class prediction or the
attestations. An identifier that fails here can never make the row admissible (A3), so every other minute
spent on that candidate is wasted.

```bash
node identifier_check.mjs --scheme LEI --value <identifier>
node identifier_check.mjs --scheme SIREN --value <identifier> --family FR-SIRENE
```

| Option | |
|---|---|
| `--scheme` | **Required.** `CIK` \| `SIREN` \| `CNPJ` \| `LEI` \| `QID`. Never guessed from the value: a 9-digit string can be a SIREN or a CIK, and only you know which. |
| `--value` | The identifier exactly as the register prints it. No spaces, no separators. |
| `--family` | Optional. `US-SEC` \| `FR-SIRENE` \| `BR-CNPJ` \| `LEI-ONLY`. When given, scheme↔family compatibility is checked too. |

It reports three things and nothing else: **scheme** accepted, **checksum** valid, **compatibility** with the
declared family. `LEI` is permitted in every family; `CIK` only in `US-SEC`; `SIREN` only in `FR-SIRENE`;
`CNPJ` only in `BR-CNPJ`.

**Exit 0** valid · **2** refused (bad scheme, failed checksum, or scheme not permitted for the family).

A valid checksum proves the identifier is **well-formed and nothing more**. It does not show that the
identifier names the entity you have in mind — that tie is **A4**, and only a human establishes it, from a
page they read themselves, recorded as an `https` URL plus a one-line note, and never from a CPG output.

## 5. `intake_to_frame.mjs` — intake → frame CSV

```bash
node intake_to_frame.mjs --intake candidates.intake.jsonl --out candidate_frame.csv
```

| Option | |
|---|---|
| `--intake` | The JSON-lines file described in §3. |
| `--out` | The frame CSV to write. **Write-once** — an existing path is refused. |
| `--allow-synthetic` | **Self-test only.** Permits `SYNTHETIC-` names and `.example` domains. Never pass it on real work. |

It converts, then runs the instrument's own `checkFrameRow`. If **any** row is malformed, **no file is
written at all** and every problem is listed with its line and column. Screening outcomes are *not* errors: a
row excluded by A1–A6, or held-out-ineligible by a contamination attestation, is written out and **stays in
the frame** — the frame records what was screened, not only what survived (§5.1, §5.3, §15.3).

On success it prints the row count, the number of values copied verbatim, `defaulted or inferred: 0`, the
screening tally, the count of rows held-out-ineligible by attestation, and the `frame_hash` (the same hash
the instrument's `frame` command reports, so you can confirm the operator scanned the file you sent).

**Exit 0** CSV written · **1** usage/IO · **2** refused, nothing written.

## 6. `row_diagnostics.mjs` — per-row verdict and remedy

```bash
node row_diagnostics.mjs --frame candidate_frame.csv
node row_diagnostics.mjs --frame candidate_frame.csv --problems-only
node row_diagnostics.mjs --frame candidate_frame.csv --only C-0301
```

Per row it prints:

- **`MALFORMED_ROW`** with each structural error, if the row is structurally broken. Admissibility is then
  *not* evaluated, and this single row stops every instrument command on the whole file.
- **A1–A6 tri-state outcomes** (`pass` / `FAIL` / `UNKNOWN`), with the *first* non-pass marked as the
  exclusion reason, and a `FIX` line per non-pass saying what must be established. **`UNKNOWN` is never a
  pass**; it means *not established*, and the remedy is evidence, not a changed answer.
- **The identifier check for the declared scheme**, with the schemes the declared jurisdiction family
  permits, and a standing reminder that a valid checksum is not the A4 tie.
- **Held-out eligibility as a SEPARATE verdict.** A contamination attestation answered `yes` — or `unknown`,
  which counts exactly as `yes` (§5.3) — makes the row **held-out-ineligible**. That is **not**
  inadmissibility. The row stays in the frame, stays admissible, and is drawn into **development first**
  (§5.8), or recorded as `DEVELOPMENT_SURPLUS`. An ineligible admissible row is *wanted*: it absorbs a
  development place and leaves the eligible pool intact. **There is nothing to fix** unless the attestation
  is `unknown`, in which case the only legitimate action is to establish the answer.

It sees **C1(2)–C1(5)** only. C1(1) (repository scan) and C1(6) (development-only registry) are operator
checks — see `../CONTAMINATION_PROCEDURE.md`. It writes no file.

**Exit 0** no malformed row · **1** usage/IO · **2** at least one `MALFORMED_ROW`.

## 7. `partition_tracker.mjs` — progress toward the §5.7.2 floor

```bash
node partition_tracker.mjs --frame candidate_frame.csv
```

Three blocks:

1. **The worst permitted pilot quota vector, derived here and now.** The tool evaluates the frozen sizing
   rule (`lib/sizing.mjs`) on **every** permitted pilot outcome through `lib/frame.mjs`, and prints the
   sizing constants, the number of outcomes, the HALT count, `Qmax` per class, the pool requirement
   `2 × Qmax`, the exact development draw, and `FRAME_MINIMUM = 2 × Qmax + Dev`. **`FRAME_MINIMUM` is read
   from `lib/frame.mjs`; it is not typed into this file** (the self-test asserts that). So the target you are
   enumerating toward is *justified* on every run rather than asserted once in a document.
2. **Per class:** eligible-admissible `have`, `required`, and the **remaining count needed**.
3. **Per jurisdiction family × class:** the same counts across `US-SEC`, `FR-SIRENE`, `BR-CNPJ`, `LEI-ONLY`
   and `UNKNOWN`, against an even-split reference target `⌈required/4⌉`. **No family quota is enforced** — the
   draw's round-robin lets an exhausted family simply stop contributing (decision D-A), and the realised
   composition is *published* as a scope limitation (§5.7.1). The even split is guidance for balance; it
   never replaces the per-class floor. Rationale and the recommended margin are in
   `../JURISDICTION_PARTITIONS.md`.

**THE TARGET IS NEVER LOWERED.** There is no option to change it. `--floor`, `--required`, `--target`,
`--quota`, `--relax` and similar are refused by *every* tool in this directory before anything is read. If
the frame is short, the only permitted action is more enumeration: §5.7.2 says *"enumeration continues
first"*, and a development commitment against an insufficient frame is `STAGE_VOID_FRAME_INSUFFICIENT` — the
slot is consumed and there is no retry.

Counts here are **attestation-only and therefore an upper bound**; the operator's scan can only subtract.

**Exit 0** every class meets the floor · **1** usage/IO · **2** short, or malformed rows make counting
meaningless.

## 8. `test_tools.mjs` — the self-test

```bash
node test_tools.mjs
```

Synthetic rows only: `SYNTHETIC-` names, `.example` domains, `enumerated_by = UNASSIGNED`, and identifiers
generated with the instrument's **own** check-digit helpers so they pass the instrument's **own** validators.
Fixtures are written to a throwaway temp directory outside the repository and deleted afterwards.
**Its output is PREPARATION. It is never U1 evidence and no part of it may enter the registered frame.**

**Exit 0** all checks pass · **1** at least one failed.

---

## 9. What these tools do and do not remove from the enumerator's work

**Removed — mechanical, and now free:**

- learning the schema by trial and error: the intake format is 23 named keys and the errors name the line and
  the column;
- discovering the tri-state and blank-cell rules the hard way, one refused file at a time;
- identifier checksum arithmetic and scheme↔family compatibility, per scheme;
- reading an exclusion reason code and working out which question caused it and what would satisfy it;
- confusing *inadmissible* with *held-out-ineligible* — the two verdicts are printed separately and labelled;
- counting progress per class and per family, and knowing what the target is and where it comes from;
- CSV hand-editing: the CSV is generated, so quoting and column order can never drift from the template.

**Irreducibly human, and untouched:**

- **finding candidates at all** — no tool proposes, ranks or discovers a company;
- **A1**: judging that the entity currently operates;
- **A2**: judging that the domain is the entity's own;
- **A4**: reading the identifier↔domain tie off a page and writing the URL and the note. A tool can check
  that a URL is `https` and that a note is non-blank; it cannot check that the page says what the note says;
- **A6**: judging whether reference truth is plausibly obtainable, without researching the values;
- **the class prediction** (§5.2), made before any reference research, and naming the collision for
  `identity-hazard`;
- **the C1(2)–C1(5) attestations**: these are statements about the enumerator's and the implementers'
  history. No tool can establish them, and `unknown` counts as `yes`;
- **independence itself** (§4A): the enumerator's eligibility is the evidence, and it is a human fact about a
  human. That is why enumeration is **H3** and why no agent, operator or implementer may fill a single row.

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

