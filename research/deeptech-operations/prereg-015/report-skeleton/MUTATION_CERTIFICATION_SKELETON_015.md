# FINAL MUTATION CERTIFICATION — CERT-015 (SKELETON)

**FINAL MUTATION CERTIFICATION = BLOCKED / PENDING LIVE RUN**

This header may not be changed until **every one of the 458 registered mutants carries exactly
one terminal state** in the merged per-mutant ledger, and the merge tool has emitted rule **R11
`IDENTITY_SUM`** as satisfied. Until then this document is a container, not a certification.

- Document class: skeleton prepared **before** the run completed. Structure and frozen constants only.
- Programme: DEEPTECH-PARALLEL-015 (CERT-015), phase 4 mutation certification of the CPG-U1 tooling candidate.
- Prepared: 2026-09-25, read-only, while the K=1 run was executing. **No live artefact was modified.**
- Scope limit (binding, restated in full at §7): engineering evidence only. Mutation certification
  certifies that **asserted executable behaviour is asserted correctly**. It is not U1 empirical
  validation and it establishes **no registration readiness**.

---

## §0 How to read the fields

**Verdict vocabulary — the only five tokens permitted anywhere in this document:**

| Token | Meaning |
|---|---|
| `VERIFIED` | Independently checked by the stated method; the method is named in the same row. |
| `NOT VERIFIED` | Checkable in principle, not checked. Never a substitute for a failure. |
| `BLOCKED` | Cannot be concluded because a precondition is unmet. |
| `PENDING LIVE RUN` | Depends on execution that had not completed when this skeleton was written. |
| `OBSERVATION ONLY` | Recorded because it was seen; carries no certification weight. |

`PASS` is not in the vocabulary and must not be introduced. Nothing that depends on incomplete
execution may ever be described as passing.

**Provenance classes — every filled value carries one:**

| Class | Meaning |
|---|---|
| `[F]` FROZEN-PRE-RUN | Established and frozen before any mutant executed. Filled in this skeleton. |
| `[R]` RUN-EMITTED | Written by a worker into its sealed partition record. Arrives from the run. |
| `[M]` DERIVED-AT-MERGE | Computed by `scripts/merge_partitions.mjs` across all K sealed records. |
| `[S]` SKELETON-STRUCTURE | Prose, rule text or scaffolding; asserts no measurement. |

A later reader can therefore tell, for every value on the page, whether it predates the run or came
out of it.

---

## §1 Candidate

