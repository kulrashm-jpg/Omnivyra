# ADMISSIBILITY_CHECKLIST — one row, by hand, cheapest disqualifier first

**Classification: PREPARATION.** This mirrors exactly what `checkFrameRow` (`lib/schema.mjs`) enforces and adds
no rule of its own. It is a hand aid; the tooling is the authority. **Enumeration is H3** — an independent
enumerator applies this, not the operator and not an agent.

Ordering principle: **structure before semantics, and free checks before expensive ones.** Steps 1–12 need no
research at all (they are typography and arithmetic on what you already wrote), so they run first — a row that
fails there is `MALFORMED_ROW` and never reaches admissibility. Steps 13–19 are the admissibility questions,
in the tool's own evaluation order. Steps 20–21 are contamination, which never blocks admission. Step 22 is
cross-row.

Legend: **M** = malformed (whole file refused, exit 1) · **X** = excluded with the named reason (row stays in
the frame and in the screening log) · **I** = held-out-ineligible (row stays admissible).

---

## Part A — structure (no research needed)

| # | Check | Fail |
|--:|---|---|
| 1 | The file's header is exactly the 23 template columns, same spelling, no extras, none missing. | **M** (whole file) |
| 2 | `candidate_id` is 1–64 characters of `A–Z a–z 0–9 _ -`. | **M** |
| 3 | `company_name` is non-empty and has no leading or trailing whitespace. | **M** |
| 4 | `company_name` does **not** start `SYNTHETIC-` and `canonical_domain` does **not** end `.example`. | **M** ("SYNTHETIC row in a real frame") |
| 5 | None of `canonical_domain`, `jurisdiction_family`, `identifier_scheme`, `expected_outcome_class` is **blank**. Not established → write `UNKNOWN` (first three) or `unknown` (the class). | **M** |
| 6 | If `canonical_domain` is not `UNKNOWN`: it is all lowercase, does not start `www.`, and contains no `/ : ? #` or whitespace. | **M** |
| 7 | `identifier_value` is empty **iff** `identifier_scheme` is `UNKNOWN`. (Scheme `UNKNOWN` + a value → M. A real scheme + blank value → M, with the instruction to set the scheme to `UNKNOWN` instead.) | **M** |
| 8 | Each of `a1_operating_legal_entity`, `a2_domain_controlled_https`, `a4_tie_independent_of_cpg`, `a6_reference_obtainable`, `c1_2_used_in_cpg_work`, `c1_3_values_derived_from_cpg`, `c1_4_prior_cpg_execution`, `c1_5_internal_or_owned` is exactly `yes`, `no` or `unknown` — lower case, nothing else, **blank is not an answer**. | **M** |
| 9 | `expected_outcome_class` is exactly one of `fill-expected`, `abstention-expected`, `identity-hazard`, `unknown`. | **M** |
| 10 | If the class is `identity-hazard`, `identity_hazard_note` is non-blank and names the colliding entity or confusable domain. | **M** |
| 11 | `enumerated_by` is non-blank (pseudonymous ID); `enumerated_at` is `YYYY-MM-DD` **and a real calendar date**; `enumeration_source_url` parses as `https://…` with a hostname. | **M** |
| 12 | `wikidata_qid` is either empty or `Q` + digits with no leading zero. | **M** |

If any of 1–12 fails anywhere in the file, `frame` prints every offending row and exits 1. **No draw, no
commitment payload and no sufficiency check can run until the file is clean** — every one of those commands
loads the frame through the same validator first.

---

## Part B — admissibility, in the tool's evaluation order

Only the **first** non-pass is reported. Fix it and re-run; the next may then surface.

