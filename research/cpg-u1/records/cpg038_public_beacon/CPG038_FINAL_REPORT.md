# CPG-038 — Public-Randomness-Beacon Review

**FINAL VERDICT: B. PUBLIC-BEACON DESIGN HAS SPECIFIC UNRESOLVED GAPS**

A public beacon **can** replace the human seed custodian. The design is fully specified in `PROPOSED_BEACON_DESIGN_NOT_APPROVED.md`. But **public randomness alone is not enough.** It stops anyone from choosing or foreseeing the seed. It does not stop the operator from committing several candidate lists and revealing whichever gives the most favourable draw.

Closing that hole needs a **publicly auditable single-commitment channel** and a **trusted timestamp**. Securely verifying drand also needs a **BLS signature implementation the tooling does not have**. Each of these needs a decision or external action outside this step's authority — and one needs a trust concession. Nothing was implemented, generated, published or frozen.

**Void historical commitments, preserved and never to be used:**

- development `55ab94c44e1ec3032f5f9292332374424b01172da5803a8da78ba296a9672372`
- held-out `98be9459cd481c41659428096899975e27bb1ec506a0dcd4de660b528fb25445`

---

## 1. Does a public beacon deliver P1–P5?

| | Protection | Beacon + private timestamp (D0) | Beacon + single public logged commitment (D1, proposed) |
|---|---|---|---|
| **P1** | Seed not chosen after seeing the list | **Yes** — round fixed by rule | **Yes** |
| **P2** | No rank-aware steering of candidate selection | **Yes, for one list — but defeated by committing many lists** (attack 4) | **Yes** — only one binding commitment |
| **P3** | Seed unknowable before list commitment | **Yes**, *if* the timestamp is trustworthy | **Yes** — the log signs the time, not the operator |
| **P4** | Unpredictable, unbiasable randomness | **Yes** — drand is threshold-generated | **Yes** |
| **P5** | No selective publication or timestamp manipulation | **No** — private timestamps can be multiplied and withheld | **Yes, subject to G1(d)** — uniqueness is auditable only as far as the log's key search is trusted to be complete |

Full attack table (15 scenarios): `ATTACK_ANALYSIS.md`. **D0 leaves attacks 3, 4, 6 and 11 open**; D1 prevents or detects all of them.

## 2. Sequence T0–T6

This is designed and specified in full (`PROPOSED_BEACON_DESIGN_NOT_APPROVED.md` §3). The critical property holds by construction:

- at each commitment, the ranking randomness is a **future** drand round;
- that round is computed from the **log-signed** commitment time plus Δ;
- no party — the operator included — can know or bias it.

The operator never chooses the round, and a second commitment voids the stage.

## 3. Beacon options

| Criterion | **A. drand quicknet** | **B1. Bitcoin block hash** | **B2. NIST Randomness Beacon v2** | **C. No beacon (independent human)** |
|---|---|---|---|---|
| Public verifiability | BLS signature under a frozen group key | Header proof-of-work, SHA-256d | NIST RSA signature | Commitment only |
| Unpredictable before publication | Yes | Yes | Yes | Yes (to non-holders) |
| Bias resistance | **Strong** — threshold of independent League of Entropy nodes | **Moderate** — a miner can withhold a block at the cost of the block reward | **Weak against NIST itself** — single operator | Depends on the custodian's honesty |
| Availability | High, 3 s rounds, multiple relays (probe 2 reachable) | Very high (probe 4 reachable) | Historically interrupted (e.g. government shutdowns) | Depends on a person |
| Archival / replay years later | Good: archive the signature + chain info, verify offline | **Excellent**: headers are replicated worldwide permanently | Good: archive the signed pulse | Seed file custody |
| Timestamp / order verification | Deterministic round times; needs an external commitment timestamp | Chain height gives intrinsic order; block time ±2 h | Pulse timestamp signed | Out-of-band only |
| External dependency | drand network + **a BLS12-381 implementation** | Bitcoin data source; **zero-dependency verifiable** | NIST service | None |
| Failure mode | Network halt → missed rounds produced on resumption | Reorganisation → require ≥ 6 confirmations | Outage → gaps | Custodian unavailable |
| Operator can influence the round | No, under R-3 | No, if height is fixed by rule | No, if the pulse is fixed by rule | n/a |
| Operator can discard an unfavourable result | **Detectable** under R-8 | Detectable under R-8 | Detectable under R-8 | Custodian can withhold |
| **Zero-dependency verification in current tooling** | **No** — Node crypto and OpenSSL lack BLS12-381 (probe 1) | **Yes** | Yes (RSA) | n/a |

**Proposed:** **A (drand)** on bias-resistance grounds, subject to G3. B1 is the best zero-dependency alternative, with a weaker but documented bias model. B2 is rejected: its single operator is a trust concentration no better than a human custodian. Not chosen for convenience — the choice turns on bias resistance, and on whether a verification dependency is acceptable (G3).

## 4. Round-selection rule

**Proposed R-3:**

```
R = floor((T + Δ − genesis) / period) + 1
```

- `T` is the transparency log's **signed** `integratedTime` for the single commitment entry.
- **Δ = 3600 s** [NORMATIVE].
- R's scheduled time is strictly after `T + Δ`.
- The tool computes R itself and refuses any operator-supplied round.

| Attack | Why R-3 stops it |
|---|---|
| Choosing a favourable round | No input is chosen by the operator |
| Retrying until favourable | A second commitment → VOID (R-5); every entry's draw is disclosed (R-8) |
| Discarding an unfavourable value | Every entry and its computable draw must be reported (R-8); a restart needs a new protocol version listing all prior attempts |
| Selecting the round after seeing rankings | Rankings do not exist before R's value exists |