| Field | Value | Provenance | Verdict |
|---|---|---|---|
| Candidate path | `C:/tmp/dt013-candidate/tooling` | `[F]` | `VERIFIED` — recorded identically in the frozen manifest, the baseline attestation and a sealed partition record |
| Candidate is the tooling tree | yes; `candidate_aggregate` and `tooling_aggregate` are the same value by construction | `[F]` | `VERIFIED` — manifest `aggregate_note` |
| File count | **595** | `[F]` | `VERIFIED` — manifest `tooling_file_count`, baseline `clone_file_count`, sealed-record `files_before`/`files_after` all read 595 |
| Candidate aggregate | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` | `[F]` | `VERIFIED` (recorded-value identity across four independent frozen records; byte-level recomputation deliberately not run — §8.1) |
| Tooling aggregate | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` | `[F]` | `VERIFIED` — same value, same records |
| Aggregate definition | CPG_U1_PROTOCOL_004 §19.1 / §24 via `lib/aggregate.mjs`: sha256 over `"<sha256>  <relative/path>"` lines, LF-terminated, sorted by path, over **every** file including vendored dependencies | `[F]` | `VERIFIED` — quoted from the manifest |
| Protocol document | `CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `[F]` | `VERIFIED` — recomputed with `sha256sum`; matches |
| Treatment / resolver SHA | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | `[F]` | `VERIFIED` — `git rev-parse HEAD` in both clones |
| U1 evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | `[F]` | `VERIFIED` — `git rev-parse f01a7eb4^{tree}` equals it; the protocol names it at §7.1 |
| Development-only registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | `[F]` | `VERIFIED` — recomputed over `tooling/rules/development_only_registry.json`; matches |
| Provider configuration hash | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | `[F]` | `VERIFIED` (recorded-value identity in the registration errata and the run ledger; a composite over `registry/builtins.ts` + `coverageInventory.ts` per protocol §13.1, not recomputed here) |

### §1.1 Tooling identity of the execution environment

| Field | Value | Provenance | Verdict |
|---|---|---|---|
| Resolver clone | `C:/tmp/dt013-resolver` — role `CPG_U1_RESOLVER_CLONE`, HEAD `f01a7eb4…`, porcelain lines 0, `node_modules` absent | `[F]` | `VERIFIED` — `git rev-parse` plus `git status --porcelain` (0 lines) |
| Adapter clone | `C:/tmp/dt015-adapter` — role `CPG_U1_ADAPTER_CLONE`, HEAD `f01a7eb4…`, porcelain lines 0, `node_modules` present, `tsx` CLI present, `undici` present | `[F]` | `VERIFIED` — same method; dependency presence read from a sealed record |
| Clones kept distinct | `clone_paths_distinct = true`; the resolver clone is dependency-free, the adapter clone carries dependencies | `[F]` | `VERIFIED` — distinct paths; merge rule R13 re-checks this per shard |
| Unmutated baseline (gate G7 / rule R12) | `selftest: 1251 passed, 0 failed` (exit 0); `adapter conformance: 18 passed, 0 failed` (exit 0); attested `2026-09-25T06:08:41.337Z`; `g7_pass = true` | `[F]` | `VERIFIED` — read from `baseline/BASELINE_ATTESTATION.json`; **not re-executed here** |

The baseline exists to exclude the one remaining way a broken environment could be mistaken for a
kill: a partial environment fault that still prints a summary line containing failures.

---

## §2 Manifest

| Field | Value | Provenance | Verdict |
|---|---|---|---|
| Manifest file | `C:/tmp/dt015-mutrun/manifest/FINAL_MUTATION_MANIFEST_458.json` | `[F]` | `VERIFIED` |
| Frozen | `frozen = true`; the population is bound to the candidate aggregate and may not change | `[F]` | `VERIFIED` |
| File digest of the manifest | `e7f9d856ca60c15aed7b37e6893ccbd24b53aa6848695159e6f69575fef9fb8a` | `[F]` | `VERIFIED` — recomputed with `sha256sum`; matches |
| Manifest digest (population digest) | `168415b990ece6f4eaedb0522d08beb8b4d563776812626595b294f9156d3be7` — sha256 over `"<id>:<spec_hash>"` + LF per mutant, ordered by integer id | `[F]` | `VERIFIED` — recorded in the manifest and re-asserted in every sealed record |
| Partition digest | `fdb6938d7d3592e57060aed587307febc3ce1fecfef6ce2cef8cc663a7346805` — sha256 over `"adapter-pinned-stride-v1|K=<K>"` + LF then `"<id>:<partition>"` + LF per mutant | `[F]` | `VERIFIED` — recorded value |
| Registered population | **458** | `[F]` | `VERIFIED` — counted the `mutants` array: 458 entries, 458 distinct ids |
| Shard counts | **153 / 153 / 152** (partitions 0 / 1 / 2) | `[F]` | `VERIFIED` — recounted from the per-entry `partition` field; matches `target_sizes` and `actual_sizes` |
| Partition rule | `adapter-pinned-stride-v1`: stage 1 pins every `kind == "adapter"` mutant to partition 0 in ascending id order; stage 2 deals the remainder cyclically, skipping any partition already at target | `[F]` | `VERIFIED` — quoted; recomputable from the manifest alone |
| Adapter-kind mutants | 5 — `M254, M255, M256, M257, M258`, all in partition 0 | `[F]` | `VERIFIED` — recounted |
| Anchor precheck at this candidate | `anchors: 458/458 occur exactly once`; `invalid_count = 0` | `[F]` | `OBSERVATION ONLY` — read from the manifest record; **not re-run here** (`--anchors` was out of scope for this preparation) |

### §2.1 Exhaustiveness

- Highest allocated id `M484`; 26 retired ids absent below `M430`
  (`23, 24, 25, 26, 225, 244, 280–299`); **no gaps at or above `M430`**; no reserved-but-unallocated ids.
- Population identity recorded and self-checked in the manifest: `max_allocated − gaps = total = 458`;
  404 ids at or below `M430` plus 54 above it. Provenance `[F]`, verdict `VERIFIED` (recounted).
- The manifest's own `checks` block reports nine structural checks satisfied with `failed_checks: []`.
  Provenance `[F]`, verdict `VERIFIED` (read, with the counts independently recounted).

### §2.2 Disjointness

- Each id is inserted into the assignment map exactly once; the generator throws if the map is not
  total or if the sizes do not sum to the total. The only ordering used is ascending integer id — no
  hashing, no randomness, no filesystem order. Provenance `[F]`, verdict `VERIFIED` (rule text read;
  sizes recounted; every entry also carries its computed partition, so a verifier compares rather
  than trusts).
- Disjointness is **re-established from the run's own outputs** at merge by R5 `COVER_AND_DISJOINT`
  and R7 `EXACTLY_ONCE`. Those verdicts are `PENDING LIVE RUN` (§5).

### §2.3 Recorded wording that predates the present population — `OBSERVATION ONLY`

Some narrative fields of the frozen manifest still carry pre-expansion (441-mutant) wording:
`freeze_precondition` describes `M468–M471` as *reserved, contiguous and empty*, the
`regeneration_on_dr11` procedure speaks of *total 441 plus at most 4*, and the determinism note says
*all 441 ids are distinct integers*. The machine-checked fields of the same document report
`total = 458`, `distinct_ids = 458`, `max_allocated = M484` and no gaps at or above `M430`, and the
independent recount performed for this skeleton agrees with 458. This is stale prose in narrative
fields, not a population discrepancy; it is recorded so that no reader reconciles it by adjusting a
count.

### §2.4 DR-11

**DR-11 DECISION AUTHORITY: DELEGATED TO CLAUDE.** **DR-11 = ADOPT.**

DR-11 (the `cpg_u1_data.mjs` scan `byId` collapse) was decided under **delegated** authority and
adopted. This is a delegated decision and **must never be described, cited or paraphrased as an owner
ruling**; no owner ruling on DR-11 exists. The adoption is what made the manifest-regeneration path
live, and the regenerated frozen manifest is the 458-entry document identified above. Any later
document restating DR-11 must preserve the delegation.

---

## §3 Execution

Run shape: **K = 1** (`--jobs 1` per worker), three workers, one shard each, under
`C:/tmp/dt015-mutrun/`. Every `[R]` field is read from that worker's **sealed** partition record; a
worker that did not seal a record has no row to fill, and its absence is a finding, not a blank.

### §3.1 Per-worker / per-shard block

Nothing in this block may be filled from another worker's record.

| Field | w0 | w1 | w2 | Provenance |
|---|---|---|---|---|
| Worker identity (directory) | `C:/tmp/dt015-mutrun/w0` | `C:/tmp/dt015-mutrun/w1` | `C:/tmp/dt015-mutrun/w2` | `[F]` `VERIFIED` |
| Shard id | 0 | 1 | 2 | `[F]` `VERIFIED` |
| Assigned mutation count (from the manifest) | 153 | 153 | 152 | `[F]` `VERIFIED` (recounted) |
| `assigned_count` in the sealed record | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `per_mutant_count` returned | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `started_utc` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `ended_utc` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `duration_ms` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `exit_code` / `signal` / `exit_code_meaning` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `worker_crashed` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `anchor_line` / `anchor_failures` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Candidate identity carried — `candidate_aggregate` = `7410ec6c…f752c6` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` compared against `[F]` |
| Candidate identity carried — `tooling_aggregate`, `tooling_file_count` = 595 | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` compared against `[F]` |
| Manifest identity carried — `manifest_file`, `manifest_digest` = `168415b9…6d3be7` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` compared against `[F]` |
| Manifest identity carried — `partition_digest` = `fdb6938d…346805` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` compared against `[F]` |
| Clone identity — `aggregate_before` / `files_before` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Clone identity — `aggregate_after` / `files_after` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Clone unchanged by the run (`unchanged_by_the_run`, `equals_candidate_before_and_after`) | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| TEMP isolation — `os_tmpdir`, `TEMP`, `TMP` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| TEMP isolation — `mkdtemp_dir`, `mkdtemp_dir_is_under_this_workers_dir` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| TEMP isolation — `mkdtemp_dir_is_under_no_other_worker`, `machine_default_tmpdir_not_used`, `harness_path_guard_passes` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| TEMP isolation — `other_workers_temp_dirs` enumerated | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Resolver clone block (`path`, `head`, `porcelain_lines`, `node_modules_present`) | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` compared against §1.1 |
| Adapter clone block (`path`, `head`, `porcelain_lines`, `node_modules_present`, `tsx_cli_present`, `undici_present`) | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` compared against §1.1 |
| `clone_paths_distinct` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Invocation (`cwd`, `argv`, `jobs`, `env_delta`) | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Output identity — expected `output_path` | `…/w0/out/partition-0.json` | `…/w1/out/partition-1.json` | `…/w2/out/partition-2.json` | `[F]` |
| Output identity — record present and **sealed** | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Output identity — `log_path` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| Partition-local harness summary line | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` |
| `returned_ids` all belong to this shard | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `PENDING LIVE RUN` | `[R]` / `[M]` |

