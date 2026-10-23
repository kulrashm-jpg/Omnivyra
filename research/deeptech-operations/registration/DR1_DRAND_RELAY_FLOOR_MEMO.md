# DR-1 — THE "≥ 2 DRAND RELAYS" REQUIREMENT IS PROCEDURAL, NOT MECHANICAL

**CLASSIFICATION: PREPARATION.** This memo decides nothing. It states verified current behaviour, the
options, and the cost of each, so that the study owner can decide in one sitting. **The patch in §5 was
NOT applied anywhere.** No relay was contacted, no beacon was fetched, no network call was made.

**Instrument under examination (read-only):** `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, 593 files — **recomputed in this
task and VERIFIED** (§6.1).
**Protocol:** `CPG_U1_PROTOCOL_004`, `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`
— **recomputed and VERIFIED**. Protocol line numbers below are of the file at that hash.

---

## 1. What the protocol asks for

Three places, and **only** three:

| Where | Text |
|---|---|
| §19.3, protocol line **961** | "Also required before held-out execution: … **≥ 2 drand relays** for verification." |
| §21 step 5, protocol line **997** | "Fetch drand rounds `R_dev`, `R_ho` from **≥ 2 relays**." |
| §20.17, protocol line **981** | "**Tooling cannot prove** non-spend, most-work status, source independence or **drand unavailability from a bundle**; outsiders confirm with a full node and **≥ 2 relays** (§21)." |

Note the shape of this already: §21 is the **outsider's** procedure, and §20.17 is a **declared
limitation**. Neither §5.7.1 (the sampling mechanism) nor §5.5.1 (the registration record) mentions a
relay count. `parameters` in the registration record has twelve pinned keys and none of them is a relay
count (`lib/registration.mjs:14-27`).

## 2. What the code actually does — VERIFIED, with citations

### 2.1 The bundle builder deduplicates by round, refuses disagreement, and counts nothing

`lib/evidenceBundle.mjs:31-41`:

```js
31  function beacons(list) {
32    const byRound = new Map();
33    for (const [i, b] of list.entries()) {
34      if (!b || !Number.isSafeInteger(b.round) || b.round < 1 || typeof b.randomness !== 'string' || typeof b.signature !== 'string') throw new Error(`drand beacon ${i}: must carry round, randomness and signature`);
35      const v = { round: b.round, randomness: b.randomness, signature: b.signature };
36      const prior = byRound.get(b.round);
37      if (prior && (prior.randomness !== v.randomness || prior.signature !== v.signature)) throw new Error(`drand beacons disagree for round ${b.round} — relays returned different values; do not choose one`);
38      byRound.set(b.round, v);
39    }
40    return [...byRound.values()].sort((a, b) => a.round - b.round);
41  }
```

Three facts follow from these eleven lines:

1. **No minimum count.** There is no comparison against any floor. `beacons([])` returns `[]` and is
   accepted; `lib/evidenceBundle.mjs:63` passes `parts.beacons ?? []` with no arity check.
2. **No relay identity is even accepted.** Line **35** rebuilds each entry from exactly three fields. A
   `relay` (or any other) key on the operator's input object is **silently discarded**. So a bundle
   built from ten relays and a bundle built from one are **byte-identical**. The requirement is not
   merely unenforced — it is **unrecorded**, and therefore unauditable from the bundle.
3. **The dedup is by round, so two relays agreeing collapse to one entry** (line 38 overwrites with an
   equal value). Agreement leaves no trace; only *disagreement* (line 37) does anything, and what it
   does is refuse.

This is asserted deliberately by the instrument's own self-test, `test/selftest.mjs:1488`:

```js
ok(EB.buildEvidenceBundle({ … beacons: [{ ...full.drand.beacons[0], extra: 'relay metadata' }, full.drand.beacons[0]] }).drand.beacons.length === 1,
   'EVIDENCE BUNDLE (lib): identical duplicate beacons collapse; only round/randomness/signature are kept');
