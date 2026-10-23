# AUDIT C — MERGE / ACCOUNTING FORENSICS (CERT-015)

**Read-only audit. Nothing was modified. Nothing was executed against the live run.**
Status vocabulary used here: `VERIFIED` · `NOT VERIFIED` · `BLOCKED` · `PENDING LIVE RUN` ·
`OBSERVATION ONLY`. The word `PASS` is never used for any property that depends on execution which
has not finished.

Artefacts read (all read-only):

| Path | Role |
|---|---|
| `C:/tmp/dt015-mutrun/scripts/merge_partitions.mjs` | the reconciliation implementation (R1–R14) |
| `C:/tmp/dt015-mutrun/scripts/run_worker.mjs` | what a worker seals, and when |
| `C:/tmp/dt015-mutrun/scripts/test_merge.mjs` | the merge tool's own synthetic suite |
| `C:/tmp/dt015-mutrun/scripts/baseline.mjs`, `verify_manifest.mjs`, `verify_agg.mjs`, `run_k1.sh`, `sample.sh` | supporting tools |
| `C:/tmp/dt015-mutrun/manifest/FINAL_MUTATION_MANIFEST_458.json` | the frozen population (metadata only) |
| `C:/tmp/dt015-mutrun/baseline/BASELINE_ATTESTATION.json` | gate G7 / rule R12 input |
| `C:/tmp/dt015-mutrun/MERGE_REFUSED.json` | a prior refusal, as evidence of refusal behaviour |
| `C:/tmp/dt014-final/phase4/RESULT_ACCOUNTING.md` | the design this implements |
| `C:/tmp/dt013-candidate/tooling/test/mutate.mjs`, `test/selftest.mjs` | `classify()` and terminal-state logic |

---

## 1. The population being reconciled

`FINAL_MUTATION_MANIFEST_458.json`: `frozen: true`, 458 entries, 458 distinct ids, 458 distinct
`spec_hash`, every entry carries `partition ∈ {0,1,2}`, shard sizes `153/153/152`, candidate and
tooling aggregate both `7410ec6c…` over 595 files, `manifest_digest 168415b9…`,
`partition_digest fdb6938d…`, `protocol_sha256 c50fc680…`. The five adapter-kind mutants
(`M254`–`M258`) are all pinned to partition 0, so the single adapter clone is never used by two
processes at once. 458 = the earlier 441 plus the 17 ids `M468`–`M484`.

`K` in the live run means **concurrency 1**, not one shard: `run_k1.sh` runs shards 0,1,2
**sequentially**. The merge is fixed at three partitions (`const K = 3;`).

---

## 2. The mechanical proof chain for `registered = exactly one terminal state each`

The claim is established by a chain of five links. Each link is a distinct rule; none is redundant
with another, and R11 is a deliberate arithmetic backstop over the whole chain.

```
manifest (458 ids, frozen)            ← the definition of "registered"
   │  R2  every record's manifest_digest / partition_digest / candidate_aggregate /
   │      tooling_aggregate / tooling_file_count / protocol_sha256 == the manifest's
   ▼
per-shard ASSIGNMENT
   │  R4  set(record.assigned_ids) == set(manifest ids with partition == record.shard_id)
   │  R5  ⋃ assigned_ids == set(manifest ids)  ∧  pairwise intersections empty  ∧  no duplicate
   ▼
per-shard RETURN
   │  R1  a sealed record file exists for every k ∈ {0,1,2}
   │  R6  set(record.returned_ids) == set(record.assigned_ids), equal cardinality,
   │      and no id repeated inside the shard
   ▼
GLOBAL ONE-RESULT-PER-ID
   │  R7  across all records, each manifest id appears in exactly one per_mutant entry
   │      (no id twice, no orphan id absent from the manifest, no manifest id without a result)
   ▼
STATE OF EACH RESULT
   │  R9  every per_mutant.outcome ∈ {KILLED, SURVIVED, TIMEOUT, ERROR, INVALID}
   │  R10 no id is both anchor-INVALID and carries a result; every shard's anchor line reads n/n
   ▼
ARITHMETIC BACKSTOP
      R11 killed+survived+timeout+error+invalid == 458  ∧  per_mutant rows == 458
```

Only `R11` is arithmetic. Every completeness statement above it is a **set** statement. The identity
line printed on success is derived from the merged per-mutant id table, never from any harness
summary line:

```js
// merge_partitions.mjs:1-4
// Every count is derived from the merged per-mutant id table, never from a harness summary line
// (those are partition-local after --only).
```

```js
// merge_partitions.mjs:218
const identityLine = `registered ${registered} = killed ${counts.KILLED} + survived ${counts.SURVIVED} + timeout ${counts.TIMEOUT} + error ${counts.ERROR} + invalid ${counts.INVALID} = ${terminalTotal}`;
```