**Partition-local totals are not run totals.** The sealed record names its own summary field
`harness_summary_line_PARTITION_LOCAL_NOT_A_RUN_TOTAL`. That line must be transcribed with its
partition-local meaning intact and may never be added by hand to another shard's line. The only
cross-shard arithmetic permitted anywhere in this certification is the merge tool's own (§4.1).

### §3.2 TEMP isolation — why per-worker evidence is required

`os.tmpdir()` resolves `TEMP` then `TMP` on Windows, and the harness creates every mutant workspace
with `mkdtempSync(join(tmpdir(), …))` behind its own path guard. Setting `TEMP` and `TMP` per worker
therefore isolates every mutant workspace inside that worker's directory. Each sealed record must show
its own `mkdtemp_dir` under its own worker directory, under **no** other worker's directory, and must
show the machine default temp directory unused. Merge rule R13 `ISOLATION_DISTINCT` re-checks pairwise
distinctness across shards. Provenance `[S]` for the mechanism, `[R]` for the evidence.

---

## §4 Outcomes

The five terminal states are **exactly** `KILLED`, `SURVIVED`, `TIMEOUT`, `ERROR`, `INVALID`. There is
no `skipped`, `n/a` or `not-relevant` bucket, and none may be added.

| Terminal state | Source of the classification | Count |
|---|---|---|
| `KILLED` | the child exited non-zero with code 1 and its summary line reported a non-zero failed count | `PENDING LIVE RUN` |
| `SURVIVED` | the child exited zero | `PENDING LIVE RUN` |
| `TIMEOUT` | `err.killed` or `err.signal` set; per-command timeout 3 600 000 ms (60 minutes) | `PENDING LIVE RUN` |
| `ERROR` | any other non-zero exit, including a precondition stop inside the child (exit 2) and a harness exception. **A broken environment lands in `ERROR`, never in `KILLED`.** | `PENDING LIVE RUN` |
| `INVALID` | the anchor-precheck state: the anchor string does not occur exactly once in its target file, so the mutant is refused before execution | `PENDING LIVE RUN` |

