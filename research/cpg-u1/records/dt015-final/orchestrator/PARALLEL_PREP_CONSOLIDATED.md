# Read-only certification preparation — consolidated

**The live run was never touched.** No process stopped, paused, restarted or reniced; K, shards, manifest,
candidate, outputs, TEMP dirs and both clones untouched. No partial result interpreted as evidence.

Status vocabulary: `VERIFIED` · `NOT VERIFIED` · `BLOCKED` · `PENDING LIVE RUN` · `OBSERVATION ONLY`.

## 1. Candidate identity — VERIFIED

All eight frozen identities measured independently, read-only: candidate aggregate
`7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` over **595** files · protocol
`c50fc680…b719` · treatment commit `f01a7eb4…c553` · evaluation tree `3b4811fc…67af` · treatment
aggregate `ffe4f603…d1c5` (11552 files) · registry `a1392952…0814` · provider configuration
`c9a7e9aa…7561`. All three worker clones independently hash to `7410ec6c…`/595. Bonus: `test/mutate.mjs`
on disk is byte-identical to the manifest's recorded `mutate_source.sha256`.

**The authorised-change boundary is ATTESTED, NOT DIFFED — and cannot be diffed retroactively.** No
predecessor `b9250356…` tree exists on disk. The indirect evidence is strong (across 441 shared ids in 30
target files, only **M444** and **M457** changed anchor text, both inside the authorised six; the six
approved files are the six newest, in a 17-minute block **4h49m** after the newest non-approved file), but
it is not a diff: it says nothing about the other 565 files, mtimes are settable, and `b9250356…` is known
only from records this programme wrote. **The candidate's own identity, by contrast, is measured.**

## 2. Manifest — VERIFIED structurally; prose defective

Digest `e7f9d856…fb8a` ✅ · 458 entries / 458 distinct ids ✅ · `frozen: true` ✅ · shards 153/153/152 ✅ ·
pairwise disjoint ✅ · union exhaustive ✅ · gaps exactly the 26 retired ids, `484 − 26 = 458` ✅ ·
`manifest_digest` and `partition_digest` both recomputed and matching ✅ · candidate bound inside matches
the live candidate ✅ · **M468–M471 populated** by the four DR-11 mutants ✅.

**Spec hashes: 458 of 458 recomputed, 0 mismatches** — the whole population, not a sample, since
recomputation needs no file reads. The partition rule was independently re-implemented from the manifest's
own prose: **0 mismatches in 458**.

**M444/M457 expectation CONFIRMED** — exactly two shared ids changed spec hash, both deliberate re-points
keeping id, description, file and kind; 17 ids added (M468–M484); none removed.

Prose defects are recorded in `MANIFEST_ERRATUM.md` and the manifest is **not edited** (it is frozen and
the run is bound to it). The sharpest is `reserved_block_empty`: measured `undefined`, with
`reserved_not_allocated: []` — the predicate ranges over an **empty set** and is true by construction.
**Evidence of nothing**, and indistinguishable from a verified true at a glance.

## 3. Merge / accounting assurance — VERIFIED as code; PENDING LIVE RUN as result

The chain proving `registered = exactly one terminal state each`: manifest defines registered → **R2**
identity binding → **R4/R5** shard sets cover and never overlap → **R1/R6** sealed record present and its
returned id set equals its assigned set → **R7** each id exactly once globally → **R9/R10** five states
only, INVALID single-producer → **R11** arithmetic backstop. Counts derive only from the merged per-mutant
table, never from a worker figure.

**The exit-code hazard is closed** — `merge_partitions.mjs:201` treats exits 0 **and** 1 as normal
completion, no other rule reads `exit_code`, the wrapper always exits 0, and the driver is a `for` loop, not
an `&&` chain. Completeness is by **id-set equality in both directions**, so counts cannot coincide while
membership differs.

### Two limits that change how the result must be read

**A `KILLED` does not necessarily mean an assertion caught anything.** `selftest.mjs:77-83` prints a
summary with `failed > 0` and forces exit 1 even on a crash; `mutate.mjs:596` then classifies that as
`KILLED`, merely tagging `crash: true`. **No merge rule aggregates that flag**, so `counts.KILLED` mixes
assertion-kills with crash-kills. **This is already live: one crash-kill has occurred in the first 27
results.** The per-mutant data survives in `per_mutant[].line`, so before any kill rate is quoted the two
must be reported separately.

**A `COMPLETE` merge does not prove the mutants ran.** The merge's own test suite demonstrates three wholly
fabricated records yielding `COMPLETE` with 458 KILLED. Only R8 (re-deriving spec hashes from each worker's
actual clone) and R12 touch real artefacts; `log_sha256`/`ndjson_sha256` were never implemented, so **no
digest binds a sealed record to its log**. A COMPLETE document attests accounting consistency and identity
binding — **not authenticity of measurement**, which rests on logs, timings and operator custody.

