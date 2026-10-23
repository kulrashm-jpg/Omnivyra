# DR-1 — DRAND RELAY FLOOR: **DECISION REQUIRED**, with the cost measured rather than estimated

**DEEPTECH-PARALLEL-008 / stream G.** **PROPOSAL ONLY. NOTHING WAS APPLIED.**

**CLASSIFICATION: PREPARATION.** No file in `C:/tmp/dt002` and no file under `research/cpg-u1/**` was modified
or written. The candidate patch was applied **only** to throwaway copies in the session scratchpad, which exist
solely to produce the numbers below. **No relay was contacted. No beacon was fetched. No network call was
made.** This memo decides nothing.

**Extends, does not replace,** `C:/tmp/dt004-operations/registration/DR1_DRAND_RELAY_FLOOR_MEMO.md`, which
established the problem, the three options and the candidate patch but **explicitly did not run the selftest**
and **did not compute the moved aggregate**. This memo supplies both, measured.

---

## 1. Both halves of the defect, verified in the code and quoted

### 1.1 The bundle builder enforces no minimum relay count

`C:/tmp/dt002/research/cpg-u1/tooling/lib/evidenceBundle.mjs`, lines **31–41**, quoted verbatim:

```js
function beacons(list) {
  const byRound = new Map();
  for (const [i, b] of list.entries()) {
    if (!b || !Number.isSafeInteger(b.round) || b.round < 1 || typeof b.randomness !== 'string' || typeof b.signature !== 'string') throw new Error(`drand beacon ${i}: must carry round, randomness and signature`);
    const v = { round: b.round, randomness: b.randomness, signature: b.signature };
    const prior = byRound.get(b.round);
    if (prior && (prior.randomness !== v.randomness || prior.signature !== v.signature)) throw new Error(`drand beacons disagree for round ${b.round} — relays returned different values; do not choose one`);
    byRound.set(b.round, v);
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}
```

Three facts follow, all of them re-verified here:

1. **No floor.** There is no comparison against any minimum. The caller at line **63** passes
   `beacons: beacons(parts.beacons ?? [])`, so `beacons([])` returns `[]` and is accepted.
2. **No relay identity survives.** Line 35 rebuilds each entry from exactly three fields, so any `relay` key
   on the operator's input is **silently discarded**. A bundle built from ten relays and one built from a
   single relay are **byte-identical**. The requirement is not merely unenforced — it is **unrecorded**, and so
   **unauditable from the bundle**.
3. **Agreement leaves no trace.** The dedup is by round; two agreeing relays collapse to one entry. Only
   *disagreement* does anything, and what it does is refuse — correctly, and with the right instruction
   ("do not choose one").

### 1.2 The verifier needs exactly one beacon

`lib/sampling.mjs`, line **180**, quoted verbatim:

```js
  const beacon = (ev.drand?.beacons ?? []).find((b) => b && b.round === round);
```

`.find` — the **first** match. One beacon for the computed round is sufficient for `evaluateStage` to reach
`FINAL` and derive the seed. Nothing anywhere counts relays.

### 1.3 What §19.3 asks for

Protocol `c50fc680…`, line **961**, quoted verbatim:

> "Also required before held-out execution: recording fetcher, recording Wikidata lookup, replay harness
> (§13); certenv with a fixture tenant; two independent Bitcoin header sources (or an own node) and **≥ 2
> drand relays for verification**."

**So both halves are confirmed: §19.3 asks for ≥ 2 relays; the instrument requires 1 and records 0.**

### 1.4 What is *not* at risk