**This table has no total row, and one may not be added.** Three independent structural mechanisms
make a partial total unrenderable:

1. **There is no sum cell.** The grid ends at `INVALID`; the only numeric column is the per-state
   count. Adding a "Total" row is a structural edit to this certification, not a data entry, and this
   paragraph prohibits it.
2. **The sum is not a number this document computes.** The run total exists in exactly one place —
   the identity line in §4.1 — and its value is not an arithmetic result a filler may write. It is a
   **transcription slot** for the merge tool's rule **R11 `IDENTITY_SUM`** verdict, which
   `merge_partitions.mjs` emits only when `terminalTotal === registered` **and** the merged
   per-mutant ledger holds exactly `registered` rows. On a partial run the tool lists `R11` under
   `rules_failed` and returns `BLOCKED`, and that refusal — not a number — is what goes in the slot.
   A partial run therefore has no total to transcribe.
3. **Per-state counts are transcriptions too.** Each count cell is filled only from the merged
   ledger, never from a shard record. A missing shard leaves all five cells at `PENDING LIVE RUN`
   simultaneously, so there is no state in which four cells hold numbers while a fifth is quietly
   treated as zero.

### §4.1 The identity line

> **terminal-state total = registered population**

| Field | Value | Provenance |
|---|---|---|
| Registered population | 458 | `[F]` `VERIFIED` |
| Merged per-mutant ledger row count | `PENDING LIVE RUN` | `[M]` |
| Mutants carrying exactly one terminal state | `PENDING LIVE RUN` | `[M]` |
| R11 `IDENTITY_SUM` verdict (transcribed, never computed here) | `PENDING LIVE RUN` | `[M]` |
| Terminal-state total | `PENDING LIVE RUN` — writable **only** once R11 is satisfied | `[M]` |

