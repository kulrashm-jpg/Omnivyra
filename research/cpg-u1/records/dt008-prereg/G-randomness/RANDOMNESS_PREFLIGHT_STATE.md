# CPG-U1 RANDOMNESS PREFLIGHT STATE — seven items, each with its exact command

**DEEPTECH-PARALLEL-008 / stream G (randomness preflight).**

**CLASSIFICATION: PREPARATION.** This document decides nothing and commits nothing. **No Bitcoin transaction
was created, funded or broadcast. No official commitment exists. No network call was made. No credential or
wallet was touched. No txid, outpoint, height, block hash, drand round or address is stated anywhere in this
stream — every such value is an unfilled marker.** No protocol byte and no instrument byte was modified.

> **FILENAME NOTE.** The task named this file `RANDOMNESS_READINESS.md`. That name is **silently ignored** by
> `.gitignore:51` (`*_READINESS*.md`) — verified:
> `git check-ignore -v research/.../RANDOMNESS_READINESS.md` → `.gitignore:51:*_READINESS*.md`.
> It is therefore named `RANDOMNESS_PREFLIGHT_STATE.md`, which `git check-ignore` reports as **trackable**.
> Do not rename it back. The same trap applies to `*_CHECKLIST.md` (:50), `*_RUNBOOK*.md` (:58) and
> `ROLE_*.md` (:77).

---

## 0. Baseline, recomputed in this stream

