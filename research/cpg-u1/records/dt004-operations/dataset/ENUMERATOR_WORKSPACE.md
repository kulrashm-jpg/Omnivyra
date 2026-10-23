# ENUMERATOR_WORKSPACE — what an independent enumerator needs

**Classification: PREPARATION.** This document prepares machinery and instructions. It creates no part of
the registered frame. **Enumeration itself is H3: the enumerator's independence is the evidence**, so no
agent, operator or implementer may fill any row of the registered frame. This file may be handed to an
enumerator only after OSF registration (§5.5.1, §5.5 step 3).

**Study:** CPG-U1-2026-01 · **Protocol:** `CPG_U1_PROTOCOL_004`
(`sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`)
**Instrument (read-only reference):** `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`<NEW_AGG>` (verified by recomputation, see VALIDATION).
**Frozen resolver SHA:** `f01a7eb4199be4e04d4fee7fc0116303949dc553`.

Everything below is derived from `lib/schema.mjs` (`FRAME_COLUMNS`, `checkFrameRow`), `lib/identifiers.mjs`
and `templates/candidate_frame.template.csv`. Where protocol prose and code could diverge, the code is the
contract and the protocol section is cited.

---

## 0. What the enumerator receives, and never receives

**Receives** (§4A.2): public sources; the frame template (`templates/candidate_frame.template.csv`); §4A and
§5.1–§5.4 of the protocol; the jurisdiction-family list; the development-only registry
(`rules/development_only_registry.json`).

**Never receives:** pilot results, sizing output, quotas, held-out counts, or any CPG output — including the
development pilot and the instrument check (§4A.2(b), §5.5, §5.7.2). An enumerator who has seen any CPG
output before completing the frame is not eligible and the frame is not independent (§20.18).

**Eligibility** (§4A.2): did not implement CPG, this protocol, the tooling or the registry; has not run CPG or
seen CPG output; is not the operator/key custodian; holds no other §4A.3 role; satisfies §4A.1
(no employment, contract, payment, equity or family/reporting relationship with the developing organisation;
a fixed, non-contingent study fee is the only permitted payment). **An unknown answer is not "no."**

`enumerated_by` carries a **pseudonymous ID from the restricted personnel register**. It is `UNASSIGNED` or
empty in every template and rehearsal artefact in this directory, and only the registered, independent
enumerator ever writes a real value there.

---

## 1. The frame CSV — exact columns, meaning, permitted values

One CSV, header exactly the 23 columns below, **in this order, no extras and none missing** — the loader
compares the header against the template and refuses on any difference. One row per legal entity.

| # | Column | Meaning (one line) | Permitted values |
|--:|---|---|---|
| 1 | `candidate_id` | Stable local handle for the row; the only key the tooling joins on. | 1–64 chars of `A–Z a–z 0–9 _ -`. Unique across the file. |
| 2 | `company_name` | The entity's name as the enumerator found it in a public source. | Non-empty, no leading/trailing spaces. Must **not** begin `SYNTHETIC-` in a real frame. |
| 3 | `canonical_domain` | The entity's own web domain in canonical form — the A2 subject. | Lowercase registrable host: no scheme, no port, no path, no whitespace, **no `www.` prefix**; or the literal `UNKNOWN`. Must not end `.example` in a real frame. Unique across admissible rows. |
| 4 | `jurisdiction_family` | Which accessible registry family the decisive identifier comes from (§5.1, A5). | `US-SEC` \| `FR-SIRENE` \| `BR-CNPJ` \| `LEI-ONLY` \| `UNKNOWN` |
| 5 | `identifier_scheme` | Which identifier scheme `identifier_value` is written in. | `CIK` \| `SIREN` \| `CNPJ` \| `LEI` \| `UNKNOWN` |
| 6 | `identifier_value` | The decisive identifier itself (A3). | Empty **iff** `identifier_scheme` is `UNKNOWN`; otherwise non-empty, no surrounding whitespace, and checksum-valid per §2 below. `scheme:value` must be unique across admissible rows. |
| 7 | `wikidata_qid` | Optional secondary identifier; never decisive on its own. | Empty, or `Q` followed by digits with no leading zero (`^Q[1-9][0-9]*$`). |
| 8 | `identifier_domain_evidence_url` | Where the identifier↔domain tie was read (A4). | An `https://` URL. Required for A4 to pass. |
| 9 | `identifier_domain_evidence_note` | One line saying what that page states tying identifier to domain. | Non-blank text. Required for A4 to pass. |
| 10 | `expected_outcome_class` | The enumerator's **prediction**, made before any reference research (§5.2). | `fill-expected` \| `abstention-expected` \| `identity-hazard` \| `unknown` |
| 11 | `identity_hazard_note` | Names the colliding entity or confusable domain. | Non-blank **iff** class is `identity-hazard`; otherwise may be empty. |
| 12 | `a1_operating_legal_entity` | A1: real, currently operating legal entity? | `yes` \| `no` \| `unknown` |
| 13 | `a2_domain_controlled_https` | A2: is that domain controlled by the entity and reachable over HTTPS? | `yes` \| `no` \| `unknown` |
| 14 | `a4_tie_independent_of_cpg` | A4: was the identifier↔domain tie established **without** CPG? | `yes` \| `no` \| `unknown` |
| 15 | `a6_reference_obtainable` | A6: is reference truth obtainable for all three fields? | `yes` \| `no` \| `unknown` |
| 16 | `c1_2_used_in_cpg_work` | C1(2): used in developing the CPG resolver, protocol, tooling or reference-truth procedures? | `yes` \| `no` \| `unknown` |
| 17 | `c1_3_values_derived_from_cpg` | C1(3): any expected value here derived from a CPG output? | `yes` \| `no` \| `unknown` |
| 18 | `c1_4_prior_cpg_execution` | C1(4): any prior CPG execution — smoke, live, pilot or production? | `yes` \| `no` \| `unknown` |
| 19 | `c1_5_internal_or_owned` | C1(5): the implementers' own company or tenant, or an entity they control? | `yes` \| `no` \| `unknown` |
| 20 | `enumerated_by` | Pseudonymous ID of the independent enumerator. | Non-blank. **`UNASSIGNED` in every template and rehearsal file.** |
| 21 | `enumerated_at` | Date the row was enumerated. | `YYYY-MM-DD`, a real calendar date (round-trips through ISO parsing). |
| 22 | `enumeration_source_url` | The public listing or search the candidate came from. | An `https://` URL. |