| # | Criterion | Pass condition | `no` → | `unknown` → |
|--:|---|---|---|---|
| 13 | **A1** operating entity | `a1_operating_legal_entity = yes` | **X** `A1_NOT_OPERATING_ENTITY` | **X** `A1_NOT_ESTABLISHED` |
| 14 | **A2** controlled domain over HTTPS | `canonical_domain` is a well-formed host (4–253 chars, labels of `a–z0–9-` not starting/ending `-`, TLD 2–63 letters) **and** `a2_domain_controlled_https = yes`. Special cases: `canonical_domain = UNKNOWN` → `fail` if you answered `no`, otherwise `unknown`; a host that fails the form → `fail` outright, whatever you answered. | **X** `A2_NO_CONTROLLED_DOMAIN` | **X** `A2_NOT_ESTABLISHED` |
| 15 | **A3** decisive identifier *(computed)* | `identifier_scheme ≠ UNKNOWN`, `identifier_value` passes that scheme's check rule (CIK 1–10 digits > 0; SIREN 9 digits Luhn, `356000000` allowlisted; CNPJ 12×`0-9A-Z` + 2 mod-11 digits, not all-same; LEI 18 alnum + 2 digits, ISO 7064 MOD 97-10 ≡ 1), **and** the scheme is permitted for `jurisdiction_family`. | **X** `A3_INVALID_IDENTIFIER` | **X** `A3_NOT_ESTABLISHED` (scheme `UNKNOWN`) |
| 16 | **A4** identifier↔domain tie, independent of CPG | `a4_tie_independent_of_cpg = yes` **and** `identifier_domain_evidence_url` is `https` **and** `identifier_domain_evidence_note` is non-blank. `yes` with missing/bad evidence is downgraded to **fail**, not to unknown. | **X** `A4_NO_INDEPENDENT_TIE` | **X** `A4_NOT_ESTABLISHED` |
| 17 | **A5** accessible jurisdiction *(computed)* | `jurisdiction_family ∈ {US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY}`. Permitted schemes: US-SEC → CIK\|LEI; FR-SIRENE → SIREN\|LEI; BR-CNPJ → CNPJ\|LEI; LEI-ONLY → LEI. | **X** `A5_INACCESSIBLE_JURISDICTION` (an unrecognised family string) | **X** `A5_NOT_ESTABLISHED` (`UNKNOWN`) |
| 18 | **A6** reference truth obtainable for all three fields | `a6_reference_obtainable = yes` | **X** `A6_REFERENCE_NOT_OBTAINABLE` | **X** `A6_NOT_ESTABLISHED` |
| 19 | **Outcome class established** | class ≠ `unknown` | — | **X** `OUTCOME_CLASS_NOT_ESTABLISHED` |

**`unknown` is never a pass.** It is a third outcome with its own exclusion reason. There is no way to convert
absent evidence into admission.

An excluded row is **not** an error. It stays in the frame, it is recorded in the §15.3 screening log with
`a1`–`a6` as `pass`/`fail`/`unknown` and its `exclusion_reason`, and it simply does not count toward the
§5.7.2 sufficiency floor.

---

## Part C — contamination (never blocks admission)

| # | Check | Effect |
|--:|---|---|
| 20 | Each of `c1_2_used_in_cpg_work`, `c1_3_values_derived_from_cpg`, `c1_4_prior_cpg_execution`, `c1_5_internal_or_owned` is `no`. | Any `yes` → **I**. Any **`unknown` → I as well**, recorded as "NOT ESTABLISHED, treated as contaminated". |
| 21 | C1(1) repository scan and C1(6) development-only registry match. | **Not the enumerator's to answer.** Established mechanically by `scan` and may make the company **I** regardless of the attestations. See `CONTAMINATION_PROCEDURE.md`. |

**I** means held-out-ineligible: the company stays in the frame, stays admissible, and can be drawn into
**development only** (§5.3, §5.8). Ineligible admissible rows are drawn into development *first*; the surplus
is logged `DEVELOPMENT_SURPLUS` and never enters held-out.

---

## Part D — cross-row (check once over the whole file)

| # | Check | Fail |
|--:|---|---|
| 22 | `candidate_id` is unique; and across **admissible** rows, `identifier_scheme:identifier_value` is unique **and** `canonical_domain` is unique. One row per legal entity (§5.7). | duplicate `candidate_id` → **M**; duplicate identifier or domain → the command **refuses** |

---

## Quick self-audit before handing the file over

1. `node cpg_u1_data.mjs frame --frame <F>.csv` exits **0** and reports `malformed: 0`.
2. The printed tally is what you expect: `ADMISSIBLE` plus a named reason for every row you knowingly screened
   out, and nothing you did not intend.
3. `held-out-ineligible by attestation (before scan/registry)` matches the number of rows on which you wrote a
   contamination `yes` or `unknown`.
4. Record the printed `frame_hash`. It is what the commitment binds; if it changes, the file changed.
