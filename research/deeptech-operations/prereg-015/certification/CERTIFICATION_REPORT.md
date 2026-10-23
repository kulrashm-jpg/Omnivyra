# MUTATION CERTIFICATION REPORT — CERT-015

**VERDICT: BLOCKED.** The exhaustive run is **in flight and healthy but not finished**, so not every
mutant has a terminal state. The blocking rule is the brief's first: *FINAL CERTIFICATION = BLOCKED if
any mutant lacks a terminal state.* **No accounting rule was violated and no integrity defect was
found.** The block is throughput, and it is measured, not estimated.

**Scope limit.** Engineering evidence only. Mutation certification certifies that the asserted
executable behaviour is *asserted correctly*. It is **not U1 empirical validation**, it is not a
substitute for it, and it establishes **no registration readiness**.

---

## 1. Objective

Freeze the final mutation manifest against candidate `7410ec6c…`, stand up three provably isolated
workers, execute the exhaustive 458-mutant certification, and reconcile the result so that
`killed + survived + timeout + error + invalid == 458` or no total is produced at all.

## 2. What is established, and what is not

| Step | State |
|---|---|
| Candidate aggregate re-verified | **DONE** — `7410ec6c…`, 595 files, via the tree's own `toolingManifest()` |
| Manifest regenerated and **FROZEN** | **DONE** — 458 entries, `frozen: true`, file digest `e7f9d856…` |
| Partition: sizes, disjointness, exhaustiveness | **DONE and proved** — 153/153/152, empty pairwise intersections, every id in exactly one shard |
| TEMP isolation per worker | **DONE and proved twice** — pre-flight probe and the live process table |
| Clone aggregates verified **before** | **DONE** — all three `7410ec6c…` / 595 |
| Unmutated baseline, gate G7 / R12 | **DONE and PASSES** — `selftest: 1251 passed, 0 failed`; `adapter conformance: 18 passed, 0 failed` |
| Merge/reconciliation tool built and **tested** | **DONE** — 16 synthetic tests, 16 PASS, 0 FAIL |
| Exhaustive execution of all 458 | **INCOMPLETE — 16 of 458 at handback, still running** |
| Clone aggregates verified **after** | **NOT YET** — written by each wrapper only at seal time |
| `registered = terminal total` identity | **NOT PRODUCED** — and correctly so; see §7 |

## 3. Candidate aggregate re-verified

Re-derived with the tree's own `lib/aggregate.mjs` `toolingManifest()`, never
`xargs sha256sum | sha256sum`:

```
root      : C:/tmp/dt013-candidate/tooling
files     : 595
aggregate : 7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6
```

Protocol SHA `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` and registry SHA
`a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814`
(`tooling/rules/development_only_registry.json`) both re-derived and matching. Anchor precheck:
`anchors: 458/458 occur exactly once`. The two VOID aggregates `b9250356…` and `638d68e6…` were never
merged and were never read as evidence; both are firewalled in the frozen manifest and both refusals
are exercised by test, not merely declared. Full detail in `MANIFEST_FREEZE_RECORD.md`.

## 4. Manifest — count, ids, gaps, spec-hash stability, frozen digest

| Property | Value |
|---|---|
| entries | **458** |
| distinct ids | **458** |
| max id | **M484** |
| gaps | **exactly 26**: 23, 24, 25, 26, 225, 244, 280–299 |
| population identity | **484 − 26 = 458** |
| spec hashes distinct | 458 |
| spec hashes recomputable from the manifest alone | all 458 |
| `manifest_digest` | `168415b990ece6f4eaedb0522d08beb8b4d563776812626595b294f9156d3be7` |
| `partition_digest` | `fdb6938d7d3592e57060aed587307febc3ce1fecfef6ce2cef8cc663a7346805` |
| `frozen` | `true`, with `candidate_aggregate` bound in |
| **frozen file digest** | `e7f9d856ca60c15aed7b37e6893ccbd24b53aa6848695159e6f69575fef9fb8a` |