A relay **cannot forge** randomness: `verifyBeacon` BLS-verifies every beacon under the pinned quicknet group
key (chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`). The exposure is a relay
**withholding** or **misreporting** a round — which a one-relay bundle cannot reveal.

---

## 2. The cost of enforcing a floor of 2 — MEASURED

The candidate patch (from the prior memo's §5, reproduced faithfully) requires a `relay` name on every beacon,
collects relay names per round, refuses a round with fewer than 2 distinct names in `lib/evidenceBundle.mjs`,
adds the same check in `lib/sampling.mjs`, and adds mutation anchors `M416`/`M417` in `test/mutate.mjs`.

Two throwaway copies were made in the session scratchpad. **Both copies were first confirmed byte-identical to
the frozen instrument** (<NEW_N> files, aggregate `<NEW_AGG>`) before anything was changed.

### 2.1 Variant A — the full three-file patch (evidenceBundle + sampling + mutate)

| Measurement | Real result |
|---|---|
| File count | **<NEW_N>** (no file added or removed) |
| **Tooling aggregate** | **`5c69aa3f9599f2fb78bb95d31854954a604a158bb2d924c926293bcf41a71e28`** |
| `node test/mutate.mjs --anchors` | **`anchors: 391/391 occur exactly once`**, exit **0** |
| `CPG_U1_RESOLVER_CLONE=… node test/selftest.mjs` | **`selftest: 284 passed, 1 failed`** — and it **CRASHES**, uncaught |

The crash, verbatim:

```
selftest: 284 passed, 1 failed
  FAIL: SELFTEST CRASHED (exit 1) — see stderr
EvidenceError: drand round 1 is attested by 0 named relay(s); the protocol requires at least 2 (§19.3)
    at Module.evaluateStage (…/lib/sampling.mjs:190:30)
    at evalS (…/test/selftest.mjs:523:63)
```

**`389 → 391` is CONFIRMED.** The claim that the patch "inverts two selftest assertions" is **CORRECTED and is
a significant understatement**: the patch **stops the selftest dead at its first sampling assertion**
(`selftest.mjs:523`). Of the frozen baseline's **1022** assertions, **284 ran, 1 failed, and 737 never
executed at all**. No count of "inverted assertions" can be obtained from this variant, because the suite never
reaches them.

### 2.2 Variant B — the bundle-builder floor alone (evidenceBundle only, sampling untouched)

Built to isolate the bundle-side cost, since variant A hides it behind the crash.

| Measurement | Real result |
|---|---|
| File count | **<NEW_N>** |
| **Tooling aggregate** | **`a50a4c751e464e3aa20a47e1d227f2b35727eec7a46eff836685e1aa661cd07d`** |
| `CPG_U1_RESOLVER_CLONE=… node test/selftest.mjs` | **`selftest: 661 passed, 3 failed`** — and it **CRASHES** in the end-to-end section |

The three failures, verbatim:

```
FAIL: exit 1 != 0: sampling-evidence-bundle :: ERROR: EVIDENCE_BUNDLE_REFUSED: drand beacon 0:
      must name the relay it came from (§19.3 requires 2 differently named relays per round)
FAIL: EVIDENCE BUNDLE: assembled from separate files; both stages verify FINAL; no seed printed
FAIL: SELFTEST CRASHED in the end-to-end section: ENOENT: no such file or directory,
      open 'C:\…\cpg041-selftest-…\ev_bundle.json'
```

**661 ran, 3 failed, 358 never executed.** The third "failure" is a cascade: the CLI refused to write
`ev_bundle.json`, so the end-to-end section had no file to read.

### 2.3 Baseline, for comparison — measured in the same session

| Measurement | Frozen instrument |
|---|---|
| Aggregate | `<NEW_AGG>` (<NEW_N> files) |
| `test/mutate.mjs --anchors` | `anchors: 389/389 occur exactly once`, exit 0 |
| `test/selftest.mjs` (with the clone) | **`selftest: 1022 passed, 0 failed`**, exit 0 |

---

## 3. The consequence list — **exact**

Enforcing a floor of 2 means **all** of the following, not some of them:

1. **`tooling_aggregate_sha256` moves.** The measured candidate values are
   `5c69aa3f9599f2fb78bb95d31854954a604a158bb2d924c926293bcf41a71e28` (variant A) and
   `a50a4c751e464e3aa20a47e1d227f2b35727eec7a46eff836685e1aa661cd07d` (variant B).
   **Neither is the value that would actually be registered**, because neither variant yet contains the
   required `test/selftest.mjs` and `README.md` changes. The registrable aggregate is **not knowable until the
   patch is finished** — which is exactly why this cannot be left to be decided later.
2. **Mutation anchor count 389 → 391** (`M416 beacon accepted without a named relay`,
   `M417 single-relay round accepted`). Measured: `anchors: 391/391 occur exactly once`, exit 0. The existing
   anchors M411 and M412 survive byte-for-byte, as the patch was designed to ensure. **The full mutation run
   (389/389 killed at the baseline) must be re-run to 391/391 and is not run here** — it needs
   `CPG_U1_ADAPTER_CLONE` as well and is long.
3. **The selftest must be rewritten before it can even report.** The prior memo listed twelve beacon sites;
   a re-grep of `test/selftest.mjs` in this stream finds **thirteen** — lines 518, 554, 555, 556, 559, 562,
   1299/1304, 1335, 1465-1469, 1472, 1477, 1488 **and 1692** (a harness refusal case,
   `beacons: [ROUND[1]]`, missed by the earlier list). All of them must attach relay names. The archived fixtures (`test/fixtures/drand/quicknet_round_*.json`) carry only
   `{round, randomness, signature}`, are public known-answer vectors covered by
   `test/fixtures/PROVENANCE.json`, and **must not be edited** — the names must be attached at the use sites.
4. **Two assertions invert in meaning**, confirmed by reading them:
   - **line 1488** currently asserts *"only round/randomness/signature are kept"* and passes
     `extra: 'relay metadata'` precisely so that it is **discarded**. After the patch relay metadata is
     **retained**, so the test's meaning reverses. This assertion is the design intent in plain sight.
   - **line 1472** asserts the CLI bundle is `canonicalJson`-identical to a hand-built reference document. The
     reference must gain `relays` arrays or the assertion fails.
5. **New cases must be added**: a two-relay round accepted with both names recorded sorted; a one-relay round
   refused at bundle time; a `relays`-less beacon reaching `evaluateStage` directly raising `EvidenceError`.
6. **`README.md`** must document the new required `relay` field and the floor (`--drand-beacons`, the §13.2A
   evidence table).
7. **A second-order decision follows and is UNDECIDED:** whether `EVIDENCE_SCHEMA`
   (`cpg-u1-sampling-evidence/v1`) becomes `/v2`. Adding `relays` changes the bundle document's shape, so an
   outsider validating against `/v1` sees an unexpected key.
8. **Adapter conformance and the full mutation run must both be re-run** and re-recorded (baseline: 18/18 and
   389/389).

---

## 4. Why the window closes at registration

`tooling_aggregate_sha256` is:

- a **registered** field of the registration record (`lib/registration.mjs` pinned parameters); and
- **inside the on-chain commitment digest** — it is one of the eleven `PAYLOAD_KEYS`
  (`lib/commitment.mjs:11-12`), and `digest = sha256("cpg-u1-commitment-digest/v1|" + canonicalJson(payload))`
  goes into the OP_RETURN of the commitment transaction; and
- **checked on every verification**: `lib/sampling.mjs:142` returns
  `STAGE_VOID_MALFORMED_COMMITMENT` if the committed payload's `tooling_aggregate_sha256` differs from the
  registration's, and the harness raises `TOOLING_MISMATCH` (one of its 34 fail-closed refusals) if the
  instrument on disk does not hash to the registered value.

**So changing the instrument after registration is not a patch — it voids the study.** Option (c) of the prior
memo ("add it after registration") is, mechanically, "abandon and re-register".

Before registration the change is cheap in principle and measured above in practice. **After the registration
record is filed, DR-1 can only be answered "no".**

---

## 5. DECISION REQUIRED — DR-1

**QUESTION.** Does CPG-U1 enforce a drand relay floor of 2 mechanically in the instrument, or does the "≥ 2
relays" requirement of §19.3 remain **procedural**, satisfied by `relay_attribution.mjs` outside the registered
bundle and disclosed as such?

| Option | What it costs | What it buys |
|---|---|---|
| **(a) Procedural** — accept current behaviour; use `relay_attribution.mjs`; disclose in the registration note and under §20.17 | **Nothing changes.** Aggregate, anchors and selftest stay at `<NEW_AGG>` / 389 / 1022-0. | Nothing mechanically. The record shows which relays served what; a verifier must trust the operator's record rather than the bundle. |
| **(b) Mechanical, BEFORE registration** | Items 1–8 of §3 in full. The registrable aggregate is unknown until the work is finished. Adapter conformance and the full 391-anchor mutation run must be re-run. | A one-relay bundle becomes **impossible**, and relay identity becomes **part of the evidence** rather than an operator note. |
| **(c) Mechanical, AFTER registration** | **Voids the study** (§4). Not a real option. | — |

**RECOMMENDATION OF THIS STREAM: none — this is the owner's call.** What this stream adds to the decision is
that option (b) is **larger than it was recorded to be**: it is not "two inverted assertions" but a test-suite
rewrite whose intermediate states **crash the frozen selftest**, and whose registrable aggregate cannot be
stated until that rewrite is complete and green at 1022+ passing.

**DEADLINE: before the registration record is filed.** After that, only (a) remains.

---

## 6. Exactly what was and was not done here

| | |
|---|---|
| Patch applied to `C:/tmp/dt002` | **NO — prohibited, and not done.** |
| Patch applied to `research/cpg-u1/**` in any worktree | **NO.** |
| Patch applied to disposable scratchpad copies | **YES**, and they were verified byte-identical to the frozen tree first. |
| Relay contacted / beacon fetched / any network call | **NO.** |
| Full mutation run (391 anchors) | **NOT RUN** — needs `CPG_U1_ADAPTER_CLONE`; long. Listed as a **cost**, not a result. |
| `test/selftest.mjs` rewritten for relay names | **NOT DONE** — that is the work option (b) buys. |
| Any value in §2 invented | **NO.** Every hash and count in §2 is real command output. |

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

