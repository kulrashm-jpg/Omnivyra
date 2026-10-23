# PARTITION AND WORKER-ISOLATION PROOF — CERT-015

**Scope limit.** Engineering evidence only. Mutation certification certifies that the asserted
executable behaviour is *asserted correctly*. It is **not U1 empirical validation** and establishes
**no registration readiness**.

Bound to frozen manifest `168415b9…`, candidate aggregate
`7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` (595 files).

---

## 1. Shard sizes and the disjointness proof

Partition rule `adapter-pinned-stride-v1` from `PARTITION_DESIGN.md`, at K = 3 with 458 entries:

```
target[k] = floor(458 / 3) + (1 if k < (458 mod 3) else 0)   →   153, 153, 152
```

| Shard | Size | Adapter-kind mutants | First ids |
|---|---|---|---|
| 0 | **153** | **5** (M254, M255, M256, M257, M258) | M01, M04, M07, M10, M13, … |
| 1 | **153** | 0 | M02, M05, M08, M11, M14, … |
| 2 | **152** | 0 | M03, M06, M09, M12, M15, … |

`153 + 153 + 152 = 458`. The stride is visible in the first ids: consecutive mutants land in different
shards, so no module's cluster is concentrated in one worker.

### 1.1 Disjointness, proved by computing the intersections

Not asserted from the rule — computed from the emitted JSON:

```
PASS  every id has a partition in {0,1,2}
PASS  shard sizes 153/153/152
PASS  shards pairwise disjoint (empty intersections)     [0∩1, 0∩2, 1∩2 all empty]
PASS  union size === 458 (exhaustive)
PASS  sum of shard sizes === 458
PASS  every id in EXACTLY one shard
```

The last line is the strongest form and is checked independently of the other five: for every one of
the 458 ids, the count of shards containing it is exactly 1. A duplicate would make it 2 and a gap
would make it 0; both are detected.

`partition_digest` = `fdb6938d7d3592e57060aed587307febc3ce1fecfef6ce2cef8cc663a7346805` pins the whole
assignment in one value, and is order-independent (ordered by integer id, not source order).

### 1.2 The adapter pin

```
PASS  adapter-kind ids are exactly M254-M258
PASS  every adapter mutant in partition 0
PASS  no adapter mutant in partition 1 or 2
```

Adapter-kind mutants are the only ones that touch `CPG_U1_ADAPTER_CLONE`, via
`adapter_conformance.mjs`, which runs `tsx` out of that clone and starts a loopback HTTP server. They
are contiguous in the `MUTATIONS` source array, and `--only` filters that array **without reordering
it**, so partition 0 at `--jobs 1` runs M254 → M258 strictly back to back. At most one process ever
uses the adapter clone at any instant, which is why one shared adapter clone is safe. A plain
unpinned stride would have put all three workers at their adapter mutant within minutes of each other
— three concurrent `tsx` compiles against one shared transform cache on a 2-core box.

---

## 2. TEMP isolation proof, per worker

`TEMP` **and** `TMP` are both set per worker. This is proved two independent ways, because the
harness's own path guard (`resolve(work).startsWith(resolve(tmpdir()))`) **passes even when TEMP is
shared** and therefore proves nothing about isolation.

### 2.1 Pre-flight: a real child process reports its own `os.tmpdir()`

Each worker wrapper launches a child with that worker's exact env, and the child reports its
`os.tmpdir()` and actually creates a directory with the harness's own `cpg044-mut-` prefix:

```
w0 TEMP isolation proof OK: os.tmpdir()=C:/tmp/dt015-mutrun/w0/temp  mkdtemp=C:\tmp\dt015-mutrun\w0\temp\cpg044-mut-AVqEgi
w1 TEMP isolation proof OK: os.tmpdir()=C:/tmp/dt015-mutrun/w1/temp  mkdtemp=C:\tmp\dt015-mutrun\w1\temp\cpg044-mut-pYEfNm
w2 TEMP isolation proof OK: os.tmpdir()=C:/tmp/dt015-mutrun/w2/temp  mkdtemp=C:\tmp\dt015-mutrun\w2\temp\cpg044-mut-B3CcZT
```

Each sealed record carries the full proof, and the wrapper **refuses to start** (exit 2) unless all
three of these hold:

| Assertion | Meaning |
|---|---|
| `os_tmpdir_is_this_workers_dir` | `os.tmpdir()` resolves to **this** worker's directory, not the machine default |
| `mkdtemp_dir_is_under_this_workers_dir` | a real `mkdtempSync` landed inside it |
| `mkdtemp_dir_is_under_no_other_worker` | it landed under **neither** of the other two workers' temp dirs |

`machine_default_tmpdir_not_used` is also recorded, showing the inherited `TEMP` was overridden rather
than passed through.

### 2.2 Runtime: the live process table, mid-run

Stronger than the pre-flight probe, because it shows the **actual harness** placing its **actual
mutant workspaces**. Captured while all three workers were running
(`RUNTIME_TEMP_ISOLATION_SNAPSHOT.txt`):

```
26128  node C:\tmp\dt015-mutrun\w0\clone\test\mutate.mjs --jobs 1 --only M01,M04,M07,…
31704  node C:\tmp\dt015-mutrun\w1\clone\test\mutate.mjs --jobs 1 --only M02,M05,M08,…
21088  node C:\tmp\dt015-mutrun\w2\clone\test\mutate.mjs --jobs 1 --only M03,M06,M09,…

29592  node C:\tmp\dt015-mutrun\w0\temp\cpg044-mut-GOnNR4\test\selftest.mjs
 9460  node C:\tmp\dt015-mutrun\w1\temp\cpg044-mut-RLXHWJ\test\selftest.mjs
28060  node C:\tmp\dt015-mutrun\w2\temp\cpg044-mut-sqtoOD\test\selftest.mjs

15376  node C:\tmp\dt015-mutrun\w0\temp\cpg044-mut-GOnNR4\cpg_u1_data.mjs verify-registration …
 9936  node C:\tmp\dt015-mutrun\w1\temp\cpg044-mut-RLXHWJ\cpg_u1_data.mjs verify-registration …
 8232  node C:\tmp\dt015-mutrun\w2\temp\cpg044-mut-sqtoOD\cpg_u1_data.mjs check-funding-prerequisites …
```

