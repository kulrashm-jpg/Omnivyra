# CPG-038 — Proposed Public-Beacon Seed Design (D1)

**STATUS: PROPOSAL — NOT APPROVED · NOT IMPLEMENTED · NOT FROZEN**

This design replaces the human seed custodian (H3) with seeds derived from public committed inputs. It is fully specified, but three components depend on decisions and external actions this step was not authorised to take (final report, gaps G1–G3). Parameters marked **[NORMATIVE]** are proposals for approval.

---

## 1. Components

| Role | Proposed choice | Alternatives assessed (final report §3) |
|---|---|---|
| Public randomness | **drand "quicknet"** — chain hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, scheme `bls-unchained-g1-rfc9380`, period 3 s, genesis 2023-08-23T15:09:27Z | Bitcoin block hash; no beacon |
| Commitment uniqueness **and** trusted timestamp | **Sigstore Rekor public transparency log** (`rekor.sigstore.dev`). One entry per stage, signed by a **pre-registered commitment key** whose public key is frozen at T0 | OpenTimestamps; RFC 3161 TSA; public git repo + archival |
| Beacon signature verification | **Requires a BLS12-381 implementation** — not available in Node crypto or OpenSSL (probe 1) | Vendored audited library (pinned, hashed); or Bitcoin headers (verifiable with SHA-256d and no dependency) |

## 2. Rules

