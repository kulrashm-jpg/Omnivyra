# VP-2 coverage certificate — artefact schema

**Schema id:** `cpg-u1-vp2-coverage-certificate/v1`
**Producer:** `vp2_coverage_gate.mjs` (operator-side; **not** part of the registered instrument)
**Digest domain:** `cpg-u1-vp2-coverage-certificate-digest/v1`

`certificate_digest = sha256("cpg-u1-vp2-coverage-certificate-digest/v1|" + canonicalJson(body))`
where `body` is every field **except** `certificate_digest`.

---

## 1. Fields

| Path | Type | Meaning |
|---|---|---|
| `schema` | string | `cpg-u1-vp2-coverage-certificate/v1` |
| `gate_version` | string | `vp2-coverage-gate/<semver>` — the producing script's version |
| `classification` | string | fixed sentence stating this is operator-side and not a machine barrier |
| `as_of` | string | `YYYY-MM-DDTHH:MM:SSZ`. **A required INPUT, never a clock read.** |
| `verdict` | `PASS` \| `FAIL` | all checks pass |
| **allocation identity** | | |
| `allocation.schema` | string | must be `cpg-u1-enumeration-allocation/v1` |
| `allocation.rule_id` | string \| null | the pre-registered partition rule id |
| `allocation.allocation_digest` | hex64 | as declared **and** recomputed by the gate; a mismatch is a refusal, not a FAIL |
| `allocation.allocation_file_sha256` | hex64 | sha256 of the allocation file as read |
| `allocation.enumerator_count` | int ≥ 2 | number of enumerator slots in the partition |
| `allocation.enumerator_ids` | string[] sorted | the slot pseudonyms |
| `allocation.expected_jurisdiction_families` | string[] sorted | **the authoritative expected set** |
| `allocation.expected_set_source` | string | states the exact JSON path the expected set came from |
| `allocation.allocated_cell_count` | int | number of (family × class) cells allocated |
| **frame identity** | | |
| `frame.frame_hash` | hex64 | the instrument's own `frame_hash` (`cpg_u1_data.mjs:216`), supplied by the operator |
| `frame.frame_hash_source` | string | states that the gate does **not** recompute it |
| `frame.frame_file_sha256` | hex64 | sha256 of the CSV bytes the gate read |
| `frame.rows_in_file` / `rows_excluded` / `rows_considered` | int | row accounting |
| **coverage result** | | |
| `coverage.minimum_distinct_entities_per_family` | int ≥ 1 | default 1 |
| `coverage.minimum_basis` | string | records that 1 is the weakest non-vacuous value and that any higher value is operator-chosen without protocol basis |
| `coverage.by_family[]` | object[] sorted by `jurisdiction_family` | `{jurisdiction_family, allocated, rows, distinct_entities, distinct_entities_including_cross_family}` |
| `coverage.total_rows` / `total_distinct_entities` | int | |
| `coverage.min_allocated_family_distinct_entities` | int | the number the verdict actually turns on |
| `coverage.aggregate_only_test_would_have_passed` | bool | printed so a reader sees that a totals-based test would have been fooled |
| `missing_jurisdictions` | string[] sorted | allocated families below the minimum |
| `unexpected_jurisdictions` | string[] sorted | families in the frame that the partition never allocated |
| **duplicate evidence** | | |
| `duplicates.link_keys` | string[] sorted | the five link keys in use |
| `duplicates.multi_row_entities` | int | clusters holding more than one row |
| `duplicates.cross_family_entities[]` | object[] | `{candidate_ids[], jurisdiction_families[], shared_link_keys[]}` |
| `duplicates.assert_unique_equivalent_would_pass` | bool | whether the instrument's weaker `assertUnique` key set would have let it through |
| `duplicates.rows_with_no_corroborating_link_key` | string[] sorted | candidate_ids whose duplication could not be detected either way |
| `duplicates.unresolvable_duplicate_risk` | bool | true iff the previous array is non-empty |
| **attribution (optional, §12)** | | |
| `enumeration_attribution` | object | `{performed:false, note}` or `{performed:true, mechanism, module_sha256, registered_enumerators[], error_count, errors[], result, note}` |
| **checks** | | |
| `checks[]` | object[] fixed order | `{id, title, result, detail}` — C1…C5, then A1 when attribution was performed |
| **honesty fields** | | |
| `barrier` | object | `{kind:"PROCEDURAL", mechanically_enforced:false, why, what_is_mechanical, what_is_procedural, ordering_evidence}` |
| `limitations` | string[] | fixed sentences, including that :379 permits missing families |
| `certificate_digest` | hex64 | see above |

---

## 2. How determinism is achieved

1. **No wall clock.** `as_of` is a required command-line input and is refused unless it matches
   `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`. Determinism survives a required timestamp precisely
   because the timestamp is an *input to* the artefact, not a *reading by* it: two runs with the same
   `--as-of` are byte-identical, and a run with a different `--as-of` is a different artefact by
   intent. The trustworthy ordering does not come from this field anyway — it comes from the external
   registry timestamp on the published record (see `barrier.ordering_evidence`).
2. **No clock anywhere else.** The gate contains no `Date`, no `Math.random`, no `process.hrtime`.
3. **Canonical key order.** `serialise()` rebuilds every object with keys sorted by codepoint,
   recursively, then `JSON.stringify(…, null, 2)`. The digest uses a separate no-whitespace canonical
   form (`canonicalJson`) with the same recursive key sort, so indentation can never affect the digest.
4. **Sorted arrays.** Every set-like array (`enumerator_ids`, `expected_jurisdiction_families`,
   `missing_jurisdictions`, `unexpected_jurisdictions`, `link_keys`,
   `rows_with_no_corroborating_link_key`, each `candidate_ids` / `jurisdiction_families` /
   `shared_link_keys`) is sorted with a codepoint comparator, never `localeCompare`. `coverage.by_family`
   is sorted by `jurisdiction_family`. `checks` is in a fixed authored order, not sorted.
5. **No paths.** No absolute or relative path is recorded; files are identified by sha256 only, so the
   artefact is identical whatever directory the gate ran in.
6. **Order-independent computation.** Entity clustering is union-find with `parent[max] = min`, and the
   cluster list is sorted by lowest row index, so the cluster set does not depend on iteration order.
   (Reordering the CSV rows *does* change `frame_file_sha256` and `frame_hash`, which is correct: that
   is a different frame file.)
7. **Fixed line endings.** Output is LF with exactly one trailing newline; the CSV reader accepts CRLF
   input and strips a UTF-8 BOM, so a frame re-saved on Windows produces the same coverage result.
8. **Integers only.** Every numeric field is an integer; `canonicalJson` refuses non-finite numbers.

Verified empirically: `run_rehearsal.mjs` runs every scenario twice and compares bytes —
`ALL SCENARIOS BYTE-DETERMINISTIC: true`.

---

## 3. Sample artefact

`rehearsal/S2.certificate.json` (one family absent) is the reference sample; the full set is
`rehearsal/S1..S5.certificate.json`, plus `rehearsal/S1_with_attribution.certificate.json` and
`rehearsal/S1F_forged_enumerator.certificate.json` which exercise the optional §12 check.