```

The string `extra: 'relay metadata'` in that test is the design intent in plain sight: **relay metadata
is discarded on purpose.**

### 2.2 The CLI cannot express a relay count either

`cpg_u1_data.mjs:1067`:

```js
beacons: o['drand-beacons'] && o['drand-beacons'] !== true ? String(o['drand-beacons']).split(',').filter(Boolean).flatMap((f) => [].concat(readJson(f))) : []
```

- `--drand-beacons` is **optional**; omitted, the bundle carries zero beacons and is still written.
- The flag takes a comma-separated list of **files**, and each file may itself hold an **array**
  (`[].concat(...)`). So *one* file can supply *both* rounds, and *two* files can both come from the
  *same* relay. **The file count is not a relay count.** Nothing in the CLI ties a file to a relay.
- Contrast with headers, where the two-source rule **is** mechanical: `lib/evidenceBundle.mjs:16`
  requires each archive to name its `source`, and `:51` refuses `headers.source === crosscheck.source`.
  The instrument has the pattern; it simply does not apply it to drand.

### 2.3 Only one chain-info document exists in the schema

`lib/evidenceBundle.mjs:60` accepts a single `drandChainInfo` object, and `lib/drand.mjs:43-52`
(`checkChainInfo`) compares every pinned quicknet field against `QUICKNET` (`lib/drand.mjs:9-17`).
There is **no slot** for a second relay's chain-info document, so even the "did two relays agree about
the chain?" question cannot be posed to the bundle.

### 2.4 The verifier needs exactly one beacon for the required round

`lib/sampling.mjs:180-188`:

```js
180  const beacon = (ev.drand?.beacons ?? []).find((b) => b && b.round === round);
181  if (!beacon) {
182    if (tipMtp >= record.drand_round_time + MISSING_ROUND_EXPIRY_SECONDS) {
183      return outcome(stage, STATE.VOID_RANDOMNESS, `no verifiable drand round ${round} 30 days after its scheduled time (per supplied evidence)`, { record });
184    }
185    return outcome(stage, STATE.WAITING_DRAND, `drand round ${round} (scheduled ${record.drand_round_time}) not in evidence`, { record });
186  }
187  let randomness;
188  try { randomness = verifyBeacon(ev.drand.chain_info, beacon, round); } catch (e) { throw new EvidenceError(e.message); }
```

`find` takes the **single** matching entry. One beacon, from one relay, carries a stage all the way to
`FINAL`. Note also line **183**'s honest parenthetical — *"per supplied evidence"* — the author already
knew that the VOID conclusion is only as good as the operator's fetching.

### 2.5 Mutation coverage confirms there is nothing to disable

`test/mutate.mjs` has a mutant for the header two-source rule (**M411** "one header source accepted
twice") and one for beacon disagreement (**M412** "conflicting relay beacons accepted"). There is **no
mutant for a relay-count floor**, because no such guard exists to be disabled.

**VALIDATION (actually run):** `node test/mutate.mjs --anchors` → `anchors: 389/389 occur exactly once`,
exit **0**. Read-only: the `--anchors` path exits at `test/mutate.mjs:471` (`if (anchorsOnly ||
failedAnchors) process.exit(…)`), before the `cpSync(ROOT, work, …)` at line 489 and before any
`writeFileSync`. Nothing was written to the instrument tree; its aggregate was recomputed afterwards and
is still `f7699f05…`.

### 2.6 Conclusion of §2

**Protocol-004's "≥ 2 drand relays" is a procedural instruction to the operator and to the outsider. It
is mechanically unenforced, and the evidence bundle is structurally incapable of recording whether it
was honoured.** This is an accurate reading of §20.17, not a contradiction of it.

## 3. What the ≥ 2 requirement does and does not buy

Beacon authenticity does **not** depend on relay plurality. Be precise about the boundary.

### 3.1 What a lying relay cannot do — forgery is already impossible

- The round `R` is **computed, never read**: `lib/sampling.mjs:170` `selectRound(mtp)` →
  `lib/drand.mjs:40` `roundAtOrAfter(mtp + DELTA_SECONDS)`, from the Bitcoin median-time-past of block
  `H_rand + 6`. A relay has no input to which round is required.
- `lib/drand.mjs:94` refuses a beacon for any other round outright.
- The signature is verified **offline** against the pinned group public key (`lib/drand.mjs:11`) with
  the pairing equation `e(H(m), −PK) · e(S, G2) = 1` at `lib/drand.mjs:79-83`, message
  `sha256(uint64_be(R))`, hash-to-G1 per RFC 9380 with the pinned DST (`lib/drand.mjs:18`). The
  signature must be a canonical compressed, on-curve, prime-order, **non-identity** G1 point
  (`lib/drand.mjs:70, 75`).
- `lib/drand.mjs:98` requires `randomness === sha256(signature)`, so a relay cannot report one value and
  sign another.

**Therefore: a one-relay bundle makes exactly the same cryptographic claim about the randomness value as
a ten-relay bundle.** A single malicious relay cannot forge a beacon, cannot substitute a different
round, and cannot bias the seed. Adding a relay-count floor buys **nothing** here. Any argument for
option (b) that rests on forgery is wrong.

### 3.2 What a lying or absent relay *can* do — withholding and misreporting

Exactly two things, and both are about **state**, not value:

1. **Withholding.** A relay that serves nothing (or serves a 404 for round `R`) produces a bundle with
   no entry for `R`. `lib/sampling.mjs:185` then reports `WAITING_DRAND_ROUND`; after 30 days of chain
   time, `lib/sampling.mjs:182-183` reports `STUDY_VOID_RANDOMNESS_UNAVAILABLE`. That is a **false VOID**
   — the round existed, and the stage is destroyed by one relay's outage. Because the missing-round
   expiry is absolute and there is **no substitute round**, this is unrecoverable.
2. **Misreporting availability.** A relay can claim a round does not exist. The bundle cannot
   distinguish "the round does not exist" from "this relay did not serve it" — §20.17 says so in the
   protocol's own words.

### 3.3 The adversarial reading, stated exactly

The attacker model that matters is **not** an outside forger. It is the **operator as a selective
reporter of unavailability**:

- The operator cannot choose the seed. `R` is MTP-derived; the seed is
  `sha256("cpg-u1-chain-drand-seed/v1|S|digest|txid|H_commit|H_rand|blockhash(H_rand)|chain|R|randomness")`
  (`lib/sampling.mjs:45-52`) over inputs that are all fixed by the chain once the commitment confirms.
  There is no round to choose among and no `--seed` argument anywhere.
- The **only** lever is **proceed vs. void**. An operator who fetches from one relay and reports a miss
  can, after 30 days of chain time, convert a stage into `STUDY_VOID_RANDOMNESS_UNAVAILABLE`. A
  relay-count floor in the bundle would not close this either: **a withheld beacon is an absent beacon,
  and a floor cannot force the operator to supply what they claim not to have.** A floor turns
  "one relay, proceed" into a refusal; it cannot turn "no relays, void" into anything.
- What closes it is §21: the **outsider** fetches `R_dev` and `R_ho` from ≥ 2 relays themselves, against
  the published sampling record, and contradicts a false unavailability claim from outside. That is
  where the protocol put the duty, and it is the only place it can live.

### 3.4 The honest-mistake reading

Far more likely than any attack: the operator uses one relay, it is down or lagging during the finality
window, and the operator records `WAITING_DRAND_ROUND` and then — after 30 days of chain time — a VOID
that was avoidable. **Nothing is forged; the study is simply lost.** The mitigation for this is
operational (fetch from several relays, retry), and it works whether or not the tooling enforces a floor.

### 3.5 What option (b) would actually buy

Precisely one thing, and it is a real thing: **per-relay attribution recorded inside the bundle**, so
that an outsider replaying `verify-sampling` can see *which* relays attested each round instead of
having to take the operator's word from the §13.2A archive narrative. That is an **auditability** gain,
not a security gain. It also makes the §5.10 rule at protocol line 437 ("persistent randomness
verification failure across ≥ 2 sources within 30 days → study VOID") checkable against the bundle
rather than only against prose.

## 4. The three options

### Option (a) — accept as procedural; disclose in the registration note

**What it means.** Register the instrument at aggregate `f7699f05…` unchanged. State in the registration
narrative, in terms, that the ≥ 2-relay requirement of §19.3 / §21 step 5 is an operator-and-outsider
procedure, that the bundle records no relay identity, and that the relay identities used for each round
are recorded in the §13.2A archive rather than in the bundle. `HEADER_AND_RELAY_SOURCES.md` §2.2 already
lists exactly what to record per relay.

| | |
|---|---|
| **Aggregate impact** | **None.** The registered `tooling_aggregate_sha256` stays `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`. |
| **Registration invalidated?** | **No.** Nothing changes. |
| **Re-verification forced** | **None.** No self-test run, no mutation run, no adapter conformance run, no rebuild is required. |
| **Residual** | The bundle alone cannot evidence relay plurality. The claim rests on the §13.2A archive and on §21's outsider step — which is where §20.17 already places it. |
| **Consistency with the protocol** | High: §20.17 already discloses precisely this limitation, so option (a) is *agreement* with the frozen protocol, not a concession. |

### Option (b) — add a relay-count floor with per-relay attribution **before** registration

**What it means.** Apply the patch in §5, re-verify the instrument end to end, recompute the aggregate,
correct the identity table in the five documents of the previous wave, then run `registration-fields`
and register the **new** aggregate.

| | |
|---|---|
| **Aggregate impact** | The aggregate **moves off `f7699f05…`** to a new value. Files touched: `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/selftest.mjs`, `test/mutate.mjs`, `README.md` — five files, therefore five changed lines in the manifest text, therefore a new `sha256`. The manifest is over **every** file of the tree including vendored dependencies (`lib/aggregate.mjs:8-22`), so there is no "small" change. |
| **Registration invalidated?** | **No — because nothing is registered yet.** `registration-fields` does not accept an aggregate as input; it calls `toolingManifest(ROOT).aggregate` at run time (`cpg_u1_data.mjs:269`) and writes whatever the tree hashes to. The new value simply becomes the registered one. **This is the only window in which the instrument may be changed at all.** |
| **Re-verification forced** | Full, and this is the cost: (1) `node test/selftest.mjs` with `CPG_U1_RESOLVER_CLONE` set to the clean clone at `f01a7eb4199be4e04d4fee7fc0116303949dc553` — expected exit 0; (2) `node test/mutate.mjs --anchors` — the anchor count **rises from 389 to 391** with the two new mutants, and every anchor must still occur exactly once; (3) the **full** mutation run `CPG_U1_ADAPTER_CLONE=… CPG_U1_RESOLVER_CLONE=… node test/mutate.mjs --jobs 4` — every one of the 391 mutants must be KILLED; this is the expensive step and it is not optional, because the two new guards are worthless unkilled; (4) `CPG_U1_RESOLVER_CLONE=… node test/adapter_conformance.mjs` — unaffected by the patch in principle, but it is part of the instrument's verified status and the aggregate that carries that status has changed; (5) recompute the aggregate and **rebuild the identity table** in `REGISTRATION_PACKAGE.md`, `OPERATOR_CHECKLIST.md`, `REMAINING_FIELDS.md`, `HEADER_AND_RELAY_SOURCES.md` and `BITCOIN_RANDOMNESS_RUNBOOK.md`, all five of which quote `f7699f05…` as the instrument's identity. |
| **Second-order decision the owner must also make** | The patch is a **breaking change to the operator's beacon input shape**: each beacon object must now carry a `relay` string, and each round must be supplied by ≥ 2 differently named relays. `EVIDENCE_SCHEMA` is `cpg-u1-sampling-evidence/v1`; the owner must decide whether to bump it to `/v2`. Bumping it is itself another aggregate-moving edit and changes every fixture-built bundle in the self-test. **This memo does not choose.** |
| **What it buys** | §3.5 — per-relay attribution inside the bundle, verifiable by an outsider from the bundle alone. Not a security gain; an auditability gain. |
| **What it does not buy** | §3.1 (forgery was already impossible) and §3.3 (a withheld beacon is still an absent beacon; the floor cannot compel disclosure). |

### Option (c) — add it **after** registration

**This is not a real option. It is "void the study".** Stated explicitly so the owner can rule it out
rather than rediscover it later:

| | |
|---|---|
| **Aggregate impact** | Fatal. `registered()` recomputes the aggregate on **every** sampling command and aborts: `cpg_u1_data.mjs:178-179` → `VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate …) is not the registered tooling`. `lib/harness.mjs:44` refuses identically (`TOOLING_MISMATCH`). So after a post-registration patch there is no `verify-registration`, no `verify-sampling`, no `derive-seed`, no `draw-*`, no `harness-*`. |
| **Registration invalidated?** | **Effectively yes.** The registered record remains on OSF but is unreachable by the patched instrument. And **re-registering to fix it voids the study**: `tooling_aggregate_sha256` is in `SAMPLING_FIELDS` (`lib/registration.mjs:119`), and `checkAuthority` (`lib/registration.mjs:140-141`) makes a duplicate registration with different sampling fields a VOID; the earliest registration wins (`:135-136`). |
| **Worse after the development commitment** | The aggregate is inside the commitment payload (`lib/commitment.mjs:11` `PAYLOAD_KEYS`) whose digest is broadcast in the OP_RETURN. After operator-checklist step D4, the registered aggregate is **on the Bitcoin blockchain**. There is no lawful edit at that point. |
| **Re-verification forced** | Irrelevant — no amount of re-verification restores reachability. |
| **The only lawful form of (c)** | Patch the instrument, use it for **nothing** in CPG-U1, and carry the change forward to a future study (U2) with its own registration. |

## 5. The exact patch for option (b) — **NOT APPLIED**

Presented so the owner can price it. It was **not written to any file, in any tree**. It is designed to
preserve the existing mutation anchors of M411 and M412 byte-for-byte, so that only *new* anchors are
added and no existing anchor breaks.

```diff
--- a/lib/evidenceBundle.mjs
+++ b/lib/evidenceBundle.mjs
@@ -10,6 +10,8 @@
 const HEX64 = /^[0-9a-f]{64}$/;
 const HEADER = /^[0-9a-f]{160}$/;
 const STAGES = ['development', 'held-out'];
