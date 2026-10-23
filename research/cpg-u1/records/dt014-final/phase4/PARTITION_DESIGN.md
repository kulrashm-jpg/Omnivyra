# PARTITION DESIGN — DEEPTECH-PARALLEL-014 phase 4 (preparation)

**Status: design. No mutant was executed. Nothing was written to `C:/tmp/dt013-candidate/`.**
**The manifest this design partitions is PROVISIONAL, PENDING DR-11, and is NOT frozen.**

| Binding | Value |
|---|---|
| Candidate / tooling aggregate | `b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67` (595 files, recomputed) |
| Protocol SHA | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (recomputed) |
| `manifest_digest` | `bf1b71c1039aa7ed0a8bb4f63adb57103f184d96674f29513ede7eb9226c6685` |
| `partition_digest` (K=3) | `5c8de14158ec32b6f02b810fedb5fa0bce70ae8026d42e9c7d54f26dad120547` |
| Superseded, firewalled | tooling aggregate `638d68e6…` (PID 4092). No evidence may be derived from or combined with it. |

---

## 1. The rule: `adapter-pinned-stride-v1`

```
total  = 441 mutants, ids parsed from test/mutate.mjs
K      = 3 (see CAPACITY_MEASUREMENT.md)

target[k] = floor(total / K) + (1 if k < (total mod K) else 0)          →  147, 147, 147

stage 1:  every mutant whose kind == 'adapter', in ascending numeric-id order,
          is assigned to partition 0.
stage 2:  every remaining mutant, in ascending numeric-id order, is dealt to
          partitions 0,1,...,K-1 cyclically starting at 0; a partition already at
          its target size is skipped and the cursor advances before the deal.
```

Result at K = 3: **147 / 147 / 147**, with all five adapter-kind mutants (M254–M258) in partition 0.
The rule is defined for any K ≥ 1 and was checked at K = 2 (221/220), 4 (111/110/110/110) and
5 (89/88/88/88/88); adapters stay in partition 0 at every K.

### 1.1 How each hard property is satisfied

| Property | How |
|---|---|
| **Disjoint** | Each id is inserted into a single assignment map exactly once. The generator throws if the map is not total or if the sizes do not sum to the total. Independently re-verified from the emitted JSON: 3 pairwise intersections computed, **all empty**. |
| **Exhaustive** | Stages 1 and 2 iterate over a partition of the full id set (`kind == 'adapter'` / `kind != 'adapter'`), so every id is dealt exactly once. Re-verified from the JSON: union size **441** == total. |
| **Deterministic** | The only ordering used is ascending integer id. All 441 ids are distinct integers, so this is a strict total order with no ties. No hashing, no randomness, no `readdir` order, no locale collation, no dependence on the order of `MUTATIONS` in the source file. Verified by regenerating: byte-identical output apart from `generated_utc`. |
| **Independently reproducible** | Recomputing the assignment needs only `id`, `kind` and `K`, all of which are in `FINAL_MUTATION_MANIFEST.json`. Every entry additionally carries its computed `partition`, so a verifier **compares** rather than trusts. `partition_digest` pins the whole assignment in one 64-hex value. |

---

## 2. Why this rule, and what was rejected

### 2.1 Rejected: contiguous id ranges (M01–M150 / … )

Mutants of the same target file are contiguous in id order, because they were authored file by file.
Measured clustering in this candidate:

```
lib/harness.mjs 45   lib/analysis.mjs 38   lib/sampling.mjs 36   cpg_u1_data.mjs 57
lib/evaluation.mjs 28  lib/bitcoin.mjs 24  lib/execution.mjs 23  lib/identity.mjs 23
```

A range partition can therefore hand one worker an entire module's mutants. That is bad for two
independent reasons: if that module's mutants share a systematic failure mode (all TIMEOUT, all
ERROR because one shared precondition is missing) the failure and its cost concentrate in one
partition; and the informational value of a partial result collapses, because a crashed partition
takes out whole modules rather than a representative sample. Rejected.

### 2.2 Rejected: hash-based assignment (`sha256(id) mod K`)

