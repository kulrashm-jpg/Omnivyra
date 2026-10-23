# CPG-U1 CUSTODIAN ACTION SHEET — funding to the held-out draw, in order

**DEEPTECH-PARALLEL-008 / stream G.**

**CLASSIFICATION: PREPARATION. THIS SHEET HAS NOT BEEN EXECUTED AND MUST NOT BE EXECUTED BY ANY AGENT.**
It is the ordered sequence a human custodian and operator follow. **No step below was performed. No Bitcoin
transaction was created, funded or broadcast. No official commitment exists. No network call, credential or
wallet was involved. No value in this sheet is real: every external value is an unmistakable unfilled marker
`<<UNFILLED: …>>`, and none has been invented, guessed, derived or filled in.**

Extends `C:/tmp/dt004-operations/registration/OPERATOR_CHECKLIST.md` (phases A–D) and
`BITCOIN_RANDOMNESS_RUNBOOK.md` (the external Bitcoin procedure). Where they disagree with this sheet on a
value, **they are right about policy and this sheet is right about command form** — this sheet was checked
against the instrument at `f7699f05…` in this stream.

---

## 0. Environment, fixed for every step

```
I=C:/tmp/dt002/research/cpg-u1/tooling        # the REGISTERED instrument — aggregate f7699f05…, 593 files
P=C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md    # c50fc680…
C=C:/tmp/cpg049_integration/treatment         # frozen resolver clone, f01a7eb4…, must be CLEAN
T=C:/tmp/dt004-operations/execution/tools     # operator tools (relocated copy)
REG="--registration reg.json --identity-registrations identity_regs.json --protocol $P"
```

**Three standing rules.**

1. **Always pass `CPG_U1_TOOLING=$I` explicitly.** Another tree in this programme
   (`C:/tmp/dt4-exec/research/cpg-u1/tooling`) is a **stale 587-file copy** that recomputes to
   `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`, **runs fine, and warns you of nothing.**
2. **`preflight.mjs` from the relocated copy needs `--protocol $P`**, or it reports NOT READY spuriously.
3. **Never `git rev-parse main` in a worktree** — it returns a stale ref. Use `origin/main`.

---

## Step 0 — Offline preflight (repeat before every later step)

**Preconditions.** None external.

```
cd $T
CPG_U1_TOOLING=$I CPG_U1_RESOLVER_CLONE=$C node preflight.mjs --protocol $P
```

**Evidence.** The printed table (save it).
**GATE:** exit **0** and `OFFLINE PRECONDITIONS SATISFIED (0 failed, 0 not run, 10 checks)`.
*Verified in this stream: exit 0, 10/10, adapter conformance 18 passed 0 failed.*
**Do not proceed on "OFFLINE CHECKS PASS, WITH SKIPPED CHECKS" — a skipped check is never a pass.**

---

## Step 1 — Name the custodian and clear the named prerequisites (§19.3)

**Preconditions.** The accountable OSF identity and persistent identifier exist (§19.3 item 1); the seven
mutually exclusive independent persons of §4A are identified (§19.3 item 3).

**This is a human act, not a command.** `bitcoin_key_custodian` is currently **UNASSIGNED** and the tooling
will not invent it.

```
cd $I
node cpg_u1_data.mjs check-funding-prerequisites --registration reg.json
```

**Evidence.** Its output.
**GATE:** exit **0** with no `BLOCKED` line.
*Real output against the current draft, in this stream:*
`BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)` / exit **4**.
**Nothing Bitcoin-related may begin until this exits 0.**

Fill: `<<UNFILLED: bitcoin_key_custodian — the named study operator>>`,
`<<UNFILLED: accountable OSF identity>>`, `<<UNFILLED: OSF persistent identifier>>`.

---

## Step 2 — Create the two funding outputs (§5.5.2) — **CUSTODIAN ONLY, NO TOOL**

**Preconditions.** Step 1 exits 0.

**The tooling creates no wallet, no key and no transaction. This step happens entirely outside it.**

The custodian must produce **two distinct single-signature P2WPKH outputs** on `bitcoin-mainnet`:

| | Value to record |
|---|---|
| `O_dev` address | `<<UNFILLED: development P2WPKH address>>` |
| `O_dev` outpoint | `<<UNFILLED: development txid>>:<<UNFILLED: development vout>>` |
| `O_dev` funding height | `<<UNFILLED: development funding height>>` |
| `O_ho` address | `<<UNFILLED: held-out P2WPKH address>>` |
| `O_ho` outpoint | `<<UNFILLED: held-out txid>>:<<UNFILLED: held-out vout>>` |
| `O_ho` funding height | `<<UNFILLED: held-out funding height>>` |