| Value | Computed here | Matches the handed baseline |
|---|---|---|
| Protocol `CPG_U1_PROTOCOL_004.md` (100929 bytes) | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | **YES** |
| Instrument aggregate at `C:/tmp/dt002/research/cpg-u1/tooling` | `<NEW_AGG>` over **<NEW_N> files** | **YES** |
| Registry `rules/development_only_registry.json` | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | (preflight expectation) |
| Provider configuration SHA | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | **YES** |
| Treatment clone `C:/tmp/cpg049_integration/treatment` HEAD | `f01a7eb4199be4e04d4fee7fc0116303949dc553`, **0 porcelain lines** | **YES** |
| Treatment clone root tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | **YES** |
| Treatment clone content aggregate (printed by the selftest) | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` over **11552 files** | **YES** |

**Trap 1 confirmed, not walked into.** This worktree's own `research/cpg-u1/tooling` recomputes to
`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` over **587 files** — a *self-consistent
wrong* aggregate. Every command in this document therefore passes
`CPG_U1_TOOLING=C:/tmp/dt002/research/cpg-u1/tooling` **explicitly**. Never rely on a default.

**Trap 2 not used.** No `main` ref was read. `origin/main` is `33bceb1f919113c622587fa7c6403a0d4596bbad` if it is
ever needed; `git rev-parse main` inside a worktree returns the stale `fef341785dffcbaf4c3a5ac715a6ce63b58e58c2`.

**Trap 3 handled.** `preflight.mjs` resolves the protocol relative to its own location. It was run from the
relocated copy `C:/tmp/dt004-operations/execution/tools` **with `--protocol` passed explicitly**, and exited
**0** with `OFFLINE PRECONDITIONS SATISFIED (0 failed, 0 not run, 10 checks)`. See §1.

---

## 1. Offline checks actually run in this stream — real exit codes

| # | Command (all offline) | Result | Exit |
|---|---|---|---|
| 1 | `CPG_U1_TOOLING=C:/tmp/dt002/research/cpg-u1/tooling CPG_U1_RESOLVER_CLONE=C:/tmp/cpg049_integration/treatment node preflight.mjs --protocol C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md` (from `C:/tmp/dt004-operations/execution/tools`) | `OFFLINE PRECONDITIONS SATISFIED (0 failed, 0 not run, 10 checks)`; 10/10 rows PASS/INFO; adapter conformance **18 passed, 0 failed**; 34 fail-closed refusal codes enumerated | **0** |
| 2 | `CPG_U1_RESOLVER_CLONE=C:/tmp/cpg049_integration/treatment node test/selftest.mjs` (in the frozen instrument) | **`selftest: 1022 passed, 0 failed`**; printed the evaluation-tree verification (`ffe4f603…`, 11552 files) and `scan_sha256: 7e711d2b81e04d62278caa1a8c03f1e6e2a6c3c0692f87038d64a94a1b8efd50` | **0** |
| 3 | `node test/mutate.mjs --anchors` | `anchors: 389/389 occur exactly once` | **0** |
| 4 | `node cpg_u1_data.mjs verify-protocol --protocol ../CPG_U1_PROTOCOL_004.md` | `protocol states every pinned parameter; protocol_sha256: c50fc680…` | **0** |
| 5 | `node cpg_u1_data.mjs check-funding-prerequisites --registration <draft>` | `BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)` / `ERROR: BLOCKED — 1 named prerequisite(s) missing; the tooling will not invent them` | **4** |
| 6 | `CPG_U1_TOOLING=… node test_tools.mjs` (operator tools) | `F2 operator tools: 54 passed, 1 failed` — the one "failure" is `preflight tests NOT RUN (CPG_U1_RESOLVER_CLONE unset)`, which the harness deliberately reports as a failure rather than a pass | **1** |
| 7 | `CPG_U1_TOOLING=… node collection_precheck.mjs` (no inputs) | `VERDICT: INCOMPLETE — nothing wrong so far; parts are still missing`; names all five REQUIRED human inputs | **1** |
| 8 | `CPG_U1_TOOLING=… node relay_attribution.mjs --beacon "SYNTHETIC-DEMO-RELAY-A=<archived fixture>"` | `VERDICT: FEWER THAN TWO DISTINCT RELAYS FOR AT LEAST ONE ROUND` + the §19.3 warning | **1** |
| 9 | `CPG_U1_TOOLING=… node event_log_chain_demo.mjs` (this stream, §7) | `RESULT: 17 passed, 0 failed` | **0** |
| 10 | `CPG_U1_TOOLING=… node sampling_delay_derivation.mjs` (this stream, §6) | schedule model printed; `drand DELTA rule` binds; **5.167 h** per stage from `H_commit` | **0** |

**The selftest precondition, stated so nobody misreports it.** `test/selftest.mjs` requires
`CPG_U1_RESOLVER_CLONE`. **Without it the selftest exits 2 on a precondition. Exit 2 is NOT a test failure and
must never be reported as one.** With `CPG_U1_RESOLVER_CLONE=C:/tmp/cpg049_integration/treatment` it is
**1022 passed, 0 failed, exit 0**.

Item 6 has the mirror-image trap: `test_tools.mjs` exits **1** with "1 failed" purely because
`CPG_U1_RESOLVER_CLONE` was unset for the preflight sub-tests, which it refuses to score as a pass. With the
clone set, that row runs; the 54 substantive assertions passed either way.

---

## 2. The seven readiness items

Each item states: **PREPARED** (what exists), **VERIFIED OFFLINE** (what was actually checked here),
**NEEDS THE CUSTODIAN / OPERATOR** (what no tool can do), and **COMMAND** (exact, with arguments).

Throughout: `$I = C:/tmp/dt002/research/cpg-u1/tooling`, `$C = C:/tmp/cpg049_integration/treatment`,
`$P = C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md`,
`$T = C:/tmp/dt004-operations/execution/tools`,
`REG="--registration reg.json --identity-registrations identity_regs.json --protocol $P"`.

---

### Item 1 — Bitcoin funding output procedure (§5.5.2)

**PREPARED.** `BITCOIN_RANDOMNESS_RUNBOOK.md` §1–§2 (registration package) specifies the two outputs.
Protocol §5.5.2, verified verbatim against the file at `c50fc680…`:

- **Key custodian is `STUDY_OPERATOR`; the person is UNASSIGNED.** `check-funding-prerequisites` is
  **BLOCKED** until named.
- `O_dev` and `O_ho` are **distinct single-signature P2WPKH outputs**.
- Each funding transaction needs **≥ D = 6 confirmations at the checkpoint**:
  `funding_height + 6 − 1 ≤ checkpoint_height` — enforced at `lib/sampling.mjs:108`
  (`if (f.height + D - 1 > cp.height) return … VOID_REGISTRATION`).
- An outpoint spent **at or before the checkpoint** → **study VOID** (`lib/sampling.mjs:126`).
- **"The tooling creates no wallet, no key, no transaction."** That sentence is in the protocol.

**VERIFIED OFFLINE.** `D = 6` read from `lib/sampling.mjs:13`. The P2WPKH shape rule is `isP2wpkh` in
`lib/bitcoin.mjs`, applied per stage at `lib/sampling.mjs:107`. `check-funding-prerequisites` returns the real
custodian block (exit **4**, §1 item 5). Funding *values*: **NONE EXIST.**

**NEEDS THE CUSTODIAN.** Everything: naming the custodian, key generation and custody, creating and funding two
distinct P2WPKH outputs, broadcasting, and choosing the checkpoint after both have depth 6. **Not started, and
nothing in this stream started it.**

**COMMAND (the only one runnable before funding).**
```
cd $I
node cpg_u1_data.mjs check-funding-prerequisites --registration reg.json
```
Must print **no BLOCKED lines** and exit **0** before any funding transaction is created.

---

### Item 2 — Commitment procedure (§5.5.3)

**PREPARED.** The exact on-chain form, verified in both the protocol and `lib/bitcoin.mjs:305-310`:

```
OP_RETURN script = 6a 27 ‖ "CPGU1" ‖ 01 ‖ <stage byte> ‖ <32-byte digest>      (41 bytes total)
stage byte:  0x44 = development ('D')   0x48 = held-out ('H')
digest    =  sha256("cpg-u1-commitment-digest/v1|" + canonicalJson(payload))
```
`decodeCommitment` (`lib/bitcoin.mjs:316-324`) requires **exactly one** OP_RETURN output, length exactly 41,
`s[1] === 0x27`, the tag `CPGU1`, version `0x01`, and a stage byte that is `0x44` or `0x48`. Anything else →
**stage VOID, slot consumed, no retry**.

The payload is `cpg-u1-commitment/v1` with **exactly** these eleven keys, read from
`lib/commitment.mjs:11-12` (`PAYLOAD_KEYS`):
`schema`, `study_id`, `stage`, `registration_id`, `protocol_sha256`, `tooling_aggregate_sha256`,
`registry_sha256`, `frame_hash`, `scan_sha256`, `outpoint`, `binding`.
`binding` is `null` for development; for held-out it has **exactly** the seven `BINDING_KEYS`
(`lib/commitment.mjs:13-14`): `development_commitment_txid`, `development_payload_digest`,
`development_manifest_sha256`, `development_frame_hash`, `pilot_result_sha256`, `sizing_sha256`,
`append_only_proof` — the last with exactly `APPEND_ONLY_KEYS`
(`development_frame_hash`, `held_out_frame_hash`, `development_row_hashes_sha256`, `proof`).
`STUDY_ID` is `CPG-U1-2026-01` (`lib/commitment.mjs:5`).

**VERIFIED OFFLINE.** Key sets, digest domain and script encoding read directly from the frozen instrument.
`checkPayload` refuses a `registration_id` of `UNASSIGNED` or containing `|` (`lib/commitment.mjs:28-30`), so a
payload **cannot** be built before a real registration identifier exists.

**NEEDS THE CUSTODIAN / OPERATOR.** A registration identifier; the frame CSV and the scan; then building,
signing and broadcasting a transaction that spends the correct slot and carries the script above. **No
commitment payload has been built in this stream and none may be.**

**COMMAND.**
```
cd $I
node cpg_u1_data.mjs commitment-payload --stage development $REG \
  --frame F1.csv --scan scan1.json --registry rules/development_only_registry.json \
  --out payload_dev.json