Deterministic and reproducible, but produces unequal partition sizes (multinomial spread of roughly
±20 mutants on 441/3, i.e. up to ~45 min of tail imbalance at 2.13 min/mutant) and buys nothing that
a stride does not already give. Rejected.

### 2.3 Rejected: cost-weighted LPT scheduling

The only non-uniform cost in the set is the adapter kind's **second command**. Weighting `w = 1` for
standard and `w = 1 + r` for adapter, the plain stride's worst adapter split at K = 3 would be 2/2/1,
i.e. an imbalance of `0.5 · r` units against 147 — **at most 0.34%** even at a generous `r = 1`. A
bespoke LPT scheduler would optimise an imbalance three orders of magnitude smaller than the real
source of tail latency, which is the 60-minute per-command timeout: **one TIMEOUT dominates every
static balancing decision.** Rejected in favour of the simpler, more auditable rule — with the
adapter kind handled by pinning, not by weighting, for the concurrency reason in §3.

### 2.4 Chosen: stride, with the adapter kind pinned

The stride gives exact 147/147/147 and spreads every module cluster. Measured spread in the emitted
manifest:

```
partition 0: 30 distinct target files   partition 1: 28   partition 2: 29   (of 30 total)
lib/harness.mjs   13 / 16 / 16
lib/analysis.mjs  13 / 12 / 13
cpg_u1_data.mjs   19 / 19 / 19
lib/sampling.mjs  12 / 12 / 12
harness/cpgAdapter.ts  5 / 0 / 0      ← pinned
```

The pinning is not about load; it is about **not running two adapter conformance checks at once**
(§3.3).

---

## 3. The adapter-kind mutants

### 3.1 Finding them and counting them

Parsed from `test/mutate.mjs`: the `MUTATIONS` tuples are 4-element `[label, file, anchor,
replacement]` except for a 5-element form with a `kind` string. Measured arities: **436 four-element,
5 five-element**; the only `kind` value present is `'adapter'`.

**There are exactly 5 adapter-kind mutants: M254, M255, M256, M257, M258** — all targeting
`harness/cpgAdapter.ts`, and contiguous both in id and in source order (lines 310–314).

### 3.2 What makes them different

`runMutant` runs the selftest for every mutant, and **additionally**, for `kind === 'adapter'` only:

```js
if (kind === 'adapter') results.push(classify(await runNode(
  join(work, 'test', 'adapter_conformance.mjs'), work,
  { ...process.env, CPG_U1_RESOLVER_CLONE: process.env.CPG_U1_ADAPTER_CLONE }), /…/));
```

So they (a) cost a second full command, and (b) are the **only** mutants that touch
`CPG_U1_ADAPTER_CLONE`. The second command is run unconditionally, not only when the first survives.
The verdict is then `KILLED` from either command, else `TIMEOUT`, else `ERROR`, else the selftest's
own outcome — so an adapter mutant killed only by the conformance check is still KILLED.

### 3.3 Why they are pinned to one partition

`adapter_conformance.mjs` runs `node <ADAPTER_CLONE>/node_modules/tsx/dist/cli.mjs <driver>` with
`cwd: ADAPTER_CLONE`, importing TypeScript out of that clone and starting a loopback HTTP server.
`tsx` maintains a transform cache; two concurrent runs against one clone could race on it.

A plain stride would put the five adapter mutants at ranks 253–257, i.e. **at nearly the same
position in all three workers' queues** — all three workers would reach their adapter mutant within
minutes of each other and run three `tsx` compiles plus three loopback servers simultaneously on a
2-core box against one shared clone. That is exactly the collision a stride's usual virtue creates
here.

Pinning removes it entirely. Because the five are contiguous in the `MUTATIONS` source array, and
because `--only` filters that array without reordering it, **partition 0 (running `--jobs 1`)
executes M254→M258 strictly back to back**. At most one process ever uses `CPG_U1_ADAPTER_CLONE` at
any instant, so **one shared adapter clone is sufficient and safe** — a material saving, since the
adapter clone is the only large artefact in the plan (~2.5 GB with `node_modules`).