**Custody rules that cannot be delegated.**
- Each outpoint is spendable **once**. Custody cannot buy a second draw.
- **Losing a key means that stage cannot start → abandonment (§5.10).**
- Spending either outpoint **at or before the checkpoint** → **study VOID** (`lib/sampling.mjs:126`).
- The two outputs must be distinct; a transaction spending **both** → **STUDY_VOID_SLOT_CROSS_SPEND**.

**GATE:** both outputs exist, are P2WPKH, are distinct, and **neither has been spent**.

---

## Step 3 — Wait for depth, then choose the checkpoint

**Preconditions.** Step 2 complete.

**Rule (enforced, `lib/sampling.mjs:108`):** `funding_height + D − 1 ≤ checkpoint_height` with `D = 6`, **for
both** outputs. Violation → `STUDY_VOID_REGISTRATION`.

Record: `<<UNFILLED: checkpoint_height>>`, `<<UNFILLED: checkpoint_hash>>`.

**Collect two header archives from two differently operated sources** (§19.3), each
`{source, start_height, headers_hex[]}` with 80-byte headers as 160 lowercase hex characters.

```
cd $T
CPG_U1_TOOLING=$I node header_crosscheck_report.mjs \
  --headers headers_a.json --headers-crosscheck headers_b.json \
  --checkpoint-height <<UNFILLED: checkpoint_height>> \
  --checkpoint-hash   <<UNFILLED: checkpoint_hash>>

cd $I
node cpg_u1_data.mjs verify-archive --network bitcoin-mainnet \
  --checkpoint-height <<UNFILLED: checkpoint_height>> \
  --checkpoint-hash   <<UNFILLED: checkpoint_hash>> \
  --archive headers_a.json --crosscheck headers_b.json
```

**Evidence.** Both reports; both archive files.
**GATE:** both exit **0**; the two archives **name different sources**; they agree over the overlap; both funding
outputs have ≥ 6 confirmations at the checkpoint.
**The tooling checks the two `source` strings differ — it cannot check the operators are independent. Record
that claim yourself.**

---

## Step 4 — Decide DR-1, then build the registration record (§5.5.1)

**Preconditions.** Step 3 gated.

**DR-1 MUST BE ANSWERED HERE AND NOWHERE LATER.** See `DR1_RELAY_FLOOR_DECISION.md`. Once
`tooling_aggregate_sha256` is registered and inside the on-chain digest, changing the instrument **voids the
study**. Measured candidate aggregates if the floor is enforced: `5c69aa3f…` / `a50a4c75…` — **and neither is
final**, because the selftest rewrite is not done.

```
cd $I
node cpg_u1_data.mjs registration-fields --protocol $P \
  --registry rules/development_only_registry.json --out reg.json
node cpg_u1_data.mjs verify-protocol --protocol $P --registration reg.json
node cpg_u1_data.mjs verify-registration $REG --registry rules/development_only_registry.json
```

Fill: `<<UNFILLED: registration_id (OSF persistent identifier)>>`,
`<<UNFILLED: registration_timestamp (registry-issued)>>`, and the two outpoints and checkpoint from steps 2–3.

**Evidence.** `reg.json`, `identity_regs.json`, the three command outputs.
**GATE:** all three exit **0**; `tooling_aggregate_sha256` = the aggregate you will actually ship;
`protocol_sha256` = `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.

---

## Step 5 — File the registration at the registry — **HUMAN ACT**

**Preconditions.** Step 4 gated.

OSF, public, **no embargo**, accountable identity + persistent identifier (§19.2 U1).

**GATE:** the registry has issued a timestamp, and it is recorded as `registration_timestamp`.

**Two hard ordering rules, both enforced:**
- **`registration_timestamp` must be strictly before the scheduled time of `R_dev`**, or `verify-sampling`
  returns `STUDY_VOID_REGISTRATION` (`lib/sampling.mjs:175-176`).
- **Registration precedes frame construction** (§5.5.1). **Do not construct, enumerate, extend or reclassify
  any frame before this step is complete.**

---

## Step 6 — Frame and scan (§5.5, §5.3) — after registration, before the development commitment

```
cd $I
node cpg_u1_data.mjs frame --frame F1.csv
node cpg_u1_data.mjs scan --frame F1.csv --repo $C \
  --expect-sha f01a7eb4199be4e04d4fee7fc0116303949dc553 \
  --registry rules/development_only_registry.json --out scan1.json