Nine further gaps (G1–G9) recorded unrepaired, including a one-word fix where R10 compares against a
self-reported count rather than the R4-pinned id list.

## 4. Final-report readiness — PREPARED

A skeleton and a constant-provenance ledger exist, with frozen constants filled and every
execution-dependent field marked `PENDING LIVE RUN`. The outcome table **structurally cannot render a
partial total**: no sum cell exists, the single total slot transcribes the merge's R11 verdict (which on a
partial run is a refusal, not a number), and per-state counts fill only from the merged ledger, so a missing
shard leaves all five cells pending at once rather than four numbers and a silent zero.

DR-11 is carried as `DR-11 DECISION AUTHORITY: DELEGATED TO CLAUDE` / `DR-11 = ADOPT`, explicitly a
**delegated decision with no owner ruling**, which may not be implied, cited or paraphrased as one.

## 5. Environment / throughput — OBSERVATION ONLY

| | |
|---|---|
| completed | **27 of 458** (shard 0 of 153) |
| measured rate | ~0.16–0.18 mutants/min |
| projection | ~41–44 h |
| dominant consumer | VS Code, **64,000+ CPU-seconds** across three processes |
| free RAM | 0.82 GB at peak prep load → **4.88 GB** now the audits have exited |

**Worker count is nearly irrelevant on this box; ambient load is everything** — K=3 measured 0.20/min and
K=1 measured 0.164–0.178/min, within noise of each other. The only material lever is reducing ambient load,
and the largest single item is VS Code, not Docker (6,300s, and it runs a production worker locally).

**The preparation work measurably slowed the experiment** — free RAM fell to 0.82 GB while three audit
agents ran, which risks environmental `ERROR` verdicts rather than false kills. It has since recovered. No
further parallel work should run against a live certification on this machine.

## 6. Discrepancies

| id | what | status |
|---|---|---|
| E-1 | `freeze_precondition` says M468–M471 "empty … not implemented" while all four are allocated | recorded, unrepaired |
| E-2 | `reserved_block_empty` vacuous — `undefined`, over an empty set | recorded, unrepaired |
| E-3 | stale "441" in ≥4 narrative fields of a 458-entry manifest | recorded, unrepaired |
| E-4 | `required_environment.CPG_U1_ADAPTER_CLONE` says "No such clone exists yet"; it does | recorded, unrepaired |
| D-4 | my own `sample.sh` broken by `grep -c` exiting 1 on no match | monitoring only, no effect on the run |
| G1–G9 | merge hardening gaps | recorded, unrepaired |

**Stream D's Risk 6 — resolved.** It observed worker starts at 05:02Z in a snapshot versus shard 0 starting
06:45:05Z, and correctly flagged a possible mix of attempts without investigating. I performed both, so:
**05:02Z was the terminated K=3 attempt, 06:45:05Z is the K=1 restart.** Verified that no cross-run
contamination is possible: w1 and w2 output dirs are **empty**, and w0 holds only
`partition-0.SMOKE.json` — while both the wrapper (`run_worker.mjs:15`) and the merge
(`merge_partitions.mjs:31`) use `partition-<k>.json`. **The smoke record cannot be picked up: different
filename.** The K=3 attempt sealed nothing, because wrappers seal only at the end.

## 7. Post-run action items — none to be done now

1. **Audit `per_mutant[].line` for `includes a selftest crash`** and report assertion-kills and crash-kills
   **separately**. One has already occurred.
2. Carry `MANIFEST_ERRATUM.md` with the manifest in the evidence package; fix
   `generate_manifest.458.mjs:156` and the vacuous `reserved_block_empty` (`:31`, `:106`) for **future**
   manifests — the latter should fail, not pass, on an empty expectation set.
3. Close merge gaps G1–G9, starting with G5 (one word) and G3 (unguarded `JSON.parse` yields no refusal
   artefact).
4. Verify `CERT015_BASE` is unset or correct at the certifying invocation — it can retarget the merge.
5. Recovery from a mid-run death is a **shard re-run**, never a manual seal: the attestation instrument for
   manual sealing (NDJSON + log digests) was never implemented.
6. Preserve the candidate tree if a diffable change boundary is ever expected — it cannot be reconstructed.

---

**`FINAL MUTATION CERTIFICATION = BLOCKED / PENDING LIVE RUN`** — 27 of 458 have a terminal state. No total,
no rate, no `PASS`. The completed results are evidence of nothing beyond themselves.
