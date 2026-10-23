# DEEPTECH-PARALLEL-011 — the firewall, measured rather than assumed

Written by the orchestrator while the six read-only streams run. **Nothing under
`C:/tmp/dt009-merge/tooling` has been written. Verified below.**

## Candidate integrity at 2026-09-25 02:14 IST

Recomputed with the instrument's **own** `lib/aggregate.mjs` `toolingManifest()` — not with
`xargs sha256sum | sha256sum`, which yields a different, wrong value:

```
aggregate : 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
files     : 594
```

Unchanged from wave 009. The newest mtimes in the tree are still the seven wave-009 merge
files (`test/mutate.mjs`, `test/selftest.mjs`, `lib/enumeration.mjs`, `cpg_u1_data.mjs`,
`README.md`, …). **Nothing has been written into the tree since the merge.**

## The run, from process metadata only — no verdict inspected

| | |
|---|---|
| parent | PID 4092, `node test/mutate.mjs --jobs 4` |
| started | 2026-09-24 20:10:18 IST |
| now | 2026-09-25 02:14:41 IST |
| **elapsed** | **6 h 04 m** |
| workers | 4 selftest children, sandboxes `%TEMP%\cpg044-mut-*` |

Against the ~18 h expectation that is roughly **one third complete, with ~12 h remaining**.
This is read from the process table; **no partial verdict was examined**, as §14 requires.

## Why a mid-run edit produces a run that completes and lies

`test/mutate.mjs:506-510`:

```js
const work = mkdtempSync(join(tmpdir(), 'cpg044-mut-'));
if (!resolve(work).startsWith(resolve(tmpdir()))) throw new Error('path guard: …');
cpSync(ROOT, work, { recursive: true });
const target = join(work, file);
writeFileSync(target, readFileSync(target, 'utf8').replace(from, to));
```

`cpSync(ROOT, work)` runs **inside `runMutant`, once per mutant**, at the moment that mutant
starts. Three consequences, and the third is the dangerous one:

1. The harness **never writes into `ROOT`**. Each mutant is applied to a fresh private copy
   under `%TEMP%`. So the candidate tree is safe *from the harness*.
2. But the harness **re-reads `ROOT` for every remaining mutant**. An edit landing now would
   leave completed mutants describing the old tree and every subsequent mutant describing the
   new one.
3. The anchor pre-flight at `test/mutate.mjs:486` — `readFileSync(join(ROOT, file))`, asserting
   each `from` string occurs **exactly once** — **already ran, at start, against the pre-edit
   tree**. It does not run again. So an edit that moved or removed an anchor would **not** be
   re-detected.

The result of a mid-run edit is therefore **not a crash and not an error**. It is a run that
reports `404/404 killed` over a tree that never existed as a single object. That is precisely
the failure class this programme has already been bitten by twice — the 587-file
`640510782a…` tree that "runs fine and lies", and the `xargs` aggregate that looks like a hash
and is the wrong one. A silent, plausible, wrong green.

**This is why the firewall is not procedural caution.** It is the difference between a
certification and an artefact that cannot be distinguished from one.

## What this does and does not license

It **does** license everything the six streams are doing: reading the candidate, copying it to
scratch, applying a patch to the *copy*, and running targeted checks there. None of that
touches `ROOT`.

It does **not** license applying any prepared edit — not to the candidate, and not to a fresh
candidate tree either. A fresh tree would produce a **fourth** aggregate to track while two of
the five decisions (DR-11, `EVIDENCE_SCHEMA`) are still unresolved, which is the third and
worst ordering set out in `STOP_CONDITIONS.md`.

## The one number the owner's Path A / Path B choice needs

Path B (decide now, one run) discards **6 h 04 m already spent**, not ~18 h — the run is early,
not nearly done. Path A (let it finish, then edit, then re-run) costs **~12 h more now plus a
full ~18 h second run ≈ 30 h**, and certifies a tree that the five pending decisions will
immediately supersede.

So the arithmetic currently **favours Path B**, and grows less favourable to it with every hour
that passes. That is an owner decision, not mine — but it is a decision with a clock on it, and
that fact is itself the finding.
