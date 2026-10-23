# MERGE TOOL VALIDATION — CERT-015

**Scope limit.** Engineering evidence only. Not U1 empirical validation; no registration readiness.

`RESULT_ACCOUNTING.md` §6.1 names the hazard directly: *"An untested merge tool is itself a
false-green risk."* So `merge_partitions.mjs` was tested against fabricated sealed records **before**
it was pointed at real results — each test breaking exactly one thing and asserting the merge refuses
on the expected rule.

## 1. The rules implemented

R1–R12 come from `RESULT_ACCOUNTING.md` §3. R13 and R14 are additions covering hazards this brief
raises that the design's rule table did not carry as rules.

| Rule | Name | What it refuses |
|---|---|---|
| R1 | `PARTITION_PRESENT` | a sealed record missing for any shard (the crash signal) |
| R2 | `IDENTITY_MATCH` | any shard whose candidate aggregate, tooling aggregate, file count, protocol SHA, manifest digest or partition digest differs from the frozen manifest; and explicitly any shard carrying a firewalled prefix (`638d68e6`, `b9250356`) |
| R3 | `CLONE_STABLE` | `before != after`, or either `!=` the candidate aggregate, or either file count `!= 595` |
| R4 | `ASSIGNMENT_MATCH` | a shard whose assigned id **set** differs from the manifest's shard-k set |
| R5 | `COVER_AND_DISJOINT` | union `!=` the 458 manifest ids, or any non-empty pairwise intersection |
| R6 | `NO_SHORT_PARTITION` | `set(returned_ids) != set(assigned_ids)` — **id sets, never counts** |
| R7 | `EXACTLY_ONCE` | any id appearing twice, any orphan id, any manifest id with no result |
| R8 | `SPEC_BOUND` | a spec hash re-derived from the worker's **own clone** that differs from the manifest's |
| R9 | `TERMINAL_STATE` | any outcome outside `KILLED SURVIVED TIMEOUT ERROR INVALID` |
| R10 | `INVALID_ACCOUNTED` | an INVALID id that also carries a result, or a partition-local anchor line inconsistent with its assigned count |
| R11 | `IDENTITY_SUM` | `killed + survived + timeout + error + invalid != 458` |
| R12 | `BASELINE_ATTESTED` | the unmutated baseline (gate G7) missing or non-zero |
| **R13** | `ISOLATION_DISTINCT` *(added)* | two workers reporting the same `os.tmpdir()`; a self-inconsistent temp proof; two workers sharing a clone path; resolver and adapter paths equal in any shard |
| **R14** | `WORKER_NOT_CRASHED` *(added)* | exit code outside {0, 1}, or any signal. **Exit 1 is a normal completion and is accepted.** |

### 1.1 R8 is implemented in a stronger form than the design specified

The design has each worker copy the manifest's `spec_hash` into its results, and the merge compare the
copies. A worker that copied the wrong value — or copied the right value while running something else
— would pass. Instead, the merge **re-parses `test/mutate.mjs` out of each worker's own clone** and
recomputes `CPG-U1-MUTSPEC-v1` for every id that worker was assigned, requiring equality with the
manifest. This proves the worker executed the specification the manifest *describes*, rather than
trusting a field the worker wrote about itself.

### 1.2 R12 placement deviation, stated

The design puts `baseline_attestation` inside each sealed record. Here it is a single **run-level**
artefact (`baseline/BASELINE_ATTESTATION.json`) produced against a dedicated unmutated clone whose
aggregate is verified to equal the candidate. The substance of gate G7 — a clean tree at zero failures,
adapter conformance included — is unchanged; only the placement differs. The merge records the
deviation in its own R12 evidence rather than leaving it implicit.

## 2. Test results — 16 PASS, 0 FAIL