# held-out, only after the seal:
node cpg_u1_data.mjs commitment-payload --stage held-out $REG \
  --frame F2.csv --scan scan2.json --registry rules/development_only_registry.json \
  --dev-manifest dev/manifest.json --sizing sizing.json --evidence ev.json --out payload_ho.json
```
It prints the digest **and the exact OP_RETURN script**. The custodian must reproduce that script byte for
byte; the tooling never builds the transaction.

---

### Item 3 — Checkpoint verification

**PREPARED.** The checkpoint is a `{height, hash}` pair in the registration record. `verifyArchive` binds both
header archives to it (`lib/sampling.mjs:59-61`), and the study is VOID if either funding output lacks depth 6
at that height, or if either slot was spent at or before it.

**VERIFIED OFFLINE.** `confirmations(tip, h) = tip − h + 1` (`lib/bitcoin.mjs:185`). `verify-archive` exists as
a standalone command, so the checkpoint can be checked **before** registration is filed.

**NEEDS THE CUSTODIAN.** The checkpoint height and hash, and two header archives that reach it.
**`<<UNFILLED: checkpoint_height>>` and `<<UNFILLED: checkpoint_hash>>` — invented nowhere in this stream.**

**COMMAND.**
```
cd $I
node cpg_u1_data.mjs verify-archive --network bitcoin-mainnet \
  --checkpoint-height <<UNFILLED: checkpoint_height>> \
  --checkpoint-hash   <<UNFILLED: checkpoint_hash>> \
  --archive headers_a.json --crosscheck headers_b.json
