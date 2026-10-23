# CERT-015 — resume point

Run stopped cleanly on request. Nothing was lost that was not already forfeit, and nothing is in a
half-written state.

## To resume — one command

```
C:\tmp\dt015-mutrun\scripts\run_k12.bat
```

It is **resumable**: it skips any shard that already has a sealed `w<k>/out/partition-<k>.json`, so it is
safe to start, stop and restart freely. Nothing needs re-freezing, re-sharding or re-verifying first.

## Frozen inputs — verify these before trusting any later result

| item | value |
|---|---|
| candidate tooling aggregate | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` |
| candidate files | **595** |
| candidate path | `C:/tmp/dt013-candidate/tooling` |
| frozen manifest (file sha256) | `4e1302f5f88954e7669b756bfcc4fd32c4e16504067cc592f496bc85f354b8e1` |
| manifest path | `C:/tmp/dt015-mutrun/manifest/FINAL_MUTATION_MANIFEST_458_K12.json` |
| `manifest_digest` | `168415b990ece6f4eaedb0522d08beb8b4d563776812626595b294f9156d3be7` |
| `partition_digest` (K=12) | `9b931f49151af89b0128acf573af370c1d578f882c638ac441e7605b424d2e65` |
| protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` |
| treatment commit / tree | `f01a7eb4199be4e04d4fee7fc0116303949dc553` / `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` |
| provider configuration | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` |
| resolver clone | `C:/tmp/dt013-resolver` — clean, **no `node_modules`** (keep it that way) |
| adapter clone | `C:/tmp/dt015-adapter` — same SHA, has `tsx` + `undici` |

Derive the aggregate with the tree's own `lib/aggregate.mjs` `toolingManifest()`. **Never**
`xargs sha256sum | sha256sum` — it produces a different, wrong value.

## Progress at stop

```
sealed shards        : 0 of 12
shard 0 in flight    : 19 of 39  -> DISCARDED (seals only at shard end)
mutants with a terminal state in a sealed record : 0 of 458
```

**19 mutants of work is the entire cost of this stop.** That is the point of the 12-shard layout.

## What must NEVER be merged

`C:/tmp/dt015-mutrun/superseded-K3/` holds the old K=3 manifest and its sealed shard-0 record (153
results). It binds `partition_digest fdb6938d…` and merge rule **R2 will refuse it** — correctly. Do not
resurrect it.

Also inert but present: `w0/out/partition-0.SMOKE.json`. The merge reads `partition-<k>.json` **exactly**,
so the SMOKE file cannot be picked up. Do not rename it.

## Why the layout changed, and what it cost

Shards were 3 × ~153 (~12.7 h each). With an ~8 h logoff interval **no shard could ever seal** — proven
twice, dying at 143/153 and 149/153, both unrecoverable because the design forbids manual sealing without
the log-digest attestation that was never implemented.

Re-sharded to **12 × 39/39/38** (~3–5 h each). The cost was real and is already paid: shard 0's sealed 153
results were forfeited, because a new partitioning changes `partition_digest` and R2 refuses records bound
to the old one.

## The one unresolved limitation

**This session is not an administrator**, so every scheduled task it can create is `Interactive only` and
dies at logoff or reboot. To make the run survive both, run **once, elevated**:

```
schtasks /Create /TN "CERT015_MutationRun" /TR "C:\tmp\dt015-mutrun\scripts\run_k12.bat" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F
schtasks /Run    /TN "CERT015_MutationRun"
```

The batch sets `PATH` to include Git and Node explicitly. **This is essential, not cosmetic:** `git` is not
on the machine PATH, while `selftest.mjs:63-64` and `evaluationTree.mjs:22` invoke bare `git`. Without it a
SYSTEM-run task would yield `ERROR` for all 458 rather than results. The batch logs `git --version` first
so the very first line proves git resolved.

Expected total machine time for all 458: **~38 h** at the observed 5 min/mutant, longer on a busy machine
(8.35 min/mutant was observed under load).

## Two things that must be reported separately at the end

1. **Crash-kills.** A mutant that makes the selftest *throw* is classified `KILLED` with `crash: true`, and
   **no merge rule aggregates that flag** — `counts.KILLED` mixes them with assertion-kills. Observed rate
   was ~8–9% (12 of 152, then 11 of 122). Before quoting any kill figure, audit `per_mutant[].line` for
   `includes a selftest crash` and report the two numbers apart.
2. **A `COMPLETE` merge does not prove the mutants ran.** The merge's own test suite shows three fabricated
   records yielding `COMPLETE` with 458 KILLED. Only R8 and R12 touch real artefacts; no digest binds a
   sealed record to its log. It attests accounting consistency and identity binding — not authenticity of
   measurement.

## Standing evidence boundary

Mutation certification establishes that **asserted executable behaviour is asserted correctly**. It is
**not** independent human validation, **not** U1 empirical evidence, and establishes **no registration
readiness**.

```
FINAL MUTATION CERTIFICATION = BLOCKED / PENDING LIVE RUN
458 registered · 0 with a terminal state
```