Cost of the pin: partition 0 carries 5 extra commands of ≤ 0.34% of its total work, and yields 5 of
its 147 slots to them, so its non-adapter share is 142 against 147 for the others. Already reflected
in the equal 147/147/147 sizes.

---

## 4. Is concurrent reading of one source tree safe? Do partitions need separate clones?

### 4.1 The mechanical answer: yes, sharing one tree is safe

Read from `test/mutate.mjs`, every access to `ROOT`:

- `readFileSync(join(ROOT, file), 'utf8')` in the anchor precheck — read.
- `cpSync(ROOT, work, { recursive: true })` in `runMutant` — read.

Every write in the file targets the per-mutant workspace: `writeFileSync(join(work, file), …)` and
`rmSync(work, …)`, with an explicit path guard
`if (!resolve(work).startsWith(resolve(tmpdir()))) throw` . The header states it outright:
*"Originals are never written."*

There is therefore **no writer** to the source tree. Concurrent readers of an unchanging tree cannot
corrupt it or each other, on Windows or anywhere else; unlimited concurrent read opens are permitted.
`mkdtempSync` names cannot collide. **A shared candidate tree would be mechanically correct.**

### 4.2 The evidence answer: give each partition its own clone anyway

Not for data races — for evidence discipline and blast radius:

1. **Binding each result to the tree that produced it.** Every partition must attest the aggregate of
   the tree it actually mutated, *before and after* its run. With a shared tree there is one
   aggregate assertion that all K partitions must trust, and nothing detects a change that happened
   between two partitions' checks. With per-worker clones, the merge requires all 2K before/after
   values to equal `candidate_aggregate` (RESULT_ACCOUNTING.md rule R3).
2. **The read-only firewall.** `C:/tmp/dt013-candidate/` must not change. A shared tree would be
   opened 441 × K times over ~5 h by processes that also call `writeFileSync` and `rmSync`. Cloning
   once per worker means the candidate is touched exactly K times, by a copy, and never again.
3. **Restartability.** A partition can be re-run later against its own preserved clone, whose
   aggregate is recorded, without re-deriving anything from the candidate.
4. **Cost is nil.** 3 × 4.05 MiB = 12.2 MiB and 3 × ~26 s of copying.

**Answer, stated both ways: separate clones are NOT required for correctness — the harness never
writes to its source — but they ARE required by this design, for evidence binding and blast radius.**

### 4.3 The shared clones

`CPG_U1_RESOLVER_CLONE` may be shared by all workers. `selftest.mjs` reads it with
`git -C … rev-parse HEAD` and `git status --porcelain`, and derives its negative-test clones with
`git clone --shared --no-checkout <CLEAN_CLONE> <work>/dirty_clone`, where `work` is under
`os.tmpdir()`. A local `--shared` clone only reads the source's objects and refs; the source is never
written, and concurrent `git clone --shared` from one source is safe. With per-worker `TEMP` the
derived clones land in each worker's own temp.

`C:/tmp/dt013-resolver` satisfies it: HEAD `f01a7eb4199be4e04d4fee7fc0116303949dc553`,
11,552 tracked files, 111.7 MB, no `node_modules`.

`CPG_U1_ADAPTER_CLONE` may also be shared, but only because of §3.3. **It does not exist yet** — no
directory under `C:/tmp` holds a clone at the frozen SHA with `node_modules` installed, and
`dt013-resolver` has none. It must be a *separate* clone, not `npm ci` inside the resolver clone,
so the resolver clone stays provably pristine for the cleanliness check. Provisioning it requires the
npm registry (network) and is a prerequisite on the critical path.

---

## 5. Every mutant ends in exactly one of five terminal states

