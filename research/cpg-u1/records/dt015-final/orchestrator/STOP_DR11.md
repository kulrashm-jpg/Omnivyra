# DEEPTECH-PARALLEL-015 §3 / §16.1 — STOP

```
DR-11 HUMAN OWNER DECISION REQUIRED
```

**No DR-11 code change was made. The approved batch was NOT applied. No mutation certification started.**

## The §3 test, and why it fires

§3 requires **owner-approved text**, and forbids the alternative in terms: *"Do NOT infer, synthesize, or
choose a methodological interpretation."*

Searched the two authoritative decision files. Both carry the ruling convention; neither names DR-11:

```
dt009-closure/orchestrator/DECISION_RECORD.md
  :19  ## DR-1  — drand relay floor            · OWNER DECISION: ADOPT OPTION (B)
  :40  ## DR-2  — §19.3 certenv wording        · OWNER DECISION: ADOPT OPTION (A)
  :53  ## DR-10 — cmdScan duplicate collapse   · OWNER DECISION: FIX BEFORE REGISTRATION

dt009-closure/G-registration/DECISION_DISCLOSURES.md
  :31  ## 1. DR-1  · DECIDED: **ADOPT OPTION (B)**
  :137 ## 2. DR-2  · DECIDED: **ADOPT OPTION (A)**
  :243 ## 3. DR-10 · DECIDED: **FIX BEFORE REGISTRATION**

grep -c "DR-11" on both files → 0 and 0
```

**Zero mentions.** Consistent with four prior independent determinations (waves 011, 012, 013, 014).

## This standard is stricter than wave 014's, and it changes the answer

Wave 014 §5 permitted resolution from *"authoritative protocol/decision material"*, and Stream A concluded
DR-11 is protocol-determined by **entailment** from §5.7.2 `:389` (*"`E_c` is determined by §5.1–§5.4,
using the scan committed in the development payload"*) — a duplicate `candidate_id` makes a quantity the
protocol declares determinate indeterminate.

I verified that reasoning and accepted it, **while recording plainly that it is an entailment and not an
explicit sentence**: *"the protocol nowhere says 'exactly one result per frame row'"*, and I struck one of
its supporting citations (`:791`, which is §12.3 **Cited source URLs** and governs malformed `sourceUrl`,
not scan results).

**An entailment is a methodological interpretation.** §3 excludes exactly that. So the wave-014 basis does
not satisfy this wave's test, by my own characterisation of it at the time. The gate fires.

## What I did not do, and why

§2 lists DR-11 inside the batch and says *"Do not create separate candidate identities for individual
items."* Applying F3, F1, F4b, F2 and F4 **without** DR-11 would produce a candidate that must change again
when DR-11 lands — a second candidate identity, and the exact outcome §2 forbids and §8 guards
(*"the resulting aggregate becomes the ONLY candidate eligible"*).

So the batch is held whole. Nothing was applied.

## Reported state — verified, not assumed

The directive says to treat the reported state as reported, not authoritative. Measured:

| | reported | measured |
|---|---|---|
| candidate aggregate | `b9250356…e11a67` | **`b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67`** ✅ |
| file count | 595 | **595** ✅ |
| protocol SHA | `c50fc680…` | **`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`** ✅ |
| evaluation tree | `3b4811fc…` | **`3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`** ✅ (tree of `f01a7eb4…`) |
| development registry | `a1392952…` | **`a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814`** ✅ |
| candidate modified since wave 014 | — | **0 files** ✅ |

Derived with the instrument's own `toolingManifest()`, never `xargs sha256sum | sha256sum`.

## §6 cleanup — done, with the discriminator recorded

Four abandoned `cpg044-mut-*` workspaces verified as the **terminated** run's residue before removal:

```
cpg044-mut-9Lkpud  06:02:29  594 files
cpg044-mut-bJiINr  06:03:45  594 files
cpg044-mut-cs3YOq  06:04:34  594 files
cpg044-mut-Lu80SZ  06:04:57  207 files   (partial — cpSync interrupted by the kill)
```

**594 ≠ 595 is the decisive discriminator**: these are copies of the superseded `638d68e6…` tree, not of
the candidate. Mtimes sit seconds before the 06:05:30 termination, and there are exactly four, matching
`--jobs 4`. All removed; **0 remain**. They were never read and never counted as evidence.

`dt4-legal` untouched (5 files intact). All **11** collected deliverables under `C:/tmp/dt014-final/`
present.

## §5 — the one thing proceeding while blocked

Adapter-clone provisioning is running under §5's narrow authorisation. It is the **only long-lead
prerequisite** and is **independent of DR-11**: `test/mutate.mjs:20-23` exits **2 before any mutant**
without `CPG_U1_ADAPTER_CLONE`, and no clone with `node_modules` exists anywhere. It is pinned to the
frozen treatment SHA `f01a7eb4…`, not to the candidate, so no DR-11 outcome can invalidate it.

It must be a **new** clone: installing into `C:/tmp/dt013-resolver` would create `node_modules` and dirty
the `CPG_U1_RESOLVER_CLONE`, breaking the cleanliness invariant the selftest asserts — a prior wave saw a
single stray `.env.test` cascade into 16 selftest failures.

## What unblocks this

One line, in the record's own convention, in `DECISION_RECORD.md`:

> `## DR-11 — contamination() duplicate-result collapse · OWNER DECISION: <your ruling>`

The prepared option is to refuse a `scan.results` containing a duplicate `candidate_id` — a read-time
well-formedness refusal, recorded as **input hygiene, not a security control**, with mutants landing in the
reserved empty block **M468–M471** so nothing renumbers.

**Do not read that as a recommendation carrying authority.** The prepared wording that exists in
`DR11_RESOLUTION.md:363` is a subagent's draft, and I have marked both copies `⚠ NOT A RULING — PROPOSED
WORDING ONLY`.

Declining the fix is also a ruling, and would let the wave proceed — with the defect disclosed rather than
closed.