```

**Evidence.** `F1.csv`, `scan1.json`, the printed `frame_hash` and `scan_sha256`.
**GATE:** both exit 0. **The frame is enumerated once and never extended. One frame and one scan serve both
stages** — the held-out payload's `frame_hash` and `scan_sha256` must equal the development payload's, or the
held-out stage is VOID.

---

## Step 7 — Build the development commitment payload (§5.5.3)

```
cd $I
node cpg_u1_data.mjs commitment-payload --stage development $REG \
  --frame F1.csv --scan scan1.json --registry rules/development_only_registry.json \
  --out payload_dev.json
```

**Evidence.** `payload_dev.json`, the printed digest, and **the exact OP_RETURN script**.
**GATE:** exit 0. The payload has **exactly** the eleven `PAYLOAD_KEYS` with `binding: null`.

Record: `<<UNFILLED: development payload digest (printed by this command)>>`.

---

## Step 8 — Broadcast the development commitment — **CUSTODIAN ONLY, NO TOOL**

**Preconditions.** Step 7 gated.

The transaction must: spend **`O_dev` only**; carry **exactly one** OP_RETURN output whose script is exactly

```
6a 27 ‖ "CPGU1" ‖ 01 ‖ 44 ‖ <32-byte development digest>        (41 bytes; 0x44 = 'D' = development)
```

**Any deviation consumes the slot and VOIDS the stage. There is no retry.** Reproduce the script printed in
step 7 **byte for byte** — do not retype it.

Record: `<<UNFILLED: development commitment txid>>`, `<<UNFILLED: development commitment height H_commit_dev>>`.

**GATE (before step 9):** the transaction is confirmed and `decodeCommitment` accepts its OP_RETURN. Check via
step 9's precheck — **do not** attempt a second commitment if it looks wrong; a wrong commitment is terminal.

---

## Step 9 — Wait, collect, precheck (§5.7.1)

**The wait is arithmetic, not judgement** (derived in `sampling_delay_derivation.mjs`; real output in this
stream):

| Quantity | Value |
|---|---|
| `H_rand` | `H_commit_dev + K`, `K = 12` |
| Finality height | `H_rand + D` = `H_commit_dev + 18`, `D = 6` |
| `R` | first quicknet round scheduled **≥ `MTP(H_commit_dev + 18)` + 3 h** |
| **Binding constraint** | **the drand Δ = 3 h rule, not block depth** |
| **Expected delay from `H_commit_dev`** | **≈ 5.167 h** (≈ 5.333 h from broadcast) at a 600 s block rate |
| Abandonment | 180 days from `registration_timestamp` |
| Missing-round expiry | 30 days after `R`'s scheduled time → `STUDY_VOID_RANDOMNESS_UNAVAILABLE` |

**`R` is computed by the tooling from the chain. Never choose it, never read it from a relay, never write it
into the bundle.** `<<UNFILLED: R_dev — computed, never chosen>>`.

Collect: both header archives extended past `H_commit_dev + 18`; the funding Merkle proofs for **both** slots;
the development commitment Merkle proof; the quicknet `/info` document; and the beacon for `R_dev` **from ≥ 2
differently operated relays** (§19.3).

```
cd $T
CPG_U1_TOOLING=$I node collection_precheck.mjs \
  --headers headers_a.json --headers-crosscheck headers_b.json \
  --funding-development fd.json --funding-held-out fh.json \
  --commitment-development cd.json --payload-development payload_dev.json \
  --drand-chain-info info.json --drand-beacons r1.json,r2.json \
  --registration reg.json

CPG_U1_TOOLING=$I node relay_attribution.mjs \
  --beacon "<<UNFILLED: relay 1 name>>=r1.json" \
  --beacon "<<UNFILLED: relay 2 name>>=r2.json" \
  --drand-chain-info info.json --at <<UNFILLED: collection time, ISO UTC>> \
  --out relay-attribution-dev.json

CPG_U1_TOOLING=$I node sampling_timeline.mjs \
  --commitment cd.json --headers headers_a.json --headers-crosscheck headers_b.json \
  --stage development --registration reg.json --drand-beacons r1.json,r2.json
