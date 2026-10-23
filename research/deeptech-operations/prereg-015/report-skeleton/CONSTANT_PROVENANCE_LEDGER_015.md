# CERT-015 — provenance ledger for the constants pre-filled into the certification skeleton

Companion to `MUTATION_CERTIFICATION_SKELETON_015.md`. Its purpose is narrow: for every value that
skeleton states as already established, record **who established it, where it is recorded, and how it
was checked here.** Nothing in this ledger is a run outcome. Verdict vocabulary and provenance classes
are those of the skeleton §0; `PASS` does not appear.

Checks were performed read-only on 2026-09-25 while the K=1 mutation run was executing. No file under
`C:/tmp/dt015-mutrun/` or `C:/tmp/dt013-candidate/` was created, modified or deleted; no mutation
script, selftest, `--anchors` pass or merge was executed.

## A. Independently recomputed here

| Constant | Value | Method | Verdict |
|---|---|---|---|
| Frozen manifest file digest | `e7f9d856ca60c15aed7b37e6893ccbd24b53aa6848695159e6f69575fef9fb8a` | `sha256sum` over `C:/tmp/dt015-mutrun/manifest/FINAL_MUTATION_MANIFEST_458.json` | `VERIFIED` — byte-for-byte match |
| Protocol document digest | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum` over `C:/tmp/dt013-candidate/CPG_U1_PROTOCOL_004.md` | `VERIFIED` — match |
| Development-only registry digest | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | `sha256sum` over `C:/tmp/dt013-candidate/tooling/rules/development_only_registry.json` | `VERIFIED` — match; the same value is recorded in the registration package as the registered `registry_sha256` |
| Registered population = 458 | 458 entries, 458 distinct ids | counted the manifest `mutants` array | `VERIFIED` |
| Shard counts = 153 / 153 / 152 | partitions 0 / 1 / 2 | tallied the per-entry `partition` field; compared with `partition_rule.target_sizes` and `actual_sizes` | `VERIFIED` — recount agrees with both |
| Adapter-kind mutants = 5 | `M254`–`M258`, all partition 0 | filtered `kind == "adapter"` | `VERIFIED` |
| Newly added mutants = 17 | `M468`–`M484`, contiguous | filtered id ≥ 468 and checked contiguity | `VERIFIED` |
| Treatment SHA | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | `git rev-parse HEAD` in `C:/tmp/dt013-resolver` and `C:/tmp/dt015-adapter` | `VERIFIED` — both clones at the same SHA |
| Both clones clean | 0 porcelain lines each | `git status --porcelain` in each clone | `VERIFIED` |
| Clones kept distinct | `C:/tmp/dt013-resolver` ≠ `C:/tmp/dt015-adapter` | distinct paths; roles distinct (`node_modules` absent vs present) | `VERIFIED` |
| U1 evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | `git rev-parse f01a7eb4…^{tree}` in the resolver clone; cross-read against protocol §7.1 (line 525) | `VERIFIED` — resolves to the stated tree |

## B. Accepted by recorded-value identity, not recomputed

| Constant | Value | Where recorded | Verdict |
|---|---|---|---|
| Candidate aggregate / tooling aggregate | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` | frozen manifest (`candidate_aggregate`, `tooling_aggregate`); `MERGE_REFUSED.json`; `baseline/BASELINE_ATTESTATION.json` (`clone_aggregate`); a sealed partition record (`clone_identity.aggregate_before` / `aggregate_after`) | `VERIFIED` for value identity across four independent records. Byte-level recomputation over 595 files was deliberately **not** run: CPU is the binding constraint during the live run. The run re-establishes it per worker, and merge rule R3 `CLONE_STABLE` refuses on drift. |
| Tooling file count | 595 | manifest `tooling_file_count`; baseline `clone_file_count`; sealed record `files_before` / `files_after` | `VERIFIED` for value identity across the same records |
| Manifest (population) digest | `168415b990ece6f4eaedb0522d08beb8b4d563776812626595b294f9156d3be7` | manifest `manifest_digest`; `MERGE_REFUSED.json`; sealed partition record | `VERIFIED` for value identity; the definition (`"<id>:<spec_hash>"` + LF per mutant, ordered by integer id) is recorded and order-independent |
| Partition digest | `fdb6938d7d3592e57060aed587307febc3ce1fecfef6ce2cef8cc663a7346805` | manifest `partition_digest`; `MERGE_REFUSED.json`; sealed partition record | `VERIFIED` for value identity |
| Provider configuration hash | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | registration errata; the CPG-U1 run ledger | `VERIFIED` for value identity. It is a composite over `registry/builtins.ts` + `coverageInventory.ts` evaluated at the U1 evaluation tree (protocol §13.1 / §7.1); recomputing it needs the resolver build inputs and was not attempted here. |
| Unmutated baseline (gate G7 / R12) | `selftest: 1251 passed, 0 failed`; `adapter conformance: 18 passed, 0 failed`; `g7_pass = true`; attested `2026-09-25T06:08:41.337Z` | `baseline/BASELINE_ATTESTATION.json` | `VERIFIED` as the content of the attestation artefact. **Not re-executed.** Re-running the selftest was out of scope and would contend for CPU with the live run. |
| Anchor precheck | `anchors: 458/458 occur exactly once`; `invalid_count = 0` | manifest `anchor_precheck` | `OBSERVATION ONLY` — read, not re-run; `--anchors` was explicitly excluded from this preparation |

## C. Authority and decision record

| Item | Record | Verdict |
|---|---|---|
| **DR-11 DECISION AUTHORITY: DELEGATED TO CLAUDE** / **DR-11 = ADOPT** | Carried forward into skeleton §2.4 as a **delegated decision**. No owner ruling on DR-11 exists, and none may be implied, cited or paraphrased. | `VERIFIED` as the standing delegated decision of record |
| Manifest narrative still carries 441-era wording | `freeze_precondition` calls `M468–M471` reserved and empty; `regeneration_on_dr11` speaks of *total 441 plus at most 4*; the determinism note says *441 ids*. The machine-checked fields and the recount here both give 458 with `max_allocated = M484` and no gaps at or above `M430`. | `OBSERVATION ONLY` — stale prose in narrative fields, not a population discrepancy. Do **not** reconcile it by changing a count. |
| A prior `MERGE_REFUSED` record exists | `status: BLOCKED`; `rules_failed` = R1, R5, R7, R11, R1's evidence being *sealed record absent (the crash signal)* | `OBSERVATION ONLY` — predates the current run; contributes nothing to the outcome or integrity sections |

## D. Everything else

Every field of skeleton §3 (per-worker execution), §4 (outcomes and the identity line), §4.2
(disposition), and every merge-rule verdict in §5 except the baseline-artefact read, is
`PENDING LIVE RUN`. None of those values exists yet, and this ledger records no substitute for any of
them.