The generator was re-run **unchanged first** and needed no logic change: it derived 458 entries,
153/153/152 and the 5/0/0 adapter pin correctly. Only five hard-coded 441-era expectation constants
failed. They were turned into CLI options **whose defaults are the original literals**, plus a
`--freeze` flag, a generalised population-identity check, and the second VOID aggregate added to the
firewall. Proof the patch is confined to the expectation layer: re-running the patched generator with
no `--expect-*` flag reproduces the original's `mutants` array, `manifest_digest` and
`partition_digest` **byte-identically**. Diff at `generator.458.diff`.

### 4.1 Spec-hash stability vs the 441 set — 439 identical, 2 changed and explained

```
ids common      : 441          ids only in 441 : 0
ids only in 458 : 17  (M468–M484)
spec_hash CHANGED on a surviving mutant : 2   (M444, M457)
```

For both, `id`, `description`, `file` and `kind` are **unchanged**; only `anchor_sha256` and
`replacement_sha256` changed — i.e. the mutant **specifications** changed, not their ordering. Both are
deliberate and documented *in the candidate tree itself* as `M444 RE-POINTED (F4, same ID, same
mutant)` and `M457 RE-POINTED (F4b, same ID, same mutant)`, because upstream refactors removed the old
anchor text.

**Order-independence therefore holds.** The correct reading is the inverse of an alarm: a re-pointed
anchor that kept its old hash would have been the defect, since the old text no longer exists in the
refactored source and the mutant would silently fail its anchor precheck. Both pass `458/458`.

## 5. Shard sizes and disjointness proof

| Shard | Size | Adapters | Clone aggregate before |
|---|---|---|---|
| 0 | **153** | **5** (M254–M258, pinned) | `7410ec6c…` / 595 |
| 1 | **153** | 0 | `7410ec6c…` / 595 |
| 2 | **152** | 0 | `7410ec6c…` / 595 |

Computed, not asserted from the rule: all three pairwise intersections **empty**; union **458**; sum
**458**; **every id in exactly one shard**; all five adapter-kind mutants in partition 0 and none
elsewhere. Partition-local anchor lines `153/153`, `153/153`, `152/152` — which sum to 458, giving
`INVALID = 0` for the assigned population.

## 6. TEMP isolation proof per worker

Proved two independent ways, because the harness's own path guard **passes even when TEMP is shared**
and therefore proves nothing.

**Pre-flight** — a real child process with each worker's exact env reports its own `os.tmpdir()` and
creates a directory with the harness's own prefix; the wrapper refuses to start (exit 2) otherwise:

```
w0  os.tmpdir()=C:/tmp/dt015-mutrun/w0/temp  mkdtemp=C:\tmp\dt015-mutrun\w0\temp\cpg044-mut-AVqEgi
w1  os.tmpdir()=C:/tmp/dt015-mutrun/w1/temp  mkdtemp=C:\tmp\dt015-mutrun\w1\temp\cpg044-mut-pYEfNm
w2  os.tmpdir()=C:/tmp/dt015-mutrun/w2/temp  mkdtemp=C:\tmp\dt015-mutrun\w2\temp\cpg044-mut-B3CcZT
```

**Runtime** — the live process table mid-run, showing the actual harness placing actual workspaces:

```
node …\w0\temp\cpg044-mut-GOnNR4\test\selftest.mjs
node …\w1\temp\cpg044-mut-RLXHWJ\test\selftest.mjs
node …\w2\temp\cpg044-mut-sqtoOD\test\selftest.mjs
```

Three distinct workspaces under three distinct temp roots. A `tsx-lenovo` transform cache was also
observed created **inside `w0/temp`**, so even the adapter path's cache is isolated. Merge rule R13
re-checks pairwise distinctness at reconciliation. Also enforced: own clone, own output directory
**and** distinct filename `partition-<k>.json`, own log, and `CPG_U1_RESOLVER_CLONE` /
`CPG_U1_ADAPTER_CLONE` asserted **distinct by path** — the one check that matters, since both clones
sit at `f01a7eb4…` and are equally clean, so a swap is invisible to every harness guard. Detail in
`PARTITION_AND_ISOLATION_PROOF.md`.