| ID | Rule |
|---|---|
| **R-1** Freeze at T0 | The protocol freezes: drand chain hash, scheme, period and genesis; Rekor log identity and public key; the **commitment public key** (key fingerprint); Δ; the payload schema; the derivation strings; retrieval, verification and fallback rules |
| **R-2** Beacon identity | Only rounds of the frozen chain hash with the frozen scheme are accepted. Any other network, scheme or chain hash → REFUSE |
| **R-3** Round rule | For a commitment entry with log-signed time `T` (Rekor `integratedTime`, Unix seconds, verified via the entry's signed timestamp): `R = floor((T + Δ − genesis) / period) + 1` **[Δ = 3600 s, NORMATIVE]**. R's scheduled time is strictly later than `T + Δ`. The operator supplies no round number; the tool computes R and refuses any other |
| **R-4** Frame binding | Commitment payload = `sha256` of the canonical frame (existing `frame_hash`, candidate-002 tooling). The draw tool recomputes it from the frame file and refuses any mismatch |
| **R-5** Uniqueness | **Exactly one** Rekor entry per stage, signed by the commitment key, with payload type `cpg-u1-frame-commitment/v1` and that stage label, integrated **before** round R's scheduled time. Zero entries → the stage has not started. **Two or more → the stage is VOID** (R-8). Enumeration: Rekor search by public key |
| **R-6** Only logged commitments count | Unlogged hashes, private timestamps and operator statements carry no weight |
| **R-7** Payload schema | Canonical JSON: `{ schema: "cpg-u1-frame-commitment/v1", protocol_sha256, tooling_aggregate_sha256, stage, frame_hash, registry_sha256, scan_sha256, prior_stage: null \| { dev_manifest_sha256, sizing_sha256, dev_log_uuid } }`. The held-out payload binds the entire development stage |
| **R-8** Void and disclosure | A VOID stage is permanent for that protocol version. **Every** entry ever signed by the commitment key is reported with its fully computed draw. A restart requires a new protocol version whose preregistration lists all prior entries and their draws |
| **R-9** Beacon verification | The round value is accepted only if its BLS signature verifies under the frozen group public key for message `sha256(uint64_be(R))` (quicknet scheme). The randomness is `sha256(signature)` and must equal the published `randomness`. Retrieval from ≥ 2 independent relays; the bytes must agree |
| **R-10** Log verification | The entry's signed timestamp must verify under the frozen Rekor public key (ECDSA P-256), and its inclusion proof must verify against a signed checkpoint |

## 3. Sequence

| Step | Action | What becomes public |
|---|---|---|
| **T0** | Freeze protocol + R-1 parameters; publish the commitment public key fingerprint inside the frozen protocol | Protocol hash, key fingerprint |
| **T1-dev** | Enumerate development frame F₁ (no randomness exists that could bias ranks) | — |
| **T2-dev** | Sign and submit the development payload (R-7) to Rekor → entry E_dev with log-signed time T_dev | E_dev (hash only; the frame content stays private until the draw) |
| **T3-dev** | Wait until round R_dev = R-3(T_dev) is published | drand round R_dev |
| **T4-dev** | Verify E_dev (R-10), uniqueness (R-5), beacon (R-9); derive seed_dev (§4) | — |
| **T5-dev** | `draw-development`; publish F₁, the manifest, and the derivation transcript | Everything needed to recompute the development draw |
| — | Development pilot, sizing, optional append-only extension F₂ (candidate-002 §5.5–5.6) | Pilot result, sizing file |
| **T2-ho** | Submit the held-out payload (binds F₂, sizing and E_dev) → E_ho, time T_ho | E_ho |
| **T3–T5-ho** | Round R_ho = R-3(T_ho); verify; derive seed_ho; `draw-held-out`; publish | Everything needed to recompute the held-out draw |
| **T6** | Archive (§6); any independent party recomputes both draws from public data alone | Archive |

**Critical property:** at every T2, the randomness that will rank the committed frame is a future drand round that no party — the operator included — can know or bias.

## 4. Seed derivation (proposed; frozen only on approval)

```
seed_<stage> = SHA-256( UTF-8(
    "cpg-u1-public-beacon-seed/v1"
  + "|" + <stage>                         // "development" | "held-out"
  + "|" + <frame_hash>                    // 64 lowercase hex, R-4
  + "|" + <rekor_entry_uuid>              // lowercase hex, as returned by the log
  + "|" + <drand_chain_hash>              // 64 lowercase hex, frozen
  + "|" + <round R, decimal, no leading zeros>
  + "|" + <drand randomness>              // 64 lowercase hex = sha256(signature), R-9
))
```

**Output:** 64 lowercase hex, used as the existing `seed` input of `rankKey` (candidate-002 §5.7 unchanged).

**Domain separation:**
- a versioned prefix;
- a stage label;
- **different** commitment entries and rounds per stage;
- `|` cannot occur in any field, since every field is lowercase hex or decimal, and stage labels come from a closed list.

**Cross-stage binding:** the held-out payload contains the development manifest hash and the development log UUID (R-7), so the held-out seed transitively commits to the whole development stage.

## 5. Failure behaviour — no silent fallback

| Condition | Behaviour |
|---|---|
| Round R not yet published | Wait. The tool refuses to draw with any other round |
| Round R unretrievable from every relay for 30 days after its scheduled time **[NORMATIVE]** | Stage **VOID** (R-8). No substitute round, no other network |
| drand network halted at R | drand produces missed rounds on resumption; R's value then exists and is used. The 30-day rule applies |
| Malformed round response (non-hex, wrong length, round mismatch) | Retry other relays. If none is well-formed → REFUSE; the 30-day rule applies |
| BLS signature fails verification (R-9) or relays disagree | REFUSE. If no verifiable value is obtained within 30 days → VOID |
| Rekor entry missing, unverifiable timestamp, or inclusion proof fails (R-10) | The commitment does not exist → the stage has not started. Nothing may be drawn |
| Two or more entries for a stage (R-5) | Stage **VOID** (R-8) |
| Timestamp relationship cannot be established (e.g. log key rotated with no verifiable history) | REFUSE; VOID after 30 days |
| Frame hash ≠ committed hash (R-4) | REFUSE; the draw is impossible without the committed frame |

## 6. Minimum archival package (independent reconstruction without trusting the operator)

| Item | Why it is needed |
|---|---|
| Frozen protocol + SHA-256 | Rules R-1…R-10, derivation strings, Δ |
| Tooling files + aggregate SHA-256 | Deterministic re-execution |
| Candidate frame(s) + scan + registry + sizing (as used) | Recompute `frame_hash` and the draw |
| Rekor entries E_dev and E_ho (full JSON), inclusion proofs, signed checkpoints, Rekor public key | Prove existence, timestamp and **uniqueness** |
| Result of the key-based entry search at archive time, **plus** a verifiable checkpoint | Evidence of exactly-one (R-5) |
| Commitment public key | Verify the entries' signatures |
| drand chain info (group public key, chain hash, scheme, period, genesis) | Verify R-9 offline |
| drand rounds R_dev and R_ho: round, signature, randomness | Recompute randomness offline |
| Derivation transcript (every input string + digest) | Human-auditable replay |
| Development and held-out manifests + screening logs | Final draws |

**No private seed material exists or is needed.** Every input is public or publicly committed.

## 7. Tooling delta (not implemented)

| File | Change |
|---|---|
| `lib/seed.mjs` | **Replaced** by `lib/beacon.mjs`: round rule (R-3), payload canonicalisation (R-7), derivation (§4), drand response validation, BLS verification (**needs a dependency — G3**), Rekor timestamp and inclusion verification (ECDSA P-256 / SHA-256 Merkle, zero-dependency feasible) |
| `cpg_u1_data.mjs` | `seed-commit` removed. New `commitment-payload` (prints the canonical R-7 payload to be signed and logged). `draw-development` / `draw-held-out` take `--log-entry`, `--beacon-round`, `--chain-info` instead of `--seed` / `--seed-commitment`; they derive the seed and write the transcript |
| `lib/select.mjs`, `lib/schema.mjs`, `lib/reconcile.mjs`, `lib/sizing.mjs`, registry | **Unchanged** |
| Tests to add | Malformed beacon value; invalid signature; wrong chain hash; wrong scheme; wrong round (earlier, later, stale); future round not yet published; timestamp ordering (`round time ≤ T + Δ` refused); frame hash ≠ payload; frame mutation after commitment; stage-label substitution; beacon-value substitution; derivation reproducibility vector; development/held-out separation; two entries → VOID; missing entry → no draw; relay disagreement; deterministic replay from the archive |
| Mutations to add | One per rule R-2…R-10 that must fail closed (≈ 12) |

**Consequence:** the frozen counts (243 self-tests, 37 mutations) change, and the tooling aggregate changes — so re-verification is mandatory.

## 8. Protocol delta

| Section of candidate-002 | Change |
|---|---|
| §5.5 Two stages, commit–reveal seeds | **Replaced**: logged frame commitments + beacon rounds (§3 above) |
| §5.7 Ordering | Unchanged rank key; the seed source changes |
| §13 Archive | Adds the Rekor evidence and drand evidence (§6) |
| §15.5 / §18 Halt and INCONCLUSIVE rules | Add stage VOID conditions (R-5, R-8, §5 failure table) |
| §19.1 Freeze requirements | Seed commitments are removed; R-1 parameters and the commitment key fingerprint are added |
| §19.2 H3 | Independent human custodian → **public-beacon commitment protocol** |
| §20 Limitations | Add dependence on drand and Rekor availability and trust assumptions |
| Tooling contract | New aggregate, new test and mutation counts |