+/** §19.3 / §21 step 5: every round must be attested by at least this many differently named relays. */
+const MIN_RELAYS = 2;
 
@@ -31,13 +33,21 @@ function proof(p, what) {
 function beacons(list) {
   const byRound = new Map();
   for (const [i, b] of list.entries()) {
     if (!b || !Number.isSafeInteger(b.round) || b.round < 1 || typeof b.randomness !== 'string' || typeof b.signature !== 'string') throw new Error(`drand beacon ${i}: must carry round, randomness and signature`);
-    const v = { round: b.round, randomness: b.randomness, signature: b.signature };
+    if (typeof b.relay !== 'string' || !b.relay.trim()) throw new Error(`drand beacon ${i}: must name the relay it came from (§19.3 requires ${MIN_RELAYS} differently named relays per round)`);
+    const v = { round: b.round, randomness: b.randomness, signature: b.signature, relays: [b.relay] };
     const prior = byRound.get(b.round);
     if (prior && (prior.randomness !== v.randomness || prior.signature !== v.signature)) throw new Error(`drand beacons disagree for round ${b.round} — relays returned different values; do not choose one`);
+    if (prior) { if (!prior.relays.includes(b.relay)) prior.relays.push(b.relay); continue; }
     byRound.set(b.round, v);
   }
+  for (const v of byRound.values()) {
+    v.relays.sort();
+    if (v.relays.length < MIN_RELAYS) throw new Error(`drand round ${v.round} is attested by ${v.relays.length} relay(s) (${v.relays.join(', ')}); §19.3 requires at least ${MIN_RELAYS} differently named relays — do not proceed on one relay`);
+  }
   return [...byRound.values()].sort((a, b) => a.round - b.round);
 }
```

```diff
--- a/lib/sampling.mjs
+++ b/lib/sampling.mjs
@@ -186,6 +186,9 @@
   }