| State | Emitted by | Condition |
|---|---|---|
| `KILLED` | `runMutant` / `classify` | non-zero exit, code 1, and the summary line reported a non-zero failed count |
| `SURVIVED` | `runMutant` / `classify` | child exited zero |
| `TIMEOUT` | `runMutant` / `classify` | `err.killed` or `err.signal`; per-command ceiling 3,600,000 ms |
| `ERROR` | `runMutant` / `classify` | any other non-zero exit, including a child `stop()` (exit 2) and a caught harness exception (`harnessError`) |
| `INVALID` | **not** `runMutant` — the anchor precheck | the anchor string does not occur exactly once in its target file; `mutate.mjs` prints `ANCHOR?  <name> (Nx in <file>)` and refuses to run |

`classify` is a total function: every `(err, stdout)` pair falls into exactly one of the first four
branches, and `runMutant`'s `try/catch/finally` converts any thrown harness error into `ERROR`. So
the harness itself cannot silently omit a mutant: `results[i]` is written for every index it reaches.
`INVALID` exists so the five states stay exhaustive over the manifest even when a mutant is not
runnable. **There is no "not relevant", "skipped" or "n/a" bucket, and the merge rejects any outcome
string outside the five (RESULT_ACCOUNTING.md rule R9).**

**Why a broken environment cannot produce a false KILLED.** `KILLED` requires the regex
`/selftest: (\d+) passed, (\d+) failed/` to match with a non-zero second group. A missing or dirty
`CPG_U1_RESOLVER_CLONE` makes `selftest.mjs` call `stop()`, which exits before printing that summary
line, so the regex does not match and the outcome is `ERROR`. Likewise a missing
`CPG_U1_ADAPTER_CLONE` or `CPG_U1_RESOLVER_CLONE` makes `mutate.mjs` itself exit 2 before any mutant
runs. This is the harness's anti-false-green property and the design relies on it — together with
gate G7, the unmutated baseline, which is what rules out a *partial* environment fault that still
prints a summary line with failures.

The anchor precheck was run on this candidate (read-only; `--anchors` performs no copy, no write and
no mutant execution):

```
anchors: 441/441 occur exactly once        →  INVALID count = 0
```

---

## 6. Isolation plan

### 6.1 Layout

```
C:/tmp/dt014-mutrun/
  manifest/FINAL_MUTATION_MANIFEST.json        (copy; the binding manifest)
  shared/
    resolver/   ->  C:/tmp/dt013-resolver       read-only, HEAD f01a7eb4, must stay clean
    adapter/    ->  clone at f01a7eb4 + npm ci  read-only; used by partition 0 only  [TO PROVISION]
  w0/ clone/  temp/  out/  logs/
  w1/ clone/  temp/  out/  logs/
  w2/ clone/  temp/  out/  logs/
```

### 6.2 Per-worker launch contract

```
cwd          : C:/tmp/dt014-mutrun/w<k>
command      : node C:/tmp/dt014-mutrun/w<k>/clone/test/mutate.mjs --jobs 1 --only <ids of partition k>
env (set)    : TEMP = C:/tmp/dt014-mutrun/w<k>/temp        (no trailing separator)
               TMP  = C:/tmp/dt014-mutrun/w<k>/temp
               CPG_U1_RESOLVER_CLONE = C:/tmp/dt014-mutrun/shared/resolver
               CPG_U1_ADAPTER_CLONE  = C:/tmp/dt014-mutrun/shared/adapter
env (else)   : inherited unchanged
stdout+stderr: C:/tmp/dt014-mutrun/w<k>/logs/partition-<k>.log
progress     : C:/tmp/dt014-mutrun/w<k>/out/partition-<k>.ndjson   (append-only)
sealed result: C:/tmp/dt014-mutrun/w<k>/out/partition-<k>.json     (written once, at the end)
```

### 6.3 How each hard requirement is met