```

**Evidence.** All collected files; the three reports; `relay-attribution-dev.json`.
**GATE:** `collection_precheck` exit **0**; `relay_attribution` exit **0** (exit 1 = fewer than two distinct
relays — **collect the second relay, do not proceed**); `sampling_timeline` exit **0**.
**`relay-attribution-dev.json` is an operator record. It is NOT part of the evidence bundle and nothing reads
it.**

---

## Step 10 — Assemble and verify the evidence bundle (§13.2A)

```
cd $I
node cpg_u1_data.mjs sampling-evidence-bundle $REG \
  --headers headers_a.json --headers-crosscheck headers_b.json \
  --funding-development fd.json --funding-held-out fh.json \
  --commitment-development cd.json --payload-development payload_dev.json \
  --drand-chain-info info.json --drand-beacons r1.json,r2.json --out ev.json

node cpg_u1_data.mjs verify-commitment $REG --evidence ev.json --stage development
node cpg_u1_data.mjs verify-sampling   $REG --evidence ev.json --stage development
```

**Evidence.** `ev.json` and both verdicts.
**GATE:** `verify-sampling` prints **`FINAL`**. Anything beginning `WAITING_` means wait and re-run; anything
beginning `STUDY_` or `STAGE_` is **terminal — stop and escalate, do not retry.**
**The bundle cannot prove a non-spend, most-work status, source independence or drand unavailability
(§20.17) — confirm those with an own node and ≥ 2 relays.**

---

## Step 11 — The development draw (§5.8)

```
cd $I
node cpg_u1_data.mjs draw-development $REG --frame F1.csv --scan scan1.json \
  --registry rules/development_only_registry.json --evidence ev.json \
  --screened-by <<UNFILLED: screener pseudonym>> --out dev/
```

**Evidence.** `dev/manifest.json` and the sampling record.
**GATE:** exit 0. **The seed is derived internally; only its fingerprint is printed or recorded. Never print,
copy, store or transmit a seed.**

---

## Step 12 — Pilot, sizing, reference, seal (§5.6, §5.9, §6.3)

```
cd $I
node cpg_u1_data.mjs harness-pilot   ...   # development companies ONLY, through the frozen resolver
node cpg_u1_data.mjs size --dev-manifest dev/manifest.json --pilot pilot.json --out sizing.json
node cpg_u1_data.mjs check-personnel ...   # seven independent roles, operator in none
node cpg_u1_data.mjs reference-adjudication-packet --dev-manifest dev/manifest.json \
     --held-out-manifest ho/manifest.json --author a.csv --confirmer c.csv --out ref_packet.json
node cpg_u1_data.mjs resolve-reference-adjudication ... --out j.csv
node cpg_u1_data.mjs reconcile ... --out reference.csv
node cpg_u1_data.mjs seal --dev-dir dev --held-out-dir ho --sizing sizing.json \
     --author a.csv --confirmer c.csv --adjudication j.csv \
     --reference-packet ref_packet.json --blind-decisions blind.csv \
     --reference reference.csv --out SEAL.json
```

**GATE:** each exits 0; `check-personnel` confirms seven mutually exclusive independent persons with the
operator in none. **The blind adjudication happens BEFORE the seal.**

---

## Step 13 — Publish the seal record at the registry — **HUMAN ACT, AND IT OPENS THE WINDOW**

A public record linked to the registration on OSF, naming the seal hash, with a **registry-issued timestamp**.

**GATE (§6.5):** the registry timestamp exists **and is later than the held-out drand round's scheduled
time**. `<<UNFILLED: seal record registry timestamp>>`, `<<UNFILLED: seal hash>>`.

---

## Step 14 — Held-out commitment (§5.5.3) — the binding is unforgiving

```
cd $I
node cpg_u1_data.mjs pool-check --frame F2.csv --scan scan2.json \
  --registry rules/development_only_registry.json --dev-manifest dev/manifest.json --sizing sizing.json
node cpg_u1_data.mjs commitment-payload --stage held-out $REG \
  --frame F2.csv --scan scan2.json --registry rules/development_only_registry.json \
  --dev-manifest dev/manifest.json --sizing sizing.json --evidence ev.json --out payload_ho.json
