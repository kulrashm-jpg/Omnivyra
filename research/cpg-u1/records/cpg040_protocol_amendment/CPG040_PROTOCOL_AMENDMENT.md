# CPG-040 — Custodian-Free Sampling-Integrity Amendment Specification

**VERDICT: B. IMPLEMENTATION-BLOCKED — named methodological decisions remain**

This document specifies, to implementation level, the amendment that replaces the human seed custodian (H3) with a publicly preregistered, single-use-Bitcoin-commitment sampling mechanism. **Design only.** Nothing was implemented, published, transacted, seeded, fetched from drand, or changed in the existing protocol or tooling.

Three decisions genuinely require human approval before implementation (§10): **U1** registry, identity and publication; **U2** creation and custody of the two funded Bitcoin outputs, plus confirmation parameters; **U3** randomness model A or B. Every other element below is closed and needs no further methodological choice.

---

## 1. Current protocol state (reconstructed from verified artifacts)

All six artifact sets (CPG-036, 037, 037A, 037B, 038, 039) verify against their `SHA256SUMS.txt`.

| Item | Value | Source |
|---|---|---|
| Protocol version / state | `CPG_U1_PREREGISTRATION_CANDIDATE_002` — **NOT FROZEN** | CPG-036 |
| Protocol SHA-256 | `093d15e4f93644340662e898eaf88452575a5a6463907d2c3597b2c16b85a707` | `C:/tmp/cpg036_protocol_close/` |
| Decision register SHA-256 | `60043256c9c3f45ee65e60b77570c9f1bc040db17eec263a784f76dd127433cc` | same |
| Tooling aggregate SHA-256 | `ab8aab4e1ccfd1f4f9e53577cd65c23392733f2efc3958c5efeeb3e3bb40eca3` (18 files; CPG-037A reproducibility-repaired) | `C:/tmp/cpg037a_reproducibility_fix/` |
| Self-tests | **243 passed, 0 failed** (clean rebuild) | 037A logs |
| Mutations | **37 / 37 killed** (clean rebuild) | 037A logs |
| H1 | "I approve H1: at most 60 fill-expected held-out companies; the final count is set by the preregistered pilot fill-yield rule." | CPG-037 approvals |
| H2 | "I confirm H2: the 13-company development-only list is complete to the best of my knowledge." | same |
| H3 | "I designate an independent reviewer outside the CPG and dataset teams as seed custodian. This person is not the CPG operator and is not involved in listing candidate companies." — **approved but unfulfilled**; operator-generated commitments `55ab94c4…` / `98be9459…` are **VOID** | CPG-037B |
| Development-only registry (13) | DEV-001 Omnivyra · DEV-002 Cloudflare · DEV-003 Tesco · DEV-004 Calendly · DEV-005 TotalEnergies · DEV-006 Mercury · DEV-007 Sasol · DEV-008 BMW Group · DEV-009 Petrobras · DEV-010 Stripe · DEV-011 Infosys · DEV-012 Zerodha · DEV-013 Basecamp | `rules/development_only_registry.json` |
| Admissibility | A1–A6 tri-state yes/no/unknown; `unknown` never passes; blank = malformed; jurisdiction families US-SEC (CIK/LEI), FR-SIRENE (SIREN/LEI), BR-CNPJ (CNPJ/LEI), LEI-ONLY (LEI) | cand-002 §5.1 |
| Contamination | C1(1) TEST ∪ CPG_IMPLEMENTATION scope · C1(2) CPG work · C1(3) values from CPG · C1(4) prior CPG execution · C1(5) own/internal · C1(6) development-only registry; `unknown` = contaminated | §5.3–5.4 |
| Sizing | Development exactly 6/2/2; held-out = f(pilot yield y): `N_fill = min(60, max(12, ceil(30 ÷ y)))`, secondary strata scaled with floors 5/3; y = 0 → HALT; pool ≥ 2 × quota; no replacement | §5.6–5.9 |
| Reference-answer independence | Blind double entry (Author ≠ Confirmer); adjudicator picks a record or declares REFERENCE-CONFLICT, never supplies a value; the operator sees only the seal hash | §9 |
| Raters | ≥ 2 independent + rater adjudicator; nominal Krippendorff α ≥ 0.667; without independent raters → UNADJUDICATED, Rung ≤ 2 | §12 |
| U1 endpoints / labels | G1 fills ≥ 20 · P1 EFR ≤ 0.05 · P2 AR (corrected) ≥ 0.90 · P3 II = 0 · R1 FR reported. Labels: SUPPORTED, UNSUPPORTED, INCORRECT, MISATTRIBUTED, CORRECT-ABSTENTION, MISSED, REFERENCE-AMBIGUOUS | §10 |

### 1.1 Decision status

| Class | Decisions |
|---|---|
| **A. Already closed — NOT changed by this amendment** | Single-arm U1; unit; all labels, agreement rules, endpoints, thresholds and outcome vocabulary; admissibility (tri-state); contamination C1(1)–(6) and scan scope; the development-only registry and H2; H1 (CAP 60); dev quota, sizing function, pool multiplier, no-replacement; rank key `sha256("<seed>\|<scheme>:<identifier>")` and round-robin family order; append-only frame extension; reference-truth independence; rater rules and α; archive of raw documents and Wikidata snapshots; validity, exclusion and INCONCLUSIVE rules; U4/U8/U9 boundaries; Omnivyra status; the 037A reproducibility contract (Node v22.17.0, git, LF, `CPG_U1_RESOLVER_CLONE`) |
| **B. Superseded by CPG-039** | H3 human seed custodian; `lib/seed.mjs` stage-separated commit–reveal seeds (`sha256("cpg-u1-seed-commitment\|<stage>\|<seed>")`); the `seed-commit` command; `--seed`/`--seed-commitment` draw arguments; the "custodian" role wherever named (cand-002 §5.5, §12 rater eligibility, §19.2 H3, §19.3); the **local-hash "freeze" as the freeze act** |
| **C. Requiring approval now** | U1, U2, U3 (§10) |

