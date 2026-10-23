# ENUMERATOR_SUBMISSION_PROCEDURE — the exact frame format, and what happens when a row fails

**Classification: PREPARATION.** Not evidence. This document creates no part of the registered
frame. **No enumerator has been recruited; no row has been enumerated.** Every example cell below is
a *format illustration*, never a candidate and never a company.

Unfilled-marker convention: `<<UNFILLED: ...>>` and `UNASSIGNED` are markers, never data.

- Protocol basis: §5.1 (tri-state admissibility, representation rules, accessible families), §5.2
  (classes), §5.3 (contamination), §5.4, §15.3 — `CPG_U1_PROTOCOL_004.md` sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified).
- **Every rule below is read out of the registered instrument's code, not inferred**, at aggregate
  `<NEW_AGG>` / <NEW_N> files (verified):
  `lib/schema.mjs` (`FRAME_COLUMNS:12`, `checkFrameRow:93`), `lib/identifiers.mjs`, `lib/csv.mjs`,
  `cpg_u1_data.mjs` (`loadCsv:73`, `loadFrame:93`, `cmdFrame:86`, `refuseMalformed:129`),
  `templates/candidate_frame.template.csv`.
- **Correction to a commonly repeated citation:** `checkFrameRow` is exported from
  **`lib/schema.mjs`**, not `lib/frame.mjs`. `lib/frame.mjs` holds the frame-*sufficiency* rule,
  which enumerators never run and never see.
- Where the protocol and the code disagree, the protocol wins and the code is defective.

---

## 1. The file

One CSV. Header exactly the **22** columns below, **in this order, no extras and none missing**. One
row per legal entity. The header is compared against the template and the load **fails on any
difference** (`cpg_u1_data.mjs:73–78`):

```
<path>: columns must match the template exactly (missing: <list>; extra: <list>)
```

Verified count: `FRAME_COLUMNS.length === 22`, and
`templates/candidate_frame.template.csv` is exactly that header and nothing else.

```
candidate_id,company_name,canonical_domain,jurisdiction_family,identifier_scheme,identifier_value,wikidata_qid,identifier_domain_evidence_url,identifier_domain_evidence_note,expected_outcome_class,identity_hazard_note,a1_operating_legal_entity,a2_domain_controlled_https,a4_tie_independent_of_cpg,a6_reference_obtainable,c1_2_used_in_cpg_work,c1_3_values_derived_from_cpg,c1_4_prior_cpg_execution,c1_5_internal_or_owned,enumerated_by,enumerated_at,enumeration_source_url
```

**CSV mechanics** (`lib/csv.mjs`, RFC 4180):

- Quoted fields may contain commas, newlines and `""`-escaped quotes. Quote any field containing
  `,` `"` CR or LF.
- LF and CRLF line endings are both accepted. A leading UTF-8 BOM is stripped.
- **Every row must have exactly 22 fields.** A row with a different count raises
  `CSV: row <n> has <k> fields, header has 22` and the whole file is rejected — not just that row.
  This is the usual consequence of an unquoted comma inside a company name or a note.
- An unterminated quoted field raises `CSV: unterminated quoted field`.
- Write the file as UTF-8.

**There is no `a3_` and no `a5_` column.** A3 and A5 are **computed**, never attested: A5 from
`jurisdiction_family`, A3 from `identifier_scheme` + `identifier_value` + the family's permitted
scheme list. An enumerator influences them only through columns 4, 5 and 6.

---

## 2. The two "not established" tokens — and the blank rule

§5.1, verbatim:

> **Representation rules.** A value that is not established is written as the explicit token
> `UNKNOWN` (domain, jurisdiction family, identifier scheme) or `unknown` (attestations, outcome
> class). **A blank cell is always malformed**, so an omission can never pass for a deliberate "not
> established". Domains are canonical: lowercase, no scheme, port, path, or `www.` prefix.

