# CPG-U1 BITCOIN / RANDOMNESS RUNBOOK (stream C)

**CLASSIFICATION: PREPARATION.** Nothing here has been done. No key exists, no output has been
funded, no transaction has been built or broadcast, no header or beacon has been fetched. Every
external act below is **H2 or H3** — an agent is prohibited from performing it. The tooling itself
"creates no wallet, no key, no transaction" and fetches nothing.

**Rule source:** Protocol-004 §5.5, §5.5.2, §5.5.3, §5.7.1, §5.10, §13.2A, §21, as implemented in
`lib/bitcoin.mjs`, `lib/drand.mjs`, `lib/sampling.mjs`, `lib/commitment.mjs`, `lib/evidenceBundle.mjs`.

---

## 1. The two funding outputs `O_dev` and `O_ho`

**Act: H2 — the named key custodian, role `STUDY_OPERATOR`.**

Requirements, each mechanically enforced:

1. **Network `bitcoin-mainnet`.** `synthetic-test` is refused unless `--allow-synthetic`, and the
   registration must name `bitcoin-mainnet`.
2. **Two distinct outputs.** `checkRegistration` rejects `development === held-out`. The outpoint
   format is exactly `<64 lowercase hex txid>:<vout>`, vout ≤ 4294967295.
3. **Single-signature P2WPKH.** `isP2wpkh` accepts exactly a 22-byte script `00 14 <20 bytes>`.
   Anything else — P2SH-wrapped, P2TR, multisig, P2WSH — is `STUDY_VOID_REGISTRATION` at
   verification, after the money is spent.
4. **Single-use.** Each outpoint may be spent exactly once; that is what makes a second draw
   impossible. Do not consolidate, do not use either output for anything else, do not let a wallet
   auto-select them as change inputs. **Isolate them in a wallet that will not touch them.**
5. **≥ D = 6 confirmations at the checkpoint**, enforced as
   `funding_height + 6 − 1 ≤ checkpoint_height`.
6. **A spend at or before the checkpoint → `STUDY_VOID_PRE_REGISTRATION_SPEND`.** There is no
   recovery.
7. The funding transactions must be **Merkle-provable** in the agreed header range, so they must be
   in a block the header archives cover.

**UNASSIGNED — the key custodian supplies both outputs and their custody arrangement. This stream
generated no key and no address.**

## 2. Choosing the checkpoint

**Act: H1 (agent may read and propose; human signs).**

- A block at or after **both** funding confirmations, satisfying the inequality in §1.5.
- Record `(height, hash)`; the hash must be 64 lowercase hex, display (RPC) order.
- Both header archives must **contain** the checkpoint block with exactly the registered hash, and
  must **start at a retarget boundary** (`start_height % 2016 === 0`) **at or below** it — so every
  difficulty transition after the archive start is recomputed rather than trusted.
- Choose the checkpoint deep enough that a reorg will not orphan it. The tooling has no
  reorg-tolerance parameter here: a checkpoint hash that later changes makes every archive refuse
  with `checkpoint mismatch at <height>`.

**UNASSIGNED — the operator chooses the checkpoint after funding confirms.**

## 3. Broadcasting each commitment

**Act: H2 — the key custodian. Irreversible.**

Per stage `S` (`development` first, then `held-out`):

1. Get the payload and script from the tooling, never by hand:
   `commitment-payload --stage <S> ...` prints `payload_digest` and `op_return_script`.
2. Build a transaction that **spends `O_S`** and **only** `O_S`. Spending both slots in one
   transaction is `STUDY_VOID_SLOT_CROSS_SPEND`.
3. It must carry **exactly one** OP_RETURN output, whose script is exactly the 41 bytes
   `6a 27 | "CPGU1" | 01 | <stage byte> | <32-byte digest>`; stage byte `0x44` for development,
   `0x48` for held-out. `decodeCommitment` counts OP_RETURN outputs and refuses anything other than
   exactly one — **a wallet that adds its own OP_RETURN, or a batching tool that merges two
   commitments, destroys the stage** (`STAGE_VOID_MALFORMED_COMMITMENT`, which per §5.10 voids the
   study).
4. The stage byte must match the outpoint actually spent.
5. Do not let the transaction be a 64-byte stripped transaction (the parser refuses those outright
   for Merkle ambiguity) and do not present a transaction with trailing bytes, an all-empty SegWit
   witness, or non-canonical CompactSize — all are strict parse refusals.
6. Broadcast once. Do not RBF-replace a commitment: a replacement is a different txid, and the
   seed is bound to the txid.
7. **Held-out ordering:** the held-out commitment must be confirmed at a height **strictly greater
   than `H_rand_dev + 6`** (development finality). Earlier is `STAGE_VOID_BINDING_MISMATCH`.

**UNASSIGNED — the key custodian builds and broadcasts. No transaction has been constructed.**

## 4. The wait: §5.7.1 as the tooling implements it

