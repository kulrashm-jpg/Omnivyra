# DEEPTECH-PARALLEL-013 §5 — the gate fired

```
DR-11 OWNER DECISION REQUIRED
```

**No DR-11 code change has been made.** §5 is explicit: *"If only a recommendation exists: STOP. Return
DR-11 OWNER DECISION REQUIRED and do not make any DR-11 code change."*

## What I looked for, and the trap I nearly walked into

§5 also says *"Do NOT infer DR-11 from the label."* Searching the wave-011/012 artefacts for the record's
ruling convention returns a line that **looks exactly like a ruling**:

```
/c/tmp/dt012-decisions/D3-D5/DR11_RESOLUTION.md:361
## DR-11 — contamination() duplicate-result collapse · OWNER DECISION: ADOPT OPTION (A) — FIX BEFORE REGISTRATION
```

It is **not** a ruling. Read in context it is:

- under the heading **`### EXACT WORDING TO RECORD`**;
- entirely inside a blockquote (every line `>`-prefixed);
- preceded, four lines earlier, by `### OWNER APPROVAL REQUIRED?` → *"**YES.** No `OWNER DECISION:` or
  `DECIDED:` line naming DR-11 exists anywhere in the corpus … **This document is a recommendation and
  nothing more. Nothing has been applied and no code has been written.**"*

So it is **proposed wording drafted for the owner to adopt**, deliberately written in the ruling convention
so it can be pasted. A subagent of mine wrote it. Treating it as authority would mean **manufacturing owner
approval from my own output** — the one failure mode that would invalidate this entire programme's
decision record.

## The corpus-wide count

Ruling-convention lines that exist, by subject:

```
DR-1   7      DR-2   7      DR-10  6
DR-11  2   ← both are the proposed-wording block above and a reference to it
```

Two independent wave-012 streams reached this conclusion separately, and wave 011 before them. **DR-11 has
no owner ruling.**

## Consequence for the wave — and it is larger than §5 alone states

§17 gate **A ("DR-11 explicitly resolved") FAILS**, so per §17: *"If ANY item is missing: STOP. Do not start
the new mutation run."* That much is straightforward.

The larger consequence is about **ordering**, and it follows from the directive's own objective rather than
from §5:

> §1: *"The final candidate must be produced once."*
> §18 objective: *"produce one final candidate so the next expensive run is meaningful and is not
> immediately invalidated."*

DR-11 is **aggregate-moving** — it touches `cpg_u1_data.mjs`, `test/selftest.mjs` and `test/mutate.mjs`. So
if R28, R15 and DR-12 were applied now and sealed as *the* final candidate, resolving DR-11 afterwards would
change the tree again, produce a second aggregate, and invalidate the very run this wave exists to make
meaningful. **Sealing a final candidate today would violate §1 and defeat §18.**

## How I am resolving that without either ignoring "IMPLEMENT" or over-reaching

§3, §4 and §6 say **IMPLEMENT** for R28, R15 and DR-12. §5 blocks only DR-11's code change and the
*certification*. §17 gates the *run*. Nothing blocks the implementation work itself.

So the coherent reading, and what I am doing:

1. **Implement R28, R15 and DR-12** into a **new candidate tree**, leaving `C:/tmp/dt009-merge` untouched
   (the old run is still live at 8.27 h — editing its tree would corrupt it, per the established
   `cpSync`-per-mutant finding).
2. **Do not seal a FINAL aggregate.** Any aggregate derived is labelled
   **PROVISIONAL — PENDING DR-11**, never final.
3. **Do not start any mutation run.**
4. Leave **one clean insertion point** so DR-11's one-line change lands in the same tree when ruled on, and
   the aggregate is derived **once**, immediately before the single run.

That satisfies "implement" without producing the final candidate twice, and costs nothing if DR-11 is ruled
on later — because no certification will have been spent.

## §2 frozen identities — VERIFIED before any edit

| identity | expected | measured | |
|---|---|---|---|
| protocol | `c50fc680…b719` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | ✅ |
| treatment commit | `f01a7eb4…` | resolves | ✅ |
| evaluation tree | `3b4811fc…` | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` (tree of that commit) | ✅ |
| development registry | `a1392952…` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | ✅ |
| candidate aggregate (pre-wave) | `638d68e6…` | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files | ✅ |

Derived complete, not abbreviated, with the instrument's own `toolingManifest()` — never
`xargs sha256sum | sha256sum`, which gives a different, wrong value.

**Treatment content aggregate `ffe4f603…`: NOT EXECUTED.** Deriving it walks 11552 files, which §15 says to
defer if it would materially compete with the still-running mutation process. It is deferred, and must be
verified in the same session that derives the final aggregate.

**Old run: RUNNING, 8.27 h elapsed. Not restarted, not inspected, not interpreted.** Zero candidate files
modified.
