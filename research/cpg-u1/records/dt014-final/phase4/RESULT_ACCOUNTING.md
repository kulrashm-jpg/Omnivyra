# RESULT ACCOUNTING — DEEPTECH-PARALLEL-014 phase 4 (preparation)

**Status: design. No mutant was executed. Nothing was written to `C:/tmp/dt013-candidate/`.**

Goal: after K partitions run independently, produce a total that **provably accounts for all 441
mutants**, or produce **no total at all**. There is no third outcome.

---

## 1. Three artefacts per worker

| File | Written when | Purpose |
|---|---|---|
| `w<k>/logs/partition-<k>.log` | streamed | verbatim stdout+stderr of that harness process; the human-readable record |
| `w<k>/out/partition-<k>.ndjson` | appended per mutant, flushed each time | append-only progress stream; survives a crash and names exactly how far the worker got |
| `w<k>/out/partition-<k>.json` | **once**, only after the harness exits **and** the clone aggregate is re-verified | the sealed partition record; the only input the merge accepts |

A **wrapper** process launches the harness, tees its output to the log, parses it line by line into
the NDJSON, and seals the JSON. The wrapper lives outside every clone — the candidate and the worker
clones are byte-exact and must stay so — and `mutate.mjs` derives `ROOT` from its own
`import.meta.url`, so the wrapper's location and cwd are irrelevant to the harness.

### 1.1 Parsing contract

`mutate.mjs` prints, per completed mutant:

```
  ${outcome.padEnd(8)} ${name}[ (N failing assertion(s)[; includes a selftest crash])| (exit N)]
```

where `name` is the full label, whose first token is the id. The wrapper matches

```
/^ {2}(KILLED|SURVIVED|TIMEOUT|ERROR) +(M\d+) /
```

and additionally captures the parenthetical detail (`failed`, `code`, `crash`). Anchor failures print

```
  ANCHOR?  ${name} (${count}x in ${file})
```

and are recorded as `INVALID` with their observed count. The `anchors: n/n occur exactly once` line
and the `mutations: total N; killed …` summary are parsed **only as cross-checks** against the
per-mutant lines; no count in the sealed record is taken from them.

### 1.2 Exit-code interpretation — `1` is not a crash

| Exit | Meaning |
|---|---|
| `0` | partition completed; every mutant in it was KILLED |
| `1` | partition completed **normally** but had ≥ 1 SURVIVED / TIMEOUT / ERROR, **or** the anchor precheck failed |
| `2` | precondition failed (`CPG_U1_ADAPTER_CLONE` or `CPG_U1_RESOLVER_CLONE` unset) — no mutant ran |
| anything else, or a signal | the worker **crashed** |

Treating `1` as a failure would abandon a healthy partition; treating it as success without the
per-id check would hide a short run. Both are avoided by sealing on the *parsed id set*, never on the
exit code.

### 1.3 Sealed partition record

```jsonc
{
  "document": "MUTATION_PARTITION_RESULT",
  "sealed": true,
  "partition": 0, "partitions": 3,
  "partition_rule_id": "adapter-pinned-stride-v1",
  "manifest_digest":  "bf1b71c1…",      // must equal the manifest's
  "partition_digest": "5c8de141…",      // must equal the manifest's
  "candidate_aggregate": "b9250356…",
  "tooling_aggregate":   "b9250356…",
  "protocol_sha256":     "c50fc680…",
  "clone_path": "C:/tmp/dt014-mutrun/w0/clone",
  "clone_aggregate_before": "b9250356…",
  "clone_aggregate_after":  "b9250356…",
  "clone_file_count_before": 595, "clone_file_count_after": 595,
  "resolver_clone": { "path": "…/shared/resolver", "head": "f01a7eb4…",
                      "porcelain_empty": true, "env_files": [] },
  "adapter_clone":  { "path": "…/shared/adapter",  "head": "f01a7eb4…",
                      "tsx_present": true, "undici_present": true },
  "baseline_attestation": { "selftest_failed": 0, "adapter_conformance_failed": 0 },   // gate G7
  "harness_argv": ["--jobs", "1", "--only", "M01,M04,…"],
  "assigned_ids": ["M01", "…"],          // 147 ids
  "assigned_count": 147,
  "anchor_check": { "reported_total": 147, "reported_ok": 147, "invalid": [] },
  "host": { "platform": "win32", "hostname": "…", "logical_cpus": 4 },
  "node_version": "v…",
  "started_utc": "…", "ended_utc": "…",
  "exit_code": 1,
  "leftovers": 0,
  "ndjson_sha256": "…",                  // digest of the append-only stream
  "log_sha256": "…",
  "results": [
    { "id": "M01", "spec_hash": "…", "outcome": "KILLED",
      "failed": 3, "code": 1, "crash": false }
    // … exactly assigned_count entries
  ]
}
```

Each result carries the `spec_hash` copied from the manifest, so the merge can prove the worker ran
the mutant the manifest *describes*, not merely one bearing the same id.

---

## 2. Detecting a crashed or short worker