| Where | Token | Case |
|---|---|---|
| `canonical_domain`, `jurisdiction_family`, `identifier_scheme` | `UNKNOWN` | **upper case, exact** |
| every `a*_` and `c1_*` attestation, and `expected_outcome_class` | `unknown` | **lower case, exact** |

Enforced at `lib/schema.mjs:104–106`: a blank in `canonical_domain`, `jurisdiction_family`,
`identifier_scheme` or `expected_outcome_class` produces

```
<column> is blank — write "UNKNOWN" if it is not established
```

(or `write "unknown"` for `expected_outcome_class`), and the row is `MALFORMED_ROW`. An attestation
left blank fails the enum check instead, with `blank is not an answer` in the message
(`lib/schema.mjs:116`).

**The one cell that must be empty:** `identifier_value`, when `identifier_scheme` is `UNKNOWN`
(`lib/schema.mjs:112`). There, and only there, empty is the correct value.

`wikidata_qid`, `identity_hazard_note`, `identifier_domain_evidence_url` and
`identifier_domain_evidence_note` may be empty — but the last two being empty makes A4 **fail**
whenever `a4_tie_independent_of_cpg` is `yes` (§4 below), and `identity_hazard_note` being empty
makes an `identity-hazard` row malformed.

---

## 3. The 22 columns — meaning and exact validation

`UNK` = the literal `UNKNOWN`. Every "Refusal message" is the text the tool prints.