## 7. Per-worker state at handback

All three launched 05:02:09–05:02:15Z on 2026-09-25 and were **still running** at handback.

| Shard | Assigned | Completed | Exit code | Clone agg. before | Clone agg. after |
|---|---|---|---|---|---|
| 0 | 153 | **5** | — still running | `7410ec6c…` / 595 | pending (written at seal) |
| 1 | 153 | **6** | — still running | `7410ec6c…` / 595 | pending (written at seal) |
| 2 | 152 | **5** | — still running | `7410ec6c…` / 595 | pending (written at seal) |

**16 of 458 complete. All 16 KILLED. Zero SURVIVED, zero TIMEOUT, zero ERROR, zero INVALID so far** —
but these are *interim harness lines, not a certification result*, and no rate is derived from them.

### 7.1 No totals are produced, and that is the design working

The merge was run against the live incomplete state. It refused:

```
MERGE REFUSED — rules failed: R1 PARTITION_PRESENT, R5 COVER_AND_DISJOINT, R7 EXACTLY_ONCE, R11 IDENTITY_SUM
No counts are emitted in a refusal.

status: BLOCKED     has counts field: false     has total_accounted field: false     has identity field: false
```

**The `registered = terminal total` identity line is deliberately absent.** A partial run is not
merely discouraged here — it is *unrepresentable* as a total, because the refusal document has no field
in which a count could appear. Accounting was not repaired by inference.

## 8. Why it is incomplete: measured throughput

| Measurement | Value |
|---|---|
| Single worker, no contention (smoke) | ~2.7 min/mutant; ~5.5 min for an adapter-kind mutant (two commands) |
| **Three workers concurrent, 30-min instrumented window** | **15.03 min/mutant/worker; 0.20 mutants/min aggregate** |
| Projected remaining at that rate | **~37 hours** |
| Phase 4 projection (quiesced) | 5 h 13 m |
| Phase 4 projection (contended) | 9 h 27 m |

```
CLEAN-BOX THROUGHPUT WINDOW
elapsed_s=1804  mutants_completed_across_all_3_workers=6  start_total=6  end_total=12
aggregate rate: 0.20 mutants/min      per-worker mean: 15.03 min/mutant
remaining=446   projected_remaining_hours=37.2
```

**Diagnosis: CPU saturation, not disk and not a harness fault.** `% Processor Time` pinned at **100%**
while `% Disk Time` sat at **4–5%**. The box has **2 physical cores / 4 logical**. Roughly half of it
is consumed by software this stream must not kill: VS Code (several processes), Chrome, Docker Desktop
(per project memory, Docker runs a production worker locally), WPS cloud service, and Claude Code
itself. Available memory fell to **2.8 GB**.

Note the consequence, which is the real finding: at 0.20 mutants/min aggregate, **three concurrent
workers deliver no more throughput than one** (a lone worker measured ~0.37 mutants/min). On this box
in its current state the 3-worker configuration is already past saturation. The Phase 4 measurement
that chose K = 3 and rejected K = 4 must have been taken on a substantially quieter machine.

**The machine could not be quiesced.** Quiescing would mean terminating the user's editor session,
browser and Docker Desktop. That is the user's call, not this stream's, and Docker in particular is
documented as hosting a production worker locally.

## 9. Survivors and non-KILLED mutants

**None observed in the 16 completed.** No survivor, timeout, error or invalid mutant exists to name.
This is **not** a clean-sweep claim: 442 of 458 have not run, and nothing about them is asserted here.

Positive evidence that the 16 kills are genuine rather than environment artefacts — gate G7:

```
selftest            : selftest: 1251 passed, 0 failed  (exit 0)
adapter conformance : adapter conformance: 18 passed, 0 failed  (exit 0)
G7 baseline pass    : true
```