```

**GATE before broadcast — every one of these is a VOID if wrong:**
- `frame_hash` **equals** the development payload's; `scan_sha256` **equals** the development payload's;
  `registry_sha256` **equals** the registered one;
- `binding.development_commitment_txid` and `binding.development_payload_digest` name the **development**
  commitment;
- the held-out commitment's height must be **strictly greater than `H_rand_dev + 6`** (= `H_commit_dev + 18`),
  or **held-out is VOID** (`lib/sampling.mjs:153`).

Then, **custodian only, no tool**: spend `O_ho` only, exactly one OP_RETURN,

```
6a 27 ‖ "CPGU1" ‖ 01 ‖ 48 ‖ <32-byte held-out digest>           (0x48 = 'H' = held-out)
```

Record: `<<UNFILLED: held-out commitment txid>>`, `<<UNFILLED: held-out commitment height>>`.

---

## Step 15 — Held-out wait, bundle, verify, draw

Repeat steps 9–10 for the held-out stage (another **≈ 5.167 h** from `H_commit_ho`, the Δ rule again binding),
adding `--commitment-held-out ch.json --payload-held-out payload_ho.json`, and collecting the beacon for
`<<UNFILLED: R_ho — computed, never chosen>>` from **≥ 2 relays** again.

```
cd $I
node cpg_u1_data.mjs verify-sampling $REG --evidence ev.json --stage held-out
node cpg_u1_data.mjs draw-held-out $REG --frame F2.csv --scan scan2.json \
  --registry rules/development_only_registry.json --dev-manifest dev/manifest.json \
  --sizing sizing.json --evidence ev.json --screened-by <<UNFILLED: screener pseudonym>> --out ho/
```

**GATE:** `verify-sampling --stage held-out` prints **`FINAL`** before `draw-held-out` is run.
`held-out` cannot be FINAL unless `development` is FINAL first (`lib/sampling.mjs:113-117`).

**Once the held-out draw exists, the held-out companies are identified. From that moment any CPG execution or
any reading of stored CPG output touching them, in any environment and through any entry point, before the
single authorised run starts or after it completes, is a PREVIEW and VOIDS the study (§6.5).**

---

## Step 16 — Authorise, and the event log

```
cd $I
node cpg_u1_data.mjs authorize-execution --seal SEAL.json --held-out-manifest ho/manifest.json \
  --seal-publication seal_publication.json --out auth.json
node cpg_u1_data.mjs audit-execution-log --log events.jsonl
```

**Evidence.** `auth.json` and its SHA-256; `events.jsonl` and **its head hash**.
**GATE:** the window is **open** (the seal record's registry timestamp has passed and is later than `R_ho`'s
scheduled time) and the log audit is clean.

**PROCEDURAL CONTROL THAT NO TOOL PERFORMS.** `lib/eventlog.mjs` detects an edited, re-hashed, deleted or
reordered **interior** event — demonstrated in this stream, 17/17. It does **not** detect a **truncated tail**
or a substituted whole log, because a prefix of a valid chain is itself a valid chain. **The operator must
publish the head hash and the event count at every checkpoint.** Record:
`<<UNFILLED: published event-log head hash>>`, `<<UNFILLED: published event count>>`.

**The single authorised held-out run is out of scope of this sheet and of this stream. It is not started,
prepared or rehearsed here.**

---

## Appendix — every unfilled marker in this sheet

None of these has been invented, guessed or derived anywhere in stream G.

```
<<UNFILLED: bitcoin_key_custodian — the named study operator>>
<<UNFILLED: accountable OSF identity>>
<<UNFILLED: OSF persistent identifier>>
<<UNFILLED: development P2WPKH address>>       <<UNFILLED: held-out P2WPKH address>>
<<UNFILLED: development txid>>:<<UNFILLED: development vout>>
<<UNFILLED: held-out txid>>:<<UNFILLED: held-out vout>>
<<UNFILLED: development funding height>>       <<UNFILLED: held-out funding height>>
<<UNFILLED: checkpoint_height>>                <<UNFILLED: checkpoint_hash>>
<<UNFILLED: registration_id (OSF persistent identifier)>>
<<UNFILLED: registration_timestamp (registry-issued)>>
<<UNFILLED: development payload digest (printed by commitment-payload)>>
<<UNFILLED: development commitment txid>>      <<UNFILLED: development commitment height H_commit_dev>>
<<UNFILLED: R_dev — computed, never chosen>>   <<UNFILLED: R_ho — computed, never chosen>>
<<UNFILLED: relay 1 name>>                     <<UNFILLED: relay 2 name>>
<<UNFILLED: collection time, ISO UTC>>
<<UNFILLED: screener pseudonym>>
<<UNFILLED: seal hash>>                        <<UNFILLED: seal record registry timestamp>>
<<UNFILLED: held-out commitment txid>>         <<UNFILLED: held-out commitment height>>
<<UNFILLED: published event-log head hash>>    <<UNFILLED: published event count>>
```