The failure behaviour — unavailable round, service outage, malformed output, verification failure, unestablishable ordering — is specified with **no silent fallback**, including a 30-day VOID rule (design §5).

## 5. Seed derivation

**Proposed** (design §4):

```
seed_<stage> = SHA-256("cpg-u1-public-beacon-seed/v1|<stage>|<frame_hash>|<log_entry_uuid>|<drand_chain_hash>|<round>|<drand_randomness>")
```

- The output feeds the **unchanged** `rankKey`.
- **Stage separation:** distinct stage labels, distinct logged commitments, distinct rounds.
- **Sequence binding:** the held-out commitment payload binds the development manifest, sizing and development log entry.
- **Not frozen.**

## 6. Timestamp trust

| Mechanism | Proves "existed before" | Proves **uniqueness** | Operator-independent time | Verifiable without the operator | Needs a credential / external publication |
|---|---|---|---|---|---|
| OpenTimestamps (Bitcoin-anchored) | Yes (upper bound = block) | **No** — private, non-enumerable | Yes | Yes | No / yes (calendar submission) |
| RFC 3161 TSA | Yes | **No** | Yes (trust TSA) | Yes (TSA certificate) | No / yes |
| **Sigstore Rekor** (signed `integratedTime`, Merkle inclusion) | Yes | **Partially** — see G1(d) | Yes (trust Rekor) | Yes (P-256 verification is zero-dependency, probe 1) | **Yes: a signing key + publication** |
| Public git repo + independent archive (e.g. Software Heritage) | Yes (archive visit time) | Partially (visit history visible) | Trust the archive | Yes | Yes: public repo + publication |
| Operator statement | No | No | No | No | — |

**The ordering cannot be proven with tooling and actions available in this step.** It requires an external log and a signing key. That is recorded as a blocker (G1–G2), not assumed.

## 7. The precise blockers

| ID | Blocker | Why it blocks | What resolves it |
|---|---|---|---|
| **G1** | **No single-commitment channel exists** | Without it, attack 4 (commit many lists, reveal the favourable one) is **open**, so P2 and P5 fail and the beacon adds nothing over a seed | A human decision to adopt a public append-only log, plus: **(a)** creating a pre-registered **commitment signing key** (a credential — not authorised here); **(b)** **external publication** of commitments (an outward-facing action — not authorised here); **(c)** accepting the log operator as a trust anchor; and **(d)** a trust concession — **Rekor's search-by-key index is not cryptographically complete.** Inclusion proofs show an entry exists, never that no second entry exists, so "exactly one" (R-5) is auditable only if the index is trusted or the full log range is scanned (billions of entries — impractical). Alternative: a dedicated append-only log containing only this protocol's entries, whose small full history is checkpointed by an independent witness |
| **G2** | **No trusted timestamp** | Without a log-signed time, R-3 has no operator-independent anchor, so P3 cannot be demonstrated | Resolved by the G1 channel (its signed timestamp). OpenTimestamps or RFC 3161 alone are **insufficient** because they do not address G1 |
| **G3** | **drand signatures cannot be verified by the current zero-dependency tooling** | Without BLS verification, a tampered relay response is undetectable (attack 13), and offline replay years later rests on relay trust | Decide either (i) **add a vetted BLS12-381 library** — pinned, vendored, hashed into the tooling aggregate, breaking the zero-dependency property; or (ii) **use Bitcoin block hashes** (zero-dependency verification) and accept the documented miner-withholding bias model and a cross-clock Δ of at least 4 h |

## 8. Protocol impact

| | Value |
|---|---|
| **Current** | H3 = independent human seed custodian (candidate-002 §5.5, §19.2) |
| **Proposed** | H3 = public-beacon commitment protocol (R-1…R-10) |
| Affected sections | §5.5 (replaced), §5.7 (seed source), §13 (archive), §15.5 and §18 (VOID conditions), §19.1 and §19.2 (freeze items, H3), §20 (limitations), tooling contract |
| Tooling | `lib/seed.mjs` replaced; CLI draw arguments changed; ≈ 17 tests and ≈ 12 mutations added. **243 and 37 no longer hold**, and the aggregate SHA changes |
| **Classification** | **B. Material protocol amendment requiring new preregistration review.** It changes the sampling procedure's security basis, adds external trust anchors, changes the tooling contract, and invalidates the recorded verification counts |

## 9. Unchanged by any beacon

The beacon removes the need for a **seed custodian only**. It does **not** remove the protocol's requirements for independent enumerators, reference Author, Confirmer, adjudicator and raters (candidate-002 §5, §9, §12, §19.3). A frame authored by the operator is not rank-aware under D1, but it can still be globally biased — governed by the enumerator-independence rule, which remains unmet if no independent person exists.

## 10. Next action

A human decision on **G1 (channel + trust concession), G2 (follows G1) and G3 (BLS dependency vs Bitcoin)**. Then implement the approved variant, add tests and mutations, and run a controlled protocol re-review. Alternatively, have a genuine independent reviewer act as custodian under the existing H3, which needs no redesign.

---

## Artifacts

`C:/tmp/cpg038_public_beacon/`:

- `CPG038_FINAL_REPORT.md` — this report
- `ATTACK_ANALYSIS.md` — 15 attacks, D0 vs D1
- `PROPOSED_BEACON_DESIGN_NOT_APPROVED.md` — R-1…R-10, sequence, derivation, failure rules, archive, tooling and protocol delta
- `FEASIBILITY_PROBES.log` — read-only probe results
- `SHA256SUMS.txt`

No tooling was changed, no tests added, no seed generated, no commitment published, no key created, nothing frozen or committed. The void commitments are preserved above only as historical references.