---

## 2. U1 — Public preregistration

### 2.1 Why it is required

Bitcoin single-use outputs bind **one** commitment to **one** outpoint. They cannot reveal **sibling** outpoints the operator never disclosed. The only control against study-level grinding (running K instances and publishing the favourable one) is a **single, public, identity-bound, independently timestamped** record that names the unique commitment instances **before any randomness exists**. The current local `C:/tmp` hashes provide no timing or uniqueness evidence to outsiders.

### 2.2 Minimum registration record

| Field | Content | Must exist before |
|---|---|---|
| `study_id` | Constant `CPG-U1-2026-01` | Frame construction |
| `protocol_version` | e.g. `CPG_U1_PREREGISTRATION_003` (the amended protocol) | Frame construction |
| `protocol_sha256` | SHA-256 of the amended protocol file (attached) | Frame construction |
| `tooling_aggregate_sha256` | Aggregate SHA-256 of the amended tooling (canonical manifest attached) | Frame construction |
| `development_outpoint` | `O_dev` = `<txid>:<vout>`, confirmed ≥ D blocks before registration | Commitment creation |
| `held_out_outpoint` | `O_ho` = `<txid>:<vout>`, same | Commitment creation |
| `stage_relationship` | Held-out commitment must bind the development commitment txid, development manifest, pilot result and sizing (§3.6) | Frame construction |
| `candidate_list_commitment_rules` | By reference into the protocol (hash-bound) | Frame construction |
| `sizing_rule` | By reference (hash-bound) | Frame construction |
| `randomness_rule` | Model A or B with K, D, Δ and drand chain hash if B | Commitment creation |
| `seed_derivation_rule` | Exact strings (§3.8) | Commitment creation |
| `verification_procedure` | By reference: `verify-sampling` specification | Commitment creation |
| `archive_specification` | Archive location **type and target** (e.g. the same registry's file storage) and the manifest schema. **Hashes are added later** as linked results records — they cannot exist before data | Frame construction (spec only) |
| `accountable_identity` | Verified identity bound to the registry account (§2.4) | Registration |
| `registration_timestamp` | **Issued by the registry**, not asserted by the operator | Registration (= the freeze) |
| `checkpoint_block` | Bitcoin block hash + height at or after both funding confirmations | Commitment creation |

**Ordering constraint:** registration (public, not embargoed) → frame construction → development commitment. All fields above are therefore fixed before any candidate list or randomness exists.

### 2.3 Integrity of the registration itself

| Threat | Rule |
|---|---|
| **Changed** | The registration must be **immutable** once submitted. Only registries whose submitted registrations cannot be edited are eligible |
| **Replaced / retroactively superseded** | **Authoritative = the earliest registration under the accountable identity whose `study_id` is `CPG-U1-2026-01`.** Later records are *amendments*. An amendment made **after either outpoint is spent** cannot alter any sampling field; an amendment naming **different outpoints** at any time → **study VOID** |
| **Duplicated** | A second registration under the same identity naming the same `study_id` with different sampling fields → **study VOID**. Identical duplicates are ignored |
| **Embargoed / private** | **Forbidden.** The registration must be publicly visible **before** the development commitment is broadcast. An embargo would allow selective disclosure and re-enable study-level grinding |
| **Withdrawn** | A withdrawal must leave a public tombstone. A withdrawn study is VOID and must be reported |
| **Pseudonymous duplicates under other identities** | **Cannot be prevented cryptographically.** Limited by binding to a verified, accountable identity and by the rule that only studies registered under that identity may be reported as CPG U1 evidence. Residual → §5 |

### 2.4 Identity binding

The registry account must be bound to a verifiable persistent identity (e.g. an ORCID iD, or a verified institutional account) of the **accountable person or organisation** named in the registration. The published study must cite that registration's persistent identifier (DOI or registry URL). **Who** that identity is — an approval item (U1).

### 2.5 Outsider verification

An outsider: (1) resolves the registration's persistent identifier; (2) confirms the registry-issued timestamp, public (non-embargoed) status and immutability; (3) lists the identity's registrations and confirms exactly one authoritative record for the `study_id`; (4) hashes the attached protocol and manifest and compares them with the registered values; (5) proceeds to chain verification using the registered outpoints and checkpoint.

### 2.6 Candidate registries (not implemented)

| Property | **OSF Registries** | **Zenodo (versioned record)** | AsPredicted |
|---|---|---|---|
| Immutable after submission | Yes (registrations are frozen snapshots) | Files per version immutable; new versions allowed under a concept DOI | Yes |
| Public by default | **Embargo possible (must be disabled)** | Public on publish (restricted access possible — must be public) | **Private until the author chooses to reveal** |
| Registry-issued timestamp | Yes | Yes (per version) | Yes |
| Persistent identifier | DOI | DOI + concept DOI | URL/PDF |
| Identity binding | Account; ORCID linkable | Account; ORCID linkable | Email-based |
| Withdrawal | Tombstone retained | Deletion rare, via support | — |
| Enumeration of an identity's records | Profile listing (platform-provided) | Profile / community listing | Not public |
| **Eligible** | **Yes** (embargo off) | **Yes** (public; versioning rules apply: only the first version before the first spend is authoritative) | **No** — private-until-revealed enables selective disclosure |

OSF is **not** required specifically. Either eligible registry satisfies §2.3 under its stated settings. The choice is part of U1.

---

## 3. U2 — Single-use Bitcoin commitment

### 3.1 What Bitcoin proves — and what it does not

| **Bitcoin consensus proves** | **Bitcoin does NOT prove (covered by other rules)** |
|---|---|
| In the most-work chain, **at most one** confirmed transaction spends a given outpoint | That the registered outpoints are the **only** outpoints the operator created — **U1** |
| That transaction's block height and position (**order**) | Who authored the candidate list, or whether it is unbiased — **enumerator independence (§5, §6)** |
| That the transaction and its `OP_RETURN` data existed by that block | Wall-clock time (block time is approximate) — rules use **height** |
| That later blocks, including the randomness block, were produced after it | That the payload is well-formed or truthful — **§3.4 validity rules** |
| Finality **probabilistically**, increasing with depth | That no miner withheld a randomness block — **U3** |

### 3.2 Outputs

- **Creator:** the operator, with a single-signature **P2WPKH** wallet key held in operator custody.
- **Commitment:** each output commits to nothing by itself; it is a **one-time commitment slot**.
- **Value:** each funding output must cover the fee of its later spend plus a non-dust change output.
- **Registration:** both funding transactions must have ≥ **D** confirmations before registration. `O_dev` and `O_ho` must be distinct outpoints, and must not be spent before registration (→ VOID).
- **Key custody is harmless** to sampling integrity: holding the key allows **one** spend per outpoint, which cannot buy a second draw. Loss of the key → the stage cannot start → **study abandoned** (disclosed).

### 3.3 Valid commitment transaction for stage S ∈ {development, held-out}

A transaction `T` is the commitment for S **iff** all of the following hold:

1. `T` spends outpoint `O_S` (as one of its inputs);
2. `T` is included in the most-work chain, and its block has ≥ **D** confirmations;
3. `T` has **exactly one** `OP_RETURN` output, whose script is `6a 27 <39 bytes>`;
4. the 39 data bytes are `"CPGU1"` (`43 50 47 55 31`) ‖ `01` (version) ‖ stage byte (`44` "D" for development, `48` "H" for held-out) ‖ 32-byte digest;
5. the stage byte matches the outpoint spent (`O_dev` ↔ `44`, `O_ho` ↔ `48`);
6. the digest equals `sha256` of the canonical payload published off-chain (§3.5);
7. the payload's own validity rules hold (§3.5, §3.6).

**Length constraint:** 39 data bytes, so the script is 41 bytes — well within the 80-byte data-carrier standardness limit historically enforced by default relay policy. No larger payload is permitted.

### 3.4 Invalid and edge cases

| Case | Disposition |
|---|---|
| `O_S` spent by a transaction failing any of rules 3–7 | Stage **VOID permanently** (the slot is consumed; no retry). Disclosed |
| `O_S` unspent | Stage **not started**. Development unspent 180 days after registration, or held-out unspent 180 days after the development draw [NORMATIVE] → **study abandoned**, disclosed; no evidence claim |
| Valid transaction broadcast but unconfirmed | **Not a commitment.** Nothing may be derived |
| Confirmed but < D confirmations | Not yet final. Wait |
| Competing spends of `O_S` in different branches (fork) | Only the spend in the most-work chain counts. `H_commit` and `T` are **re-evaluated** until the randomness block reaches depth D (§3.7) |
| Reorganisation after finality (depth > D) replaces `T` or the randomness block | **Study VOID** — this indicates an attack or extraordinary network event; no re-draw |
| `OP_RETURN` present in a different transaction not spending `O_S` | Irrelevant (not a commitment) |
| A second transaction claiming the payload but not spending `O_S` | Irrelevant |
| Commitment "after randomness became available" | Impossible for its own stage: randomness is defined as blocks **after** `H_commit`. For held-out, the payload binds development results **by design**, and held-out randomness is a later block |

### 3.5 Canonical payload and digest

The payload is canonical JSON (sorted keys, no insignificant whitespace, UTF-8), per the tooling's existing `canonicalJson`:

```
{
  "schema": "cpg-u1-commitment/v1",
  "study_id": "CPG-U1-2026-01",
  "stage": "development" | "held-out",
  "registration_id": "<registry persistent identifier>",
  "protocol_sha256": "<64 hex>",
  "tooling_aggregate_sha256": "<64 hex>",
  "registry_sha256": "<development-only registry file, 64 hex>",
  "frame_hash": "<64 hex>",
  "scan_sha256": "<64 hex>",
  "outpoint": "<txid>:<vout>",
  "binding": null | { ...held-out only, §3.6 }
}
```

`digest = sha256( UTF-8( "cpg-u1-commitment-digest/v1|" + canonicalJson(payload) ) )`.

The domain prefix prevents reuse of any other SHA-256 value from the project as a digest.

### 3.6 Development ↔ held-out binding

The held-out `binding` object must contain:

- `development_commitment_txid`
- `development_payload_digest`
- `development_manifest_sha256`
- `development_frame_hash` — the frame F₁
- `pilot_result_sha256`
- `sizing_sha256`
- `append_only_proof` — `F₁`'s per-row hashes are a subset of `F₂`'s, recomputed by the tooling

**Cryptographic separation:** distinct outpoints, distinct stage bytes, distinct `stage` payload fields, distinct domain-separated seed strings (§3.8), and **distinct randomness blocks** (each stage's randomness follows its own commitment).

**Binding:** the held-out payload hashes the development commitment and its derived results. A held-out commitment is therefore impossible before the development draw, and cannot be re-pointed to a different development outcome.

### 3.7 Confirmation, randomness height and finality [NORMATIVE — part of U2 approval]

| Parameter | Proposed | Meaning |
|---|---|---|
| **D** | 6 | Confirmation depth for funding outputs, the commitment block and the randomness block |
| **K** | 12 | `H_rand = H_commit + K` |
| Finality | The sampling event is final when block `H_rand` has ≥ D confirmations in the most-work chain | Until then `T`, `H_commit` and `H_rand` are recomputed mechanically, with **no operator input** |

### 3.8 Seed derivation

**Model A:**

```
seed_S = sha256( UTF-8( "cpg-u1-chain-seed/v1|" + S + "|" + digest_S + "|" + txid_S + "|" + H_commit_S + "|" + H_rand_S + "|" + blockhash(H_rand_S) ) )
```

**Model B:**

```
seed_S = sha256( UTF-8( "cpg-u1-chain-drand-seed/v1|" + S + "|" + digest_S + "|" + txid_S + "|" + H_commit_S + "|" + H_rand_S + "|" + blockhash(H_rand_S) + "|" + drand_chain_hash + "|" + R_S + "|" + drand_randomness(R_S) ) )
```

- All hashes are 64 lowercase hex characters in display byte order; heights and rounds are decimal without leading zeros.
- `|` cannot occur in any field.
- `S` ∈ {`development`, `held-out`}.
- `seed_S` feeds the **unchanged** `rankKey`.

---

## 4. U3 — Randomness model

### 4.1 Model A — Bitcoin block hash only

| Aspect | Assessment |
|---|---|
| Source | `blockhash(H_commit + K)` |
| **Attack model** | The miner who finds block `H_rand` — or anyone paying miners — can compute the resulting draw (the commitment and frame are public) and **discard** the block, forfeiting its reward, to obtain a fresh block hash |
| **Grinding cost** | ≥ the forfeited block reward **per discard** (subsidy 3.125 BTC plus fees at the time); each discard yields an independent draw |
| **Detectability** | **Undetectable** — orphaned or withheld blocks leave no reliable public trace |
| Other bias | Leading-zero structure of block hashes reduces min-entropy (roughly the difficulty's zero bits). The remaining entropy (> 150 bits) is far beyond what a ≤ 100-company draw can exploit; the derivation passes it through SHA-256 |
| External dependency | Bitcoin data (self-verifying headers) |
| Verification complexity | Low: SHA-256d proof of work, target from `nBits`, linkage, depth, cumulative work vs ≥ 2 independent sources |
| Reproducibility / archive | Headers from checkpoint to `H_rand + D` (80 bytes each), commitment block Merkle proof, raw transaction — small and permanent |
| Implementation dependency | **None new** |
| Failure handling | Data source unavailable → use another source (headers self-verify) |
| **New methodological assumption** | **"No party spends ≥ one block reward per attempt to bias this study's sample."** |
| **Residual** | An economically motivated, undetectable bias channel |
| **Consequence for U1 evidence** | Held-out sampling integrity holds under the stated economic assumption; the study must declare it |

### 4.2 Model B — Bitcoin block hash + drand

| Aspect | Assessment |
|---|---|
| Source | `blockhash(H_rand)` combined with drand round `R` |
| **Round rule** | `R` = the first drand round whose scheduled time ≥ `MTP(H_rand + D) + Δ`, with **Δ = 3 h** [NORMATIVE]. MTP (median-time-past of the 11 preceding blocks) is monotonic and cannot exceed real time by more than the 2-hour header rule, so `R` is scheduled after `H_rand` is mined |
| **Attack model** | A withholding miner at `H_rand` cannot compute the draw, because round `R` does not yet exist → **withholding is blind** and yields no bias. The drand network could bias only by threshold collusion (a majority of League-of-Entropy members), who would also need the public commitment and a motive |
| Grinding | None available to a single miner; requires drand threshold compromise **and** block-hash control |
| Detectability | A threshold-signature compromise is not directly detectable; public key misuse would be |
| External dependency | Bitcoin **and** the drand network (quicknet) |
| Verification complexity | Model A, plus BLS signature verification |
| Reproducibility / archive | Model A, plus drand chain info (group public key, genesis, period, scheme, chain hash) and round `R` (round, signature, randomness) |
| Implementation dependency | **A vendored BLS12-381 implementation** (not available in Node crypto or OpenSSL — CPG-038 probe) |
| Failure handling | Round `R` not published → wait. No verifiable value 30 days after `R`'s scheduled time → **study VOID** (no substitute round). Relays disagree or the signature fails → refuse; 30-day rule |
| **New methodological assumption** | drand threshold honesty; correctness of the vendored BLS implementation |
| **Residual** | Collusion of a threshold of drand operators; a verification-library defect |
| **Consequence for U1 evidence** | Removes the only undetectable economic bias channel of Model A, at the cost of an external network and a pinned cryptographic dependency |

**Required BLS interface (library not selected):**

```
verifyDrandRound(chainInfo, round, signatureHex) -> { valid: boolean, randomnessHex: string }
```

It must:

- implement scheme `bls-unchained-g1-rfc9380`: 48-byte compressed G1 signature, 96-byte compressed G2 group public key;
- compute message = `sha256(uint64_be(round))`;
- hash-to-G1 per RFC 9380, with the domain separation tag **specified by drand for that scheme** (confirmed against drand's published specification at implementation);
- reject malformed encodings, points not on the curve or not in the prime-order subgroup, and the identity point;
- return `randomness = sha256(signature bytes)` and require equality with any relay-reported randomness;
- be deterministic and produce no network calls;
- be pinned by exact version and vendored source, with its files included in the tooling aggregate;
- pass known-answer tests on archived historical quicknet rounds, **including negative vectors** (flipped signature bit, wrong round, wrong chain).

### 4.3 Proposed default — **requires explicit approval**

**Model B is proposed as the default**, on the factual ground that it removes Model A's only **undetectable** bias channel. **Model A is acceptable only if the economic assumption in §4.1 is explicitly accepted** and declared as a study limitation. This is a protocol decision (U3), not a preference encoded here.

---

## 5. Attack matrix

Classification: **PREVENTED** · **DETECTABLE** · **PARTIALLY MITIGATED** · **UNRESOLVED**.

### 5.1 The CPG-039 seventeen

| # | Attack | Model A | Model B | Control |
|--:|---|---|---|---|
| 1 | Seed chosen after the list | PREVENTED | PREVENTED | Randomness block `H_commit + K` postdates the commitment; the derivation is fixed in the registration |
| 2 | List chosen after the seed | PREVENTED | PREVENTED | Same |
| 3 | Multiple candidate lists (same study) | PREVENTED | PREVENTED | Consensus: `O_S` spent once; §3.3 |
| 4 | Favourable list selected after randomness | PREVENTED | PREVENTED | Same + finality rule §3.7 |
| 5 | Favourable randomness selected after the list | **PARTIALLY MITIGATED** (miner discard, #15) | PREVENTED | Height rule; model B blind withholding |
| 6 | Commitment deleted | PREVENTED | PREVENTED | Proof-of-work depth ≥ D |
| 7 | Commitment rewritten | PREVENTED | PREVENTED | Proof-of-work depth; post-finality reorg → VOID |
| 8 | Identifier changed after commitment | PREVENTED | PREVENTED | Digest binds `frame_hash`; the tool recomputes |
| 9 | Class changed after commitment | PREVENTED | PREVENTED | Class inside committed rows |
| 10 | Quota changed after commitment | PREVENTED | PREVENTED | Dev quota in the registered protocol; held-out sizing in the held-out binding |
| 11 | Beacon round / randomness block changed | PREVENTED | PREVENTED | `K`, `D`, `Δ` and the drand chain are in the registration |
| 12 | Randomness output discarded (declare failure, restart) | **DETECTABLE** | **DETECTABLE** | Spent outpoints and computable draws are public; abandonment is disclosed (§7). **Evidentiary control:** only the registered study may be reported; an abandoned study yields no evidence, and a restart requires a new registration citing the abandoned one |
| 13 | Public log / chain changed after randomness | PREVENTED | PREVENTED | Chain, outpoints and checkpoint registered before commitment |
| 14 | Candidate list reconstructed differently | PREVENTED | PREVENTED | Canonical frame hash; SHA-256 |
| 15 | Randomness learned early / miner withholding | **UNRESOLVED (economic)** — undetectable discard at ≥ block reward | **PREVENTED** for miners (blind); drand threshold collusion remains an assumption | U3 decision; Model A declares the economic assumption as a limitation |
| 16 | **Study-level grinding** (parallel instances) | **PARTIALLY MITIGATED** | **PARTIALLY MITIGATED** | Registration before commitment, public and immutable, identity-bound, naming the outpoints. **Residual:** pseudonymous parallel studies under other identities cannot be prevented or detected; **evidentiary control:** only a study registered under the accountable identity may be reported as CPG U1 evidence, and that identity's full registration list is public |
| 17 | `O_ho` spent early with a junk payload to kill held-out | DETECTABLE | DETECTABLE | Stage VOID, public, and gives no information advantage (randomness does not yet exist) |

### 5.2 Supplementary attacks named in CPG-040

| # | Attack | Classification | Control |
|---|---|---|---|
| S1 | **Multiple preregistrations** (same identity) | DETECTABLE → VOID | §2.3: a second registration with different sampling fields voids the study; identity listing is public |
| S2 | Multiple preregistrations (different identities) | **UNRESOLVED (identity-level)** | Only accountable-identity registrations count; residual declared (#16) |
| S3 | **Registry replacement** (use a different registry) | PREVENTED as evidence | The published study must cite its authoritative registration; the protocol forbids ineligible registries; a record elsewhere is simply not the registration |
| S4 | Registration edited or embargoed | PREVENTED (eligible registries) / DETECTABLE (withdrawal tombstone) | §2.3 immutability, no-embargo rule |
| S5 | **Timestamp manipulation** (registration backdated) | PREVENTED under registry trust | Registry-issued timestamp; additionally the development payload binds `registration_id`, so the commitment block proves the registration existed by `H_commit` |
| S6 | Timestamp manipulation (miner-set block time) | PREVENTED | Height-based rules; MTP-based round rule in Model B |
| S7 | **Seed substitution** (claim a different seed) | PREVENTED | The seed is recomputed from public inputs; `verify-sampling` aborts on mismatch |
| S8 | **Candidate-list replacement** after commitment | PREVENTED | `frame_hash` in the digest |
| S9 | **Candidate-list extension** beyond append-only | PREVENTED | `append_only_proof` in the held-out binding; the tool refuses otherwise |
| S10 | **Post-randomness manipulation** of rows, attestations or scan | PREVENTED for committed artifacts; **attestation judgements themselves are not cryptographically verifiable** | Frame, scan and registry hashes are committed. Truthfulness of human attestations → enumerator independence (§6) |
| S11 | **Commitment withholding** (never spend `O_S`) | DETECTABLE | 180-day abandonment rule; public registration shows the missing stage |
| S12 | **Blockchain reorganisation** | PREVENTED within D; post-finality → VOID | §3.4, §3.7 |
| S13 | **Development ↔ held-out cross-contamination** (held-out shaped by development outcome) | PREVENTED for ranks (independent randomness); the append-only extension may *legitimately* follow development | §3.6 binding; C1 rules keep development companies out of held-out |
| S14 | Operator authors a globally biased frame (not rank-aware) | **UNRESOLVED by sampling integrity** | Governed by the existing, closed enumerator-independence requirement. Cryptography does not address it |

---

## 6. Trust model

| Party / component | Trusted assumption | Adversarial capability | Evidence supplied | Remaining limitation |
|---|---|---|---|---|
| **Candidate enumerators** | Independent of CPG; answer attestations truthfully | Globally bias frame composition; misstate A1–A6 or C1 answers | Frame, scan, screening log (hash-committed) | **Independent candidate selection is NOT established by cryptography** — only by the people chosen |
| **Reference-answer researchers** (Author, Confirmer, adjudicator) | Independent, blind, non-communicating before submission | Shared error; collusion | Blind records, reconciliation, seal | Independence rests on role assignment |
| **Raters** | Independent; follow the decision procedure | Label bias | Per-rater sheets; α | Without independent raters, Rung ≤ 2 |
| **Rater adjudicator** | Independent of raters | Biased tie-breaks | Flagged adjudications | As above |
| **Study operator** | Follows the protocol | Parallel identities (#16/S2); abandonment (#12/S11); attestation influence if also enumerator | All sampling inputs public and recomputable | **Cannot choose the sample for a registered study**; can decline to run or report one (detectable under the accountable identity) |
| **Preregistration registry** | Immutable records; honest timestamps; public listing; tombstones | Backdating, deleting, hiding records (institutional failure) | Persistent identifier, timestamp, attached hashes | Institutional, not cryptographic, trust |
| **Bitcoin consensus** | Honest-majority hash power | Deep reorganisations | Headers, proof of work, Merkle proofs | Probabilistic finality |
| **Miners** | Do not forfeit rewards to bias the sample | **Model A:** discard `H_rand` blocks (undetectable) · **Model B:** blind withholding only | — | **Model A economic assumption** |
| **drand** (Model B) | Threshold honesty; availability | Threshold collusion | BLS-signed rounds | Network dependency; 30-day VOID rule |
| **Protocol implementation** | Tooling implements the protocol | Bugs | Aggregate SHA, self-tests, mutations, clean rebuild | Test coverage limits; BLS library correctness (Model B) |
| **Archive / storage** | Preserves the artifacts | Loss or tampering | Hashes in registration-linked records; chain data is independently replicable | Loss of off-chain frames or payloads prevents recomputation → the evidence claim lapses |

**Two separate claims — never merged:**

1. **Cryptographic sampling integrity** — given the committed frame, the sample was not chosen by anyone.
2. **Independent candidate selection** — the frame itself is an unbiased, independently constructed pool.

The amendment strengthens (1) only.

---

## 7. Failure and abort rules (no operator discretion after randomness)

| Condition | Rule |
|---|---|
| Registration unavailable (registry down) | **Retry** read-only verification from mirrors or cached signed copy; the sampling event cannot be *verified* until available. Does not affect validity |
| Registration missing, embargoed or private at the development commitment's broadcast | **VOID study** |
| Duplicate registration with different sampling fields | **VOID study** |
| Commitment absent (`O_S` unspent) | **Continue waiting** until the 180-day limit → **study abandoned** (disclosed) |
| Commitment malformed (§3.3 rules 3–7) | **VOID stage** (and therefore the study) |
| Output spent before registration | **VOID study** |
| Commitment unconfirmed / < D confirmations | **Continue waiting** (not yet a commitment) |
| Reorganisation before finality | **Continue** — recompute mechanically |
| Reorganisation after finality | **VOID study** |
| Randomness block not yet at depth D | **Continue waiting** |
| drand round unavailable (Model B) | **Retry** relays; **VOID study** 30 days after `R`'s scheduled time |
| Randomness verification failure (proof of work, linkage, BLS) | **Retry** with other sources. Persistent failure across ≥ 2 independent sources within 30 days → **VOID study** |
| Archive mismatch (hash of an archived artifact ≠ recorded) | **Abort verification** — the evidence claim is unsupported until an intact copy is found; never "repaired" |
| Protocol or tooling hash ≠ registered | **Abort** — the draw is not the registered procedure |
| Candidate-list hash ≠ committed `frame_hash` | **Abort** — the draw is impossible |
| Development ↔ held-out binding mismatch | **VOID held-out stage** |
| Seed derivation mismatch (recomputed ≠ reported) | **Abort**; the reported draw is invalid |
| Pilot yield y = 0 (existing rule) | **HALT** (unchanged) |
| Instrument check produces any fill (existing rule) | **HALT** (unchanged) |

---

## 8. Evidence and reproducibility consequences

| Concept | Before (candidate-002) | After amendment |
|---|---|---|
| **Freeze** | Local hashes of protocol and tooling | **The public, immutable, identity-bound registration** (registry timestamp) |
| **Preregistration** | The frozen file | The registration record naming protocol, tooling and outpoints |
| **Valid sampling event** | Seed revealed by the custodian after frame-hash publication | Confirmed single spend of `O_S` with a valid payload → `H_rand` at depth D (+ verified drand `R` in Model B) → seed recomputed → draw recomputed |
| **Independent reproducer must possess** | Seeds, frames, tooling | Registration record; protocol and tooling files; frames F₁/F₂; scans; development-only registry; pilot result; sizing; both payloads; commitment raw transactions + Merkle proofs; headers from checkpoint to `H_rand + D`; drand chain info + rounds (Model B); manifests; screening logs |
| **Must archive** | As candidate-002 §13 | Candidate-002 §13 **plus** the rows above (payloads, raw transactions, Merkle proofs, header ranges, drand evidence, registration snapshot) |
| **Outsider must recompute** | Draw from seeds | Digest from payload; commitment validity; `H_commit`/`H_rand`; finality; seed; ranks; development and held-out draws; append-only proof |

**A. Cryptographic reproducibility** — anyone can recompute from public inputs that the registered procedure, applied to the committed frames and the chain-determined randomness, yields exactly the reported draws.

**B. Methodological reproducibility** — the protocol, labels, agreement rules, reference-truth and rating procedures can be re-run on the archived data (unchanged from candidate-002).

**C. Independence / accountability** — who built the frames, reference truth and ratings, and whether they were independent. **Not established by A.** Cryptographic reproducibility proves the sample was not *chosen*; it does not prove the pool was built or judged independently.

---

## 9. Amendment delta (plan — not applied)

### 9.1 Protocol → `CPG_U1_PREREGISTRATION_003`

| Section of candidate-002 | Change |
|---|---|
| Header table | New version; **governed tooling → the 037A-repaired lineage** (candidate-002 still names CPG-036 `tooling_v2`) |
| §0 | Add correction note: H3 custodian superseded; operator-generated commitments void |
| §5.5 | **Replaced** by "Registration, commitment and randomness" (§2, §3, §4 of this document) |
| §5.7 | Seed source changed to §3.8; rank key and round-robin **unchanged** |
| §5.8, §5.9, §5.6 | **Unchanged** |
| §9.6 | Unchanged, except "seed hash" is not referenced; seal publication remains before execution |
| §12 rater eligibility | Remove "seed custodian" from the exclusion list |
| §13 archive | **Add** §8 rows |
| §15.5, §18 | **Add** §7 VOID and abort rules |
| §16 | Unchanged |
| §19.1 | Remove seed commitments; add registration fields, outpoints, checkpoint, K, D, (Δ, drand chain), identity |
| §19.2 | H1, H2 unchanged; **H3 replaced** by the U1/U2/U3 approvals |
| §19.3 | Add: funded outputs confirmed; registration public; verification data sources |
| §20 | **Add** limitations: study-level grinding under other identities (#16/S2); registry institutional trust; Model A economic assumption **or** Model B drand/BLS assumptions; probabilistic finality |
| **New §21** | Sampling-integrity verification procedure (`verify-sampling`) |
| Decision register | Rows 8, 17, 18, 19 superseded; new rows for U1–U3, K, D, Δ, abandonment windows, VOID rules |

### 9.2 Tooling

| File | Change |
|---|---|
| `lib/seed.mjs` | **Removed** |
| `lib/chain.mjs` | **New**: header parse; SHA-256d proof of work; `nBits` target; linkage; cumulative work; Merkle proof; SegWit/legacy transaction parse; outpoint check; `OP_RETURN` parse |
| `lib/commitment.mjs` | **New**: canonical payload, digest, held-out binding, append-only proof |
| `lib/chainseed.mjs` | **New**: §3.8 derivation, finality evaluation, round rule (Model B) |
| `lib/drand.mjs` + vendored BLS | **New, Model B only** |
| `cpg_u1_data.mjs` | Remove `seed-commit`. Add `registration-fields`, `commitment-payload --stage`, `verify-commitment`, `derive-seed`, `verify-sampling`. `draw-development`/`draw-held-out` take an evidence bundle (`--registration`, `--payload`, `--commit-tx`, `--merkle-proof`, `--headers`, `[--drand-chain --drand-round]`) instead of `--seed`/`--seed-commitment` |
| `lib/select.mjs`, `lib/schema.mjs`, `lib/reconcile.mjs`, `lib/sizing.mjs`, `lib/scan.mjs`, registry, templates | **Unchanged** |
| Metadata | Manifest: new files, dependency list (Model B), external data sources |

### 9.3 Tests and mutations (estimates; supersede the CPG-039 rough estimate)

| Area | New test checks | New mutations |
|---|---|---|
| Header parsing, proof of work, target, linkage, cumulative work | 12–15 | 4 |
| Merkle proof | 5–6 | 2 |
| Transaction parse, outpoint, `OP_RETURN` (length, tag, version, stage byte) | 12–15 | 5 |
| Payload canonicalisation, digest, domain prefix | 8 | 2 |
| Held-out binding and append-only proof | 8 | 3 |
| Seed derivation and stage separation | 6 | 2 |
| Finality, reorganisation rules, `K`/`D` | 8 | 3 |
| Abort/VOID rules (§7) | 12 | 4 |
| **Subtotal, Model A** | **≈ 71–78** | **≈ 25** |
| drand: round rule, BLS known-answer and negative vectors, relay disagreement, 30-day rule | 12–15 | 5 |
| **Total, Model B** | **≈ 83–93** | **≈ 30** |

The existing seed tests (commitment and stage separation) are removed or replaced. **The 243/37 counts will change**, and new counts must be recorded after implementation. Test vectors must use **historical public Bitcoin mainnet data and archived drand rounds** — never study commitments or seeds.

### 9.4 Dependencies and external infrastructure

| Item | Model A | Model B |
|---|---|---|
| New code dependency | None | Vendored, pinned BLS12-381 library |
| Registry account + public registration | Yes | Yes |
| Bitcoin wallet key + two funded outputs + two spend fees | Yes | Yes |
| ≥ 2 independent Bitcoin data sources (or own node) for verification | Yes | Yes |
| drand relays | — | Yes |

### 9.5 New failure states

`STUDY_VOID_REGISTRATION` · `STUDY_VOID_DUPLICATE_REGISTRATION` · `STAGE_VOID_MALFORMED_COMMITMENT` · `STUDY_VOID_PRE_REGISTRATION_SPEND` · `STUDY_VOID_POST_FINALITY_REORG` · `STUDY_ABANDONED` · `STUDY_VOID_RANDOMNESS_UNAVAILABLE` · `VERIFY_ABORT_HASH_MISMATCH` · `VERIFY_ABORT_SEED_MISMATCH` · `STAGE_VOID_BINDING_MISMATCH`

---

## 10. Decision register

### U1 — Public preregistration

| | |
|---|---|
| **Proposed requirement** | One public, immutable, non-embargoed registration on an eligible registry under a verified accountable identity, containing the §2.2 fields, made after both funding outputs have D confirmations and **before any frame construction**. The earliest such registration is authoritative (§2.3) |
| Alternatives considered | OSF Registries (eligible, embargo off); Zenodo (eligible, first public version authoritative); AsPredicted (ineligible: private-until-revealed); GitHub (ineligible: owner-rewritable, CPG-039); local hashes (ineligible: no outsider evidence) |
| Unresolved issue | Pseudonymous parallel studies under other identities are neither preventable nor detectable (#16/S2) — the limit is identity accountability |
| **Approval required** | (a) choose the registry (OSF or Zenodo); (b) name the accountable identity (role/organisation plus persistent identifier type, e.g. ORCID); (c) accept publishing the registration publicly, without embargo; (d) accept the §2.3 rules and the #16 residual as a declared limitation |

### U2 — Single-use Bitcoin commitment

| | |
|---|---|
| **Proposed requirement** | Two operator-created P2WPKH funding outputs (`O_dev`, `O_ho`), each confirmed ≥ D before registration; commitment = the unique spend with a 39-byte `OP_RETURN` (`CPGU1 ‖ 01 ‖ D/H ‖ digest`); `H_rand = H_commit + K`; **D = 6, K = 12**; 180-day abandonment windows; the §3.4 and §7 VOID rules |
| Alternatives considered | Rekor first-entry (fragile ≈ 360 k entries/hour scan); GitHub (rewritable); Ethereum nonce-0 (needs Keccak and state proofs); OpenTimestamps / RFC 3161 (no uniqueness) |
| Unresolved issue | None methodological. **Operational authority** is needed: creating transactions, holding a key, spending small funds, and publishing on a public chain |
| **Approval required** | (a) authorise creating two funded outputs and later spending each once; (b) assign key custody to the operator; (c) approve D = 6, K = 12 and the 180-day windows; (d) approve the §7 VOID rules |

### U3 — Randomness model

| | Model A — block hash only | Model B — block hash + drand |
|---|---|---|
| Bias resistance | Economic: a miner can discard `H_rand` at ≥ block reward, **undetectably** | Miner withholding is blind; bias requires drand threshold collusion |
| Dependency | None new | drand network + pinned BLS library |
| Verification | Proof of work / headers | Plus BLS known-answer verification |
| Archive | Headers, Merkle proof, transaction | Plus drand chain info and round |
| Failure | Source swap (self-verifying) | Plus 30-day drand VOID rule |
| New assumption | "No party pays ≥ block reward per attempt" | drand threshold honesty; BLS library correctness |
| Proposed default | — | **Proposed (requires approval)** |
| **Approval required** | Choose **A** — accepting and declaring the economic assumption — **or B** — accepting drand dependency, Δ = 3 h, the 30-day rule, and vendoring a BLS library selected at implementation against the §4.2 interface |

### Other decisions

**No other methodological decision is required before implementation.** Two items are **not implementation blockers** but must be recorded:

- **Execution precondition (unchanged, closed):** independent enumerator(s), reference Author, Confirmer, reference adjudicator, ≥ 2 raters and a rater adjudicator (§19.3) — or a recorded absence, with the Rung ≤ 2 ceiling. The custodian-free design does not remove these.
- **Documentation fix inside the amendment:** point the governed tooling at the 037A-repaired lineage, and remove the custodian from rater eligibility (§9.1).

---

## 11. Freeze-readiness verdict

**B. IMPLEMENTATION-BLOCKED — named methodological decisions remain.**

Decisions genuinely requiring human approval:

1. **U1** — registry choice (OSF or Zenodo); accountable identity and its persistent identifier; consent to public, non-embargoed registration; acceptance of the identity-level residual (#16/S2) as a declared limitation.
2. **U2** — authority to create and later spend two funded Bitcoin outputs, operator key custody, `D = 6`, `K = 12`, 180-day abandonment windows, and the VOID rules.
3. **U3** — randomness **Model A** (declare the block-reward economic assumption) **or Model B** (drand + BLS dependency, Δ = 3 h, 30-day rule).

---

*Design only. No external publication, Bitcoin transaction, drand call, seed, dataset construction, production access or code change. CPG-036/037/037A/037B/038/039 artifacts unchanged.*