+  // §19.3 / §21 step 5: the round must be attested by ≥ 2 differently named relays. Checked only once a
+  // beacon IS present, so that absence stays WAITING_DRAND_ROUND / STUDY_VOID_RANDOMNESS_UNAVAILABLE.
+  const relays = new Set(Array.isArray(beacon.relays) ? beacon.relays.filter((r) => typeof r === 'string' && r.trim()) : []);
+  if (relays.size < 2) throw new EvidenceError(`drand round ${round} is attested by ${relays.size} named relay(s); the protocol requires at least 2 (§19.3)`);
   let randomness;
   try { randomness = verifyBeacon(ev.drand.chain_info, beacon, round); } catch (e) { throw new EvidenceError(e.message); }
```

```diff
--- a/test/mutate.mjs
+++ b/test/mutate.mjs
@@ -455,4 +455,6 @@
   ["M415 malformed transaction hex accepted by the builder", EBU, "if (typeof p.tx_hex !== 'string' || !HEX.test(p.tx_hex)) throw", "if (false) throw"],
+  ["M416 beacon accepted without a named relay", EBU, "if (typeof b.relay !== 'string' || !b.relay.trim()) throw", "if (false) throw"],
+  ["M417 single-relay round accepted", SAM, "if (relays.size < 2) throw new EvidenceError(", "if (false) throw new EvidenceError("],
 ];
