# DEEPTECH-PARALLEL-009 — the merged candidate instrument

**PROVISIONAL. Not registered, not committed, not published, not placed in any OP_RETURN.**
Location: `C:/tmp/dt009-merge/tooling`. The pre-wave instrument at `C:/tmp/dt002` is **untouched** and still reads
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` over 593 files.

## Provisional aggregate

```
files 594   aggregate 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
```

**Stability — three independent computations agree:**

| Computation | Result |
|---|---|
| My manifest recipe, clean rebuild 1 | `638d68e6…`, 594 files |
| My manifest recipe, clean rebuild 2 | `638d68e6…`, 594 files |
| **The instrument's own `lib/aggregate.mjs` `toolingManifest()`** | `638d68e6…`, 594 files |

The third line matters: it is not my recipe checking itself, it is the instrument's own definition agreeing with mine.
(A naive `xargs sha256sum | sha256sum` gives a different value and must never be used.)

## What changed, and nothing else

Exactly **7 paths**, the union of the three streams, confirmed by per-file diff against `BEFORE_manifest.txt`:

| Path | From |
|---|---|
| `lib/evidenceBundle.mjs` | DR-1 — relay attribution + per-round floor |
| `lib/sampling.mjs` | DR-1 — `MIN_DRAND_RELAYS`, verifier floor, `drandRelays` in the result |
| `lib/enumeration.mjs` **(new)** | enumeration binding — `checkEnumerationAttribution` |
| `cpg_u1_data.mjs` | all three — `verify-sampling` relay output, the scan fix, `cmdFrame --personnel` |
| `README.md` | DR-1 + enumeration binding |
| `test/selftest.mjs` | all three |
| `test/mutate.mjs` | all three (resolved, see below) |

**Registry unchanged** at `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814`. File count 593 → 594,
the one addition being `lib/enumeration.mjs`.

## The merge, and the defect it caught

`cpg_u1_data.mjs`, `test/selftest.mjs` and `README.md` **auto-merged cleanly** — the three streams genuinely worked in
different regions of each. Only `test/mutate.mjs` conflicted, because each stream appended to the same array.

**The substantive problem was not textual. All three streams independently claimed M416 onwards for different mutants:**

| ID | DR-1 | DR-10 | enumeration |
|---|---|---|---|
| M416 | beacon without a named relay | scan state keyed on `candidate_id` | forged/unregistered enumerator |
| M417 | single-relay round accepted | duplicate `candidate_id` not refused | enumerator not eligible under §4A.1 |
| M418 | same relay counted twice | occurrence pair not counted as duplicate | any role accepted as enumerator |

**Why every existing check would have missed it:** anchors are keyed on the *search text*, not the ID, so `392/392`,
`394/394` and `396/396` are each true in isolation and would stay true after a careless merge. What breaks is `--only`
selection and result attribution — a mutation report would credit the wrong guard.

Resolved deterministically by `scratchpad/merge_mutate.mjs`: DR-1 keeps **M416–M418**, DR-10 becomes **M419–M423**,
the enumeration binding becomes **M424–M430**, and the new `ENU` alias joins the existing alias block rather than the
mutant list. Verified: **15 new mutants, IDs M416–M430, zero duplicate ids**, `node --check` clean.

```
anchors: 404/404 occur exactly once        (389 baseline + 15)
```

## Verification status

| Gate | Result |
|---|---|
| Anchors | **404/404 occur exactly once** — VERIFIED by me |
| Clean rebuild ×2 | **identical** — VERIFIED by me |
| Instrument's own aggregate function | **agrees** — VERIFIED by me |
| Registry / protocol / treatment / eval-tree identity | **unchanged** — VERIFIED by me |
| Full selftest on the merged candidate | **running** |
| Full mutation suite (404 mutants) | **NOT RUN** — ~18 h at `--jobs 4`, each mutant runs the whole selftest |
| Adapter conformance, protocol verify, eval-tree verify on the merge | pending |

**The selftest must be run with the protocol two levels above the tooling.** `test/selftest.mjs:1216` gates two
assertions on `join(HERE, '..', '..', 'CPG_U1_PROTOCOL_004.md')`, so a bare tree silently reports **1020** instead of
1022 with two assertions skipped. A byte-identical copy of the protocol (`c50fc680…`) is placed at
`C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md`, **outside** the tooling directory so it does not enter the aggregate.

Per-stream selftest results, each verified by my own run: DR-1 **1050/0**, DR-10 **1035/0**, enumeration **1041/0** —
against the 1022 baseline that is +28, +13, +19, so the merged expectation is **1082**.

## This aggregate is NOT yet registrable

Section 10 of the directive requires the complete mutation suite with zero survivors, timeouts and errors, plus
adapter, protocol, evaluation-tree and deterministic-replay verification, before a final value may be reported. Two of
those are done; the mutation suite is ~18 hours and has not been started. **Until it completes, `638d68e6…` is a
provisional engineering result and must not be copied into any registration draft, published, or committed.**