| Failure | Observable signature | Caught by |
|---|---|---|
| worker never launched | no log, no NDJSON, no sealed JSON | R1 |
| worker died mid-run | log + NDJSON present, sealed JSON absent; `NDJSON lines < assigned_count` names the missing ids exactly | R1, and R6 if a record is forged |
| harness threw inside `Promise.all` | process exits non-zero with a stack and **no** `mutations: total` line; wrapper refuses to seal | R1 |
| precondition failure (exit 2) | zero parsed results | R1 / R6 |
| worker finished but died before sealing | NDJSON complete, sealed JSON absent | R1. Re-run that one partition — partitions are independent by construction. A manual seal is permitted only if it records `ndjson_sha256` and is itself signed off; re-running is preferred. |
| worker ran the **wrong** id set | `assigned_ids` ≠ the manifest's partition-k set | R4 |
| worker silently dropped mutants | `set(results.id)` ⊊ `assigned_ids` | **R6** |
| worker ran against a drifting tree | `clone_aggregate_before ≠ clone_aggregate_after` | R3 |
| worker ran against the wrong tree | `candidate_aggregate` mismatch | **R2** |
| results from two different candidates mixed | records disagree on `candidate_aggregate` / `manifest_digest` | **R2** |

The key property: **the sealed JSON is written only at the very end.** Its absence is the crash
signal, and the NDJSON is the forensic record of how far the worker got. A partition that ends with
fewer results than assigned can never look complete, because completeness is asserted by comparing id
*sets*, never by counting.

---

## 3. The merge: twelve refusal rules

`merge_partitions.mjs` takes `FINAL_MUTATION_MANIFEST.json` plus the K sealed records and either
emits `MERGED_MUTATION_RESULT.json` with `status: "COMPLETE"`, or emits `MERGE_REFUSED.json` naming
the failing rule — and in the refusal case emits **no counts of any kind**.

| # | Rule | Refusal |
|---|---|---|
| **R1** | `PARTITION_PRESENT` — a record with `sealed === true` exists for every `k` in `0…K-1` | `MISSING_PARTITION` + the list of missing k |
| **R2** | `IDENTITY_MATCH` — every record's `candidate_aggregate`, `tooling_aggregate`, `protocol_sha256`, `manifest_digest`, `partition_digest`, `partitions` and `partition_rule_id` equal the manifest's | `IDENTITY_MISMATCH` + field + both values |
| **R3** | `CLONE_STABLE` — for every record, `clone_aggregate_before == clone_aggregate_after == manifest.candidate_aggregate`, and both file counts are 595 | `CLONE_DRIFT` |
| **R4** | `ASSIGNMENT_MATCH` — each record's `assigned_ids`, as a set, equals the manifest's partition-k id set | `ASSIGNMENT_MISMATCH` |
| **R5** | `COVER_AND_DISJOINT` — the union of all `assigned_ids` equals the manifest's 441 ids, and the K sets are pairwise disjoint | `COVERAGE_BROKEN` |
| **R6** | `NO_SHORT_PARTITION` — for each record, `set(results.id) == set(assigned_ids)` with equal cardinality | `SHORT_PARTITION` + k + missing ids + extra ids |
| **R7** | `EXACTLY_ONCE` — across all records each of the 441 ids appears in exactly one result | `DUPLICATE_RESULT` / `ORPHAN_RESULT` |
| **R8** | `SPEC_BOUND` — each result's `spec_hash` equals the manifest's `spec_hash` for that id | `SPEC_HASH_MISMATCH` — the worker ran a different specification than the manifest describes |
| **R9** | `TERMINAL_STATE` — every `outcome` is one of `KILLED SURVIVED TIMEOUT ERROR INVALID`. Any other string, `null`, or a missing field is a refusal. No `"skipped"`, `"n/a"` or `"not relevant"` value is accepted. | `UNKNOWN_OUTCOME` |
| **R10** | `INVALID_ACCOUNTED` — the union of `anchor_check.invalid` across records plus all `results` ids covers all 441 exactly once, and no INVALID id also has a result | `INVALID_ACCOUNTING_BROKEN`. Any INVALID present ⇒ status `NOT_RUNNABLE`: the invalid ids are printed and **no kill total is printed** |
| **R11** | `IDENTITY_SUM` — `killed + survived + timeout + error + invalid == 441` (redundant backstop to R6–R10), printed as an explicit identity line | `ACCOUNTING_IDENTITY_BROKEN` |
| **R12** | `BASELINE_ATTESTED` — every record carries `baseline_attestation` with `selftest_failed == 0`, and partition 0 also `adapter_conformance_failed == 0` (gate G7) | `BASELINE_NOT_ATTESTED` |

R1–R12 are evaluated in order and **all** are evaluated; the refusal document lists every rule that
failed, not just the first, so one merge attempt diagnoses the whole run.

### 3.1 Successful output