`registered` is `man.mutants.length` — the frozen manifest, not anything a worker reported.

**Status of the chain as written: VERIFIED by code reading.** Whether it holds on the live data is
`PENDING LIVE RUN`.

---

## 3. Each rule and the property it enforces

| Rule | Enforces | Mechanism | Trusts |
|---|---|---|---|
| R1 `PARTITION_PRESENT` | no partition is silently absent | `existsSync` of `w<k>/out/partition-<k>.json` for k=0,1,2 | filesystem |
| R2 `IDENTITY_MATCH` | no cross-candidate / cross-manifest mixing; the two void aggregates cannot enter | field equality against the manifest + forbidden-prefix screen on `638d68e6`/`b9250356` | record fields **copied from the same manifest** |
| R3 `CLONE_STABLE` | the worker's tree did not drift during the run and equals the candidate before and after | `aggregate_before == aggregate_after == CAND`, `files == 595` | **worker's self-reported** aggregates (really computed, lines 31/112, but not re-verified by the merge) |
| R4 `ASSIGNMENT_MATCH` | a shard ran its own id set | set equality vs `manifest.mutants.filter(partition == shard_id)` | record's `shard_id` |
| R5 `COVER_AND_DISJOINT` | the three assignments exactly cover the 458 and overlap nowhere | union set equality + pairwise intersections + duplicate scan | — |
| R6 `NO_SHORT_PARTITION` | no mutant silently vanishes; none appears twice inside a shard | `set(returned_ids) == set(assigned_ids)`, cardinality, `indexOf` duplicate scan | the parsed per-mutant lines |
| R7 `EXACTLY_ONCE` | exactly one result per registered id, globally; no orphan | `Map` of id → occurrences over all records | — |
| R8 `SPEC_BOUND` | the worker executed the mutant the manifest *describes*, not merely one with the same id | re-reads `test/mutate.mjs` **from each worker's own clone**, re-derives `CPG-U1-MUTSPEC-v1`, compares to `manifest.spec_hash` for every assigned id | the clone path the record names |
| R9 `TERMINAL_STATE` | five states, nothing else; no skipped / n-a / not-relevant bucket | `TERMINAL.includes(outcome)` over every row | — |
| R10 `INVALID_ACCOUNTED` | INVALID is produced only by the anchor precheck and never coexists with a result; every shard anchor-checked all of its own mutants | `ANCHOR?` line scrape + `anchors: n/n` regex with `n == assigned_count` | `assigned_count` (see gap G5) |
| R11 `IDENTITY_SUM` | the arithmetic identity, as an independent backstop | `Σ counts == 458` **and** `per_mutant.length == 458` | — |
| R12 `BASELINE_ATTESTED` | an unmutated tree in this environment reports zero failures, so a broken environment cannot be mistaken for a kill | reads `baseline/BASELINE_ATTESTATION.json`: `selftest_failed == 0`, `adapter_conformance_failed == 0`, `clone_aggregate == CAND` | a single point-in-time artefact |
| R13 `ISOLATION_DISTINCT` | three workers did not share a TEMP, a clone, or one resolver/adapter path | pairwise-distinct normalised `os_tmpdir` and clone paths + each record's own isolation proof booleans | worker-recorded proof (a real child probe, worker lines 60-86) |
| R14 `WORKER_NOT_CRASHED` | a crash is never converted to a pass | `worker_crashed !== true ∧ signal === null ∧ exit_code ∈ {0,1}` | record fields |

R1–R14 are **all** evaluated; the refusal document lists every failing rule, so one merge attempt
diagnoses the whole run. The existing `MERGE_REFUSED.json` demonstrates exactly this
(`rules_failed: R1,R5,R7,R11`, `rules_passed` R2,R3,R4,R6,R8,R9,R10,R12,R13,R14 over the records that
were present). **OBSERVATION ONLY:** in a refusal, a rule can appear in `rules_passed` having been
satisfied only *vacuously* over the subset of records present. That is a reading hazard, not a
false green — `status` is `BLOCKED` and no count of any kind is emitted.

**Refusals carry no arithmetic — VERIFIED:**

```js
// merge_partitions.mjs:241-245
  // A refusal carries evidence and NO arithmetic. No count, no rate, no total.
  writeFileSync(BASE + '/MERGE_REFUSED.json', JSON.stringify({
    document: 'MERGE_REFUSED', status: 'BLOCKED', ...common, failures,
    note: 'No count, total or kill rate is emitted in a refusal document. Accounting is never repaired by inference.',
```

Confirmed on the artefact: `MERGE_REFUSED.json` has neither `counts` nor `total_accounted`.

---