Three distinct workspaces under three distinct worker temp roots, each with its own nested child
processes. Also observed: a `tsx-lenovo` transform-cache directory created **inside `w0/temp`** during
the adapter-path smoke test — so even `tsx`'s cache is temp-isolated, not shared through the machine
default.

Merge rule **R13** re-checks this at reconciliation time and refuses if any two workers report the
same `os.tmpdir()`.

---

## 3. Everything else each worker owns

| Requirement | How it is satisfied and proved |
|---|---|
| **Own clone** | `w<k>/clone`, a byte-exact copy. `toolingManifest()` recomputed to `7410ec6c…` over 595 files **before and after** each run, recorded in the sealed record and re-checked by merge rule R3. |
| **Own TEMP and TMP** | §2. Both variables set; proved by a real child's `os.tmpdir()`, and again by the live process table. |
| **Own output dir and distinct filenames** | `w<k>/out/partition-<k>.json`. Separate directory **and** a filename containing `k`, so no worker can name, let alone overwrite, another's output. The harness writes no output files at all; every result file is the wrapper's. |
| **Own log** | `w<k>/logs/partition-<k>.log`, that process's stdout and stderr verbatim. No shared stream, no interleaving. |
| **Identical env otherwise** | Only four variables are set: `TEMP`, `TMP`, `CPG_U1_RESOLVER_CLONE`, `CPG_U1_ADAPTER_CLONE`. Everything else is inherited unchanged. The delta is recorded in each sealed record. |

### 3.1 The two shared clones are kept distinct

```
CPG_U1_RESOLVER_CLONE = C:/tmp/dt013-resolver
CPG_U1_ADAPTER_CLONE  = C:/tmp/dt015-adapter
```

Both sit at `f01a7eb4199be4e04d4fee7fc0116303949dc553` and both are clean, so **a swap would not be
caught by any harness guard** — the harness only checks HEAD and `git status --porcelain`, which are
identical for the two. The wrapper therefore asserts the two **paths** are distinct and refuses (exit
2) if they are equal, and records both paths with their distinguishing properties:

| Clone | HEAD | `git status --porcelain` lines | `node_modules` | `tsx/dist/cli.mjs` | `undici` |
|---|---|---|---|---|---|
| resolver `dt013-resolver` | `f01a7eb4…` | 0 | **absent** (required) | — | — |
| adapter `dt015-adapter` | `f01a7eb4…` | 0 | present (required) | present | present |

The `node_modules` asymmetry is the one property that actually distinguishes them, and the wrapper
checks it in both directions: it refuses if the resolver clone **has** `node_modules`, and refuses if
the adapter clone **lacks** `tsx` or `undici`. Merge rule R13 re-checks path distinctness.

### 3.2 Worker count is 3, and `--jobs` is always explicit

Three workers, not four: the Phase 4 capacity measurement established that 4 leaves no spare capacity
on this 2-physical-core box. Each is invoked as:

```
node <w<k>/clone>/test/mutate.mjs --jobs 1 --only <ids of shard k>
```

`--jobs 1` is passed **explicitly, as the first two arguments**, every time. `mutate.mjs` computes
`jobs = Number(argv[argv.indexOf('--jobs') + 1]) || 4`, so with `--jobs` absent `indexOf` returns −1,
`argv[0]` is read instead, and the count silently becomes 4; `--jobs 0` is also falsy and silently
becomes 4. Neither failure mode is reachable here.

### 3.3 Nothing was written to the protected trees

`C:/tmp/dt013-candidate`, `C:/tmp/dt013-resolver`, `C:/tmp/dt015-adapter` and `C:/tmp/dt4-legal` are
read-only in this run. The candidate was read exactly three times, by `cp`, to create the clones, and
its aggregate was re-verified as `7410ec6c…` over 595 files after the clones were made. All worker
scratch is under `C:/tmp/dt015-mutrun/`; all documentation is under `C:/tmp/dt4-uncert`.

---

## 4. The partition-local traps, recorded so they are not misread

Three harness behaviours that a careless reading would turn into a false total:

1. `--only` splices `MUTATIONS` **before** the anchor loop, so each worker's `anchors: n/n` line is
   **partition-local**. Observed: `153/153`, `153/153`, `152/152` — which sum to 458 and confirm
   `INVALID = 0`, but no single one of them is the run's anchor result.
2. After `--only`, `MUTATIONS.length` is the shard size, so each worker's own
   `mutations: total N; killed …` line is **partition-local and is never quoted as a run total**. It is
   recorded in the sealed record under the deliberately long key
   `harness_summary_line_PARTITION_LOCAL_NOT_A_RUN_TOTAL` and is **not an input to any count**. Every
   count in the merged result is derived from the merged per-mutant id table.
3. Exit code **1 is a normal completion** with at least one non-KILLED outcome, not a crash. The merge
   accepts 0 and 1, refuses 2 (precondition failure), and treats anything else or any signal as a
   crash. A synthetic test asserts specifically that exit 1 with one SURVIVED and one ERROR still
   merges to `COMPLETE`.