```jsonc
{
  "document": "MERGED_MUTATION_RESULT",
  "status": "COMPLETE",
  "candidate_aggregate": "b9250356…", "tooling_aggregate": "b9250356…",
  "protocol_sha256": "c50fc680…",
  "manifest_digest": "bf1b71c1…", "partition_digest": "5c8de141…",
  "partitions": 3,
  "total_assigned": 441, "total_accounted": 441,
  "identity": "killed + survived + timeout + error + invalid = 441",
  "counts": { "KILLED": 0, "SURVIVED": 0, "TIMEOUT": 0, "ERROR": 0, "INVALID": 0 },
  "survivors": [], "timeouts": [], "errors": [], "invalid": [],
  "per_mutant": [ { "id": "M01", "partition": 0, "spec_hash": "…", "outcome": "…" } ],
  "per_partition_provenance": [ /* the K sealed records minus their results arrays */ ],
  "rules_passed": ["R1","R2","R3","R4","R5","R6","R7","R8","R9","R10","R11","R12"]
}
```

Every count is derived from `per_mutant`, which is built from the merged id table — **never** from any
harness summary line, which is partition-local after `--only`.

---

## 4. Anti-false-green clauses

1. **`COMPLETE` is emitted only when all twelve rules pass.** There is no `"partial"` status that
   carries counts: on any refusal the output format has no fields in which a count could appear. A
   partial run is therefore not merely discouraged — it is **unrepresentable** as a total.
2. **No kill count and no kill rate exists outside a `COMPLETE` document.** Refusals carry evidence,
   never arithmetic.
3. **Cross-candidate mixing is blocked at R2.** Every partition output carries the candidate
   aggregate, the tooling aggregate and the protocol SHA, and the merge compares all three against
   the manifest. In particular the superseded tree — tooling aggregate `638d68e6…`, the terminated
   PID 4092 run — cannot enter: its records would fail R2 on the first field. **No number from that
   tree may be quoted, derived from, or combined with anything here.** The same rule blocks mixing
   pre- and post-DR-11 output, since DR-11 changes the aggregate.
4. **R8 blocks id-level substitution.** Matching ids is not enough; the specification hash must match,
   so a mutant whose anchor or replacement changed cannot be credited against the old manifest entry.
5. **A missing result can never be read as a pass.** R6 compares id *sets*, so absence is loud. R11
   is a second, independent arithmetic check of the same thing.
6. **`ERROR` and `INVALID` are reported as non-green terminal states beside `KILLED`.** A run with any
   SURVIVED, TIMEOUT, ERROR or INVALID is reported as such and never summarised as a clean
   "n/n killed". The `counts` block is always printed in full, never filtered to the favourable rows.
7. **The environment cannot forge a kill.** `KILLED` requires the selftest's
   `selftest: N passed, M failed` summary with `M > 0`; a missing or dirty resolver clone makes the
   child `stop()` before printing it, so the outcome is `ERROR`. Gate G12/R12 (the unmutated baseline
   at 0 failures) closes the remaining case — a *partial* environment fault that still prints a
   summary line with failures.
8. **Partition-local totals are never promoted.** The harness's own `mutations: total N` line is
   recorded in the log for audit but is not an input to any count.

---

## 5. Re-running one partition

Partitions are independent: distinct clone, distinct temp, distinct output, distinct log, no shared
mutable state, and (by the adapter pin) no shared exclusive resource. A partition may therefore be
re-run on its own after a crash, and the merge is re-attempted with the fresh sealed record. The
re-run must re-verify its clone aggregate before and after (R3) and carry the same `manifest_digest`
and `partition_digest` (R2); if the candidate has changed in the meantime, **all** partitions are void,
not just the failed one.

---

## 6. Residual risks in the accounting scheme

1. **The wrapper is a spec, not code.** Nothing here has been implemented or executed; the later
   gated phase must build the wrapper and the merge tool and test them against synthetic records
   before the real run. An untested merge tool is itself a false-green risk.
2. **The parse is textual.** Outcome lines are recovered by regex from harness stdout. If a mutant's
   *description* ever began with a token matching `M\d+`, or if a future harness change altered the
   `padEnd(8)` format, the parse could mis-attribute. Mitigations: the id is taken as the token
   immediately after the padded outcome; the parsed count is cross-checked against the harness's own
   bucket counts and the NDJSON line count; and the wrapper refuses to seal on any disagreement. A
   structured `--json` output mode in the harness would remove this risk entirely and is the right
   long-term fix — but it would change `test/mutate.mjs` and therefore the tooling aggregate, so it is
   **out of scope for this wave**.
3. **`maxBuffer` truncation.** A child producing more than 67.1 MB of stdout is killed with an
   `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` error, which `classify` maps to `ERROR` (not a silent loss) —
   correct, but it would be reported as a mutant fault rather than a harness limit. The log preserves
   the evidence.
4. **A manual seal is a hole.** §2 permits sealing from a complete NDJSON when a worker died after its
   last mutant. That path trusts a human. Re-running the partition is preferred and should be the
   default; a manual seal must record `ndjson_sha256` and be explicitly signed off.
5. **The manifest is not frozen.** Everything above binds to `manifest_digest bf1b71c1…` /
   `candidate_aggregate b9250356…`, both **PROVISIONAL, PENDING DR-11**. If DR-11 lands, the manifest
   is regenerated, both digests change, and every rule here refuses any older partition output — which
   is the intended behaviour, not a defect.