## 4. The five terminal states and their producers

`merge_partitions.mjs:13` — `const TERMINAL = ['KILLED', 'SURVIVED', 'TIMEOUT', 'ERROR', 'INVALID'];`

Four of the five come from one total function in the candidate harness. `classify()` has no path that
returns nothing:

```js
// C:/tmp/dt013-candidate/tooling/test/mutate.mjs:592-599
    const classify = ({ err, stdout }, re) => {
      const m = re.exec(stdout || '');
      if (!err) return { outcome: 'SURVIVED', failed: 0, code: 0 };
      if (err.killed || err.signal) return { outcome: 'TIMEOUT', failed: null, code: err.code };
      if (m && Number(m[2]) > 0 && err.code === 1) return { outcome: 'KILLED', failed: Number(m[2]), code: 1, crash: /SELFTEST CRASHED/.test(stdout || '') };
      return { outcome: 'ERROR', failed: null, code: err.code };
    };
```

and every harness-level exception is funnelled into `ERROR` rather than dropped:

```js
// mutate.mjs:607-609
      } catch (e) {
        done({ name, outcome: 'ERROR', failed: null, code: null, harnessError: e.message });
```

| State | Producer | Exhaustiveness argument |
|---|---|---|
| `KILLED` | `classify`: child exited code 1 **and** its summary line reported `failed > 0` | requires a *positive* failure signal; the environment cannot supply it by being broken (§7) |
| `SURVIVED` | `classify`: `!err`, i.e. the child exited 0 | |
| `TIMEOUT` | `classify`: `err.killed || err.signal` (per-command timeout 3 600 000 ms) | also absorbs any signal-kill and `maxBuffer` overflow — see OBSERVATION below |
| `ERROR` | `classify` final `return` — the **explicit catch-all**: any other non-zero exit, a child `stop()` (exit 2), a harness exception | this is the total-function terminator: no fifth branch and no fall-through exists |
| `INVALID` | **the anchor precheck only**, never `runMutant` | `mutate.mjs:566-571` |

```js
// mutate.mjs:566-571 — the INVALID producer, and the whole-shard consequence
for (const [name, file, from] of MUTATIONS) {
  const count = readFileSync(join(ROOT, file), 'utf8').split(from).length - 1;
  if (count !== 1) { failedAnchors++; console.log(`  ANCHOR?  ${name} (${count}x in ${file})`); }
}
console.log(`anchors: ${MUTATIONS.length - failedAnchors}/${MUTATIONS.length} occur exactly once`);
if (anchorsOnly || failedAnchors) process.exit(failedAnchors ? 1 : 0);
```

The manifest states the same contract explicitly, including the absence of a discard bucket:

> `"INVALID": "NOT emitted by runMutant. It is the anchor-precheck state … The accounting layer
> records them as INVALID so the five states stay exhaustive. There is no \"not relevant\" bucket."`

**No silent-exclusion bucket exists — VERIFIED.** The merge rejects any other string, including the
literal case the suite exercises (`test_merge.mjs:93` sets an outcome to `'not relevant'` and expects
an R9 refusal), and the rule carries the claim in its own evidence:

```js
// merge_partitions.mjs:155
rule('R9', 'TERMINAL_STATE', badState.length === 0, { non_terminal: badState, allowed: TERMINAL, note: 'no skipped / n-a / not-relevant bucket exists' });
```

There is also no `partial` status: on any failure the emitted document has no field in which a count
could appear, so a partial run is unrepresentable as a total.

### 4.1 `INVALID` is fail-closed, and therefore unreachable in a `COMPLETE` document

