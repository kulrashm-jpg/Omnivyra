# CAPACITY MEASUREMENT — DEEPTECH-PARALLEL-014 phase 4 (preparation)

**Status: measurement + derivation. No mutant was executed. Nothing was written to
`C:/tmp/dt013-candidate/`.**

Candidate: `C:/tmp/dt013-candidate/tooling`, tooling aggregate
`b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67`, 595 files (recomputed here with
the tree's own `lib/aggregate.mjs` — it matches).
Protocol SHA `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (recomputed from
`research/cpg-u1/CPG_U1_PROTOCOL_004.md` — it matches).

---

## 1. Measurements

All figures are measured on this host, not assumed. **Every figure was taken while this session was
running six parallel agents**, so the CPU and memory readings are a loaded-machine snapshot; that is
stated wherever it matters.

### 1.1 CPU

| Quantity | Measured |
|---|---|
| Model | Intel Core i7-6600U @ 2.60 GHz (max clock reported 2808 MHz) |
| Physical cores | **2** |
| Logical processors | **4** (hyperthreading) |
| `Win32_Processor.LoadPercentage` | 95 |
| `\Processor(_Total)\% Processor Time`, 5 × 1 s | 100.0, 100.0, 100.0, 100.0, 100.0 |
| `\System\Processor Queue Length`, 3 × 1 s | 9, 4, 0 |

A sustained 100% with a run queue of 9 on a 4-logical-CPU box means the machine is currently
oversubscribed roughly 2–3× by the ambient agent load alone.

### 1.2 Memory

| Quantity | Measured |
|---|---|
| Total physical (`TotalVisibleMemorySize`) | 16,240 MB |
| Free physical | 4,404 MB, then 3,734 MB on a second sample |
| Commit limit (`TotalVirtualMemorySize`) | 30,551 MB |
| Commit in use | 26,424 MB |
| **Commit headroom** | **4,127 MB**, then 5,092 MB |
| Pagefile `C:\pagefile.sys` | allocated 14,311 MB, current use 3,946 MB, peak 5,533 MB |
| Largest resident processes | `node` 3,274 MB · `Code` 1,379 MB · `vmmem` 1,199 MB · `Code` 716 MB · `claude` 395 MB · `claude` 300 MB · 4 × `chrome` 236–390 MB |
| `node` processes running | 3 |

Quiescing the editor, the container VM and the agent hosts returns on the order of **6.5 GB** of
commit, so the numbers below are given for both the loaded and the quiesced machine.

### 1.3 Disk and IO on the volume holding `%TEMP%`

`%TEMP%` = `C:\Users\lenovo\AppData\Local\Temp`, i.e. volume **C:**.

| Quantity | Measured |
|---|---|
| C: filesystem / size / free | NTFS · 476.3 GB · **96.8 GB free** (80% used) |
| `\PhysicalDisk(_Total)\% Idle Time`, 3 × 1 s | 21.1, 72.8, 89.0 |
| Candidate tree | **595 files, 4,242,799 bytes (4.05 MiB)** |
| — of which `node_modules` | 486 files, 3,205,403 bytes |
| — outside `node_modules` | 109 files, 1,037,396 bytes |

**Full-tree `cpSync` into `%TEMP%`** — the exact operation every mutant performs. Five consecutive
serial trials, copying the same 595 files, under the ambient load above:

```
25,603 ms · 14,136 ms · 18,173 ms · 65,022 ms · 196,576 ms
median 25,603 ms      min 14,136 ms      max 196,576 ms
```

At the median that is **23.2 files/s / 166 KB/s**; at the minimum, 42.1 files/s / 300 KB/s. Copying
4 MiB should take well under a second on any SSD, so the cost is **per-file syscall + filter-driver
overhead, not bandwidth** — about 43 ms per file at the median. `Get-MpPreference` failed with
`0x800106ba` (the Defender service is not queryable on this host), so the overhead could not be
attributed to a specific scanner; the measurement stands regardless of its cause.

The 14× spread across five *identical* serial copies is the single most important measurement here:
**the per-file path is already contention-bound**, before any mutation worker is added.

### 1.4 Process floor

A trivial Node script that had just performed those five copies reported **RSS 39.5 MB**. That is the
Node process floor on this host. The selftest child's real RSS was deliberately **not** measured,
because running `test/selftest.mjs` is the executable core of a mutation run and this wave is
prohibited from executing any of it (see §5 risk 6).

### 1.5 What the harness does with `--jobs`

From `test/mutate.mjs` (read, not inferred):

- `const jobs = Number(argv[argv.indexOf('--jobs') + 1]) || 4;` — line 14.
- `await Promise.all(Array.from({ length: jobs }, async () => { ... }))` — line 584: a shared cursor
  (`next`) consumed by `jobs` async loops.
- **`jobs` is the only concurrency bound in the file.** There is no semaphore, no pool, no per-file
  lock, no rate limit and no `os.cpus()`-derived default.
- Each loop iteration runs `runMutant`, which does one `mkdtempSync` + one full `cpSync(ROOT, work)`,
  then awaits `runNode(selftest)` and — for `kind === 'adapter'` only — a second
  `runNode(adapter_conformance)`. So one job = at most one child process at a time.
- `runNode` uses `timeout: 3600000` (60 min per command) and `maxBuffer: 1 << 26` (67.1 MB of
  captured stdout per child). `adapter_conformance.mjs` internally uses `maxBuffer: 1 << 28`
  (268.4 MB).
- Parsing hazards worth recording: with `--jobs` absent, `argv.indexOf` returns `-1` and `argv[0]` is
  read instead, so a stray numeric first argument silently becomes the job count; and `--jobs 0`
  is falsy and silently becomes 4. **Always pass `--jobs 1` explicitly as the first two arguments.**

---

## 2. Deriving the worker count

### 2.1 What one "worker" is

The recommended topology is **K independent harness processes, each invoked with `--jobs 1`**, rather
than one harness with `--jobs K`. Concurrency is identical; the difference is that a single process
cannot give per-worker `TEMP`, a per-worker checkout, independent logs, or independent crash
recovery — one crash would lose all in-flight work and produce one interleaved stdout. So
**worker count = partition count = K**, and peak Node process count = 2K (K harness parents + K
children).

### 2.2 CPU ceiling

Physical cores = 2. The selftest is single-threaded JavaScript plus libuv filesystem work and node
crypto. Hyperthreading on Skylake-U typically returns 20–30% over the physical count for mixed
integer/crypto workloads:

```
effective CPU capacity  =  2 physical × 1.25  =  2.5 worker-equivalents
```

### 2.3 IO-blocked slack (how far it is worth oversubscribing)

During its `cpSync` prologue a worker holds no core. Measured prologue = 25.6 s (median). Using the
quiet historical per-mutant figure of 2.7 min = 162 s as a conservative-high service time:

```
blocked fraction  f  =  25.6 / 162          =  0.158
useful oversubscription  =  1 / (1 − f)      =  1 / 0.842  =  1.188
```

### 2.4 The derived number

```
N  =  2.5 × 1.188  =  2.97   →   N = 3
```

### 2.5 Cross-check: memory

Per-worker budget:

| Component | MB |
|---|---|
| harness parent, Node floor (measured) | 40 |
| harness parent, one child's stdout buffer (`maxBuffer` 1<<26) | 67 |
| selftest child heap — **budgeted, not measured** | 500 |
| **per worker** | **607, budget 700** |
| partition 0 only, during its 5 adapter mutants (`maxBuffer` 1<<28) | +268 |

```
loaded machine:   4,127 MB headroom / 700 MB  =  5.9 workers   (5 with safety)
  N = 3 needs     3 × 700 + 268 = 2,368 MB    ≤ 4,127 MB   ✓ (57% of headroom)
  N = 4 needs     4 × 700 + 268 = 3,068 MB    ≤ 4,127 MB   ✓ but only 1,059 MB slack
quiesced machine: ~10,600 MB headroom / 700 MB = 15 workers
```

Memory does not bind at N = 3. It begins to bind at N ≈ 5 on the loaded machine.

### 2.6 Cross-check: disk

```
per-worker clone              4.05 MiB   × 3  =    12.2 MiB
one live mutant workspace     4.05 MiB   × 3  =    12.2 MiB
worst case, every cleanup fails  441 × 4.05 MiB = 1,786 MiB  =  1.74 GiB
adapter clone with node_modules installed (budget)           ≈  2.5  GiB
                                                     total  ≈  4.3  GiB
free on C:                                                  =  96.8 GiB
```

Not binding. Gate: require ≥ 10 GB free on the volume holding every worker's `TEMP`.

### 2.7 Cross-check: IO — the reason not to reuse 4

Each worker issues one 595-file copy per mutant; at N workers those copies overlap on one volume and
one filter-driver stack. The measured 14.1 s → 196.6 s spread across five *serial*, identical copies
shows the per-file path is already contention-bound with **zero** mutation workers, so a fourth
concurrent copier is expected to lengthen the prologue super-linearly, and the prologue is 16% of
each mutant.

The empirical corroboration is the pair of historical figures. At `--jobs 4` the same harness went
from **2.7 min/mutant** (quiet) to **4.9 min/mutant** (this session's six parallel agents) — a
**×1.81** degradation from ambient load alone. A configuration that loses 45% of its throughput to
ambient load had **no spare capacity at all**; that is the definition of saturation. N = 3 returns
about 25% of the pressure on every one of CPU, memory, and IO.

### 2.8 Throughput and projected wall-clock

Let `X(N)` = mutants completed per minute.

```
observed  X(4) quiet            =  4 / 2.7  =  1.481 /min
observed  X(4) with 6 agents    =  4 / 4.9  =  0.816 /min      (×0.55)
```

Because the only variable between those two points was ambient load and throughput fell 45%, the
bottleneck resource is already fully consumed at N = 4, so the saturated ceiling is
`X_max ≈ 1.481 /min`. At N = 3 the machine is still oversubscribed relative to its 2.5 effective
CPU-equivalents (3 > 2.5), so the bottleneck stays saturated; the only loss is the IO overlap the
fourth queued worker was providing.

```
conservative   X(3) = 0.95 × X_max = 1.407 /min
optimistic     X(3) = 1.00 × X_max = 1.481 /min
```

**At 441 mutants, N = 3, machine quiesced:**

```
conservative   441 / 1.407  =  313.4 min  =  5 h 13 m
optimistic     441 / 1.481  =  297.8 min  =  4 h 58 m
per-mutant wall = 3 / 1.407 = 2.13 min
per partition   = 147 × 2.13 = 313 min     ← partitions are exactly 147/147/147,
                                             so the tail equals the mean
```

**At 445 mutants (if DR-11 adds M468–M471), N = 3:** partition sizes become 149/148/148.

```
conservative   445 / 1.407  =  316.3 min  =  5 h 16 m      (+2.9 min)
optimistic     445 / 1.481  =  300.5 min  =  5 h 01 m      (+2.7 min)
tail partition 149 × 2.13   =  317.4 min
```

**If the machine is NOT quiesced** (applying the measured ×1.81 ambient penalty):

```
441 / (1.407 / 1.81)  =  441 / 0.777  =  567 min  =  9 h 27 m
```

Quiescing is therefore worth about **4 hours** — a far larger lever than any choice of N. For
comparison, N = 4 on a quiet box projects 298 min, at best ~15 min faster than the conservative N = 3
figure, bought with 25% more memory, IO and timeout-risk pressure on a box with 4,127 MB of commit
headroom and a disk already 80% full.

**Timeout tail.** The per-command ceiling is 3,600,000 ms. Each TIMEOUT adds up to 60 min to its own
partition, and each of the five adapter mutants runs a second command with its own 60-min ceiling.
Budget: **5 h 13 m + 60 min per timing-out mutant in the worst partition.**

---

## 3. Recommendation

> **Run K = 3 partitions, one harness process each, invoked `--jobs 1`, with the machine quiesced.**
> Projected wall-clock for all **441** mutants: **5 h 13 m** (conservative) to **4 h 58 m**
> (optimistic); **5 h 16 m** at 445 if DR-11 lands. Do not use 4: it is measurably saturated. Do not
> use one process with `--jobs 3`: it cannot be isolated, logged or restarted per partition.

Derivation in one line:

```
N = ceil( physical_cores × HT_factor × 1/(1 − io_blocked_fraction) )
  = ceil( 2 × 1.25 × 1/(1 − 0.158) )
  = ceil( 2.97 )
  = 3          bounded above by memory (5) and below by nothing; IO argues against 4
```

---

## 4. Pre-launch gates (for the later gated phase — none executed here)

| # | Gate |
|---|---|
| G1 | candidate aggregate == `b9250356…`, 595 files |
| G2 | protocol sha256 == `c50fc680…` |
| G3 | every worker clone's aggregate == candidate aggregate |
| G4 | `CPG_U1_RESOLVER_CLONE` HEAD == `f01a7eb4…`, `git status --porcelain` empty, no non-example `.env*` file |
| G5 | `CPG_U1_ADAPTER_CLONE` HEAD == `f01a7eb4…`, `node_modules/tsx/dist/cli.mjs` and `node_modules/undici` present |
| G6 | `node <clone>/test/mutate.mjs --anchors` reports `441/441 occur exactly once` — **already observed at this candidate** |
| G7 | **baseline**: the unmutated clone's `selftest.mjs` and `adapter_conformance.mjs` each report 0 failed. Without G7, an environment-induced failure is indistinguishable from a kill for every mutant. G7 is a baseline, not a mutant. |
| G8 | ≥ 10 GB free on each worker's `TEMP` volume; commit headroom ≥ 2,368 MB |
| G9 | ambient quiesce: no other agent, editor or container running; record `\Processor(_Total)\% Processor Time` immediately before launch |
| G10 | re-derive N from the G7 baseline's measured child RSS before launching (see risk 6) |

---

## 5. Risks on the capacity side

1. **`CPG_U1_ADAPTER_CLONE` does not exist.** No directory under `C:/tmp` holds a clone at
   `f01a7eb4…` with `node_modules` installed; `C:/tmp/dt013-resolver` has none. Without it
   `mutate.mjs` exits 2 immediately, before any mutant. Provisioning it needs the npm registry, i.e.
   **network**, which this wave is prohibited from using — it must be explicitly authorised in the
   gated phase and is on the critical path.
2. **Wide IO error bars.** A 14× spread on identical copies means the 5 h 13 m projection assumes a
   quiesced box. Unquiesced, expect ~9.5 h.
3. **Selftest child RSS was not measured** (prohibited). If a child exceeds ~1.2 GB, N = 3 becomes
   memory-bound on the loaded machine. Mitigated by G7 + G10: measure once at baseline, then re-derive.
4. **Only 4,127 MB commit headroom was observed**, with the pagefile already at 3,946 MB of its
   14,311 MB allocation. A memory spike lands in the pagefile, on the same contended volume as the
   mutant workspaces.
5. **The 60-minute per-command timeout** can add an hour to a partition's tail; with K = 3 there is
   no work-stealing, so a slow partition is not absorbed by the others.
6. **The resolver clone must stay clean for ~5 hours.** Any process that touches
   `C:/tmp/dt013-resolver` mid-run makes every subsequent selftest `stop()`. That produces ERROR, not
   a false KILLED (see PARTITION_DESIGN.md §5), so it is detectable — but the partition's remaining
   hours are wasted.
7. **`--jobs` parsing** silently defaults to 4 when the flag is absent or `0`. Always pass
   `--jobs 1` first.
8. **Windows cleanup failures** leave mutant workspaces behind (the harness records them in
   `leftovers` and never aborts) — up to 1.74 GiB. Not a correctness risk; sweep afterwards and carry
   the count in the sealed partition record.