Until the last two rows are filled from a satisfied R11, the header of this document stays at
**BLOCKED / PENDING LIVE RUN**, and no number written anywhere in §4 may be characterised as a run
total.

### §4.2 Survivor and non-kill disposition

Every `SURVIVED`, `TIMEOUT`, `ERROR` and `INVALID` outcome is itemised here, one row each, with mutant
id, file, description, shard and disposition — `PENDING LIVE RUN`. An empty itemisation becomes
meaningful only once §4.1 is satisfied; before then, emptiness means *unknown*, not *none*.

---

## §5 Integrity

Each claim is discharged by a named merge rule over the **sealed** shard records. The rule set and its
names are `[F]` (read from `scripts/merge_partitions.mjs`); every verdict is `[M]` and
`PENDING LIVE RUN`, because every rule reads run output.

| Integrity claim | Discharged by | Verdict |
|---|---|---|
| **No duplicates** — no mutant result appears twice, within a shard or across shards | R5 `COVER_AND_DISJOINT`, R7 `EXACTLY_ONCE` | `PENDING LIVE RUN` |
| **No omissions** — every registered id has a result; no orphan, no id without a result | R5 `COVER_AND_DISJOINT`, R6 `NO_SHORT_PARTITION`, R7 `EXACTLY_ONCE`, R11 `IDENTITY_SUM` | `PENDING LIVE RUN` |
| **No cross-candidate results** — every record carries the bound candidate aggregate; superseded aggregate prefixes are firewalled | R2 `IDENTITY_MATCH`, R3 `CLONE_STABLE` | `PENDING LIVE RUN` |
| **No cross-manifest results** — every record carries the frozen manifest digest and partition digest, and every result is bound to its manifest `spec_hash` | R2 `IDENTITY_MATCH`, R8 `SPEC_BOUND` | `PENDING LIVE RUN` |
| **No wrong-shard results** — every returned id belongs to the shard that returned it | R4 `ASSIGNMENT_MATCH`, R5 `COVER_AND_DISJOINT` | `PENDING LIVE RUN` |
| **No unsealed or partial result accepted** — an absent sealed record is the crash signal; a short partition and a crashed worker are refusals, not gaps | R1 `PARTITION_PRESENT`, R6 `NO_SHORT_PARTITION`, R14 `WORKER_NOT_CRASHED` | `PENDING LIVE RUN` |
| Terminal states are exactly the five, with no extra bucket | R9 `TERMINAL_STATE` | `PENDING LIVE RUN` |
| `INVALID` mutants are accounted and never also carry an execution result | R10 `INVALID_ACCOUNTED` | `PENDING LIVE RUN` |
| Unmutated baseline attested (gate G7) | R12 `BASELINE_ATTESTED` | `VERIFIED` for the attestation artefact as read (§1.1); the merge-time re-check is `PENDING LIVE RUN` |
| TEMP dirs, clone paths and the resolver/adapter pair all distinct | R13 `ISOLATION_DISTINCT` | `PENDING LIVE RUN` |