```

Also required, and the reason this is not a three-file change:

- `test/selftest.mjs` — **twelve** beacon sites must be updated: lines **518**, **554**, **555**, **556**,
  **559**, **562**, **1299/1304**, **1335**, **1465-1469**, **1472**, **1477**, **1488**. The archived
  fixtures (`test/fixtures/drand/quicknet_round_*.json`) carry only `{round, randomness, signature}` and
  are **public known-answer vectors covered by `test/fixtures/PROVENANCE.json`** — they must **not** be
  edited. Relay names must be attached at the use sites, e.g.
  `const relayed = (r, n) => ({ ...ROUND[r], relay: n });` with lists built as
  `[relayed(1, 'relay-a'), relayed(1, 'relay-b'), …]`. Two existing assertions **invert** and must be
  rewritten, not merely adjusted:
  - line **1488** currently asserts `'only round/randomness/signature are kept'` and passes
    `extra: 'relay metadata'` as a field that must be discarded — after the patch relay metadata is
    *retained*, so this test's meaning reverses;
  - line **1472** asserts the CLI bundle is `canonicalJson`-identical to the hand-built reference
    document — the reference must gain `relays` arrays or the assertion fails.
  New positive and negative cases must be added: a two-relay round is accepted and records both relay
  names sorted; a one-relay round is refused at bundle time; a `relays`-less beacon reaching
  `evaluateStage` directly is an `EvidenceError`.
- `README.md` — the `--drand-beacons` documentation and the §13.2A evidence table must state the new
  required `relay` field and the floor.
- `EVIDENCE_SCHEMA` — see the second-order decision in option (b)'s table. **Undecided here.**

## 6. Validation actually performed for this memo

### 6.1 Commands run (real output)

| Command | Result | Status |
|---|---|---|
| `sha256sum research/cpg-u1/CPG_U1_PROTOCOL_004.md` in `C:/tmp/dt4-reg` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | **VERIFIED** (matches the registered value) |
| Replication of `lib/aggregate.mjs` `toolingManifest()` against `C:/tmp/dt002/research/cpg-u1/tooling` (read-only script in the session scratchpad) | `files: 593`, `aggregate: f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | **VERIFIED** |
| `node test/mutate.mjs --anchors` | `anchors: 389/389 occur exactly once`, exit **0** | **VERIFIED** |