There is **no `a3_` and no `a5_` column.** A3 and A5 are *computed*, not attested: A5 from
`jurisdiction_family`, A3 from `identifier_scheme` + `identifier_value` + the family's permitted scheme list.
The enumerator controls them only by what it writes in columns 4–6.

### The two "not established" tokens

| Where | Token | Meaning |
|---|---|---|
| `canonical_domain`, `jurisdiction_family`, `identifier_scheme` | `UNKNOWN` (upper case, exact) | Not established. |
| every `a*`/`c1_*` attestation, and `expected_outcome_class` | `unknown` (lower case, exact) | Not established. |

**A blank cell is always malformed.** The tooling refuses a blank in `canonical_domain`,
`jurisdiction_family`, `identifier_scheme` and `expected_outcome_class` with an explicit instruction to write
the `UNKNOWN`/`unknown` token instead, and refuses any attestation that is not exactly `yes`, `no` or
`unknown` — so an omission can never pass for a deliberate "not established" (§5.1).

**`unknown` is never a pass.** For admissibility (A1, A2, A4, A6) `unknown` is its own third outcome and
yields a `*_NOT_ESTABLISHED` exclusion, never a pass. For the four contamination attestations, **`unknown` is
treated exactly like `yes`** and makes the company held-out-ineligible (§5.3). There is no value an
enumerator can write that converts absent evidence into eligibility.

---

## 2. Identifier schemes per jurisdiction family, and their check rules

Permitted combinations (`JURISDICTION_FAMILIES`, §5.1). Any other pairing fails A3 even if the identifier is
itself checksum-valid:

| `jurisdiction_family` | Permitted `identifier_scheme` |
|---|---|
| `US-SEC` | `CIK` or `LEI` |
| `FR-SIRENE` | `SIREN` or `LEI` |
| `BR-CNPJ` | `CNPJ` or `LEI` |
| `LEI-ONLY` | `LEI` only |
| `UNKNOWN` | — (A5 is `unknown`; the row cannot be admitted) |

A company from an **inaccessible** jurisdiction is admissible only as `LEI-ONLY` (§5.1).

Check rules actually enforced (`lib/identifiers.mjs`):