```
--- happy path ---
PASS  all three shards complete, all KILLED  -> COMPLETE | registered 458 = killed 458 + survived 0 + timeout 0 + error 0 + invalid 0 = 458
      counts {"KILLED":458,"SURVIVED":0,"TIMEOUT":0,"ERROR":0,"INVALID":0}  rules R1,R10,R11,R12,R13,R14,R2,R3,R4,R5,R6,R7,R8,R9
--- refusals ---
PASS  R1 a worker never sealed (crash)                                   expected R1       got R1,R5,R7,R11   [no counts emitted]
PASS  R2 shard from the superseded b9250356 candidate                    expected R2       got R2             [no counts emitted]
PASS  R2 shard from the firewalled 638d68e6 tree                         expected R2       got R2             [no counts emitted]
PASS  R3 clone drifted during the run                                    expected R3       got R3             [no counts emitted]
PASS  R4/R5 worker ran the wrong id set                                  expected R4+R5    got R4,R5,R6,R10   [no counts emitted]
PASS  R6/R7/R11 short partition silently dropping 52 mutants             expected R6+R7+R11 got R6,R7,R11     [no counts emitted]
PASS  R6/R7/R11 a mutant reported by two shards                          expected R6+R7+R11 got R6,R7,R11     [no counts emitted]
PASS  R9 a non-terminal "not relevant" bucket                            expected R9       got R9,R11         [no counts emitted]
PASS  R12 unmutated baseline not attested                                expected R12      got R12            [no counts emitted]
PASS  R13 two workers sharing one TEMP                                   expected R13      got R13            [no counts emitted]
PASS  R13 resolver/adapter clone swapped to one path                     expected R13      got R13            [no counts emitted]
PASS  R14 a crashed worker (not converted to PASS)                       expected R14      got R14            [no counts emitted]
PASS  R14/R6 precondition failure, exit 2, zero results                  expected R14+R6   got R6,R7,R14,R11  [no counts emitted]
PASS  exit 1 with 1 SURVIVED + 1 ERROR is a NORMAL completion, not a crash -> registered 458 = killed 456 + survived 1 + timeout 0 + error 1 + invalid 0 = 458
PASS  R8 clone specifies a different mutant than the manifest (id-level substitution)  expected R8  got R8  [no counts emitted]

MERGE TOOL TEST: ALL PASS
```

Full output at `MERGE_TOOL_TEST_OUTPUT.txt`.

### 2.1 What these tests establish

1. **The two VOID candidates cannot enter.** Both `b9250356…` and `638d68e6…` are refused by R2, and
   both refusals are *demonstrated*, not merely declared in prose.
2. **`[no counts emitted]` on every refusal.** The assertion is structural: the test checks that the
   refusal document has no `counts` and no `total_accounted` field at all. A partial run is therefore
   not merely discouraged — no total is *representable*. Accounting is never repaired by inference.
3. **Short and duplicate partitions are loud.** Dropping 52 of 152 mutants trips R6, R7 and R11
   independently. A worker crash detectable only as "short" cannot be silently absorbed, because
   completeness is asserted by comparing **id sets**, never counts.
4. **A crashed worker stays a failure.** R14 refuses on exit `3221225477` and on exit 2 with zero
   results. A worker failure is never converted to PASS.
5. **Exit 1 is not misread.** The explicit counter-test proves a shard with one SURVIVED and one ERROR
   and exit code 1 still merges to `COMPLETE` with the correct identity line. Treating 1 as a crash
   would abandon a healthy shard — the false-*red* mirror of the false-green risk.
6. **Id-level substitution is blocked.** Tampering with one mutant's description in a worker's clone,
   while leaving its id and the recorded aggregate alone, trips R8.
7. **Shared TEMP and a resolver/adapter swap are caught.** Both are conditions no harness guard
   detects, which is why they are rules here.

## 3. What the merge tool never does

- It never takes a count from a harness summary line. Those are partition-local after `--only`; they
  are recorded under the key `harness_summary_line_PARTITION_LOCAL_NOT_A_RUN_TOTAL` and read by nothing.
- It never uses a `grep` exit status, or any process exit status, as a result. Outcomes are parsed from
  the harness's actual terminal result lines by an anchored regex, and every count is derived from the
  merged per-mutant id table.
- It never infers success from a file existing. The sealed record's **absence** is the crash signal
  (R1), and its presence is only the beginning of fourteen checks.