| Step | Rule | Implementation |
|---|---|---|
| Commitment depth | `confirmations(tip, H_commit) ≥ D = 6`, where confirmations = `tip − h + 1` | below this: `WAITING_COMMITMENT_DEPTH` |
| Randomness block | **`H_rand = H_commit + K`, `K = 12`** | `deriveSeed` throws unless `randHeight === commitHeight + K`; no caller may choose it |
| Finality | **block `H_rand + 6`** must exist in the agreed chain | below this: `WAITING_RANDOMNESS_DEPTH` ("need block `H_rand + D`; agreed tip is `<tip>`") |
| drand round | **`R` = the first quicknet round whose scheduled time ≥ `MTP(H_rand + 6) + Δ`, `Δ = 3 h = 10800 s`** | `selectRound(mtp)` = `roundAtOrAfter(mtp + 10800)`; the round is **computed, never read from the bundle** |
| Round schedule | round `r` scheduled at `genesis + (r − 1) × 3`, genesis `1692803367`, period 3 s | `roundTime()` |
| MTP | Bitcoin Core median-time-past: median timestamp of the block and its 10 predecessors | `medianTimePast()`; needs all 11 headers present |
| Round verification | message `sha256(uint64_be(R))`; hash-to-G1 per RFC 9380 with DST `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`; check `e(H(m), −PK) · e(S, G2) = 1`; signature must be canonical compressed, on-curve, prime-order, non-identity G1; `randomness = sha256(signature)` and relay-reported randomness must equal it | `verifyDrandRound`, `verifyBeacon`; vendored `@noble/curves` 1.9.7 + `@noble/hashes` 1.8.0 |
| Chain pinning | quicknet hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, scheme `bls-unchained-g1-rfc9380`, group hash `f477d5c8...`, beacon id `quicknet` | `checkChainInfo` compares **every** pinned field; no other chain is accepted |
| Seed | `sha256("cpg-u1-chain-drand-seed/v1\|S\|digest\|txid\|H_commit\|H_rand\|blockhash(H_rand)\|drand_chain_hash\|R\|drand_randomness")` | `deriveSeed`; only `seed_fingerprint = sha256("cpg-u1-seed-fingerprint/v1\|" + seed)` is ever printed |

**Clocks are chain-derived (MTP), never the operator's wall clock.** Every window below is measured
in MTP.

### 4.1 VOID and abandonment windows

| Window | Rule | State |
|---|---|---|
| **180-day abandonment** | Development outpoint unspent 180 days after `registration_timestamp`; held-out outpoint unspent 180 days after the development draw (the **scheduled time of `R_dev`**, not the broadcast); or a commitment **confirmed** after its own window (MTP of its block ≥ window start + 180 d) | `STUDY_ABANDONED` — disclosed, no evidence claim; a restart needs a **new registration citing this one** |
| **30-day missing round** | No verifiable drand round `R` 30 days after `R`'s scheduled time | `STUDY_VOID_RANDOMNESS_UNAVAILABLE` — **no substitute round**; before that, `WAITING_DRAND_ROUND` |
| Post-finality reorg | A previously FINAL txid, height, block hash or round is contradicted | `STUDY_VOID_POST_FINALITY_REORG` — no re-draw. Pass the published record as `--prior-final` on every later verification so this is *detected* rather than silently re-derived |
| Registered too late | `registration_timestamp` ≥ scheduled time of `R_dev` | `STUDY_VOID_REGISTRATION` |
| Persistent verification failure | Randomness verification failing across ≥ 2 sources within 30 days | study VOID (§5.10) |

Constants as implemented: `ABANDONMENT_SECONDS = 180 × 86400`,
`MISSING_ROUND_EXPIRY_SECONDS = 30 × 86400`, `D = 6`, `K = 12`, `DELTA_SECONDS = 10800`.

---

## 5. What to collect for the evidence bundle

Bundle schema `cpg-u1-sampling-evidence/v1`. `sampling-evidence-bundle` assembles it from separately
obtained **local** files; it fetches nothing, alters no value, keeps only the fields the verifier
reads, and refuses conflicting duplicates.

| Artefact | Shape required | Source (all **H1/H2**, none fetched here) |
|---|---|---|
| **Header archive A** | `{source, start_height (retarget boundary ≤ checkpoint), headers_hex[]}`; each header exactly 160 lowercase hex chars | Independently named source #1 |
| **Header archive B (crosscheck)** | same shape, **`source` must differ** from A | Independently named source #2 |
| **Funding proof, development** | `{tx_hex, height, merkle_branch[] (display-order 64-hex), merkle_pos}` | Chain |
| **Funding proof, held-out** | same | Chain |
| **Commitment, development** | `{payload, tx_hex, height, merkle_branch, merkle_pos}` — the **committed payload is required with the transaction** | `payload_dev.json` + chain |
| **Commitment, held-out** | same; cannot be bundled without the development commitment | `payload_ho.json` + chain |
| **drand chain info** | must match the pinned quicknet chain field-for-field | ≥ 2 relays (see `HEADER_AND_RELAY_SOURCES.md`) |
| **drand beacons** | `[{round, signature (96 hex), randomness (64 hex)}]`, passed as a comma-separated `--drand-beacons` list | ≥ 2 relays; **relays disagreeing on a round is a hard refusal — do not choose one** |