The **unmutated** tree reports zero failures on both commands. `KILLED` requires the regex
`selftest: (\d+) passed, (\d+) failed` to match with a non-zero second group; a missing or dirty
resolver clone makes the child `stop()` before printing that line, so a broken environment lands in
`ERROR`, never `KILLED`. G7 closes the remaining case — a *partial* environment fault that still prints
a summary with failures. Each observed kill also carries a plausible, specific assertion count
(1 to 10), and one carries `includes a selftest crash` (M17).

## 10. Resolver clone: still clean, still without `node_modules`

Checked at handback, with the run in flight:

```
C:/tmp/dt013-resolver   HEAD=f01a7eb4199be4e04d4fee7fc0116303949dc553  dirty_lines=0  node_modules=absent
C:/tmp/dt015-adapter    HEAD=f01a7eb4199be4e04d4fee7fc0116303949dc553  dirty_lines=0  node_modules=present
```

The resolver clone is **clean and has no `node_modules`**, as required. The adapter clone is a separate
clone with `node_modules` including `tsx/dist/cli.mjs` and `undici` — the asymmetry that distinguishes
the two. `C:/tmp/dt013-candidate/tooling` re-verified at `7410ec6c…` / 595 files after the three clones
were taken. `C:/tmp/dt4-legal` untouched (mtime 2026-09-25 02:31, hours before this stream began). All
worker scratch is under `C:/tmp/dt015-mutrun/`.

## 11. Certification verdict

**BLOCKED.** Blocking rule: *any mutant lacks a terminal state.* 442 of 458 have no terminal state
because the run has not finished.

Explicitly **not** blocked by any of the other rules: no mutant appeared twice; no result belongs to
another candidate; no worker used the wrong candidate; no worker crashed; no accounting inconsistency
was found. The refusal is a completeness block, not an integrity failure.

### 11.1 To complete it

The frozen manifest, the three verified clones, the wrappers and the tested merge tool are all in
place, and the three workers are still running. Either let them finish (~37 h at the observed rate) or
— far better — **quiesce the box and restart the three workers**, which the measurements suggest would
bring it near the 5 h 13 m projection. Then:

```
node C:/tmp/dt015-mutrun/scripts/run_worker.mjs 0     # and 1, and 2, concurrently
node C:/tmp/dt015-mutrun/scripts/merge_partitions.mjs
```

A restart is safe and needs no re-freeze: each wrapper re-verifies its clone aggregate against the
frozen manifest before and after, and the merge refuses on any mismatch. Live worker PIDs are in
`RUN_STATE_SNAPSHOT.txt` should they need stopping.

## 12. Risks

1. **The run is unfinished, and no partial total may be quoted.** The only honest statement about kill
   coverage is that 16 of 458 have run. Any "16/16 killed" or rate derived from it would be a false
   green. The merge structurally cannot emit one.
2. **Three workers are still consuming this machine.** They will saturate the CPU for roughly 37 more
   hours unless stopped or the box is quiesced and they are restarted.
3. **Capacity planning for this box is wrong in the Phase 4 measurement.** K = 3 is past saturation
   here, delivering no more than K = 1. Any future scheduling that trusts 2.13 min/mutant on a
   contended box will overrun by ~6×.
4. **Adapter path exercised only once so far.** M254 was killed in the smoke test and G7's adapter
   conformance passes, but M255–M258 have not run. A systematic adapter fault would appear as ERROR,
   not as a silent omission.
5. **The parse is textual.** Outcomes are recovered from harness stdout by an anchored regex. The
   structural fix — a `--json` mode in `mutate.mjs` — would change the tooling aggregate and is
   correctly out of scope. Mitigation: R6 compares id **sets**, so a mis-parse shows up as a short
   partition rather than a silent loss.
6. **R12 placement deviates from the design** (run-level artefact rather than per-record). Substance
   unchanged; stated in `MERGE_TOOL_VALIDATION.md` rather than left implicit.
7. **Two spec hashes changed** vs the 441 set. Benign and explained (§4.1), but any future comparison
   against pre-F4 records must expect it, and R8 will refuse such a mixture — correctly.