| # | Column | Meaning | Validation, as coded | Refusal message |
|--:|---|---|---|---|
| 1 | `candidate_id` | Stable local handle; the only key the tooling joins on. Use the prefix reserved to your slot. | `/^[A-Za-z0-9_-]{1,64}$/`; must be **unique across the whole merged frame** (`cpg_u1_data.mjs:99`) | `candidate_id must be 1-64 of [A-Za-z0-9_-]` · `duplicate candidate_id` |
| 2 | `company_name` | The entity's name as a public source states it. | non-empty after trimming **and** not padded (`r !== r.trim()` is an error); must not begin `SYNTHETIC-` | `company_name empty or padded` · `SYNTHETIC row in a real frame — synthetic rows exist only for the self-test` |
| 3 | `canonical_domain` | The entity's own web domain, canonical form — the subject of A2. | not blank; `UNK` allowed; otherwise **must equal its own lower case**, must **not** start `www.`, must contain none of `/ : ? #` or whitespace; must not end `.example` | `canonical_domain must be lowercase` · `canonical_domain must not start with "www." (canonical form)` · `canonical_domain must be a bare host (no scheme, port, path or whitespace)` |
| 4 | `jurisdiction_family` | Which accessible registry family the decisive identifier comes from (§5.1 A5). | not blank; one of `US-SEC`, `FR-SIRENE`, `BR-CNPJ`, `LEI-ONLY`, `UNKNOWN`. An unrecognised value is not a malformed-row error — it makes **A5 fail** | blank → `jurisdiction_family is blank — write "UNKNOWN" …` |
| 5 | `identifier_scheme` | Which scheme column 6 is written in. | not blank; `CIK` \| `SIREN` \| `CNPJ` \| `LEI` \| `UNKNOWN`. An unrecognised value makes **A3 fail** | blank → `identifier_scheme is blank — write "UNKNOWN" …` |
| 6 | `identifier_value` | The decisive identifier (A3). | **empty iff** column 5 is `UNKNOWN`; otherwise non-empty, no surrounding whitespace, and checksum-valid per §5 | `identifier_value must be empty when identifier_scheme is UNKNOWN` · `identifier_value is blank — set identifier_scheme to UNKNOWN if no identifier is established` |
| 7 | `wikidata_qid` | Optional secondary identifier. Never decisive on its own. | empty, or `/^Q[1-9][0-9]*$/` with no surrounding whitespace | `QID "<v>" fails format/checksum validation` · `QID is empty or has surrounding whitespace` |
| 8 | `identifier_domain_evidence_url` | Where you read the identifier↔domain tie (A4). | may be empty, **but** A4 cannot pass unless this parses as a URL with `protocol === 'https:'` and a non-empty hostname | none — its absence shows up as **A4 fail**, not as a malformed row |
| 9 | `identifier_domain_evidence_note` | One line stating what that page says tying the identifier to the domain. | may be empty, **but** A4 cannot pass unless it is non-blank after trimming | none — absence shows up as **A4 fail** |
| 10 | `expected_outcome_class` | **Your prediction, made before any reference research** (§5.2). | not blank; `fill-expected` \| `abstention-expected` \| `identity-hazard` \| `unknown` | `expected_outcome_class must be one of fill-expected\|abstention-expected\|identity-hazard\|unknown` |
| 11 | `identity_hazard_note` | Names the colliding entity or confusable domain. | non-blank **iff** column 10 is `identity-hazard`; otherwise may be empty | `identity_hazard_note is required for identity-hazard (name the colliding entity)` |
| 12 | `a1_operating_legal_entity` | A1: a real, currently operating legal entity? | exactly `yes` \| `no` \| `unknown` | `a1_operating_legal_entity must be exactly "yes", "no" or "unknown" (blank is not an answer)` |
| 13 | `a2_domain_controlled_https` | A2: is that domain controlled by the entity and reachable over HTTPS? | exactly `yes` \| `no` \| `unknown` | as above, with the column name |
| 14 | `a4_tie_independent_of_cpg` | A4: was the identifier↔domain tie established **without** CPG? | exactly `yes` \| `no` \| `unknown` | as above |
| 15 | `a6_reference_obtainable` | A6: is reference truth obtainable for **all three** fields? | exactly `yes` \| `no` \| `unknown` | as above |
| 16 | `c1_2_used_in_cpg_work` | C1(2): used in developing the CPG resolver, protocol, tooling or reference-truth procedures? | exactly `yes` \| `no` \| `unknown` | as above |
| 17 | `c1_3_values_derived_from_cpg` | C1(3): any expected value here derived from a CPG output? | exactly `yes` \| `no` \| `unknown` | as above |
| 18 | `c1_4_prior_cpg_execution` | C1(4): any prior CPG execution — smoke, live, pilot or production? | exactly `yes` \| `no` \| `unknown` | as above |
| 19 | `c1_5_internal_or_owned` | C1(5): the implementers' own company or tenant, or an entity they control? | exactly `yes` \| `no` \| `unknown` | as above |
| 20 | `enumerated_by` | **Your pseudonymous `person_id` from the restricted register** — see §6. | non-blank after trimming | `enumerated_by is required` |
| 21 | `enumerated_at` | The date **you enumerated that row**. | `/^\d{4}-\d{2}-\d{2}$/` **and** a real calendar date: it must survive `new Date("<v>T00:00:00Z")` and round-trip to the same string | `enumerated_at must be YYYY-MM-DD` |
| 22 | `enumeration_source_url` | The public listing or search the candidate came from — see §6. | must parse as a URL with `protocol === 'https:'` and a non-empty hostname | `enumeration_source_url must be an https URL` |

**On column 21, honestly:** `isCalendarDate` checks format and calendar validity only. It does **not**
check that the date is in the past, inside the enumeration window, or consistent with any other row.
`2026-02-30` is caught; a wrong-but-real date is not. The date is yours to get right.

---

## 4. The tri-state rules, and what each answer costs

§5.1, verbatim:

> Each criterion is answered **yes / no / unknown**. **UNKNOWN means "not established / insufficient
> evidence". It never means false, and it never satisfies a criterion** [enforced: `checkFrameRow`;
> exhaustive 81-combination test].

Coded as `const tri = (v) => (v === 'yes' ? 'pass' : v === 'no' ? 'fail' : 'unknown');`
(`lib/schema.mjs:131`). `unknown` is its own outcome and is **never** a pass.