| Scheme | Rule |
|---|---|
| `CIK` | 1–10 digits, numeric value > 0. No checksum. Leading zeros are not significant — but the string is what is hashed and deduplicated, so write one consistent form. |
| `SIREN` | Exactly 9 digits, **Luhn**-valid. One documented exception is allowlisted in code: `356000000` (La Poste). |
| `CNPJ` | 14 characters: 12 positions of `0–9A–Z` then **2 numeric check digits** (mod-11, weights `5 4 3 2 9 8 7 6 5 4 3 2` then `6 5 4 3 2 9 8 7 6 5 4 3 2`, each character valued `ASCII − 48`). Since July 2026 the first 12 may be alphanumeric. All-same-digit strings are rejected. |
| `LEI` | ISO 17442: 18 alphanumerics + 2 check digits, **ISO 7064 MOD 97-10** over the whole 20-character string ≡ 1 (letters valued `A`=10 … `Z`=35). |
| `wikidata_qid` | `Q` + digits, no leading zero. Validated only if non-empty; a bad QID is **malformed**, not an A3 failure. |

**Validation proves well-formedness, never identity.** That an identifier is checksum-valid says nothing
about whether it names the intended entity. That tie is **A4**, and A4 is established by a human reading a
registry record — never by the tooling.

---

## 3. A1–A6 in plain language

Answer each for the entity named in the row. Where a column exists, write `yes`, `no` or `unknown`; A3 and A5
follow from columns 4–6.

- **A1 — real, currently operating legal entity.** Is this a legal entity that exists and is trading today?
  Not a brand, not a product line, not a dissolved or merged-away shell.
  `no` → `A1_NOT_OPERATING_ENTITY` · `unknown` → `A1_NOT_ESTABLISHED`.
- **A2 — the entity controls this domain, over HTTPS.** Is `canonical_domain` the entity's own domain, and
  does it serve over HTTPS? A syntactically impossible host, or `canonical_domain = UNKNOWN`, cannot pass:
  `UNKNOWN` gives `unknown` (or `fail` if the enumerator answered `no`), and a host that fails the hostname
  form is a straight `fail`.
  `no` → `A2_NO_CONTROLLED_DOMAIN` · `unknown` → `A2_NOT_ESTABLISHED`.
- **A3 — decisive identifier, checksum-valid and permitted for the family.** *(computed)* Does
  `identifier_value` pass its scheme's check rule, **and** is that scheme permitted for
  `jurisdiction_family`? `identifier_scheme = UNKNOWN` → `unknown`.
  `no` → `A3_INVALID_IDENTIFIER` · `unknown` → `A3_NOT_ESTABLISHED`.
- **A4 — the identifier↔domain tie was evidenced independently of CPG.** Did you establish, from a source
  that is not CPG and not derived from CPG, that *this* identifier and *this* domain belong to the same
  entity? You must record **both** an `https` URL and a non-blank note. Answering `yes` **without** valid
  evidence is not "unknown" — it is recorded as an outright A4 **failure**
  (`A4_NO_INDEPENDENT_TIE`), because an unevidenced claim is worse than an admitted gap.
  `unknown` → `A4_NOT_ESTABLISHED`.
- **A5 — jurisdiction family accessible at the resolver SHA.** *(computed)* Is `jurisdiction_family` one of
  the four accessible families? `UNKNOWN` → `unknown`; anything not in the list → `fail`.
  `no` → `A5_INACCESSIBLE_JURISDICTION` · `unknown` → `A5_NOT_ESTABLISHED`.
- **A6 — reference truth obtainable for all three fields.** Do you expect an independent researcher to be
  able to find authoritative documentation for `founded_year`, `employee_count` and `revenue_range`?
  This is about *obtainability of documentation*, not about what the values are — and
  `NOT_AVAILABLE_FROM_SOURCE` is later a valid reference outcome, not inadmissibility (§5.9).
  `no` → `A6_REFERENCE_NOT_OBTAINABLE` · `unknown` → `A6_NOT_ESTABLISHED`.
- **Outcome class.** `unknown` → `OUTCOME_CLASS_NOT_ESTABLISHED`. Definitions (§5.2, a **prediction** made
  before any reference research; it drives sampling balance only and never a label):
  - `fill-expected` — an authoritative source is expected to state at least one of the three fields;
  - `abstention-expected` — no authoritative source is expected to state any of the three;
  - `identity-hazard` — a *different* real entity shares the name or a confusable domain; the collision must
    be named in `identity_hazard_note`.

Only the **first** failing criterion is reported, in the fixed order A1, A2, A3, A4, A5, A6, then the outcome
class. Fix the reported one and re-run; a second may then appear.

---

## 4. The C1 contamination attestations