### 6.2 Deliberately NOT run

| Check | Status | Why |
|---|---|---|
| `node test/selftest.mjs` | **NOT RUN** | Requires `CPG_U1_RESOLVER_CLONE`; not needed to establish any claim in this memo, and the instrument's verified status was handed to this task as baseline. |
| `node test/mutate.mjs --jobs 4` (full) | **NOT RUN** | Requires `CPG_U1_ADAPTER_CLONE` + `CPG_U1_RESOLVER_CLONE`; long-running. Listed as a **cost of option (b)**, not as a result. |
| `node test/adapter_conformance.mjs` | **NOT RUN** | Same. |
| Any drand fetch | **NOT RUN — PROHIBITED** | No network access was used. No relay was contacted. |
| Applying the §5 patch | **NOT DONE — PROHIBITED** | The patch exists only inside this memo. |

---

## 7. DECISION REQUIRED — DR-1

**PROBLEM.** Protocol-004 names "≥ 2 drand relays" as an execution prerequisite (§19.3, protocol line
961) and as an outsider verification step (§21 step 5, line 997), but the instrument enforces **no
minimum relay count** and **records no relay identity**. `lib/evidenceBundle.mjs:31-41` deduplicates
beacons by round and refuses disagreement while rebuilding each entry from exactly
`{round, randomness, signature}` (line 35), so relay metadata is discarded — asserted on purpose by
`test/selftest.mjs:1488`. `lib/sampling.mjs:180` needs the **single** beacon for the tooling-computed
round. `cpg_u1_data.mjs:1067` makes `--drand-beacons` optional and ties no file to a relay. The
requirement is therefore procedural, not mechanical.