```

---

### Item 4 — Header cross-check (§19.3: "two independent Bitcoin header sources (or an own node)")

**PREPARED.** `header_crosscheck_report.mjs` in `$T`. It refuses two archives that **name the same source**
(`lib/evidenceBundle.mjs:53`, `lib/sampling.mjs:64-66`), reports each start height, whether it is a retarget
boundary, both tips, the agreed range and the **first disagreeing height**. `evaluateStage` then counts
**only blocks both sources agree on** (`lib/sampling.mjs:69-70`).

**VERIFIED OFFLINE.** The refusal is a real mechanical check, and it is mutation-covered as
`M411 one header source accepted twice`. Every consensus rule comes from `lib/bitcoin.mjs`
(`verifyHeaderChain`, `crosscheckArchives`, `confirmations`) — nothing is re-implemented in the tool.

**NEEDS THE OPERATOR.** Two archives from two genuinely **differently operated** sources. The tooling checks
that the two `source` *strings* differ; **it cannot check that the operators are independent.** That is a
procedural claim the operator must make and record.

**COMMAND.**
```
cd $T
CPG_U1_TOOLING=$I node header_crosscheck_report.mjs \
  --headers headers_a.json --headers-crosscheck headers_b.json \
  --checkpoint-height <<UNFILLED: checkpoint_height>> --checkpoint-hash <<UNFILLED: checkpoint_hash>> \
  --depth-of <<UNFILLED: height whose depth you want>>
```
Exit **0** = both verify, name different sources, and agree over the overlap.

---

### Item 5 — drand relay verification (§19.3: "≥ 2 drand relays for verification")

**PREPARED.** The chain is **pinned**: quicknet, `period 3 s`, `genesis_time 1692803367`
(`lib/drand.mjs:12-13`), chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`.
`verifyBeacon` BLS-verifies each beacon under the pinned group key, so **a relay cannot forge randomness**.
`relay_attribution.mjs` in `$T` records, **outside the registered bundle**, which relay served which beacon.

**VERIFIED OFFLINE.** Run against one archived fixture round under a single obviously-synthetic relay name, it
exits **1** with:
`VERDICT: FEWER THAN TWO DISTINCT RELAYS FOR AT LEAST ONE ROUND`, and warns that
*"the registered tooling CANNOT detect this: a one-relay bundle is accepted"*.

**THE GAP — see `DR1_RELAY_FLOOR_DECISION.md`.** The instrument enforces **no minimum relay count** and
**records no relay identity**: a ten-relay bundle and a one-relay bundle are byte-identical. §19.3's "≥ 2" is
**procedural today**. **DECISION REQUIRED, and the window closes at registration.**

**NEEDS THE OPERATOR.** Fetching the same round from ≥ 2 differently operated relays, and the `/info`
document. `<<UNFILLED: drand round R_dev>>`, `<<UNFILLED: drand round R_ho>>` — **never invented; the round is
computed by the tooling from the chain, never read from the bundle.**

**COMMAND.**
```
cd $T
CPG_U1_TOOLING=$I node relay_attribution.mjs \
  --beacon "<<UNFILLED: relay 1 name>>=<<UNFILLED: relay 1 beacon file>>" \
  --beacon "<<UNFILLED: relay 2 name>>=<<UNFILLED: relay 2 beacon file>>" \
  --drand-chain-info info.json --at <<UNFILLED: collection time, ISO UTC>> \
  --out relay-attribution.json
```
Exit **0** = every round has ≥ 2 distinct relays that agree byte-for-byte. **Its output is an operator record,
not registered evidence — nothing reads it.**

---

### Item 6 — Sampling timeline (§5.7.1, §6, §6.5)

**PREPARED.** `sampling_timeline.mjs` in `$T` for the live case (it needs real headers), and
`sampling_delay_derivation.mjs` in this directory for the **schedule model**, which needs nothing but the
instrument.

**VERIFIED OFFLINE — the constants, read from the instrument, never restated:**
`D = 6`, `K = 12` (`lib/sampling.mjs:13-14`); `DELTA_SECONDS = 10800` (3 h, `lib/drand.mjs:20`);
quicknet `period 3 s`, `genesis_time 1692803367`; `ABANDONMENT_SECONDS` = 180 days;
`MISSING_ROUND_EXPIRY_SECONDS` = 30 days. The mechanism:
`H_rand = H_commit + K` → need tip ≥ `H_rand + D` → `MTP(H_rand + D)` → `R = first round scheduled ≥ MTP + Δ`.
**`medianTimePast(chain, h)` here is the median of the 11 timestamps at heights `h−10 … h` INCLUSIVE of `h`**
(`lib/bitcoin.mjs:106-115`) — under uniform spacing that is exactly `t(h−5)`, confirmed by real output.