Four attestations, each `yes` / `no` / `unknown`. They are **not** admissibility: a contaminated company stays
in the frame and stays researchable — it simply can never be drawn into held-out, only into development
(§5.3, §5.8).

| Attestation | Question the enumerator answers |
|---|---|
| `c1_2_used_in_cpg_work` | Was this company used in developing the CPG resolver, this protocol, the dataset tooling, or the reference-truth procedures? |
| `c1_3_values_derived_from_cpg` | Was any expected value for this company derived from a CPG output? |
| `c1_4_prior_cpg_execution` | Has this company been through any prior CPG execution — smoke, live, pilot **or** production? |
| `c1_5_internal_or_owned` | Is this the implementers' own company or tenant, or an entity they control? |

Two further C1 rules are **not** the enumerator's to answer — they are established mechanically and may
override any attestation:

- **C1(1)** — name, domain or identifier occurring in a committed path within scan scope at the frozen
  resolver SHA. Established by the scanner (§5.4).
- **C1(6)** — a match against the frozen development-only registry by name (whole word, any name variant) or
  domain (exact or parent). Established by the scanner against
  `rules/development_only_registry.json`.

**`unknown` = `yes` here.** An unestablished contamination question makes the company held-out-ineligible.
If you cannot establish the answer, write `unknown` and move on: the cost is that the company is
development-only, not that your row is rejected.

---

## 5. Evidence URL and note requirements

- `identifier_domain_evidence_url` must parse as a URL with scheme exactly `https:` and a hostname. It is
  the page on which the identifier↔domain tie is readable.
- `identifier_domain_evidence_note` must be non-blank and should say *what the page states* — which record,
  which field ties identifier to domain — not merely "checked".
- Both are required together for **A4 = pass**. `a4 = yes` with a missing or non-https URL, or with a blank
  note, is converted to an A4 **failure**.
- `enumeration_source_url` must likewise be `https` and records the public listing or search the candidate
  came from. It is provenance for *how the candidate entered the frame*, distinct from the A4 tie evidence.
- `identity_hazard_note` must name the colliding entity or confusable domain whenever the class is
  `identity-hazard`.
- Use only **public sources**. The enumerator has no access to CPG, to the product database, or to any
  internal system.

---

## 6. Refusal happens at `frame`, before any draw

`node cpg_u1_data.mjs frame --frame <F>.csv`

- The header must match the 23 template columns exactly — missing or extra columns refuse the whole file.
- Every row is checked structurally. Any structural problem (blank where a token is required, bad attestation
  value, non-`https` URL, bad date, bad QID, `identifier_value` present with scheme `UNKNOWN`, missing
  `identity_hazard_note` on a hazard row, duplicate `candidate_id`, a `SYNTHETIC-` name or `.example` domain
  in a real frame) makes the row **`MALFORMED_ROW`**.
- If **any** row is malformed, `frame` prints each one and **exits 1**. Every downstream sampling command
  (`scan` consumers, `check-frame-sufficiency`, `commitment-payload`, `draw-development`, `pool-check`,
  `draw-held-out`) calls the same loader and **refuses before drawing anything**. A malformed row therefore
  cannot reach a draw, and a refused command writes nothing.
- Duplicate identifiers (`scheme:value`) and duplicate `canonical_domain` values across admissible rows are
  refused separately — one row per legal entity (§5.7).
- Admissibility failures and `unknown`s are **not** malformed. They are legitimate screening outcomes,
  recorded in the §15.3 screening log with `a1`–`a6` as `pass`/`fail`/`unknown`, and they simply do not count
  toward the §5.7.2 sufficiency floor.
- All outputs are **write-once**; there is **no `--seed` argument** anywhere. `frame` prints the
  `frame_hash`, which is what the on-chain commitment binds.

Exit codes across the tooling: `0` ok · `1` refused/abort · `2` pool below minimum · `3` HALT · `4` BLOCKED
(named human prerequisite missing) · `5` WAITING · `6` VOID/ABANDONED.

---

## 7. Ordering constraint the enumerator must respect

```
funding confirmed → PUBLIC OSF registration (the freeze, §5.5.1)
                  → enumerate the COMPLETE frame → frame → scan → check-frame-sufficiency
                  → development commitment → ... NO LATER ADDITIONS
```

The frame is enumerated **after** registration and **before** the development commitment, and after that
commitment rows may never be added, removed, edited, re-identified or reclassified (§5.5). The enumerator
therefore delivers one complete file, once. Everything in this directory exists so that the enumerator's
single pass is not also the first time the machinery is exercised.

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