| Requirement | How |
|---|---|
| **No two workers mutate the same checkout** | `w<k>/clone/` is a byte-exact copy of the candidate, verified by recomputing `lib/aggregate.mjs` == `b9250356…` over 595 files before the run and again after. `ROOT` in `mutate.mjs` is derived from its own `import.meta.url`, so each worker's `ROOT` is its own clone regardless of cwd. |
| **Isolated temp per worker** | `TEMP` and `TMP` are set per worker. Node's `os.tmpdir()` resolves `TEMP` then `TMP` on Windows, and both `mkdtempSync(join(tmpdir(), 'cpg044-mut-'))` and the harness's own guard `resolve(work).startsWith(resolve(tmpdir()))` are relative to it, so every mutant workspace — and every clone the selftest derives internally — lands inside that worker's own temp. **Mandatory, not optional:** if `TEMP` is left shared, all workers share one temp root, the path guard still passes, and nothing detects the sharing. |
| **Isolated output per worker** | Separate directories *and* distinct filenames (`partition-<k>.*`). A worker cannot name, let alone overwrite, another's output. The harness itself writes no output files; all result files are the wrapper's. |
| **Independent logs** | One `logs/partition-<k>.log` per worker, capturing that process's stdout and stderr verbatim. No shared stream, no interleaving. |
| **Deterministic environment** | Both clone paths are pinned by env var and attested in the sealed record: resolver by HEAD + empty `git status --porcelain`, adapter by HEAD + presence of `node_modules/tsx/dist/cli.mjs`. No other variable is changed; the run inherits the rest of the environment unmodified so it is reproducible from the recorded `env` delta alone. |
| **Exactly one terminal state per mutant, no omission, no extra bucket** | §5 above, enforced at merge time by rules R6 (no short partition), R7 (exactly once), R9 (state is one of five), R10 (INVALID accounted), R11 (bucket identity sums to 441). |

### 6.4 Per-worker assignment (K = 3)

Sizes **147 / 147 / 147**; adapters **5 / 0 / 0**. The full id list for each partition is in
`FINAL_MUTATION_MANIFEST.json` under `verification.partition_id_lists`, and every entry in
`mutants[]` carries its own `partition`. `partition_digest` =
`5c8de14158ec32b6f02b810fedb5fa0bce70ae8026d42e9c7d54f26dad120547` pins the whole assignment.

The `--only` argument for a partition is its id list comma-joined: 147 ids × ≤ 5 characters ≈ 735
characters, far below the Windows command-line limit.

Two harness behaviours to record in the run evidence:

- `--only` splices `MUTATIONS` **before** the anchor loop, so each partition anchor-checks exactly its
  own mutants and its printed `anchors: n/n` line is partition-local.
- After `--only`, `MUTATIONS.length` is the partition size, so the harness's own
  `mutations: total N; killed …` line is **partition-local and must never be quoted as a run total**.
  Only the merge produces a run total.
- The source comment on `--only` says *"spot checks only; a full run never uses it"*. A K-partitioned
  run uses it K times. That is a deliberate deviation from the single-process idiom; the merge
  (RESULT_ACCOUNTING.md) is what restores the full-run guarantee, and the deviation must be recorded
  in the run's evidence rather than passed over.

---

## 7. Regeneration if DR-11 lands

`M468–M471` are reserved, contiguous and currently empty (verified: none of 468–471 is allocated).
If DR-11 is ruled and implemented, up to four entries are added **and the tooling aggregate changes**,
because both `test/mutate.mjs` and at least one `lib/` file change.

The manifest is then **regenerated, never edited**:

1. Recompute the new tree's aggregate with its own `lib/aggregate.mjs`.
2. Re-run `generate_manifest.mjs` unchanged, same `--partitions 3`.
3. Verify: total 441 + (number of DR-11 mutants, ≤ 4); max allocated M467 or M471; the gaps below 430
   still exactly the 26 retired ids; no new gaps.
4. Every unchanged mutant's `spec_hash` is unchanged **by construction** — a spec hash depends only on
   that mutant's own fields — so the diff is reviewable entry by entry.
5. `manifest_digest`, `partition_digest`, the partition sizes and most assignments change. Partition
   sizes become **149 / 148 / 148** at 445. Any partition output produced against the old
   `candidate_aggregate` is **VOID** and must never be merged with output from the new one; merge rule
   R2 refuses on the aggregate mismatch.

**The manifest is frozen only after the candidate is final.** It is not frozen now.