| Criterion | How it is decided | `no` → | `unknown` → |
|---|---|---|---|
| A1 | `tri(a1_operating_legal_entity)` | `A1_NOT_OPERATING_ENTITY` | `A1_NOT_ESTABLISHED` |
| A2 | If `canonical_domain` is `UNKNOWN`: **fail** if `a2` is `no`, otherwise **unknown**. Else if the domain does not match the hostname pattern: **fail**. Else `tri(a2)`. | `A2_NO_CONTROLLED_DOMAIN` | `A2_NOT_ESTABLISHED` |
| A3 | `UNKNOWN` scheme → **unknown**. Else **pass** iff the identifier passes its checksum **and** the scheme is permitted for the family. | `A3_INVALID_IDENTIFIER` | `A3_NOT_ESTABLISHED` |
| A4 | `tri(a4)`, then **downgraded to fail** if `a4` is `yes` but the evidence URL is not https or the note is blank. | `A4_NO_INDEPENDENT_TIE` | `A4_NOT_ESTABLISHED` |
| A5 | `UNKNOWN` family → **unknown**. A recognised family → **pass**. Anything else → **fail**. | `A5_INACCESSIBLE_JURISDICTION` | `A5_NOT_ESTABLISHED` |
| A6 | `tri(a6_reference_obtainable)` | `A6_REFERENCE_NOT_OBTAINABLE` | `A6_NOT_ESTABLISHED` |
| — | class | — | `OUTCOME_CLASS_NOT_ESTABLISHED` |

The **first** non-pass in the order A1, A2, A3, A4, A5, A6 becomes the row's exclusion reason
(`lib/schema.mjs:154–157`); if all six pass and the class is `unknown`, the reason is
`OUTCOME_CLASS_NOT_ESTABLISHED`.

**The hostname pattern for A2** (`lib/schema.mjs:76`) is
`/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/`. It requires at least one dot,
an **alphabetic** top-level label of 2–63 characters, labels that neither start nor end with `-`,
and a total length of 4–253. A domain that fails it makes **A2 fail outright**, whatever you answered
in column 13 — so a malformed domain is not a recoverable "unknown", it is a failure.

**A4 is the trap.** Answering `yes` without both an https evidence URL **and** a non-blank note
turns your `yes` into a **fail** — strictly worse than `unknown`. Either supply both, or answer
honestly.

**Being excluded is not being wrong.** A row excluded as `A6_NOT_ESTABLISHED` is a correctly
enumerated row that reports honestly that reference truth could not be established. §15.3's screening
log records every candidate and its reason. Do **not** upgrade an `unknown` to a `yes` to get a row
admitted; that is the one failure mode this whole apparatus exists to prevent.

---

## 5. Identifier checksums (A3), exactly as coded

From `lib/identifiers.mjs`. Validation proves an identifier is **well-formed**, never that it names
the intended entity — that tie is A4, established by you against a registry.

| Scheme | Rule |
|---|---|
| `LEI` | 18 alphanumerics `[A-Z0-9]` then 2 digits; ISO 7064 MOD 97-10 over the whole 20 characters must equal 1. Letters convert as `A→10 … Z→35`. Upper case only. |
| `CIK` | 1–10 digits, numeric value `> 0`. No checksum. Leading zeros are not significant. |
| `SIREN` | exactly 9 digits, Luhn-valid. One documented exception is allowlisted: `356000000`. |
| `CNPJ` | 14 characters: 12 of `[0-9A-Z]` then 2 digits. All-same-digit strings are rejected. Two mod-11 check digits, each character valued as `ASCII − 48` (so digits keep face value). Upper case only. |
| `QID` | `^Q[1-9][0-9]*$` — `Q` then a digit string with no leading zero. |

Any value with leading or trailing whitespace is rejected outright:
`<scheme> is empty or has surrounding whitespace`.