**RESULT (real output, §6 below): the drand Δ rule binds, not block depth. 5.167 h per stage from `H_commit`.**

**NEEDS THE OPERATOR.** Real headers for the live tool; the window start (registration timestamp for
development, the development round time for held-out) — the tool **refuses to invent it** and reports the
abandonment deadline NOT COMPUTABLE without it.

**COMMAND.**
```
cd $T
CPG_U1_TOOLING=$I node sampling_timeline.mjs \
  --commitment commitment_dev.json --headers headers_a.json --headers-crosscheck headers_b.json \
  --stage development --registration reg.json --drand-beacons r1.json,r2.json
# model only, needs nothing external:
cd <this directory>
CPG_U1_TOOLING=$I node sampling_delay_derivation.mjs
```

---

### Item 7 — Event log (§6.5)

**PREPARED.** `lib/eventlog.mjs`. Schema `cpg-u1-harness-event/v1`; `GENESIS` = 64 zeros; `seq` starts at 1 and
increments; `prev_event_sha256` chains; `event_sha256 = sha256(canonicalJson(body))` **over the body with
`event_sha256` omitted**. 14 event types, 6 of them refusals. `EVENT_LOG_BROKEN` is one of the harness's 34
fail-closed refusals.

**VERIFIED OFFLINE — real output, `event_log_chain_demo.mjs`, `17 passed, 0 failed`, exit 0.** An edited
interior event, an edited-and-re-hashed one, a deletion, a reordering and an unknown type are **all refused**,
and `appendEvent` refuses to extend a broken chain. See §7.

**THE MODULE'S OWN CAVEAT, demonstrated.** A **truncated tail is accepted**, because a prefix of a valid chain
is itself a valid chain. Only a **published head hash** detects truncation or wholesale substitution. That is a
**procedural control the operator must perform**: publish the head hash and the event count at every
checkpoint.

**NEEDS THE OPERATOR.** Publishing the head hash. Also the whole authorisation chain around the log: the seal,
the **published seal record with a registry-issued timestamp** (which is what **opens** the execution window,
§6.5), and `authorize-execution`.

**COMMAND.**
```
cd <this directory>
CPG_U1_TOOLING=$I node event_log_chain_demo.mjs          # semantics, synthetic, repeatable
cd $I
node cpg_u1_data.mjs audit-execution-log --log events.jsonl   # the real audit (§6.5)
```

---

## 3. Summary of what is prepared vs. what is blocked

| Item | Prepared | Verified offline here | Blocked on |
|---|---|---|---|
| 1 Funding outputs | rules + command | `D=6` rule, custodian block (exit 4) | **custodian name, keys, two P2WPKH outputs, broadcast** |
| 2 Commitment | script form, 11 payload keys, digest domain | read from the frozen instrument | registration id, frame, scan, custodian signature |
| 3 Checkpoint | `verify-archive` command | depth arithmetic | checkpoint height + hash, two archives |
| 4 Header cross-check | tool exists, same-source refusal | refusal is mechanical, mutation-covered | two genuinely independent sources (a **procedural** claim) |
| 5 drand relays | pinned chain, BLS verify, attribution tool | one-relay case exits 1 with the warning | **DR-1 decision**, then ≥ 2 real relays |
| 6 Timeline | model + live tool | 5.167 h/stage, Δ binds | real headers, the window start |
| 7 Event log | chain semantics | 17/17 tamper demo | **publishing the head hash**; seal, seal record, authorisation |

---

## 4. Files in this stream

| File | Purpose | `git check-ignore` |
|---|---|---|
| `RANDOMNESS_PREFLIGHT_STATE.md` | this document | **TRACKABLE** |
| `DR1_RELAY_FLOOR_DECISION.md` | DR-1, with the real measured consequences | **TRACKABLE** |
| `CUSTODIAN_ACTION_SHEET.md` | ordered custodian sequence, all externals unfilled | **TRACKABLE** |
| `event_log_chain_demo.mjs` | event-log tamper demonstration (synthetic) | **TRACKABLE** |
| `sampling_delay_derivation.mjs` | schedule model from the instrument's own constants | **TRACKABLE** |
| ~~`RANDOMNESS_READINESS.md`~~ | **NOT USED** — ignored by `.gitignore:51` | ignored |

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