**AFFECTED ARTIFACT.** The verified instrument at `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) — specifically
`lib/evidenceBundle.mjs`, `lib/sampling.mjs`, and consequentially `test/selftest.mjs`, `test/mutate.mjs`
and `README.md`. Downstream: the `tooling_aggregate_sha256` field of the registration record, both stage
manifests (`lib/harness.mjs:49, :155`), the execution authorization (`lib/execution.mjs:65`) and the
on-chain commitment payload (`lib/commitment.mjs:11`).

**CONSEQUENCE.**
- *Cryptographically, nothing.* Forgery is already impossible: `R` is MTP-derived, not relay-reported
  (`lib/sampling.mjs:170`); the beacon is BLS-verified offline against the pinned quicknet group key and
  `randomness == sha256(signature)` (`lib/drand.mjs:63-99`). A one-relay bundle makes the same claim
  about the randomness **value** as a ten-relay bundle.
- *What is exposed is state, not value:* withholding and misreporting. One relay's outage during the
  finality window can drive a stage to `WAITING_DRAND_ROUND` and then, after 30 days of chain time, to
  the irrecoverable `STUDY_VOID_RANDOMNESS_UNAVAILABLE` (`lib/sampling.mjs:182-185`) even though the
  round existed. A relay-count floor **cannot** fix this, because a withheld beacon is an absent beacon.
- *What is genuinely lost today is auditability:* a bundle from one relay and a bundle from ten are
  byte-identical, so an outsider cannot check the ≥ 2-relay claim from the bundle. §20.17 (line 981) and
  §21 step 5 already place that duty on the outsider's own fetching.

**OPTIONS.**
- **(a) Accept as procedural; disclose in the registration note.** Aggregate unchanged (`f7699f05…`).
  No re-verification. Relay identities and per-round attribution recorded in the §13.2A archive instead
  of the bundle. Consistent with §20.17.
- **(b) Add the floor with per-relay attribution BEFORE registration** (patch in §5). Aggregate moves to
  a new value, which then becomes the registered value. Forces: full self-test, the **full** 391-mutant
  run (anchor count 389 → 391, all mutants KILLED), adapter conformance, twelve self-test beacon sites
  rewritten including two assertions whose meaning inverts (1472, 1488), README update, and a rebuild of
  the identity table in all five prior registration documents. Requires a separate owner decision on
  whether to bump `EVIDENCE_SCHEMA` from `cpg-u1-sampling-evidence/v1`. Buys per-relay attribution
  inside the bundle; buys no security.
- **(c) Add it AFTER registration.** **Do not.** Every sampling command recomputes the aggregate and
  aborts `VERIFY_ABORT_HASH_MISMATCH` (`cpg_u1_data.mjs:178-179`; `lib/harness.mjs:44`), and
  re-registering to fix it is study VOID because `tooling_aggregate_sha256` is a sampling field
  (`lib/registration.mjs:119, :140-141`). After the development commitment the aggregate is on-chain
  inside the payload digest (`lib/commitment.mjs:11`). The only lawful form is: patch, use for nothing
  in CPG-U1, carry to a future study.

**WHETHER REGISTRATION WOULD BE INVALIDATED.**
- Option (a): **No.** Nothing changes; `f7699f05…` is registered as-is.
- Option (b): **No, if and only if it is done before `registration-fields` is run.** Nothing is
  registered yet, and `registration-fields` reads the aggregate from disk at run time
  (`cpg_u1_data.mjs:269`), so the new aggregate simply becomes the registered one. The five prior
  documents' identity tables become stale and **must** be corrected in the same sitting.
- Option (c): **Yes, in effect.** The registration stays on OSF but becomes unusable, and the repair
  (re-registration) is itself a VOID condition. Irreversible once the development commitment is
  broadcast.

**OWNER MUST DECIDE:** (a), (b) or (c) — and, if (b), whether `EVIDENCE_SCHEMA` is bumped.
**UNASSIGNED — the study owner / methodological authority. This memo decides nothing.**