**Permitted scheme per family** (§5.1; `JURISDICTION_FAMILIES`, `lib/schema.mjs:43`):

| `jurisdiction_family` | permitted `identifier_scheme` |
|---|---|
| `US-SEC` | `CIK` or `LEI` |
| `FR-SIRENE` | `SIREN` or `LEI` |
| `BR-CNPJ` | `CNPJ` or `LEI` |
| `LEI-ONLY` | `LEI` only |

A checksum-valid identifier in a scheme **not** permitted for the family makes A3 **fail**. §5.1:
*"A company from an inaccessible jurisdiction is admissible only as `LEI-ONLY`."*

---

## 6. `enumerated_by`, `enumerated_at`, `enumeration_source_url`

### `enumerated_by`
Your **pseudonymous `person_id`** from the restricted personnel register — the same string, exactly,
as in your register assignment (it matches `[A-Za-z0-9_-]{1,64}` there). **Never your legal name**,
never an email address, never initials you invented for the occasion. Legal identity lives only in
the restricted register; study artefacts carry the pseudonym.

With two enumerators, `enumerated_by` is what makes every row in the merged frame attributable to
one of them, and it is the only thing that does. Write **your own** value in **every** row you
submit; never write the other slot's value, and never leave it to the operator to fill in.

In every template and rehearsal artefact this field is `UNASSIGNED`. Only the registered,
independent enumerator ever writes a real value there.

Your value: `UNASSIGNED` `<<UNFILLED: the operator assigns your person_id before release>>`

### `enumerated_at`
The date **you enumerated that row**, `YYYY-MM-DD`, a real calendar date. Not the date you submit the
file, not the date the source page was published, not one date copied across every row — the date you
did the work on that row. Rows enumerated on different days carry different dates.

### `enumeration_source_url`
The **https** URL of the public listing, registry search or index **the candidate came from** — where
you *found* the entity. It answers "how did this company enter the frame?", which is a different
question from column 8, `identifier_domain_evidence_url`, which answers "where is the identifier↔domain
tie evidenced?". They are frequently different pages, and it is normal for them to be.

Both must be `https:`. `http:`, `ftp:`, a bare hostname, a `file:` path, a search phrase, "Google" or
a note like "see attached" all fail. The tooling parses the string with `new URL(...)` and checks
`protocol === 'https:'` with a non-empty hostname — nothing more, so a well-formed URL that does not
resolve, or that points somewhere irrelevant, passes validation and is your responsibility. See
`ENUMERATOR_EVIDENCE_HANDLING.md`.

---

## 7. Before you submit — self-check

| # | Check |
|--:|---|
| 1 | Header is byte-identical to `templates/candidate_frame.template.csv`; 22 columns, right order, no extras. |
| 2 | Every row has 22 fields; every field containing `,` `"` or a newline is quoted. |
| 3 | **No cell is blank**, except `identifier_value` where `identifier_scheme` is `UNKNOWN`, and the optional columns 7, 9, 11 where the rules above allow it. |
| 4 | Every `UNKNOWN` is upper case; every `unknown` is lower case. |
| 5 | Every domain is lowercase, no scheme, no port, no path, no `www.`. |
| 6 | Every `candidate_id` uses your reserved prefix and is unique within your file. |
| 7 | Every identifier is checksum-valid and permitted for its family. |
| 8 | Every `a4_tie_independent_of_cpg = yes` row has an https evidence URL **and** a non-blank note. |
| 9 | Every `identity-hazard` row names the colliding entity in `identity_hazard_note`. |
| 10 | Every class prediction was made **before** any reference research on that company (§5.2). |
| 11 | Every contamination attestation follows `ENUMERATOR_CONTAMINATION_RULES.md` — no `no` written out of ignorance. |
| 12 | `enumerated_by` is your pseudonym in **every** row; `enumerated_at` is the real per-row date; `enumeration_source_url` is https in every row. |
| 13 | You have seen no CPG output, no pilot result, no sizing output and no quota. Re-confirm this in writing with the submission (§4A.2(b) reaches "before completing the frame"). |
| 14 | No AI system, agent or language model produced, drafted, suggested or checked any part of the file. |

