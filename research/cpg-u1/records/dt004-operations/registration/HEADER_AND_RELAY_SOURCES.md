# CPG-U1 HEADER AND RELAY SOURCES

**CLASSIFICATION: PREPARATION.** **Nothing was fetched.** No source was contacted, no endpoint was
resolved, no archive or beacon was obtained, and **no source is recorded here as verified or
selected**. This document states the requirement and the refusal behaviour so the operator can choose
sources; the choice is the operator's.

**Rule source:** Protocol-004 §5.7.1 ("Header sources"), §13.2A, §19.3, §21 steps 3 and 5, as
implemented in `lib/bitcoin.mjs` (`verifyArchive`, `crosscheckArchives`), `lib/sampling.mjs`
(`loadChains`), `lib/evidenceBundle.mjs` (`archive`, `beacons`), `lib/drand.mjs` (`checkChainInfo`).

---

## 1. Bitcoin headers: two independently named sources are mandatory

§5.7.1 requires **two differently named sources**, and §19.3 lists "two independent Bitcoin header
sources (or an own node)" as a named prerequisite before held-out execution.

### 1.1 What the tooling enforces

| Requirement | Where | Failure |
|---|---|---|
| Each archive names its source: `source` must be a non-empty string | `evidenceBundle.archive()` | `EVIDENCE_BUNDLE_REFUSED: headers: the archive must name its source` |
| The two `source` strings must **differ** | `buildEvidenceBundle` and again in `loadChains` | `the two header archives must come from two differently named sources`; at verification, `headers and headers_crosscheck must name two different sources` |
| `start_height` divisible by **2016** (a retarget boundary) and **≤ the registered checkpoint height** | `verifyArchive` | `header archive must start at a retarget boundary (height divisible by 2016)` / `must start at or below the registered checkpoint` |
| Every header exactly 80 bytes / 160 lowercase hex characters | `parseHeader`, `evidenceBundle.archive()` | parse refusal |
| Proof of work: target in `(0, powLimit]` and `hash ≤ target` for **every** header | `checkProofOfWork` | `header <hash>: hash exceeds its target (invalid proof of work)` |
| Contiguous linkage: each header's `prev` equals its predecessor's hash | `verifyHeaderChain` | `header <h> does not link to header <h−1>` |
| MTP timestamp rule: each header's time > median-time-past of the previous 11, wherever all 11 are present | `verifyHeaderChain` | `header <h>: timestamp not greater than median-time-past of the previous 11 blocks` |
| nBits continuity off a boundary; at a boundary, nBits equals the **recomputed** retarget from the period's first header | `expectedRetargetBits` | `nBits changed outside a retarget boundary` / `nBits 0x.. != recomputed retarget 0x..` |
| The archive reaches the checkpoint height and its hash **equals** the registered `checkpoint.hash` | `verifyArchive` | `checkpoint mismatch at <height>: archive <a> != registered <b>` |

Because the archive must start at a retarget boundary at or below the checkpoint, **every difficulty
transition after the archive start is recomputed rather than trusted.** A source cannot hand over a
short suffix.

### 1.2 What "independently named" has to mean in practice

The tooling can only check that the two `source` strings differ. Independence beyond that is a
**human judgement the operator must make and record**. Two archives are not independent merely
because their labels differ — if both ultimately derive from the same node, the same hosted indexer
or the same upstream API, the crosscheck proves nothing and the study's trust model (§23) is
weakened without any tooling refusal.

Candidate source **types**, named generically only — **not endorsed, not resolved, not contacted**:

- **A full Bitcoin node operated by the study itself.** Strongest option; §19.3 explicitly allows
  "or an own node". Cost: initial block download, on the order of days.
- **A full node operated by a party independent of the study**, supplying headers directly.
- **A public block-explorer or chain-data API** of one operator.
- **A second, organisationally distinct public block-explorer or chain-data API.**
- **A published header archive / checkpoint set** maintained by a party distinct from the above.

The operator should prefer **one own node plus one external source**, and at minimum must avoid two
sources that share an operator, a hosting provider or an upstream data feed.

**UNASSIGNED — the operator names both header sources. This stream fetched nothing and endorses
nothing.**

### 1.3 What must be recorded, per source

For each of the two archives, the archived record must carry:

- The `source` string as it appears in the bundle — chosen so an outsider can tell **who** supplied
  it, not just that two labels differ.
- `start_height` and the full `headers_hex` array (the raw bytes, not a summary).
- The height range obtained, and the range over which the two sources were found to agree (printed
  by `verify-archive` as `agree over <from>..<to>`).
- Coverage through at least `H_rand_ho + 6` by the end of the study (§13.2A).
- The operator's written basis for believing the two sources are independent (**H1**: an agent may
  draft it, a human signs it).