Also archive, per §13.2A: the registration record and the identity's registration listing, protocol
and tooling files, frame, scan, registry, pilot, sizing, both payloads, both funding and commitment
raw transactions with Merkle proofs, header ranges from a retarget boundary ≤ checkpoint through
`H_rand_ho + 6` **from two sources**, drand chain info and rounds `R_dev` and `R_ho`, manifests,
screening logs and both sampling records.

### 5.1 The bundle cannot prove a non-spend

`verify-sampling` reports `NOT_STARTED` with the explicit caveat that "non-spend is not provable from
headers — confirm with a full node". §21 step 4 requires confirming with a full node that the
commitment transactions are the spends of `O_dev` / `O_ho`, or that the outpoints are unspent. That
step is **H2** and has no tooling command.

---

## 6. Which verified command checks which artefact

| Command | Checks |
|---|---|
| `verify-archive --network bitcoin-mainnet --checkpoint-height N --checkpoint-hash H --archive a.json --crosscheck b.json` | Both archives: retarget-boundary start ≤ checkpoint, 80-byte headers, proof of work in `(0, powLimit]`, linkage, MTP timestamp rule, nBits continuity, **recomputed** retargets, checkpoint hash match; then block-for-block crosscheck. Exit **0** prints the valid ranges and the agreed range; exit **1** = `archive refused: <reason>`. |
| `sampling-evidence-bundle` | Shape of every part, two differently named header sources, payload present with each commitment, drand chain info present, no conflicting duplicate beacons; then runs the full `evaluateStage` for **both** stages and writes the bundle only if it is accepted. Prints `evidence_sha256`. |
| `verify-commitment --stage <S>` | Exit **0** iff the stage's commitment is valid and confirmed ≥ 6 — i.e. the state is one of `WAITING_RANDOMNESS_DEPTH`, `WAITING_DRAND_ROUND`, `STUDY_VOID_RANDOMNESS_UNAVAILABLE`, `STUDY_VOID_POST_FINALITY_REORG`, `FINAL`. Otherwise prints the state and exits **5** (waiting) or **6** (void). |
| `verify-sampling --stage <S> [--prior-final prior.json]` | The whole §5.5–§5.10 decision: funding slots P2WPKH with ≥ 6 confirmations at the checkpoint, spend of the right outpoint, no cross-spend, no pre-checkpoint spend, depth, exactly-one-OP_RETURN decode, payload digest match, payload validity and registration binding, held-out frame/scan/registry/binding/ordering, abandonment, `H_rand`, reorg against `--prior-final`, drand chain info, computed round `R`, BLS verification. Prints the record as JSON. Exit **0** only on `FINAL`; **5** waiting; **6** void/abandoned; **1** `VERIFY_ABORT_EVIDENCE`. |
| `derive-seed --stage <S>` | Refuses unless `FINAL`. Prints the full derivation string and `seed_fingerprint`; never the seed. |
| `verify-registration ... --evidence ev.json` | Additionally checks the funding outputs against the registered checkpoint. |

---

## 7. Ordered external procedure (summary)

1. Name the key custodian; `check-funding-prerequisites` must exit **0** first. **H2**
2. Create `O_dev` and `O_ho` — distinct, single-use, single-signature P2WPKH, mainnet. **H2**
3. Wait for ≥ 6 confirmations on both funding transactions.
4. Choose the checkpoint `(height, hash)`. **H1**
5. Obtain two independently sourced header archives; `verify-archive` → exit 0. **H1**
6. Register (see `OPERATOR_CHECKLIST.md` Phase C). **H2/H3**
7. Assemble `ev.json`; `verify-registration --evidence ev.json` → exit 0.
8. Build the frame, scan, `check-frame-sufficiency`, then `commitment-payload --stage development`.
9. Broadcast the development commitment: spend only `O_dev`, exactly one OP_RETURN, exactly the
   printed script. **H2**
10. Wait for depth 6, then for block `H_rand + 6`; refresh both header archives.
11. Fetch drand chain info and the **computed** round `R_dev` from ≥ 2 relays; re-bundle.
12. `verify-commitment`, then `verify-sampling --stage development` → `FINAL`; `derive-seed` to
    record the derivation and fingerprint.
13. Draw, pilot, size, pool-check; then `commitment-payload --stage held-out`.
14. Broadcast the held-out commitment **after** development finality (`height > H_rand_dev + 6`).
    **H2**
15. Repeat 10–12 for `held-out`, passing the published development record as `--prior-final`.

**No step above has been executed. Steps 2, 6, 9 and 14 are irreversible and are human acts.**