---

## 8. Submission

| Field | Value |
|---|---|
| Filename | `<<UNFILLED: operator-specified>>` |
| Channel | `<<UNFILLED: operator-specified; must not be a channel the developing organisation can read>>` |
| Submitted by (`person_id`) | `UNASSIGNED` |
| Submission date | `<<UNFILLED: YYYY-MM-DD, on or before R+N>>` |
| Row count | `<<UNFILLED>>` |
| Re-confirmation of §4A.2(b) at submission | `<<UNFILLED: yes>>` |
| Statement that no AI produced any part of the file | `<<UNFILLED: yes>>` |

---

## 9. What happens on a validation failure

The operator merges the two files and runs:

```bash
node cpg_u1_data.mjs frame --frame <merged>.csv
```

`cmdFrame` (`cpg_u1_data.mjs:86–101`) prints, **per bad row**:

```
  MALFORMED <candidate_id>: <error>; <error>; …
```

then a tally of exclusion reasons and admissible rows, the count of rows held-out-ineligible by
attestation, and `frame_hash: <64 hex>`. **If any row is malformed, it exits `1`.**

What follows, exactly:

1. **The operator returns every `MALFORMED` line to the enumerator who wrote that row, verbatim.**
   The operator does not correct the row. A row corrected by the operator is a row the operator
   authored, and the frame would no longer be the independent enumerator's work.
2. The enumerator fixes the row and resubmits. Repeat until `frame` reports zero malformed rows.
3. **Malformed rows block everything downstream.** Every draw command calls `refuseMalformed`, which
   stops with `<n> malformed frame row(s) — run "frame" and fix before drawing`
   (`cpg_u1_data.mjs:129`).
4. A `MALFORMED_ROW` is **not** an exclusion decision. `MALFORMED_ROW` and `NOT_DRAWN` and
   `DEVELOPMENT_SURPLUS` are all in the closed `EXCLUSION_REASONS` list (`lib/schema.mjs:62`; the
   code's comment cites candidate-002 §15.4, and protocol-004 has no §15.4 heading — its §15 runs
   15.1, 15.2, 15.3, 15.5, so cite the code, not a §15.4), but a malformed row
   is a *format* defect: it must be fixed, not accepted as an outcome.
5. A row that loads cleanly and is then **excluded** (`A1_NOT_OPERATING_ENTITY`,
   `A6_NOT_ESTABLISHED`, `OUTCOME_CLASS_NOT_ESTABLISHED`, …) is **not** an error and is **not**
   returned for correction. It is a correct, honest screening outcome, and §15.3's screening log
   records it with its reason. Nobody asks you to change it.
6. **Timing.** Fixing must finish before the frame is committed. §5.7.2 requires one complete frame
   before the development commitment; after the development draw, `draw-held-out` refuses with
   `FRAME_CHANGED: held-out frame_hash differs from the development frame_hash — the single frame is
   frozen before the development commitment (no additions after sizing)`
   (`cpg_u1_data.mjs:458`). **After that point no row can be added, removed or edited by anyone,
   for any reason.**
7. **Outputs are write-once.** Draw and scan outputs refuse to overwrite
   (`<path> already exists — outputs are write-once (no re-roll). Use a new output path.`). There is
   no re-roll, so a frame is fixed *before* it is drawn from, never after.

If a systematic misunderstanding shows up — the same error across many rows — the operator restates
the relevant rule from §5.1–§5.4 or from this document, **identically to both enumerators**, records
the question and the answer, and does not supply a candidate, a judgement or an example drawn from
the other slot's work.

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