### 1.4 How the crosscheck refusal behaves

- `crosscheckArchives` walks the **overlapping** range and refuses at the **first** differing height:
  `header sources disagree at height <h> — fork or faulty source; wait and re-verify`.
- No overlap at all: `header sources do not overlap`.
- Disagreement is **not** a protocol outcome. It surfaces as `VERIFY_ABORT_EVIDENCE` (exit **1**),
  meaning *nothing is decided and nothing is drawn*. It is not a VOID, and it must not be treated as
  one.
- **The operator must never pick a side.** The instructed behaviour is literally to wait and
  re-verify. Choosing the "better" source would be the operator choosing the randomness.
- Even when both archives verify, only the blocks **both** sources contain count:
  `loadChains` caps the usable tip at `min(tipA, tipB)`. A source that lags therefore delays
  `WAITING_RANDOMNESS_DEPTH` — an expected condition, not an error.
- A source that supplies headers the other lacks gains nothing: heights above the agreed tip return
  `undefined` and any artefact there is refused with `block <h> is not in the agreed header range`.

---

## 2. drand: ≥ 2 relays

§19.3 requires "≥ 2 drand relays" and §21 step 5 requires fetching rounds `R_dev` and `R_ho` from
≥ 2 relays.

### 2.1 What qualifies

- Any relay of the **pinned quicknet chain**
  `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`. `checkChainInfo` compares
  **every** pinned field — `hash`, `public_key`, `period` (3), `genesis_time` (1692803367),
  `schemeID` (`bls-unchained-g1-rfc9380`), `groupHash`, `beaconID` (`quicknet`) — and throws on the
  first mismatch. **No other chain is accepted**, and a relay serving a different chain is not a
  second opinion, it is a refusal.
- Candidate relay **types**, generically and **without endorsement or resolution**: the drand
  project's own public HTTP relays, relays operated by independent League-of-Entropy members, a
  gossip/libp2p relay, or a self-operated relay following the same chain.
- **UNASSIGNED — the operator names ≥ 2 relays. None was contacted here.**

Note on what the second relay buys you: the beacon is **BLS-verified offline** against the pinned
group public key, so a lying relay cannot forge randomness — `verifyDrandRound` would reject the
signature. The ≥ 2 relay requirement therefore protects against **availability** and against a relay
withholding or misreporting a round, not against forgery. It is also what makes the §5.10 rule
"persistent randomness verification failure across ≥ 2 sources within 30 days → study VOID"
meaningful.

### 2.2 What must be recorded

- Each relay's identity, and which relay supplied which beacon.
- The chain info document as returned (it must match the pinned chain field-for-field).
- Per beacon: `round`, `signature` (96 lowercase hex, compressed G1), `randomness` (64 lowercase hex).
- The round numbers `R_dev` and `R_ho` **as computed by the tooling** — never as reported by a relay.

### 2.3 How the relay crosscheck refusal behaves

- `evidenceBundle.beacons()` de-duplicates by round and refuses conflicting duplicates:
  `drand beacons disagree for round <r> — relays returned different values; do not choose one`.
  Again: **the operator must not choose.**
- `verifyBeacon` refuses a beacon for any round other than the one the tooling computed:
  `drand beacon is for round <x>; the protocol requires round <R>`. There is no way to supply a round.
- Relay-reported randomness must equal `sha256(signature)`, else
  `drand relay randomness != sha256(signature)`.
- The signature must be a canonical compressed, on-curve, prime-order-subgroup, **non-identity** G1
  point, and must satisfy `e(H(m), −PK) · e(S, G2) = 1` under the pinned group key.
- A **missing** round is a protocol state, not an evidence error: `WAITING_DRAND_ROUND` (exit **5**)
  until 30 days after `R`'s scheduled time, then `STUDY_VOID_RANDOMNESS_UNAVAILABLE` (exit **6**).
  There is **no substitute round**.

---

## 3. Status of every source in this document

| Source slot | Value | Status |
|---|---|---|
| Bitcoin header source #1 | **UNASSIGNED — operator** | NOT SELECTED, NOT FETCHED, UNVERIFIED |
| Bitcoin header source #2 | **UNASSIGNED — operator** | NOT SELECTED, NOT FETCHED, UNVERIFIED |
| drand relay #1 | **UNASSIGNED — operator** | NOT SELECTED, NOT FETCHED, UNVERIFIED |
| drand relay #2 | **UNASSIGNED — operator** | NOT SELECTED, NOT FETCHED, UNVERIFIED |
| Full-node confirmation of spend / non-spend (§21 step 4) | **UNASSIGNED — operator** | NOT AVAILABLE; no tooling command exists for it |
