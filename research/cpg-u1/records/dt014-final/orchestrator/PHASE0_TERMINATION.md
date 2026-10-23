# DEEPTECH-PARALLEL-014 Phase 0 — obsolete computation terminated

## Identity verified BEFORE termination

| | |
|---|---|
| PID | **4092** |
| command line | `C:\nvm4w\nodejs\node.exe test/mutate.mjs --jobs 4` |
| started | **2026-09-24 20:10:18 IST** |
| elapsed at termination | **9.89 h** |
| tree being certified | aggregate **`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`**, 594 files |
| live workers at termination | 3 × `%TEMP%\cpg044-mut-*\test\selftest.mjs` |

## Proof it was NOT the current candidate

Decisive and independent of any report:

```
PID 4092 started          2026-09-24 20:10:18
C:/tmp/dt013-candidate    created 2026-09-25 04:32:19   (+8 h 22 m)
  .../lib/identity.mjs    created 2026-09-25 04:50:46
```

The candidate **did not exist** when the run started, so the run cannot be certifying it. Both aggregates
re-derived by me with each tree's own `lib/aggregate.mjs` `toolingManifest()` — never
`xargs sha256sum | sha256sum`, which yields a different, wrong value:

```
superseded : 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2   594 files
candidate  : b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67   595 files
```

They differ, and the candidate's value matches the directive's independently.

## Termination

**2026-09-25 06:05:30 +0530**, via `taskkill /PID 4092 /T /F` — **by PID, never by image name.** This
matters: a prior wave saw `taskkill /F /IM node.exe` kill every node process on the machine across three
occasions. The `/T` flag confines the kill to 4092's own descendants.

Terminated: **20716, 14636, 9724, 30816, 4092** — the parent and four descendants.

**Survivors, correctly untouched: 9924, 31552.** Neither is a descendant of 4092. Verified by listing all
node PIDs before and after.

## Reason recorded

> **superseded pre-decision certification; invalid as final evidence**

Its partial results were **not inspected and not interpreted**, before or after termination. Per the
directive the run is classified:

```
PRE-DECISION CERTIFICATION — INVALID AS FINAL EVIDENCE
```

## Why stopping it was correct rather than wasteful

At ~4.9 min/mutant measured (log advancing 118 lines in 9.71 h), 404 mutants projected to **~33–36 h
total**, i.e. **~23–26 h still to run** — against a ~2.7 min/mutant historical baseline, the gap being
contention from this session's own parallel streams. Every one of those hours would have certified a tree
that **no longer exists**. Terminating it also returns four workers to the machine, which materially
shortens the single final run that replaces it.

**No evidence anywhere in this programme may be derived from `638d68e6…` or from that run.**
