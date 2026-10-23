# Final candidate — reconciled and frozen for exhaustive certification

## Candidate identity

```
tooling aggregate : 7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6
files             : 595
supersedes        : b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67 (595)
location          : C:/tmp/dt013-candidate/tooling
```

**Three independent derivations agree** — separate node processes, different root forms (absolute
forward-slash, and relative from inside the tree). All with the instrument's own `lib/aggregate.mjs`
`toolingManifest()`; `xargs sha256sum | sha256sum` was never used, since it yields a different wrong value.

§8 asks for two agreeing rebuilds. Three were taken.

## Frozen identities — re-verified after the batch, all unchanged

| identity | value |
|---|---|
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| `registry_sha256` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` |
| treatment commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` |
| evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` |
| treatment aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` (11552 files) |
| provider configuration | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` |

**Only `tooling_aggregate_sha256` moved.** That is the expected and only permitted movement.

## Mutation population — verified by my own parse, not accepted from the report

```
entries      : 458
distinct ids : 458
max id       : M484
gaps         : 26, ALL exactly the retired set {23,24,25,26,225,244,280..299}
arithmetic   : 484 − 26 = 458  ✓
anchors      : "anchors: 458/458 occur exactly once", exit 0
```

*Method note:* my first parse returned 171 entries because my regex required a single-quoted id and many
entries use double quotes. **That was my measurement error, not a defect in the file** — corrected, and
recorded here because an uncorrected undercount would have looked like catastrophic mutant loss.

**Allocation**, 441 → 458 (+17):

| block | ids | count |
|---|---|---|
| DR-11 | **M468–M471** (the reserved, previously empty block) | 4 |
| F3 | M472–M474 | 3 |
| F1 | M475–M476 | 2 |
| F4b | M477–M478 | 2 |
| F4 | M479–M484 | 6 |

**Nothing renumbered. No retired id reused.**

**Two existing mutants re-pointed — inspected, legitimate.** `M444` and `M457` kept their ids and intent;
their *anchors* moved because this batch changed the lines they anchored on (F4 deleted the foreign
marker list; F4b lifted classification out of an `else if`). Both carry explicit `RE-POINTED` comments.
M444 still proves substring matching is load-bearing; M457 still proves classification runs. This is the
M77 precedent, applied correctly — but it is the one action in the batch that *could* have silently
weakened coverage, so it was checked rather than assumed.

## Batch applied — six items, one change set, six files

`cpg_u1_data.mjs` · `lib/registration.mjs` · `lib/identity.mjs` · `README.md` · `test/mutate.mjs` ·
`test/selftest.mjs`. File count unchanged at 595 — nothing added or removed.

**Selftest: 1253 passed, 0 failed, exit 0** (up from 1147/0), with `CPG_U1_RESOLVER_CLONE` and
`CPG_U1_ADAPTER_CLONE` set distinctly. `verify-protocol`, `verify-evaluation-tree` and
`verify-registration` all exit 0.

Notable dispositions recorded for the evidence file:

- **F4** implements the owner's ruling exactly. Hard refusal is reserved for tokens a governing document
  explicitly names — `UNASSIGNED` (protocol §5.5.1 / `PROTOCOL_MARKERS`), plus `TBD`, `PLACEHOLDER` and
  zero-pattern (wave-013 §3). `Na`, `None`, `Test`, `Mock` are **no longer refused**, including as
  substrings, and now resolve to `PLAUSIBLE_BUT_UNVERIFIED` / `NO_AUTHORITY_ATTESTATION`. The distinction
  is **refusal vs resolution**, asserted both ways.
- **U+200C ZWNJ and U+200D ZWJ removed** from the invisible-character refusal, so Persian, Arabic and
  Indic names are no longer classified MALFORMED. Genuine zero-width and bidi controls still refused.
- The **demotion-only contradiction was resolved in the contract, not the wiring** — the documented
  invariant now states what actually holds (screening can never *promote*), with seven assertions pinning
  each disposition so prose and behaviour cannot drift apart again.

## The honest limit on this freeze

**The 17 new kills are reasoned, not measured.** No mutant was executed — running any mutation suite was
prohibited during implementation. Each has a named killing assertion pinning exact exit code **and**
message, but only the exhaustive run proves them. Any of them surviving is a real finding, not a
formality.

Two residual gaps recorded rather than papered over: `screenProseValue`'s four internal guards have no
individual mutants (M482 removes the prose screen wholesale), and the instrument's own `SYNTHETIC` marker
remains a substring match, so a real organisation whose name contains "synthetic" is still refused outside
test mode — pre-existing and deliberately untouched.

## Authority

```
DR-11 DECISION AUTHORITY: DELEGATED TO CLAUDE
DR-11 = ADOPT
```

Recorded in `DR11_DELEGATED_DECISION.md`. **Not an owner ruling, and never to be described as one.**

## Status

**This aggregate `7410ec6c…` is now the ONLY candidate eligible for final mutation certification.** Any
evidence against `b9250356…` or the superseded `638d68e6…` is void and must never be merged.