### §5.1 A prior merge attempt exists — `OBSERVATION ONLY`

A `MERGE_REFUSED` record predates the current run: `status: BLOCKED`, `rules_passed` =
R2, R3, R4, R6, R8, R9, R10, R12, R13, R14, `rules_failed` = R1, R5, R7, R11, with R1's evidence
reading *sealed record absent (the crash signal)* for the shard outputs. It is recorded here only to
show that the merge gate does refuse and that a refusal is what an incomplete run produces. It is
**not** a result of the current run and contributes nothing to §4 or §5.

---

## §6 Standing caveat — the 17 newly added mutants

**17 of the 458 mutants are newly added, and their kills are reasoned, not yet measured.** They are
`M468`–`M484`, contiguous and without gaps:

| Id | Shard | File | What it restores or probes |
|---|---|---|---|
| `M468` | 1 | `cpg_u1_data.mjs` | duplicate scan results not refused (the `byId` collapse restored) |
| `M469` | 2 | `cpg_u1_data.mjs` | a pair of scan results not counted as a duplicate |
| `M470` | 0 | `cpg_u1_data.mjs` | duplicate scan result reported without its own contamination reasons |
| `M471` | 1 | `cpg_u1_data.mjs` | duplicate scan result reported without its own `held_out_ineligible_by_scan` |
| `M472` | 2 | `cpg_u1_data.mjs` | F3 defect restored: a supplied but missing resolver clone silently becomes "no clone supplied" |
| `M473` | 0 | `cpg_u1_data.mjs` | POSITIVE CONTROL: genuine absence of a clone turned into a refusal instead of `NOT_COMPARED` |
| `M474` | 1 | `cpg_u1_data.mjs` | the supplied-but-missing refusal does not name where the path came from |
| `M475` | 2 | `lib/registration.mjs` | F1 defect restored: the checkpoint sentinel compared raw (padded / mis-cased sentinel misrouted to the format error) |
| `M476` | 1 | `lib/registration.mjs` | the checkpoint prerequisite blocker removed entirely |
| `M477` | 2 | `lib/registration.mjs` | F4b defect restored: the pipe guard short-circuits classification, so `identity.registration_id` is absent |
| `M478` | 1 | `lib/registration.mjs` | the `registration_id` pipe refusal dropped now that classification runs first |
| `M479` | 2 | `lib/identity.mjs` | POSITIVE CONTROL: ZWNJ/ZWJ swallowed again, so legitimate Persian/Indic names are MALFORMED |
| `M480` | 1 | `lib/identity.mjs` | U+200B zero-width space no longer refused (the ZWNJ narrowing over-applied) |
| `M481` | 2 | `lib/identity.mjs` | `attestation.method` identifier-screened again, so a truthful method sentence is refused for a word it contains |
| `M482` | 1 | `lib/identity.mjs` | attestation prose fields not screened at all, so an empty method confers authority |
| `M483` | 2 | `lib/identity.mjs` | blanket lexical refusal restored (Na/None/Test/Mock forbidden again) |
| `M484` | 1 | `lib/identity.mjs` | POSITIVE CONTROL: authority / `resolved_by` prose-screened, so a placeholder authority confers authority |

Provenance `[F]` for the ids, shards, files and descriptions (read from the frozen manifest and
recounted: 17 entries with id ≥ 468); `PENDING LIVE RUN` for every outcome.

**Consequence for reading §4.** For these 17, the expectation of a kill rests on reasoning about the
assertions, not on any prior measurement. **A survivor among `M468`–`M484` is therefore a genuine
finding — a real gap in what the suite asserts — and not a formality to be waved through.** The three
POSITIVE CONTROLS (`M473`, `M479`, `M484`) invert a correct behaviour into an over-strict one: if one
of them survives, the suite is not asserting the permissive half of that rule at all. Every such
survivor must be itemised in §4.2 and dispositioned on its own merits before this document may be
characterised as anything other than `BLOCKED`.

---

## §7 Evidence boundary

This section governs every other section. Where any summary, abstract or downstream citation appears
to say more than this section allows, this section is what the certification means.