`OBSERVATION ONLY` (a representation finding, not a false-green): because the anchor precheck exits
**before any mutant runs**, one bad anchor voids that shard's entire measurement. That shard seals
with `per_mutant: []`, so `R6` (empty returned set), `R7` (152–153 manifest ids with no result),
`R10` (`anchors: n-1/n` fails the `n == n` test) and `R11` all refuse. Consequently the `INVALID`
row in `counts`, the `invalid` array and the `INVALID` term of the identity line **can never be
non-zero in a `COMPLETE` document**. This matches the design's intent
(`RESULT_ACCOUNTING.md` R10: "Any INVALID present ⇒ status `NOT_RUNNABLE` … no kill total is
printed"), but it means `INVALID` functions in practice as a *shard-void signal*, not as a
per-mutant terminal state. The 457 innocent mutants in a voided shard are not `INVALID`; they are
simply unmeasured, and the merge refuses rather than reporting them. Fail-closed: correct. The
manifest records `anchors: 458/458 occur exactly once` and `invalid_count: 0` at this candidate, so
this path is not expected to fire.

### 4.2 Two further state-attribution observations

- **`TIMEOUT` absorbs more than timeouts.** `err.killed || err.signal` is tested before anything
  else, so an OOM kill, an operator kill of a child, and a `maxBuffer` overflow (Node kills the child
  and sets `killed`) all land in `TIMEOUT`. `RESULT_ACCOUNTING.md §6.3` asserts `maxBuffer` overflow
  "maps to `ERROR`"; by the order of the branches above it lands in `TIMEOUT`. Both are non-KILLED
  and reported, so nothing is hidden — the design note is simply inaccurate. `OBSERVATION ONLY`.
- **A `KILLED` may be a crash rather than an assertion** (§8.1).

---

## 5. Exit code versus semantic terminal state — the established hazard

The hazard: *a harness may exit non-zero on legitimate `SURVIVED`, so a shell `&&` must never be the
completeness mechanism.* The harness does exactly that:

```js
// mutate.mjs:631
process.exit(survivors.length || timeouts.length || errors.length ? 1 : 0);
```

### Question 1 — if a worker exits 1 because one mutant survived, does the merge still accept its partition?

**YES. VERIFIED.** Three independent places make this so.

```js
// merge_partitions.mjs:199-204
// 0 and 1 are both normal completions. 2 is a precondition failure and 3+ / any signal is a crash.
// A worker failure is a worker failure and is never converted to a pass.
const crashed = recs.filter((r) => r.worker_crashed === true || r.signal !== null || ![0, 1].includes(r.exit_code));
rule('R14', 'WORKER_NOT_CRASHED', crashed.length === 0, …
```

`1` is inside the accepted set. No other rule reads `exit_code`. The worker records the semantics
alongside the number, so the distinction is preserved in the evidence rather than inferred:

```js
// run_worker.mjs:164-167
  exit_code_meaning: closed.code === 0 ? '0 = every mutant in this partition was KILLED'
    : closed.code === 1 ? '1 = the partition COMPLETED NORMALLY with at least one non-KILLED outcome (or a failed anchor precheck). This is NOT a crash.'
      : closed.code === 2 ? '2 = precondition failure'
        : 'unexpected exit code ' + closed.code + … ' = WORKER CRASH',
```

The wrapper's own status is deliberately decoupled from the harness's, so even a careless shell could
not read a survivor as a failure:

```js
// run_worker.mjs:179-181
// This wrapper's own exit status reflects only whether the WRAPPER completed. The harness exit code
// lives in the sealed record and must be read from there, never inferred from this status.
process.exit(0);
```

And the driver does not chain on success — it is a loop with the hazard written into its own comment:

```sh
# scripts/run_k1.sh
# K=1: shards run SEQUENTIALLY, one concurrent worker. Exit 1 = normal completion
# with >=1 non-KILLED, NOT a crash -- so never chain with && or a survivor skips later shards.
for K in 0 1 2; do
  echo "=== SHARD $K start $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
  node scripts/run_worker.mjs "$K"
  echo "=== SHARD $K end   $(date -u '+%Y-%m-%dT%H:%M:%SZ') exit=$? ==="
done
```

The only `&&` in the shell layer is inside `sample.sh`'s read-only monitoring `count()`. No `&&`
gates any shard, any seal or any rule. The merge tool's own suite pins the behaviour as a
regression test (`test_merge.mjs:99-107`): a record with `exit_code: 1`, one `SURVIVED` and one
`ERROR` must still yield `status: COMPLETE` with `KILLED 456`.

**The hazard is closed. VERIFIED.**

### Question 2 — if a worker dies after its last mutant but before sealing, is that detectable?

**YES, it is detected as a refusal — but it is not *distinguishable* from dying earlier, and the
design's forensic instrument for that distinction was not built.**

Detection:

```js
// merge_partitions.mjs:30-37
for (let k = 0; k < K; k++) {
  const p = BASE + '/w' + k + '/out/partition-' + k + '.json';
  if (!existsSync(p)) { missing.push({ k, path: p, reason: 'sealed record absent (the crash signal)' }); continue; }
  …
}
rule('R1', 'PARTITION_PRESENT', missing.length === 0 && recs.length === K, { missing, found: recs.map((r) => r.shard_id) });
```

The record is written once, at the very end, after the post-run aggregate re-check
(`run_worker.mjs:112` then `:176 writeFileSync(OUT, …)`). Its absence is the signal, and the merge
refuses on R1 with the missing `k` and path named. Reconstruction after such a death is possible only
from `w<k>/logs/partition-<k>.log`, which is streamed line by line during the run
(`run_worker.mjs:106-107`).

Three qualifications, all `OBSERVATION ONLY` / gaps:

1. **The design's NDJSON stream does not exist.** `RESULT_ACCOUNTING.md §1` specifies
   `w<k>/out/partition-<k>.ndjson`, "appended per mutant, flushed each time … survives a crash and
   names exactly how far the worker got", and §2 permits a manual seal from a *complete* NDJSON whose
   `ndjson_sha256` is recorded. `run_worker.mjs` writes no NDJSON, and the record carries neither
   `ndjson_sha256` nor `log_sha256`. So the sanctioned manual-seal path has lost its attestation
   mechanism; re-running the partition is the only defensible recovery, which the design already
   prefers.
2. **"Sealed record absent" is no longer the *only* crash signal.** The design says the wrapper
   "refuses to seal" on a harness crash or any disagreement. The implementation always seals and
   always exits 0. A harness that dies mid-run (an unhandled rejection exits 1) therefore produces a
   *present* record with a short `per_mutant` array — caught by R6/R7/R11, not by R1. Net outcome is
   the same (no `COMPLETE`), and this is precisely why completeness must rest on id sets.
3. **A truncated seal produces neither document.** `JSON.parse` at `merge_partitions.mjs:33` (and
   `:21`, `:178`) is unguarded. A record truncated by a crash mid-`writeFileSync` throws an uncaught
   `SyntaxError`: the merge dies with a stack, emits **no** `MERGE_REFUSED.json`, and writes no
   `COMPLETE`. Fail-closed, but the absence of a refusal artefact must not be read as anything at
   all.

---

## 6. Set versus count comparison

Every completeness decision is by **set**. Counts appear only as evidence and as R11's backstop.

```js
// merge_partitions.mjs:69
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
```

```js
// merge_partitions.mjs:94-105  — "(id SETS, never counts)"
for (const r of recs) {
  const want = new Set(r.assigned_ids);
  const got = new Set(r.returned_ids);
  const miss = [...want].filter((x) => !got.has(x));
  const extra = [...got].filter((x) => !want.has(x));
  const dup = r.returned_ids.filter((x, i) => r.returned_ids.indexOf(x) !== i);
  if (miss.length || extra.length || dup.length || got.size !== want.size) { … }
}
```

Membership is therefore compared in both directions plus cardinality plus within-shard duplication.
Counts cannot coincide while membership differs, because `miss` and `extra` are computed
independently of any length.

- **A mutant id the worker was never assigned** → appears in `extra` (R6) and, if it is not in the
  manifest at all, in `orphan_ids_not_in_manifest` (R7). If it belongs to *another* shard it also
  trips R7's `appearing_more_than_once`. **Caught.**
- **A mutant id the worker omits** → appears in `miss` (R6) and in
  `manifest_ids_with_no_result` (R7), and breaks R11. **Caught.** `test_merge.mjs:91` exercises a
  52-mutant silent drop and expects R6+R7+R11.
- `assigned_count` and `per_mutant_count` are **evidence only** — no decision reads them except R10
  (see gap G5). A record that lied about its own counts while keeping honest arrays would change
  nothing.
- R11 is the only count rule, and it is deliberately redundant:
  `terminalTotal === registered && perMutant.length === registered`.

**Set-based comparison: VERIFIED.**

---

## 7. Failure modes — each one, and whether it is caught

| # | Failure mode | Caught by | Status |
|---|---|---|---|
| 1 | duplicate records (same id from two shards) | R7 `appearing_more_than_once`; also R5 `non_empty_intersections` / R6 `extra` when assignment overlaps | VERIFIED (suite: `test_merge.mjs:92`) |
| 2 | duplicate record *within* one shard | R6 `duplicated_within_shard` (`indexOf` scan) | VERIFIED |
| 3 | missing records (dropped mutants) | R6 `missing`, R7 `manifest_ids_with_no_result`, R11 | VERIFIED (suite: `:91`) |
| 4 | wrong candidate aggregate | R2 field equality; worker also hard-pins `EXPECT_AGG` and exits 2 | VERIFIED (suite: `:87`) |
| 5 | wrong tooling aggregate / file count / protocol sha | R2 | VERIFIED (suite: `:88`) |
| 6 | wrong manifest digest / partition digest | R2 equality — **as disagreement between record and manifest, not as manifest self-consistency**; `verify_manifest.mjs` recomputes `manifest_digest` and all 458 `spec_hash` but is a *separate* tool the merge does not invoke | VERIFIED for mixing; see gap G1 |
| 7 | wrong shard assignment | R4 set equality vs the manifest's partition-k set; R5 cover + pairwise disjoint | VERIFIED (suite: `:90`) |
| 8 | void / superseded aggregate `b9250356…` | R2 equality **and** the `FORBIDDEN` prefix screen (lines 47-51), which fires even if the manifest itself were the void one | VERIFIED (suite: `:87`) |
| 9 | void / superseded aggregate `638d68e6…` | same, on `candidate_aggregate` and `tooling_aggregate` | VERIFIED (suite: `:88`) |
| 10 | partial worker completion (short run) | R6 by id set, R7, R11. Never by exit code | VERIFIED |
| 11 | a crashed worker (signal / exit ≥ 3) | R14 `signal !== null` or `exit_code ∉ {0,1}`; the design and the record agree a crash is never converted to a pass | VERIFIED (suite: `:97`) |
| 12 | worker never launched / died before sealing | R1 (sealed record absent) | VERIFIED; forensic *granularity* degraded — §5 Q2 |
| 13 | precondition failure (harness exit 2, zero results) | R14 (strictly: `2 ∉ {0,1}`) **and** R6 (empty returned set) | VERIFIED (suite: `:98`) |
| 14 | **worker exit code independent of semantic terminal state** | R14 accepts 0 and 1; completeness rests on R1+R6+R7; the wrapper always exits 0; the driver uses a loop, not `&&` | VERIFIED — §5 |
| 15 | clone drift during the run | R3 (`aggregate_before == aggregate_after == CAND`, 595 files) — self-reported; see gap G2 | VERIFIED as an accounting rule (suite: `:89`) |
| 16 | id-level substitution (same id, different specification) | R8 re-derives `CPG-U1-MUTSPEC-v1` from each worker's own `test/mutate.mjs` and compares to the manifest | VERIFIED (suite: `:116`) |
| 17 | non-terminal / invented outcome string | R9 | VERIFIED (suite: `:93`) |
| 18 | anchor-INVALID mutant also credited with a result | R10 `invalid_that_also_have_a_result`; R7 independently | VERIFIED |
| 19 | shared TEMP / shared clone / resolver==adapter | R13, backed by a real child-process `mkdtempSync` probe in each worker | VERIFIED (suite: `:95`, `:96`) |
| 20 | broken environment forging kills | closed at the child: `selftest.mjs:57-67` `stop()`s with **exit 2** on an unset / missing / wrong-HEAD / dirty resolver clone, and the `process.on('exit')` summary handler is registered *after* that block, so no summary is printed and `classify` yields `ERROR`, never `KILLED`. R12/G7 closes the residual partial-fault case | VERIFIED by code reading; R12 input `selftest: 1251 passed, 0 failed`, `adapter conformance: 18 passed, 0 failed`, attested 06:08:41Z, before the 06:45Z shard-0 start |
| 21 | unmutated baseline not attested | R12 (refuses when the artefact is absent or non-zero) | VERIFIED (suite: `:94`) |
| 22 | harness summary line promoted to a run total | no rule reads it; it is stored under the field name `harness_summary_line_PARTITION_LOCAL_NOT_A_RUN_TOTAL` | VERIFIED |
| 23 | recap lines double-counted (`  TIMEOUT: M123 …`) | the parse regex requires whitespace immediately after the outcome token, which a `:` fails; a duplicate would anyway trip R6/R7 | VERIFIED |
| 24 | truncated / corrupt sealed record | **NOT caught as a refusal** — uncaught `JSON.parse` throw; no document is written | gap G3, fail-closed |
| 25 | fabricated records that never ran anything | **NOT caught** — inherent; see §8.2 and gap G4 | NOT VERIFIED (out of the tool's reach) |

---

## 8. WHAT THE CERTIFICATION CANNOT PROVE

A `MERGED_MUTATION_RESULT.json` with `status: COMPLETE` and 458 `KILLED` would **not** establish any
of the following. This list is deliberately unflattering.

### 8.1 That a `KILLED` verdict reflects a *meaningful* assertion
`KILLED` requires only that the child exited 1 and printed `selftest: N passed, M failed` with
`M > 0`. A mutation that makes the selftest **throw** satisfies this, because the crash handler
counts itself as a failure:

```js
// selftest.mjs:76-83
process.on('exit', (code) => {
  if (summaryPrinted) return;
  console.log(`\nselftest: ${pass} passed, ${failures.length + 1} failed`);
  …
  console.log(`  FAIL: SELFTEST CRASHED (exit ${code}) — see stderr`);
  process.exitCode = 1;
});
```

`classify` records this as `KILLED` with `crash: true`, and the per-mutant line carries
`; includes a selftest crash`. The merge preserves that text in `per_mutant[].line` but **no rule
separates crash-kills from assertion-kills, and `counts.KILLED` mixes them**. The harness's own
"of which with a selftest crash: N" figure is retained per shard as a partition-local string and is
never aggregated. A crash-kill shows that the mutation broke the suite, not that a specific property
was asserted about it. Recoverable from the evidence; not certified by the result.

### 8.2 That any mutant actually ran
Every field R2, R3, R4, R13 and R14 compare is **self-reported by the worker** and, for R2, copied
verbatim from the same manifest the merge re-reads. The merge reaches real artefacts in exactly two
places: R8 (re-parses `test/mutate.mjs` from the clone path *the record names*) and R12 (reads the
baseline file). Nothing cryptographically binds a sealed record to the log that was streamed while it
ran — the design's `log_sha256` and `ndjson_sha256` were not implemented. The merge's own suite is
the proof of this limit: `test_merge.mjs` fabricates three records with no execution whatsoever and
the merge emits `COMPLETE` with 458 `KILLED`. **A `COMPLETE` document attests accounting consistency
and identity binding. It does not attest authenticity of measurement.** Authenticity rests on the
logs, the timings and operator custody of `C:/tmp/dt015-mutrun/`.

### 8.3 That the mutant population is adequate
The result certifies **only the 458 mutants registered**. It says nothing about behaviour no mutant
targets. The per-file distribution is uneven by design (`cpg_u1_data.mjs` 64, `lib/harness.mjs` 45 …
`lib/cpgExecutor.mjs` 2), and 26 retired ids are permanently absent. A 458/458 kill rate is a
statement about a chosen sample, not about the tree.

### 8.4 That documentation claims are true
Documentation is not executable. No mutant can be constructed to catch a false README, a wrong
protocol narrative, or a mis-stated limitation. `RESULT_ACCOUNTING.md` itself contains two claims
that the code contradicts (`maxBuffer` → `ERROR`, §4.2; "the wrapper refuses to seal", §5 Q2-2) — a
live demonstration that prose is unguarded by this mechanism.

### 8.5 That behaviour never asserted is correct
Mutation testing detects the removal of **asserted** behaviour only. A mutant that changes
behaviour no assertion covers `SURVIVED`s; a mutant in a region with no assertions at all is
indistinguishable from one whose behaviour genuinely does not matter. `SURVIVED` is a statement
about the suite, not about the mutation's importance.

### 8.6 That the 17 newest mutants are measured
`M468`–`M484` (458 − 441) are new in this wave, and their kills are, at the time of writing,
**reasoned, not yet measured**. Until this run completes and merges, every claim about them is an
argument, not evidence. Any interim statement about them is `PENDING LIVE RUN`.

### 8.7 That the environment stayed sound for the whole run
R12 is a single point-in-time attestation taken at 06:08:41Z. The workers record the resolver and
adapter clone `head`/`porcelain_lines` **only before** the run, and no rule asserts those values
(gap G6). A mid-run change to the shared, un-isolated `C:/tmp/dt013-resolver` would surface as
`ERROR` outcomes in the normal case (the child `stop()`s with exit 2 — §7 row 20), but the narrow
case of a *partial* fault that still prints `failed > 0` is closed by nothing after 06:08Z.

### 8.8 The boundary, stated plainly
Mutation certification is **engineering evidence that asserted executable behaviour is asserted
correctly**. It is **not independent human validation** and **not U1 empirical evidence**. It
implies no registration readiness. Both the manifest and every artefact carry that sentence:

```js
// merge_partitions.mjs:237
  scope_limit: 'ENGINEERING EVIDENCE ONLY. Mutation certification certifies that the asserted executable behaviour is asserted correctly. It is NOT U1 empirical validation, and it establishes no registration readiness.',
```

---

## 9. Gaps found — all UNREPAIRED (this audit is read-only)

| Gap | Where | Effect | Direction |
|---|---|---|---|
| **G1** | the merge never asserts `man.frozen === true`, never recomputes `manifest_digest`, and never checks `man.partition_rule.partitions === K` | a manifest edited together with its own digest would pass R2. Mitigated *outside* the merge: `verify_manifest.mjs` recomputes the digest and all 458 spec hashes, and `run_worker.mjs:23` exits 2 on `frozen !== true` | not fail-closed inside the merge; closed by a separate step that must be run and cited |
| **G2** | R3 trusts the record's self-reported `aggregate_before/after` | the worker's clone is still on disk and R8 already reads from `clone_identity.path`; the merge could recompute the aggregate itself and does not | trust, not fail-closed |
| **G3** | unguarded `JSON.parse` at `merge_partitions.mjs:21/33/178` | a truncated record or baseline file kills the merge with a stack and produces **no** `MERGE_REFUSED.json` | fail-closed (no `COMPLETE`), but no refusal artefact |
| **G4** | no digest binds a sealed record to its streamed log (`log_sha256`, `ndjson_sha256` from the design were not implemented; no NDJSON exists) | a `COMPLETE` document cannot be tied to the evidence that produced it; the design's manual-seal path loses its attestation | inherent limit, see §8.2 |
| **G5** | `R10`'s anchor check uses the record's self-reported `assigned_count` (`Number(m[2]) === r.assigned_count`) rather than `r.assigned_ids.length`, which R4 has already pinned to the manifest | a record with a tampered `assigned_count` and a matching tampered `anchor_line` could satisfy R10 | forgery-only; one-word fix |
| **G6** | no rule binds `resolver_clone.head` to `f01a7eb4199be4e04d4fee7fc0116303949dc553` or `porcelain_lines` to 0, although every record carries both; R13 checks only path distinctness | environment provenance is recorded but not enforced at the merge; enforcement lives inside the child selftest | closed in effect (§7 row 20), unenforced in the accounting layer |
| **G7** | `R12` checks `selftest_failed`, `adapter_conformance_failed` and `clone_aggregate`, but not `g7_pass`, not the two exit codes, and not the attestation's age or ordering relative to the run | a stale attestation, or one where a suite exited non-zero while reporting zero failures, would satisfy R12 | trust; here satisfied in fact (06:08Z, before the 06:45Z start) |
| **G8** | the loop index `k` is not compared to the record's `shard_id` (`merge_partitions.mjs:30-37`) | a mislabelled record is caught indirectly by R4/R5, never directly | fail-closed via R4/R5 |
| **G9** | the parsed per-mutant lines are never cross-checked against the harness's own bucket counts, which the record stores. `RESULT_ACCOUNTING.md §1.1/§6.2` named that cross-check as *the* mitigation for the textual parse, and §1.1 said the wrapper "refuses to seal on any disagreement" | a *systematic* mis-parse of outcomes (as opposed to ids) has no second witness; id-level errors are still caught by R6/R7 | mitigation weaker than designed |
| **G10** | `CERT015_BASE` lets the merge be pointed at any tree (it is how `test_merge.mjs` works) | the certifying invocation must be made with `CERT015_BASE` unset or verified; the emitted document records `manifest_file` but not the resolved base | operational |

Documented deviations from `RESULT_ACCOUNTING.md` that are **not** gaps: R12's run-level placement
(declared in a code comment at `merge_partitions.mjs:172-176`), the added R13/R14, and R8's
strengthening from a copied-field comparison to a re-derivation from each worker's own clone.

---

## 10. Risks

1. **`PENDING LIVE RUN` dominates.** Everything above is a property of code, not of results. No
   partial output may be read as evidence; the merge is the only producer of a run total.
2. **The 17 new mutants are unmeasured.** §8.6.
3. **`rules_passed` in a refusal can be vacuous** over the subset of records present (`R6` "passed"
   in the existing `MERGE_REFUSED.json` while `R1` failed). A reader must take `status: BLOCKED` as
   the verdict, never the passed list.
4. **stdout/stderr interleaving** — the wrapper concatenates both streams of the harness into one
   buffer (`run_worker.mjs:106-107`). A stderr chunk arriving mid-line could corrupt a per-mutant
   line; the effect is a *false refusal* on R6, not a false green.
5. **A crash-kill is indistinguishable in `counts`.** §8.1. If the run yields kills, the
   `per_mutant[].line` text should be audited for `includes a selftest crash` before any kill rate is
   quoted.
6. **`sample.sh` is broken** and no throughput figure exists: `grep -c` exits 1 on zero matches, so
   `count()` emits two lines and the arithmetic fails (`throughput.txt` holds the error). Monitoring
   only; no effect on the run or the accounting. `OBSERVATION ONLY`.
7. **Recovery from a mid-run death is re-running that shard**, per the design's own preference,
   because the manual-seal path's attestation instrument (G4) does not exist. If the candidate has
   changed in the meantime, *all* partitions are void.

---

## 11. Disposition

| Question | Status |
|---|---|
| Is `registered = exactly one terminal state per mutant` mechanically enforced? | **VERIFIED** as a chain R1→R2→R4/R5→R6→R7→R9/R10→R11, set-based throughout |
| Are the five terminal states exhaustive over the population, with no silent-exclusion bucket? | **VERIFIED**; `ERROR` is the declared catch-all, `INVALID` has a single declared producer (the anchor precheck) |
| Is the exit-code hazard closed? | **VERIFIED** — R14 accepts 0 and 1; the wrapper always exits 0; the driver is a loop, not `&&`; the suite pins it |
| Is completeness established by id set rather than count or exit status? | **VERIFIED** |
| Does the merge refuse both void aggregates? | **VERIFIED** — equality plus a prefix firewall |
| Does a successful merge establish that the measurements are authentic? | **NOT VERIFIED — out of the tool's reach by construction** (§8.2) |
| Does a successful merge establish adequacy, meaningfulness, documentation truth, or U1 evidence? | **NO** (§8) |
| The live run's result | **PENDING LIVE RUN** |