**Engineering verification.** Someone built the tooling and checked their own work: the selftest suite
runs, the adapter conformance suite runs, the unmutated tree reports zero failures, the clone
aggregates are stable, the temp directories are isolated. This is the weakest of the four claims and
the easiest to mistake for the others. It says: the thing runs, and the people who wrote it believe it
runs correctly. It is evidence about the artefact's internal consistency and about nothing else.

**Mutation certification.** This document. Mutation certification establishes exactly one thing: that
**asserted executable behaviour is asserted correctly** — that where the suite claims to detect a
defect, a deliberately reintroduced instance of that defect is in fact detected, and that the
detection is bound by hash to this candidate, this manifest and this shard. It says nothing whatever
about **whether the right things were asserted**: a behaviour no assertion covers has no mutant,
produces no survivor, and leaves no trace here, so an absence of survivors is never evidence of
completeness. It says nothing about **whether the documentation is true**: no mutant can catch a false
README, a prose claim that overstates a capability, or a protocol paragraph describing behaviour the
code does not have. And it says nothing about **whether the instrument measures what U1 claims to
measure**: killing a mutant in `lib/sampling.mjs` shows that the sampling assertions notice a broken
sampler, not that the sampling design answers the U1 question. A 458/458 kill result would be a
statement about assertions, in one tree, on one machine, at one moment.

**Independent validation.** Someone who did not build the tooling, and whose judgement is not
downstream of the builders', reproducing the behaviour and reaching their own conclusion. No part of
this certification is independent validation. Every artefact cited here was produced inside the same
effort that produced the tooling, by the same authority, on the same machine. A reader who wants
independence must obtain it separately; they will not find it in this document, and no accumulation of
internal evidence converts into it.

**Actual U1 empirical evidence.** Human enumerators, real companies, the registered protocol executed
against the frozen dataset, and the resulting ratings and analysis. **None of that has happened
here.** This certification concerns the *instrument*, not any *measurement* made with it. A fully
killed mutation population does not produce, substitute for, approximate or license any claim about
U1 efficacy, U1 results or U1 conclusions.

**Therefore, in plain terms:** a complete pass of this certification would mean *the suite's
assertions bite*. It would not mean the suite is complete, that the documents are true, that anyone
independent has agreed, or that U1 has produced a single empirical finding. **This document claims no
registration readiness** and must not be cited as establishing it. Anyone tempted to read the outcome
table as validation should re-read this section; that is what it is here for.

---

## §8 Fill-in protocol

### §8.1 The candidate aggregate was not recomputed here

The 595-file aggregate was accepted by recorded-value identity across four independent frozen records
(the frozen manifest, the merge-refusal record, the baseline attestation and a sealed partition
record), not by recomputation. Recomputation over 595 files was deliberately not run: CPU is the
binding constraint while the run executes, and every cycle spent here slows the run being certified.
The run performs its own equivalent check — each worker records `aggregate_before` and
`aggregate_after` for its clone, and merge rule R3 `CLONE_STABLE` refuses on drift. When the run
completes, those `[R]` fields supersede this note.

### §8.2 Order of filling

1. Confirm all K sealed records exist at the expected `output_path`s. A missing record is the crash
   signal (R1); the correct action is to record `BLOCKED`, not to merge what is present.
2. Fill §3.1 per worker, strictly from that worker's own record.
3. Run the merge across all K records; transcribe its rule verdicts into §5 and its ledger counts
   into §4.
4. Fill §4.1 only from a satisfied R11. If R11 is not satisfied, leave the terminal-state total
   `PENDING LIVE RUN` and leave the header `BLOCKED / PENDING LIVE RUN`.
5. Itemise §4.2, checking the 17 newly added mutants of §6 individually.
6. Only then consider changing the header — and even a satisfied header changes nothing in §7.

### §8.3 What may never be filled

- No count may be inferred, interpolated, or carried over from an earlier run, a smoke run, or the
  superseded merge refusal of §5.1.
- No partition-local number may be presented as a run number.
- No `PASS` token may be introduced.
- No section may be deleted to make the document read more cleanly; an unmet field stays visible.
