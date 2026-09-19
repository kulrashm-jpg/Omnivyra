# CPG_U1_PROTOCOL_004

**STATUS: PROTOCOL — IMPLEMENTED · NOT REGISTERED · NOT FUNDED · NOT EXECUTED · NOT EVIDENCE**

**Supersedes `CPG_U1_PROTOCOL_003.md` for U1.** Protocol-003 (sha256 `9c3a64a6f1e58abe98a02ef75aa7285fd2afafcb01d57cad49f681d4716d7ead`) is preserved byte-identically and must not be registered.

**Changes in protocol-004.** Only the integrity amendments decided in the CPG-042 decision review (`CPG042_DECISION_REVIEW.md`, sha256 `75a794a336c17bada920292cdd2035e49243ad2fbbe5788dc391eac04119ccd8`) and approved for CPG-043 are applied:
- **A-1…A-6:** personnel independence and blinding.
- **B-1:** single complete frame.
- **B-2:** registry frozen at registration.
- **X-1:** execution window and no-preview rule.

Every other decision of protocol-003 is carried unchanged, including:
- candidate-002 lineage (sha256 `093d15e4f93644340662e898eaf88452575a5a6463907d2c3597b2c16b85a707`);
- CPG-040 amendment (sha256 `03675db1ab2c72aaead25a43f40747762cf93ba95945632762ad20cc3743ed3f`);
- U1/U2/U3 approvals (sha256 `a581f639f184a43bb4b861be9e3cf4a689014c6c6295c0cb43747541a139be50`).

It **governs the dataset tooling v4** (CPG-043). Where this document and the tooling disagree, this document wins and the tooling is defective.

| Field | Value |
|---|---|
| Protocol version | `CPG_U1_PROTOCOL_004` |
| Study ID | `CPG-U1-2026-01` |
| Resolver baseline SHA | `f01a7eb4199be4e04d4fee7fc0116303949dc553` |
| Governed tooling | tooling v4: `cpg_u1_data.mjs` + `lib/*` + `rules/development_only_registry.json` + vendored `@noble/curves` 1.9.7 / `@noble/hashes` 1.8.0. Its aggregate SHA-256 is bound in the registration record (`tooling_aggregate_sha256`), not in this file |
| Freeze act | The public OSF registration (§5.5.1). **Local hashes are not a freeze** |
| Relationship to `DEEPTECH-U1` (`u1-001`…`u1-004`) | **Separate uncertainty.** Not inherited |

**Marking.**
- **[NORMATIVE]:** a judgement fixed before data.
- **[DERIVED]:** arithmetically forced by another parameter.
- **[STRUCTURAL]:** a property of the code at the resolver SHA.
- **[APPROVED U1/U2/U3]:** fixed by the recorded human approvals.
- **[APPROVED CPG-043]:** fixed by the CPG-042 decisions approved for CPG-043.
- **[CANONICALIZATION]:** an implementation-level precision of an approved rule, listed in §24.

No parameter is **[EMPIRICAL]**.

### Parts of this document

| Part | Content | Status |
|---|---|---|
| **A** | Closed decisions carried unchanged from candidate-002 (§1–§4, §5.1–§5.4, §5.6, §5.8–§5.9, §6.1–§6.4, §7–§11, §12 core, §13.1, §13.3, §14–§17) | Unchanged |
| **B** | Superseded: seed custodian (H3), commit–reveal seeds, local-hash freeze, `seed-commit` / `--seed`; **post-sizing frame extension (F₂); registry growth between stages** | Removed (§0) |
| **C** | Public preregistration (U1) | §5.5.1 |
| **D** | Single-use Bitcoin commitments (U2) | §5.5, §5.5.2–§5.5.3 |
| **E** | Randomness Model B and seed derivation (U3) | §5.7.1 |
| **F** | Failure, VOID and abort rules | §5.10, §6.5, §15.5, §18 |
| **G** | Named prerequisites (identities, key custody, personnel) — **UNASSIGNED** | §4A, §19 |
| **H** | Verification procedure, attack matrix, trust model, limitations, canonicalizations | §20–§24 |
| **I** | **Protocol-004 integrity amendments**: personnel independence (§4A), single frozen frame and sufficiency (§5.5, §5.7.2), registry freeze (§5.3), blinded adjudication (§9.2.1, §12.2), rater order (§12.1), execution window and no-preview (§6.5) | New |


---

---

## 0. Corrections (recorded, not silently fixed)

### 0.0 In protocol-004 (to protocol-003)

1. **Outcome-dependent frame composition (CPG-042 B-1).** Protocol-003 §5.5 step 9 allowed appending candidates after the pilot and sizing. Whether and how many rows were appended therefore depended on CPG's pilot yield. Because enumeration order is not random, the held-out frame's composition became a function of a CPG outcome. **Fixed:** one complete frame, sufficient for every permitted pilot outcome, exists before the development commitment and serves both stages (§5.5, §5.7.2).
2. **Registry steering (CPG-042 B-2).** Protocol-003 let the development-only registry grow before the held-out commitment. An operator could privately run CPG on frame candidates and add unfavourable companies with a truthful C1(4) basis, excluding them from held-out within the rules. **Fixed:** the registry is frozen at registration for both stages; the held-out scan equals the development scan (§5.3, §5.5.3).
3. **Held-out preview (CPG-042 X-1).** No rule prevented private CPG execution against candidates before the authorised held-out run. **Fixed** by an execution window, an authorisation artifact, a preview definition and a VOID consequence (§6.5). Detection is procedural and audit-based, not cryptographic (§20.20).
4. **Personnel independence and blinding (CPG-042 A-1…A-6).** Protocol-003 did not state:
   - enumerator eligibility;
   - economic and personal independence;
   - that enumerators may not adjudicate reference truth;
   - adjudicator blinding;
   - a seedless rater order.

   **Fixed** in §4A, §9.2.1, §12.1, §12.2.


### 0.1 In protocol-003 (to candidate-002)

1. **H3 (human seed custodian) is superseded.** Commit–reveal protects nothing against whoever holds the seed, and no independent custodian was available (CPG-037B). Candidate-002 §5.5's seeds, the `seed-commit` command and the `--seed` / `--seed-commitment` draw arguments are removed.
2. **Operator-generated commitments are VOID** and must never be used: development `55ab94c44e1ec3032f5f9292332374424b01172da5803a8da78ba296a9672372`, held-out `98be9459cd481c41659428096899975e27bb1ec506a0dcd4de660b528fb25445`.
3. **Commit–reveal did not stop study-level grinding** (running several instances and publishing a favourable one). Protocol-003 answers it with a public, identity-bound registration naming two single-use Bitcoin outpoints before any frame exists (§5.5.1–§5.5.2); the residual under *other* identities is declared (§20).
4. **The freeze is no longer a local hash.** It is the registry-issued timestamp of the public registration.
5. Candidate-002 named `tooling_v2` as governed tooling; protocol-003 governs tooling v3 (the CPG-037A-repaired lineage plus CPG-041).
6. "Seed custodian" is removed from rater eligibility (§12).

### 0.2 Carried from candidate-002 (to candidate-001)


1. **The all-abstention loophole was not closed.** Candidate-001 §10.3 defined AR = CORRECT-ABSTENTION / (CORRECT-ABSTENTION + UNSUPPORTED-FILL + INCORRECT-FILL), and `CPG_U1_INTEGRITY_REVIEW_001.md` item 4 claimed this closes the loophole. **That claim was false.** Missed fills never enter AR, so a system that abstains almost everywhere scores AR ≈ 1.0. A single correct fill plus universal abstention would have scored EFR = 0, AR = 1.0, II = 0 — a false SUCCESS. **Fixed in §10** by an assessability gate derived from θ_EFR, a corrected AR definition, and mandatory reporting of fill recall.
2. **Identity misattribution was folded into INCORRECT-FILL.** It is now its own label (§10.1), so identity errors cannot hide inside ordinary value errors.
3. **"Blinding to arm" is moot in a single-arm design.** Rater blinding is re-specified in §12.
4. **The treatment scope was stated loosely.** §7 now states precisely that U1 exercises `lookupGroundedCompanyFacts`, not the HTTP route.

---

## 1. Research question

> When CPG's deterministic evidence-grounded resolver populates a company fact, is that fact supported by an independent authoritative source for the intended real-world entity — and does CPG withhold a fact when no such support exists?

## 2. Technical uncertainty and U1 definition

**U1 = independent reference-truth evaluation of CPG's fact-resolution and abstention behaviour.**

U1 is **single-arm**. It measures whether the grounded system is reliable in absolute terms against sealed, independently constructed reference truth. It does **not** measure how much of that reliability grounding contributes. That attribution belongs to U9 (§16.3) or a future marginal-evidence protocol. **U1 and U9 are not conflated.**

**Rung 1 is already established (engineering proof):** the verified-only gate (`companyFactsLookup.ts:174`), the ≥2-sources-or-1-Tier-1 bar (`types.ts:44`), domain/registry-anchored identity, deterministic resolution, and a server-authoritative target (`company-facts-lookup.ts:49-56`). **Not established:** whether the gate, identity chain and abstention hold for real companies and live sources.

## 3. Hypotheses

| | Statement |
|---|---|
| **H₀** | CPG's fills are not reliably supportable or its withholding is not reliable: the run is not SUCCESS under §10.5. |
| **H₁** | On the held-out set, the assessability gate holds **and** EFR ≤ θ_EFR **and** AR ≥ θ_AR **and** II = 0. |

Falsification is reachable and must be reported (§10.5). "Positive", "promising", "directionally better", "encouraging" and equivalents are prohibited as substitutes for the outcome vocabulary.

## 4. Experimental unit

**company × field**, across the three fields `founded_year`, `employee_count` (reported as `team_size`) and `revenue_range` — the entire CPG fact surface [STRUCTURAL: `companyFactsLookup.ts:36-40`].

The company is the cluster: all three fields share one identity resolution and one acquisition. **Independence is violated by design.** There are no confidence intervals, no significance test as an acceptance basis, and the status is **EXPLORATORY, NOT CONFIRMATORY**. Every aggregate is reported with its company count and the per-company distribution.

---

## 4A. Study personnel and independence [NORMATIVE; APPROVED CPG-043]

### 4A.1 Independence from the developing organisation

"Developing organisation" means the entity that develops, owns or operates CPG or Omnivyra, and any affiliate.

**Exclusion period:** from the first repository commit of the developing organisation's product until publication of this study's results.

A person is **not independent**, and may hold no role in §4A.3, if at any time in the exclusion period the person:

1. is or was employed by the developing organisation, in any capacity;
2. has or had any contract, engagement or other work (paid or unpaid) for it, other than the engagement in item 5;
3. received any payment or benefit from it, other than the fee in item 5;
4. holds equity, options or any other financial or organisational interest in it;
5. — *permitted exception:* a fixed fee for the study role, agreed in writing **before** any role material is released, **not contingent** on any result, finding or future engagement; the agreement's SHA-256 is recorded;
6. is the spouse or partner, a family member or a household member of, or has a current or former direct reporting relationship with, any person who developed CPG, the operator (key custodian), or any holder of another §4A.3 role.

**Recorded per person** (restricted register; a pseudonymous ID is used in study artifacts):
- a signed declaration answering items 1–4 and 6 and §4A.2(a)–(b) with "no";
- the fee-agreement hash (or none);
- the developing organisation's written confirmation that its records show no item 1–4 relationship.

An unknown answer is not "no".

These are **procedural evidence, not proof**. If a declaration is later found false, that person's work is non-independent, and the finding is published:
- **rater work:** the §12 UNADJUDICATED consequences apply;
- **enumerator work:** the frame is not independent (§20.18);
- **reference work:** the reference truth is not independent.

**This is a methodological rule; it is not a legal determination.**

### 4A.2 Enumerator eligibility

An enumerator must:
- (a) not have implemented CPG, this protocol, the tooling or the development-only registry;
- (b) not have run CPG or seen any CPG output (including the development pilot and instrument check) before completing the frame;
- (c) not be the operator (key custodian);
- (d) hold no other §4A.3 role;
- (e) satisfy §4A.1.

**Enumerators receive only:**
- public sources;
- the frame template;
- §4A, §5.1–§5.4;
- the jurisdiction-family list;
- the development-only registry.

**They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2).

### 4A.3 Roles and mutual exclusion

**Roles:**
- operator (key custodian; not independent);
- enumerator (≥ 1);
- reference Author;
- reference Confirmer;
- reference adjudicator;
- rater 1;
- rater 2;
- rating adjudicator.

**Every independent role is held by a different person, and no independent role is held by the operator.**
- The seven independent roles are mutually exclusive: **minimum 7 independent persons**.
- Several enumerators are permitted; each holds no other role.
- An enumerator may not be the reference adjudicator. The adjudicator decides contested reference values, and the enumerator authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7).

The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is recorded in the personnel register, and its SHA-256 fingerprint is published, **before the held-out commitment transaction is broadcast** (§12.1). Tooling: `check-personnel` verifies structure (roles filled, mutual exclusion, operator in none, declarations "no", confirmation present). It cannot verify that declarations are true.


## 5. Dataset construction (normative; executed by independent people, not by this document)

Every person performing a §5 task satisfies §4A.

**No company is named in this document and no fact about any company is asserted.** The only company names that appear are in the development-only registry (§5.3), which records the implementers' own CPG history.

### 5.1 Admissibility — tri-state

Each criterion is answered **yes / no / unknown**. **UNKNOWN means "not established / insufficient evidence". It never means false, and it never satisfies a criterion** [enforced: `checkFrameRow`; exhaustive 81-combination test].

| # | Criterion | `no` → | `unknown` → |
|--:|---|---|---|
| A1 | Real, currently operating legal entity | `A1_NOT_OPERATING_ENTITY` | `A1_NOT_ESTABLISHED` |
| A2 | Canonical domain controlled by the entity, reachable over HTTPS | `A2_NO_CONTROLLED_DOMAIN` | `A2_NOT_ESTABLISHED` |
| A3 | Decisive identifier, checksum-valid and permitted for the jurisdiction family | `A3_INVALID_IDENTIFIER` | `A3_NOT_ESTABLISHED` |
| A4 | Identifier↔domain tie evidenced independently of CPG (URL + note required) | `A4_NO_INDEPENDENT_TIE` | `A4_NOT_ESTABLISHED` |
| A5 | Jurisdiction family accessible at the resolver SHA | `A5_INACCESSIBLE_JURISDICTION` | `A5_NOT_ESTABLISHED` |
| A6 | Reference truth obtainable for all three fields | `A6_REFERENCE_NOT_OBTAINABLE` | `A6_NOT_ESTABLISHED` |
| — | Expected outcome class | — | `OUTCOME_CLASS_NOT_ESTABLISHED` |

**Representation rules.** A value that is not established is written as the explicit token `UNKNOWN` (domain, jurisdiction family, identifier scheme) or `unknown` (attestations, outcome class). **A blank cell is always malformed**, so an omission can never pass for a deliberate "not established". Domains are canonical: lowercase, no scheme, port, path, or `www.` prefix.

**Accessible jurisdiction families** [STRUCTURAL: `registry/builtins.ts`, provider access states]: `US-SEC` (CIK or LEI), `FR-SIRENE` (SIREN or LEI), `BR-CNPJ` (CNPJ or LEI), `LEI-ONLY` (LEI). A company from an inaccessible jurisdiction is admissible only as `LEI-ONLY`.

### 5.2 Classes

| Class | Definition (the enumerator's **prediction**, made before any reference research) |
|---|---|
| `fill-expected` | An authoritative source is expected to state at least one of the three fields |
| `abstention-expected` | No authoritative source is expected to state any of the three fields |
| `identity-hazard` | A different real entity shares the name or a confusable domain (the collision must be named) |

The class serves **sampling balance only**. Labels are always determined by reference truth, never by the class (§9.7).

### 5.3 Held-out ineligibility (CPG-C1)

A company is **held-out-ineligible** if **any** of the following holds. Ineligibility never excludes a company from research: it can only be drawn into development.

| Rule | Condition | How established |
|---|---|---|
| **C1(1)** | Name, domain or identifier appears in a committed path within scan scope at the resolver SHA | Scanner (§5.4) |
| **C1(2)** | Used in developing the CPG resolver, the protocol, the dataset tooling, or reference-truth procedures | Attestation `c1_2_used_in_cpg_work` |
| **C1(3)** | Any expected value derived from a CPG output | Attestation `c1_3_values_derived_from_cpg` |
| **C1(4)** | Any prior CPG execution — smoke, live, pilot or production | Attestation `c1_4_prior_cpg_execution` |
| **C1(5)** | The implementers' own company or tenant, or an entity they control | Attestation `c1_5_internal_or_owned` |
| **C1(6)** | Matches the **development-only registry** by name (whole word) or domain (exact or parent) | Scanner + `rules/development_only_registry.json` |

**For every contamination attestation, `unknown` is treated exactly like `yes`.** An unestablished contamination question makes a company ineligible [enforced].

**Own company is automatically development-only.** C1(5) and registry entry DEV-001 each independently make Omnivyra held-out-ineligible, whatever the scanner or any attestation says.

**Development-only registry** [NORMATIVE, append-only, entries never removed]. It is seeded with 13 entries from the implementers' own CPG history: Omnivyra (DEV-001); Cloudflare, Tesco, Calendly, TotalEnergies and Mercury (CPG live smoke and fixtures); Sasol, BMW Group and Petrobras (CPG-012 live pass); Stripe, Infosys, Zerodha and Basecamp (CPG-004 live harness). Each entry cites its basis and evidence. **The seed's completeness is not attested** (§19.2, H2).

**For this study the registry is frozen at registration** [NORMATIVE; APPROVED CPG-043].
- **Eligibility source:** held-out eligibility for **both** stages is determined solely by the registry whose SHA-256 is in the registration.
- **No changes apply after registration.** Additions, deletions and edits of entries have no effect on this study. Both commitment payloads must carry the registered `registry_sha256` (§5.5.3), and the held-out stage verifies equality (enforced: CLI refusal before commitment; VOID at chain verification).
- **Late-discovered contamination:** a contamination discovered after registration is recorded (company, basis, date, discoverer) and published. The company is **never excluded, removed or replaced**, whether for later CPG performance, for any outcome, or at all (§5.9, §15.2). Its observations are flagged `CONTAMINATION-DISCLOSED`. A pre-specified secondary analysis excluding flagged observations may be reported and **never changes the §10.5 outcome**.

### 5.4 Scan scope (decision D-D)

"Committed test fixture, snapshot or assertion" is **replaced** by a two-class scope, evaluated over `git ls-files` at the resolver SHA in a clean clone:

- **TEST** — any path under `test/`, `tests/`, `__tests__/`, `fixture/`, `fixtures/`, `__snapshots__/`, `__mocks__/`, `e2e/`, or named `*.test.*`, `*.spec.*`, `*.snap`.
- **CPG_IMPLEMENTATION** — `backend/services/companyProfile/`, `backend/evaluation/`, `pages/api/company-profile/`, `pages/api/company-grounding/`, `components/companyProfile*`, `components/companyFacts*`.

Name (with and without legal suffixes, whole word), domain and identifier tokens are matched case-insensitively at word boundaries. The scan is **conservative**: a false positive only moves a company to development. *Why the widening matters:* at the resolver SHA, Cloudflare and Tesco also occur in CPG grounding **source** (`discoveredSource.ts:232`, `entityResolution.ts:223`), which a test-only scope would miss.

### 5.5 Two stages, registration, commitments and randomness

```
 0. key custodian (STUDY_OPERATOR) creates two P2WPKH funding outputs O_dev, O_ho; each ≥ D = 6 confirmations
 1. choose checkpoint block (height, hash) at or after both funding confirmations
 2. PUBLIC OSF registration (no embargo) under the accountable identity, naming protocol, tooling,
    registry, outpoints, checkpoint and parameters                          ← the freeze (§5.5.1)
 3. enumerate the COMPLETE frame F → frame → scan → check-frame-sufficiency (§5.7.2) — NO LATER ADDITIONS
 4. commitment-payload(development) → spend O_dev ONCE with OP_RETURN "CPGU1"‖01‖44‖digest
 5. wait: commitment depth 6; H_rand = H_commit + 12; block H_rand + 6 mined
 6. R_dev = first drand quicknet round scheduled ≥ MTP(H_rand + 6) + 3 h; verify BLS
 7. draw-development (seed derived internally, §5.7)                       (exact 6/2/2)
 8. development pilot + instrument check (§8.5) → size (§5.6)
 9. record and fingerprint the rater / rating-adjudicator label assignment (§4A.3). NO frame extension:
    held-out draws from F with the same scan and the registered registry
10. commitment-payload(held-out): same frame, scan and registered registry; binding development txid, digest, manifest, pilot, sizing, append-only proof (F identical)
    → spend O_ho ONCE (after development finality) with OP_RETURN "CPGU1"‖01‖48‖digest
11. wait as 5; R_ho as 6 → draw-held-out                                    (sizing quotas)
12. blind reference construction for BOTH stages → blinded adjudication (§9.2.1) → reconcile → seal (§9)
13. publish seal record → authorize-execution → held-out execution ONCE inside the window (§6.5) → archive (§13)
    → rating in derived order (§12.1) → blinded rating adjudication (§12.2) → analysis
```

- **No person supplies randomness.** The randomness of each stage is the Bitcoin block hash at a height fixed by the commitment (`H_commit + K`) combined with a drand round fixed by that block's successors (§5.7.1). The tooling computes both; it has no seed argument and refuses caller-chosen rounds [enforced].
- **Why this stops rank-aware selection.** The frame hash is inside the on-chain digest (§5.5.3) before the randomness block exists; a second commitment is impossible because each outpoint can be spent once (Bitcoin consensus); a second study instance is detectable because the registration naming the outpoints is public and identity-bound (§5.5.1).
- **Single frozen frame** [NORMATIVE; APPROVED CPG-043]:
  - **Complete before the development commitment.** The complete frame F must exist and meet the sufficiency rule (§5.7.2) before the development commitment.
  - **One frame for both stages.** The held-out payload's `frame_hash` and `scan_sha256` must equal the development payload's, and its `registry_sha256` must equal the registered value (§5.3).
  - **No changes after the development commitment.** Rows may never be added, removed, edited, re-identified or reclassified (enforced: CLI refusal before the held-out commitment; VOID at chain verification).
  - **Enumerator barrier.** Enumerators never receive pilot, sizing or quota information (§4A.2).
  - **Append-only proof retained.** The payload's append-only proof is retained; with a single frame it certifies identity.

#### 5.5.1 Public preregistration [APPROVED U1]

| Rule | Content |
|---|---|
| Registry | **OSF Registries**, **public**, **no embargo** |
| Identity | An **accountable identity** bound to the OSF account, with a **persistent identifier** (type and value recorded). **Both are UNASSIGNED in this document and in the tooling template; the tooling refuses to proceed while either is UNASSIGNED (exit 4)** |
| Content | `study_id` `CPG-U1-2026-01`; `protocol_version` `CPG_U1_PROTOCOL_004`; `protocol_sha256`; `tooling_aggregate_sha256`; `registry_sha256`; registry settings; accountable identity; persistent identifier; key custodian (role `STUDY_OPERATOR`); network `bitcoin-mainnet`; outpoints `O_dev`, `O_ho`; checkpoint; the pinned parameter set (§5.7.1); authority rule; verification procedure (§21). Produced by `registration-fields` |
| Ordering | Funding confirmed (≥ 6 at the checkpoint) → **registration** → frame construction → development commitment |
| Registry-issued | `registration_id` (persistent identifier of the record) and `registration_timestamp` — never asserted by the operator |
| Authority | **The earliest registration under the accountable identity with this `study_id` is authoritative.** A second registration with different sampling fields (protocol, tooling, registry, network, outpoints, checkpoint, parameters) → **study VOID**. Identical duplicates are ignored. A withdrawal → **study VOID** (tombstone reported) [enforced over the verifier-supplied identity listing] |
| Embargo / private | **Forbidden.** Registration must be public before the development commitment is broadcast. The tooling enforces the chain-provable bound: a `registration_timestamp` at or after the scheduled time of `R_dev` → **study VOID** [enforced]; the full rule (before broadcast) is an outsider check (§21) |
| Evidence rule | Only a study registered under the accountable identity may be reported as CPG U1 evidence |

#### 5.5.2 Funding outputs and key custody [APPROVED U2]

- **Key custodian: `STUDY_OPERATOR`** (CPG-040 §3.2, preserved). The person is **UNASSIGNED**; `check-funding-prerequisites` is BLOCKED until named. Custody cannot buy a second draw: each outpoint can be spent once. Loss of the key means the stage cannot start → abandonment (§5.10).
- `O_dev` and `O_ho` are **distinct single-signature P2WPKH outputs**; each funding transaction has **≥ D = 6 confirmations at the checkpoint** (`funding_height + 6 − 1 ≤ checkpoint_height`) [enforced].
- An outpoint spent **at or before the checkpoint** → **study VOID** [enforced]. A spend after the checkpoint but before registration is excluded by the payload's `registration_id` (§5.5.3) and by outsider comparison with the registry timestamp.
- The tooling creates **no wallet, no key, no transaction**.

#### 5.5.3 Commitment transaction, payload and digest [APPROVED U2]

A transaction `T` is the commitment for stage S **iff**: (1) it spends `O_S` (and not the other stage's outpoint — else **study VOID**); (2) it is included (Merkle proof) in the agreed header chain with **≥ 6 confirmations**; (3) it has **exactly one** `OP_RETURN` output, whose script is exactly `6a 27` + 39 bytes; (4) those bytes are `"CPGU1"` ‖ `01` ‖ stage byte (`44` development, `48` held-out) ‖ 32-byte digest; (5) the stage byte matches the spent outpoint; (6) the digest equals the digest of the published payload; (7) the payload is valid and binds this registration, including a `registry_sha256` equal to the registration's for **both** stages; for held-out, a `frame_hash` and `scan_sha256` equal to the development payload's.

Payload `cpg-u1-commitment/v1` (canonical JSON, sorted keys, exactly these keys): `schema`, `study_id`, `stage`, `registration_id`, `protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256`, `frame_hash`, `scan_sha256`, `outpoint`, `binding` (`null` for development). Held-out `binding`: `development_commitment_txid`, `development_payload_digest`, `development_manifest_sha256`, `development_frame_hash`, `pilot_result_sha256`, `sizing_sha256`, `append_only_proof` {`development_frame_hash`, `held_out_frame_hash`, `development_row_hashes_sha256`, `proof` = sha256(`"cpg-u1-append-only/v1|" + dev_frame + "|" + ho_frame + "|" + dev_rows`)}.

`digest = sha256("cpg-u1-commitment-digest/v1|" + canonicalJson(payload))`.

| Case | Disposition |
|---|---|
| `O_S` spent by a transaction failing rules 3–7 | **Stage VOID** (slot consumed; no retry) → study VOID |
| Supplied payload does not hash to the on-chain digest | **Abort verification** — supply the committed payload; never "repaired" |
| Valid commitment, < 6 confirmations | Wait |
| Held-out committed at or before development finality (height ≤ `H_rand_dev + 6`) | **Held-out stage VOID** |
| Held-out binding names a different development txid / digest | **Held-out stage VOID** |
| Held-out `frame_hash` ≠ development `frame_hash`, `scan_sha256` ≠ development `scan_sha256`, or `registry_sha256` ≠ registered | **Held-out stage VOID** (single frozen frame; registry freeze) |
| Held-out binding differs from the supplied development manifest, pilot, sizing or append-only proof | **Held-out stage VOID** |

### 5.6 Sizing rule

**Development** [NORMATIVE]: exactly 6 fill-expected, 2 abstention-expected, 2 identity-hazard.

**Held-out** is a **pre-registered deterministic function** of the development pilot, fixed now and applied before the held-out draw:

```
y          = total fills across the 6 development fill-expected companies ÷ 6
if y = 0   → HALT (EFR could never be assessed)
raw        = ceil(MIN_FILLS × SAFETY ÷ y)
N_fill     = min(CAP, max(12, raw))                       capped = raw > CAP
N_abst     = max(5, ceil(N_fill × 5 ÷ 12))
N_hazard   = max(3, ceil(N_fill × 3 ÷ 12))
```

| Parameter | Value | Basis |
|---|---|---|
| MIN_FILLS | 20 | **[DERIVED]** = 1 ÷ θ_EFR. Below 20 fills, one erroneous fill already exceeds θ_EFR, so EFR cannot be assessed at its own resolution |
| SAFETY | 1.5 | [NORMATIVE] Development companies are disproportionately well-known (contaminated), so their pilot yield is expected to overstate held-out yield |
| Floors 12 / 5 / 3 | — | [NORMATIVE] carried from candidate-001 as minimum strata sizes |
| CAP | 60 fill-expected (→ at most 60 / 25 / 15 = 100 held-out companies) | [NORMATIVE] resourcing ceiling — **requires human approval (H1)** |

If `capped`, the run proceeds at the cap and the elevated risk of an INCONCLUSIVE result is declared in advance. **The pilot result informs size only.** It may change no threshold, rule, label definition or line of code.

### 5.7 Ordering, tie-breaking, pool minimum

#### 5.7.1 Confirmation, randomness, round rule and seed [APPROVED U2, U3]

| Parameter | Value |
|---|---|
| Confirmation depth | **D = 6** (funding at the checkpoint, commitment block, randomness block). Confirmations of block `h` at tip `t` = `t − h + 1` |
| Randomness block | **K = 12**: `H_rand = H_commit + 12` |
| Finality | Block `H_rand + 6` exists in the agreed chain. Before that, `T`, `H_commit`, `H_rand` are recomputed mechanically |
| drand chain | quicknet `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, scheme `bls-unchained-g1-rfc9380`, period 3 s, genesis 1692803367; round `r` scheduled at `genesis + (r − 1) × 3` |
| Round rule | **Δ = 3 h**: `R` = the first round whose scheduled time ≥ `MTP(H_rand + 6) + 10800` s, where MTP = Bitcoin Core median-time-past (median timestamp of the block and its 10 predecessors) |
| Round verification | message = sha256(uint64_be(R)); hash-to-G1 per RFC 9380 with DST `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_`; check e(H(m), −PK) · e(S, G2) = 1; signature must be a canonical, on-curve, prime-order, non-identity G1 point; randomness = sha256(signature); relay-reported randomness must match. Implementation: vendored **@noble/curves 1.9.7** (+ @noble/hashes 1.8.0), pinned in the tooling aggregate |
| Header sources | Two differently named sources; every header verified (proof of work ≤ powLimit, linkage, MTP timestamp rule, nBits continuity, recomputed retargets from an archive starting at a retarget boundary ≤ checkpoint, registered checkpoint hash). Sources must agree block-for-block; only blocks both contain count |
| Missing round | Wait; **no verifiable round 30 days after R's scheduled time → study VOID** (no substitute round) |

**Seed** [APPROVED U3, Model B]:

```
seed_S = sha256( "cpg-u1-chain-drand-seed/v1|" S "|" digest_S "|" txid_S "|" H_commit_S "|" H_rand_S "|"
                 blockhash(H_rand_S) "|" drand_chain_hash "|" R_S "|" drand_randomness(R_S) )
```

Hashes 64 lowercase hex in display order; heights and rounds decimal without leading zeros; `S` ∈ {`development`, `held-out`}. `seed_S` feeds the **unchanged** rank key below. The seed is derived inside the draw commands; manifests and outputs record only `seed_fingerprint = sha256("cpg-u1-seed-fingerprint/v1|" + seed)` and the full sampling record, from which anyone can recompute the seed.


- **Rank key** (decision D-C) [NORMATIVE]: `sha256("<seed>|<scheme>:<identifier>")`. Keying on the identifier means renaming a row cannot re-roll it. The tie-break is the identifier string, which makes the order total.
- **Jurisdiction balance** (decision D-A) [NORMATIVE]: within each class, families are interleaved round-robin in the fixed order `US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY`, each family's queue in rank order. An exhausted family stops contributing and the others continue. **The realised jurisdiction composition is published**, and missing families are declared as a scope limitation.
- **Uniqueness** [enforced]: one row per legal entity. Duplicate identifiers or duplicate canonical domains are refused.
- **Pool minimum** [NORMATIVE]: for each stage and class, the eligible admissible pool must hold at least **2 × the quota**, so the draw is a genuine selection rather than a hand-picked set. `pool-check` verifies this **without any randomness**. Below the minimum, nothing is drawn.

#### 5.7.2 Frame sufficiency [NORMATIVE; DERIVED; APPROVED CPG-043]

**Rule.** Before the development commitment, for each class c, the number `E_c` of **admissible, held-out-eligible** rows in F must satisfy:

`E_c ≥ 2 · Qmax_c + Dev_c`, that is, **E ≥ 126 / 52 / 32** (fill-expected / abstention-expected / identity-hazard).

- `E_c` is determined by §5.1–§5.4, using the scan committed in the development payload and the registered registry.
- If unmet, **no development commitment may be made**; enumeration continues first (enforced: `check-frame-sufficiency`, `commitment-payload`).
- A development commitment to an insufficient frame is **STAGE_VOID_FRAME_INSUFFICIENT**: the slot is consumed and there is no retry (enforced at `draw-development`).

**Proof that 126 / 52 / 32 suffices for every permitted pilot outcome.**

1. **Permitted pilot outcomes.** §5.6 and §11: the pilot covers exactly 6 development fill-expected companies, each with fills ∈ {0, 1, 2, 3}. There are 4⁶ = 4096 outcomes, with total fills `T` ∈ {0,…,18}.
2. **HALT.** `T = 0` → HALT (§5.6): no held-out stage exists.
3. **Fill-expected quota.** For `T ≥ 1`: `y = T/6` and `raw = ⌈MIN_FILLS·SAFETY / y⌉ = ⌈180/T⌉`. Then `N_fill = min(60, max(12, raw)) ≤ 60`, with equality iff `raw ≥ 60` iff `T ≤ 3`.
4. **Secondary quotas.** `N_abst = max(5, ⌈5·N_fill/12⌉)` and `N_hazard = max(3, ⌈3·N_fill/12⌉)` are non-decreasing in `N_fill`, so `N_abst ≤ max(5, 25) = 25` and `N_hazard ≤ max(3, 15) = 15`. Hence **Qmax = 60 / 25 / 15**, attained at `T ∈ {1, 2, 3}`.
5. **Development consumption.** The development draw takes exactly `Dev = 6 / 2 / 2` rows per class (§5.8). At most `Dev_c` of them are eligible, so the held-out pool (admissible ∧ eligible ∧ ¬development) satisfies `pool_c ≥ E_c − Dev_c`.
6. **Stable eligibility.** Eligibility is identical at both stages, because frame, scan and registry are frozen (§5.3, §5.5).
7. **Sufficiency.** The held-out draw requires `pool_c ≥ 2·Q_c` (§5.7). If `E_c ≥ 2·Qmax_c + Dev_c`, then `pool_c ≥ 2·Qmax_c ≥ 2·Q_c` for every permitted outcome. ∎
8. **Tightness.** With `E_c = 2·Qmax_c + Dev_c − 1` and a development draw taking `Dev_c` eligible rows of class c (possible whenever class c has fewer than `Dev_c` ineligible admissible rows), an outcome with `T ≤ 3` leaves `pool_c = 2·Qmax_c − 1 < 2·Qmax_c`. The minimum cannot be lowered in the worst case. It is conservative when ineligible rows absorb development places.
9. **Mechanical check.** Tooling v4 derives `Qmax` by evaluating the frozen sizing function on all 4096 outcomes (`lib/frame.mjs`). The self-test asserts:
   - 4096 outcomes, 1 HALT and 0 refusals;
   - Qmax = 60/25/15 and the minimum 126/52/32;
   - an exactly-minimal frame supports every distinct permitted quota vector after an all-eligible development draw;
   - one row fewer fails.

**Resourcing consequence.** At least 210 eligible admissible rows must be enumerated and screened before the development commitment. Reference-truth workload is unchanged: only drawn companies are researched; CAP H1 is unchanged.


### 5.8 Development allocation and surplus (decision D-B)

Development is filled class by class: **held-out-ineligible companies first**, since they can serve nowhere else, then eligible companies, each group in D-A order, capped at the exact development quota. Ineligible admissible companies not drawn are `DEVELOPMENT_SURPLUS` and **never enter held-out**.

### 5.9 No replacement

A drawn company is **never replaced**. If identity-level inadmissibility is discovered after the draw (e.g. the identifier belongs to a different entity), **all of that company's observations become INVALID and are published**. They count against the valid-observation floor (§15.5). *Reason:* replacement after the draw lets the reference team reject hard-to-document companies, and documentation difficulty plausibly correlates with CPG's own difficulty. A reference value of `NOT_AVAILABLE_FROM_SOURCE` is a valid outcome, not inadmissibility.

### 5.10 Sampling-event states, abandonment and VOID rules [APPROVED U2, U3]

| State | Condition | Consequence |
|---|---|---|
| `NOT_STARTED` | `O_S` unspent (per supplied evidence) | Wait |
| `STUDY_ABANDONED` | Development unspent **180 days** after `registration_timestamp`; held-out unspent 180 days after the development draw (scheduled time of `R_dev`); or a commitment confirmed after its window (MTP of its block) | Disclosed; no evidence claim; a restart needs a new registration citing this one |
| `WAITING_COMMITMENT_DEPTH` / `WAITING_RANDOMNESS_DEPTH` / `WAITING_DRAND_ROUND` / `WAITING_DEVELOPMENT_FINALITY` | Depth, block `H_rand + 6`, round `R` or development finality not yet available | Wait |
| `STUDY_VOID_REGISTRATION` | Registration incomplete in a sampling field, differing duplicate, withdrawal, funding not P2WPKH or < 6 confirmations at the checkpoint; **or `registration_timestamp` ≥ scheduled time of `R_dev`** (registered after the development randomness existed) | Study VOID |
| `STUDY_VOID_PRE_REGISTRATION_SPEND` | Outpoint spent at or before the checkpoint | Study VOID |
| `STAGE_VOID_MALFORMED_COMMITMENT` | §5.5.3 rules 3–7 fail | Study VOID |
| `STUDY_VOID_SLOT_CROSS_SPEND` | A commitment spends both slots | Study VOID |
| `STAGE_VOID_BINDING_MISMATCH` | Held-out ordering or binding fails, including a held-out frame, scan or registry differing from the development / registered one (§5.5.3) | Study VOID |
| `STAGE_VOID_FRAME_INSUFFICIENT` | The development commitment named a frame failing §5.7.2 | Study VOID |
| `STUDY_VOID_PREVIEW` / `STUDY_VOID_UNAUTHORIZED_EXECUTION` / `STUDY_VOID_REPEATED_EXECUTION` / `STUDY_VOID_POST_WINDOW_EXECUTION` | §6.5 violation detected | Study VOID |
| `STUDY_VOID_POST_FINALITY_REORG` | A previously FINAL record (txid, heights, block hashes, round) is contradicted by the chain | Study VOID; no re-draw |
| `STUDY_VOID_RANDOMNESS_UNAVAILABLE` | No verifiable round `R` **30 days** after its scheduled time | Study VOID |
| `FINAL` | All of the above satisfied; BLS verified | Seed derived; draw permitted |
| Abort (`VERIFY_ABORT_*`) | Evidence wrong or incomplete: header/Merkle/BLS failure, source disagreement, payload ≠ digest, protocol or tooling hash ≠ registered, frame/scan/registry ≠ committed, sampling record ≠ chain | Nothing decided or drawn; retry with correct evidence. Persistent randomness verification failure across ≥ 2 sources within 30 days → study VOID |

Clocks are chain-derived (MTP), never the operator's wall clock.

---

## 6. Development / held-out integrity

1. The held-out set, its identifiers and its sealed reference truth are frozen **before** held-out execution.
2. **The held-out set is executed once.** No threshold, rule, label definition, rater instruction or line of CPG code may change after any held-out result is seen, except by a new protocol version as a new file.
3. Development may be executed without limit (pilot, instrument check, harness debugging).
4. A company moves from development to held-out **never** within a protocol version.

### 6.5 Held-out execution window and no-preview rule [NORMATIVE; APPROVED CPG-043]

**Authorising artifact.** The execution authorisation (`cpg-u1-execution-authorization/v1`, produced by `authorize-execution`) binds:
- the seal hash (recomputed);
- the development and held-out manifests (their hashes as bound by the seal);
- the single frozen frame (development frame hash = held-out frame hash);
- the **published seal record**: a public record linked to the registration on OSF Registries, naming the seal hash, with a registry-issued timestamp.

Its SHA-256 is recorded.

**Window.**
- **Opens** at the registry-issued timestamp of the published seal record, which must be later than the held-out drand round's scheduled time.
- **Closes** when the single authorised held-out run completes.
- **One run.** Exactly one run executes the held-out companies. It names the authorisation hash and executes each held-out company once. It is not restarted, resumed or repeated: a company without a response is INVALID (§15.2).
- **Start time.** The operator chooses when to start after the window opens. No held-out outcome information exists without a preview, so this choice cannot use outcomes. Public source-availability information remains observable (§20.21).

**Preview (prohibited).** Any execution of CPG, in any environment (production, staging, certenv, local, harness) and through any entry point, or any reading of stored CPG output (logs, persisted results), where:
- the input identifies a company in F (by identifier, name or domain);
- it is performed by study personnel, the developing organisation's staff, or anyone at their direction.

A preview occurs if such an execution or reading happens:
- (a) for a company later drawn into **held-out**: at any time before the authorised run starts, or after it completes;
- (b) for a company drawn into **development**: before the development drand round's scheduled time;
- (c) for any **other frame company**: before the held-out drand round's scheduled time.

Pilot, instrument-check and harness-debugging runs on development companies after (b) are permitted (§6.3).

**Evidence retained (archive, §13.2A):**
- the execution authorisation;
- the execution log of every CPG invocation made by the U1 harness (run id, kind, authorisation hash, start/completion, per-invocation time and company identifier), in `cpg-u1-execution-log/v1` form;
- the recording-fetcher archive (§13.1);
- the operator's signed no-preview declaration covering the period from frame completion to run completion;
- where the deployment stores CPG lookups or results, an export of records for the frame's companies over that period, made where possible by someone other than the operator;
- the `audit-execution-log` output.

**Detection.**
- Mechanical audit (`audit-execution-log`) of the supplied log flags `STUDY_VOID_PREVIEW`, `STUDY_VOID_UNAUTHORIZED_EXECUTION`, `STUDY_VOID_REPEATED_EXECUTION` and `STUDY_VOID_POST_WINDOW_EXECUTION`.
- Comparison of recording-archive timestamps with the window.
- Review of stored-lookup exports.
- Disclosure by any person.

**Technical prevention actually available:**
- the registered tooling runs no CPG;
- the U1 harness must refuse held-out companies without a verified authorisation and must log every invocation.

This prevents previews **through the harness only**. **Nothing in this protocol can prove that an unlogged private query did not occur** in another environment. Protection against that is procedural (declaration, restricted access) and audit-based (exports, archives), and is declared in §20.20.

**Consequence.** A detected preview, unauthorised execution, repeated execution or post-window execution is a protocol violation (§18.3). **The study is VOID**, not flagged:
- the finding is published;
- no endpoint is reported;
- nothing is repaired or replaced;
- a restart requires a new registration citing this one.

## 7. Treatment definition

**Arm T — CPG resolver.** U1 exercises `lookupGroundedCompanyFacts` (`companyFactsLookup.ts:107-122`) at the resolver SHA, in the non-production evidence environment. The HTTP route's authentication, tenant authorisation and persisted-profile read are **out of U1 scope**; they were established separately (CPG-025).

| Input | Value |
|---|---|
| `companyId` | Non-production fixture id |
| `companyName`, `websiteUrl`, `linkedinUrl` | From the sealed manifest (`linkedinUrl` null) |
| `asOf` | One frozen ISO timestamp for the whole held-out run |
| `fetcher` | `createSafeEvidenceFetcher({ budgetMs: 45_000 })`, wrapped by a **recording** fetcher (§13) |
| `wikidataLookup` | The production adapter `lookupCompanyFirmographicsFromWikidata`, wrapped by a **recording** lookup (§13) |
| Sources | `[createWikidataSource(...)]`; identity pre-step on — exactly as production |

**Both wrappers are harness code. No CPG code changes.** [STRUCTURAL: every first-party, identity and registry request passes through the injected fetcher — `firstPartySource.ts:135`, `identityEstablishment.ts:119`, `registryRecordSource.ts:55`, and all four accessible registry providers. Wikidata alone uses its own adapter (`wikidataSource.ts:27,56`), which is injectable.]

The full response is captured per company (§13.2).

### 7.1 Evaluated software identity [NORMATIVE; APPROVED CPG-047]

**The evaluated resolver is the repository content at commit `f01a7eb4199be4e04d4fee7fc0116303949dc553`**, and nothing else. That commit is the **U1 evaluation tree**. It is identified by three values, all published (§13.2) and all recomputable by an outsider:

- the commit id `f01a7eb4199be4e04d4fee7fc0116303949dc553`;
- its git tree object id `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`;
- its **content manifest aggregate** (domain `cpg-u1-evaluation-tree/v1`): `sha256` over `"<sha256>  <path>\n"` lines for every path of `git ls-files` at that commit, sorted by path — `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` (11552 files). If the commit ever becomes unreachable, this value, not the commit id, is what the study was run against.

**Scope of the pin.** Every rule that reads "at the resolver SHA" — the treatment (§7), the contamination scan scope and C1(1) (§5.3–§5.4), A5 accessibility (§5.1) and the provider configuration hash (§13.1) — is evaluated on the U1 evaluation tree.

**Changes after that commit are excluded, by construction.** No later commit on any branch is part of the evaluated software, whether or not it is believed to be behaviour-preserving. In particular the post-`f01a7eb4` change to `lib/security/safeFetch.ts` (redaction of SSRF error text and metric labels) is **not** evaluated; the recorded analysis that it cannot affect any endpoint (the §7 fetcher discards every error) is a reason the study is not weakened by excluding it, never a licence to substitute it.

**What the tree is not.** The evaluation tree fixes the *resolver*. It does not fix the instrument: the tooling and harness that run the study are pinned separately by the tooling aggregate (§19.1), and a change to them never changes the evaluated resolver identity. Where the tooling is stored in the same repository, its files are excluded from the resolver identity by definition — the resolver identity is the tree at `f01a7eb4`, which predates them.

**Re-pinning.** The evaluation tree is chosen **before** frame construction and is frozen at registration. It is never advanced to track mainline, and never changed after any held-out result is seen; doing so is a protocol violation (§18.3) and voids the study. A study of a later resolver is a new protocol version and a new registration.

**Claims.** Results are claims about the resolver at the U1 evaluation tree, not about current production. The mainline commit current at registration is recorded alongside, for the reader's information only (§16.1).

**Enforcement.** `verify-evaluation-tree` recomputes the commit, tree object and content manifest aggregate of a supplied clone and compares them with the three values above: differing content is refused, a differing commit id over identical content is reported and accepted (the content is what was evaluated), and a clone whose tracked files include the instrument (`research/cpg-u1`) is refused as a conflation of treatment with instrument.

## 8. Design decision: single-arm

**Decided: B — single-arm precision/abstention evaluation against independent reference truth.**

| Candidate | Why not the U1 design |
|---|---|
| A. Evidence-free CPG | **Degenerate.** It cannot reach `PUBLICLY_VERIFIED`, so it returns three nulls by construction. Retained only as the §8.5 instrument check |
| B. Direct foundation model | Changes retrieval, verification, abstention discipline **and** model priors at once. **This is U9** (§16.3) |
| C. Marginal evidence | The cleanest causal contrast, but uninterpretable before absolute reliability is known. Deferred to a future protocol |
| **D. Single-arm vs reference truth** | **Adopted.** It measures exactly the product claim |

### 8.5 Instrument check (non-comparative)

Before the held-out draw, CPG runs over the development set with `sources: []` and `establishIdentity: false` [STRUCTURAL: `orchestrator.ts:46-68`]. **Pass condition: zero fills.** **Any fill halts the programme**, because the verified-only gate would be falsified.

---

## 9. Reference truth

### 9.1 Roles

| Role | Who | Must not |
|---|---|---|
| **Author** | Independent person; constructs a blind record for every drawn company × field | Have implemented CPG, the protocol or the tooling; see any CPG output (including the development pilot); communicate with the Confirmer before both have submitted |
| **Confirmer** | Different independent person; constructs a **separate blind** record for every company × field | Same as Author; see the Author's record before submitting |
| **Reference adjudicator** | Third independent person (§4A) | Hold any other §4A.3 role (including enumerator); introduce a new value |

### 9.2 What each receives

The Author and Confirmer each receive only: company name, canonical domain, jurisdiction family, decisive identifier, the three field definitions, the value-format rules (§9.3), and the authority table (§9.4). **They never receive CPG output, each other's records, or the class prediction.** The reference adjudicator receives only the materials in §9.2.1.

#### 9.2.1 Reference-adjudicator packet [NORMATIVE; APPROVED CPG-043]

**Contents, for each disagreeing company × field only:**
- company name, canonical domain, jurisdiction family and decisive identifier;
- the field definition, §9.3 formats and §9.4 authority table;
- the two blind records presented **unlabelled** as "Record 1" and "Record 2", each carrying only its value, source and search content (no recorder identity or timestamps).

**Record 1 / Record 2 assignment.** Record 1 is the Author's record iff the first hexadecimal digit of `order_key("reference-adjudicator-record-1", candidate_id, field)` is even. Items are presented in `order_key("reference-adjudicator", …)` order (§12.1).

**Decisions** are `RECORD_1`, `RECORD_2` or `REFERENCE-CONFLICT`. They are mapped mechanically to AUTHOR / CONFIRMER after the decision (`resolve-reference-adjudication`).

**The reference adjudicator never receives:**
- any CPG output (including pilot and instrument check);
- class predictions, identity-hazard notes, stratum or split;
- screening logs, attestations or contamination bases;
- agreeing records;
- the identities or pseudonyms of Author and Confirmer;
- any count or tally of adjudication outcomes.

**Timing:** adjudication occurs after both blind record sets are submitted and before `seal`.

**Enforcement.** The packet is built deterministically (`reference-adjudication-packet`) and verified by rebuilding (`verify-adjudication-packet`); any added information, extra or agreeing item, reordering or reassignment is refused. What the adjudicator learns outside the packet is controlled procedurally (§4A).

### 9.3 Record format [enforced]

Each blind record holds: `value_kind` (`STATED` | `NOT_AVAILABLE_FROM_SOURCE`), `expected_value`, `authoritative_source_name`, `source_class`, `source_url`, `publication_date` (or `NOT_STATED`), `as_of_date`, `search_note`, `constructed_without_cpg` (must be `yes`), `recorded_by`, `recorded_at`.

**STATED value formats** [NORMATIVE; enforced]:

| Field | Format | Example |
|---|---|---|
| `founded_year` | four-digit year | `1999` |
| `employee_count` | positive integer | `3682` |
| `revenue_range` | ISO 4217 code, space, positive integer in whole units | `USD 1300000000` |

Targets, projections, run-rates, order books and estimates are **never** an expected value [enforced]. Where only such a figure exists, the record is `NOT_AVAILABLE_FROM_SOURCE`, with the figure described in `search_note`.

### 9.4 Authority by field [NORMATIVE; enforced]

| Field | Tier 1 | Tier 2 | Not authoritative |
|---|---|---|---|
| `founded_year` | `REGISTRY_RECORD` | `ENTITY_OWN_PAGE` | everything else |
| `employee_count` | `REGULATORY_FILING` | `ENTITY_OWN_PAGE` **with a stated publication date** | everything else |
| `revenue_range` | `AUDITED_FINANCIAL_FILING`, `REGULATORY_FILING` | `ENTITY_OWN_FINANCIAL_STATEMENT` | everything else |

### 9.5 Reconciliation [enforced]

| Author vs Confirmer | Result |
|---|---|
| Same `value_kind` and same value (whitespace-collapsed, case-insensitive) | `AGREED` — **an adjudication may not override it** |
| Different | **Must** be adjudicated: `AUTHOR` → `ADJUDICATED_AUTHOR`; `CONFIRMER` → `ADJUDICATED_CONFIRMER`; `REFERENCE-CONFLICT` → `REFERENCE_CONFLICT` (excluded from every denominator, published) |

The adjudicator chooses between the two records or declares a conflict, and **cannot supply a third value**. The author and confirmer must be different people, and the adjudicator must differ from both. The reconciled reference file is produced **only** by `reconcile`: `seal` refuses any reference file that is not byte-identical to the reconciliation of the blind records.

### 9.6 Sealing and operator separation

- `seal` binds the development and held-out manifests and screening logs, the sizing file, the three blind-record files, and the reconciled reference file into one `seal_hash`.
- **The seal hash is published (timestamped) before held-out execution.**
- **The operator receives the seal hash only.** The reference file stays with the reference team until execution and archiving are complete.
- Any post-execution change to reference truth yields a different seal hash, which does not match the published one, so the results are invalid on their face.
- **The operator therefore cannot choose reference values after seeing CPG output:** the values are sealed first and never visible to the operator.

### 9.7 Class predictions vs reference truth

If reference truth contradicts a company's class prediction (a `fill-expected` company with no unambiguous STATED value, or an `abstention-expected` company with one), the mismatch is **recorded in the seal and published**. It is not an error and it is never corrected by editing. Labels come from reference truth alone.

### 9.8 Independence class

Every sealed row is `independence_class = PENDING_RUN`. After execution, each observation is classified `INDEPENDENT` or `SOURCE-COINCIDENT` (reference and CPG cite the same document). **If SOURCE-COINCIDENT exceeds 60% of scored observations, the run is INCONCLUSIVE** for insufficient reference independence [NORMATIVE].

---

## 10. Endpoints — final

### 10.1 Labels

Applied by raters with this **decision procedure**, in order:

```
CPG returned a value?
├─ no  → reference holds an authoritative value?  yes → MISSED-FILL          no → CORRECT-ABSTENTION
└─ yes → value attributable to the EXPECTED entity? no → MISATTRIBUTED-FILL
         └─ yes → reference holds an authoritative value? no → UNSUPPORTED-FILL
                  └─ yes → value agrees (§10.2)?          yes → SUPPORTED-FILL   no → INCORRECT-FILL
Reference insufficient to decide → REFERENCE-AMBIGUOUS (excluded; published)
```

`INVALID` is machine-assigned for observations that could not be scored (§15).

### 10.2 Agreement rules [NORMATIVE; published to raters]

| Field | Agrees when | Else |
|---|---|---|
| `founded_year` | same four-digit year | INCORRECT-FILL |
| `employee_count` | \|CPG − reference\| ≤ 10% of reference | INCORRECT-FILL |
| `revenue_range` | CPG states a currency (`$` = USD) equal to the reference currency, **and** the parsed amount (K=10³, M=10⁶, B=10⁹) is within 10% of reference | a value with **no currency marker** → UNSUPPORTED-FILL (sub-reason `CURRENCY_NOT_STATED`); a stated but different currency or amount → INCORRECT-FILL |

**Temporal rule** for `employee_count` and `revenue_range`: reference truth is the most recent authoritative value with `as_of_date` no more than **24 months** before the run `asOf` [NORMATIVE]. If none exists that recent, the observation is `REFERENCE-STALE` (excluded; published). A CPG value that matches only an *older* authoritative value is INCORRECT-FILL, sub-reason `STALE_VALUE`.

*Rationale for the currency rule* [STRUCTURAL]: the adapter emits a `$` only for USD and otherwise drops the currency (`wikidataAdapter.ts:172`). A revenue figure without its currency is not an established fact as displayed to the user. *Rationale for 10%:* the adapter compacts revenue to one decimal of M/B, which alone introduces up to about 5% rounding, and headcounts are reported at differing dates and definitions.

### 10.3 Endpoints

| ID | Endpoint | Definition | Threshold |
|---|---|---|---|
| **G1** | **Assessability gate** | all fills = SUPPORTED + UNSUPPORTED + INCORRECT + MISATTRIBUTED | **≥ 20** [DERIVED from θ_EFR]; below → INCONCLUSIVE |
| **P1** | **Erroneous Fill Rate (EFR)** | (UNSUPPORTED + INCORRECT + MISATTRIBUTED) ÷ all fills, pooled across held-out | **≤ 0.05** [NORMATIVE] |
| **P2** | **Abstention Recall (AR)** — corrected | CORRECT-ABSTENTION ÷ (CORRECT-ABSTENTION + UNSUPPORTED-FILL): *of the fields where no authoritative value exists, how often CPG withheld* | **≥ 0.90** [NORMATIVE] |
| **P3** | **Identity Integrity (II)** | count(MISATTRIBUTED-FILL) | **= 0** [NORMATIVE]; any > 0 fails the run outright |
| **R1** | **Fill Recall (FR)** — mandatory, no threshold | SUPPORTED ÷ (SUPPORTED + MISSED + INCORRECT) | reported with every EFR |

**Why FR has no threshold.** U1 is a truthfulness question. How much coverage is "enough" is a product-utility judgement that the evidence cannot calibrate. **G1 closes the misleading-success loophole without that judgement:** SUCCESS requires at least 20 fills with at most one erroneous. FR is always reported beside EFR, and **no coverage claim may be made from a SUCCESS.**

**Explicit handling**

- **All-abstention:** zero fills fails G1 → INCONCLUSIVE, never success. Near-all-abstention with fewer than 20 fills → INCONCLUSIVE.
- **Zero-fill companies:** contribute nothing to P1, are fully scored for P2 and FR, and are counted and published.
- **Identity errors:** a distinct label (MISATTRIBUTED-FILL), counted in P1 **and** separately in P3.
- **Unavailable sources:** per observation, `unavailableSources` / `registryUnavailable` are machine-recorded from the response. Abstentions are reported split into *source unavailable* vs *other*. They are **never excluded**.
- **Reference ambiguity:** REFERENCE-CONFLICT (sealed), REFERENCE-AMBIGUOUS (rater) and REFERENCE-STALE are excluded from every denominator, counted and published. Raters never convert them into a scored label.
- **No weighted or composite score.** Unsupported, incorrect and misattributed fills are reported separately beside EFR, so a reader may weigh them differently.

### 10.4 Secondary (never an acceptance basis)

| ID | Metric | Class |
|---|---|---|
| S1 | Company-level identity correctness — resolved registry identity or Wikidata entity equals the pre-registered identifier | diagnostic (P3 carries the acceptance role) |
| S2 | Abstention precision — CORRECT-ABSTENTION ÷ all abstentions (always reported with P2) | diagnostic |
| S3 | Per-field and per-label breakdown, incl. `CURRENCY_NOT_STATED` and `STALE_VALUE` | diagnostic |
| S4 | Provenance completeness — fills with ≥1 resolvable `sourceUrl` in the response | diagnostic |
| S5 | Evidence-support depth — independent evidence items per fill | diagnostic |
| S6 | Conflict detection — `evidenceState` conflicts and `registryAmbiguity` counts. **Structurally limited:** user-vs-public conflict is unreachable while `userClaims: []` (`companyFactsLookup.ts:117`) | diagnostic |
| S7 | Field coverage — fills per company | diagnostic |
| S8 | Latency | diagnostic — detects budget exhaustion (45 s / 60 s) as a validity threat only |

### 10.5 Outcome vocabulary — exactly one

| Outcome | Condition |
|---|---|
| **INCONCLUSIVE** | Any §15.5 condition, or G1 fails. Checked first |
| **FALSIFIED** | II > 0, **or** EFR > 2 × θ_EFR. Recorded and reported as evidence **against** the verified-only claim |
| **FAILURE** | Conclusive, not falsified, and any of P1, P2 or P3 missed — **explicitly including a near miss** |
| **SUCCESS** | G1 holds and P1, P2 and P3 are all met |

---

## 11. Development pilot (not an endpoint)

The pilot runs CPG over the 6 development fill-expected companies to compute the pilot yield `y` for §5.6. Its outputs are held by the operator, **never** shown to the reference team, and never used for any purpose except sizing and harness debugging.

## 12. Human adjudication (rating)

| Field | Specification |
|---|---|
| **Raters** | **≥ 2 independent** [NORMATIVE] |
| **Eligibility** | Must not have implemented CPG, the protocol or the tooling; must hold no other §4A.3 role; must satisfy §4A.1 |
| **Rater packet** | Field; CPG's value or null; the source URLs CPG cited for that value (**§12.3**); the sealed reference record |
| **Blinding** (single-arm) | Raters are blind to each other's labels, to running tallies and aggregates, and to the development pilot. There is no arm label to blind |
| **Randomisation** | Presentation order is **derived, not seeded** (§12.1) [NORMATIVE; APPROVED CPG-043] |
| **Scale** | Categorical: SUPPORTED-FILL, UNSUPPORTED-FILL, INCORRECT-FILL, MISATTRIBUTED-FILL, CORRECT-ABSTENTION, MISSED-FILL, REFERENCE-AMBIGUOUS — applied by the §10.1 procedure with the §10.2 rules |
| **Minimum valid ratings** | Every scored observation needs ≥ 2 independent ratings; ≥ 90% of held-out observations must be completely rated, else INCONCLUSIVE |
| **Agreement** | Krippendorff's α, **nominal**, **≥ 0.667** [NORMATIVE — Krippendorff's own floor for tentative conclusions]; per-label agreement also published |
| **Rater disagreement** | Resolved by the **rating adjudicator** (§4A.3) using the blinded packet of §12.2; adjudicated values are flagged |
| **Missing ratings** | `pending` — never imputed, never scored |

**If independent raters are unavailable:** execution may occur, but every primary endpoint is labelled **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of independent validation may be made.** The protocol is not weakened to accommodate unavailability.

### 12.1 Rater presentation order [NORMATIVE; DERIVED; APPROVED CPG-043]

**No seed and no custodian exist.** Order derives from the approved Bitcoin + drand randomness through the **held-out sampling record**. The primary sampling seed is never used directly.

- **Canonical input.** `ho_record_sha256` is the held-out `sampling.record_sha256`, which is `sha256(canonicalJson(record without record_sha256))`. The record contains the commitment txid, heights, randomness block hash, drand round and randomness, and the seed fingerprint. Its value is bound in the seal (`held_out.sampling_record_sha256`) and must recompute.
  - `label` ∈ {`rater-1`, `rater-2`, `rating-adjudicator`, `reference-adjudicator`} for ordering, and {`reference-adjudicator-record-1`, `rating-adjudicator-label-a`} for blind-position assignment. Separate labels keep order and position unrelated.
  - `candidate_id` matches `[A-Za-z0-9_-]{1,64}` and `field` ∈ {`founded_year`, `employee_count`, `revenue_range`}, so the `|`-joined preimage is unambiguous.
- **Hash function.** `order_key(label, candidate_id, field) = SHA-256( UTF-8( "cpg-u1-rater-order/v1|" + ho_record_sha256 + "|" + label + "|" + candidate_id + "|" + field ) )`, 64 lowercase hex.
- **Ordering algorithm.**
  - **Items per list:** a rater's list is every held-out company × field; the rating adjudicator's list is the disagreeing held-out items; the reference adjudicator's list is the disagreeing items of both stages.
  - **Sort:** items are sorted ascending by `order_key` compared as hex strings.
  - **Tie handling:** a tie (requiring a SHA-256 collision) is broken by the string `candidate_id|field`. Duplicate items are refused.
- **Separation from sampling.**
  - **After the draw, one-way:** the derivation starts only after the held-out draw is fixed, uses a distinct domain prefix, and takes a one-way hash of the published record, so it cannot influence or be influenced by selection.
  - **Unknowable in advance:** `ho_record_sha256` cannot be known before the held-out drand round exists.
- **Reproducibility.** Any outsider recomputes every order from the seal, the held-out manifest and this rule (`rater-order`, `verify-rater-order`). An order derived from any other record, a reordered list, or a manifest the seal does not bind is refused.
- **Archive representation.** `cpg-u1-rater-order/v1` artifacts contain domain, `held_out_record_sha256`, label, and the ordered items with their `order_key`, plus `order_sha256 = sha256(canonicalJson(artifact body))`. They are archived and published with the per-rater sheets (§13.2).
- **Remaining discretion removed procedurally.** The person-to-label assignment is fixed and fingerprinted before the held-out commitment (§4A.3).

### 12.2 Rating-adjudicator packet [NORMATIVE; APPROVED CPG-043]

**Contents, for each disagreeing held-out observation only:**
- the identical §12 rater packet (field; CPG's value or null; the source URLs CPG cited (§12.3); the sealed reference record);
- the §10.1 decision procedure and §10.2 agreement rules;
- the two raters' labels shown **unlabelled** as "Label A" and "Label B".

**Label A / Label B assignment.** Label A is rater 1's label iff the first hexadecimal digit of `order_key("rating-adjudicator-label-a", …)` is even. Items are presented in `order_key("rating-adjudicator", …)` order.

**Decisions** are `LABEL_A`, `LABEL_B` or `REFERENCE-AMBIGUOUS`. They are mapped mechanically to the chosen label.

**The rating adjudicator never receives:**
- which rater gave which label, or rater identities;
- other observations' labels;
- tallies, aggregates or provisional endpoint values;
- class prediction, stratum, split or identity-hazard note;
- pilot outputs;
- the number of disagreements.

**Timing:** after both raters submit complete sheets.

**What cannot be hidden:** U1 is single-arm, so the company and the CPG output for the item are necessarily visible, and no arm identity exists.

**Enforcement.** The packet is built deterministically and verified by rebuilding (`verify-adjudication-packet --type rating`).


### 12.3 Cited source URLs [NORMATIVE; APPROVED CPG-045]

**Rule A — field-level evidence URL union.** For a reported field value, "the source URLs CPG cited for that value" means the **ordered, deduplicated set of URLs carried by that field's final evidence records in the CPG response**.

- **What counts as a cited URL.** Exactly the URL a final evidence record of that field states as its own evidence source: `grounding.facts[<field>].evidence[i].sourceUrl` in the response. Nothing else in the response or the archive qualifies — not the Wikidata entity URL, not registry identities, not provider or navigation metadata, not replayed request URLs, and no URL appearing inside a fetched document.
- **All qualifying URLs are included.** Every final evidence record of the field contributes its URL, including records whose own value differs from the reported value. No URL is selected, removed, reordered or filtered on the basis of value agreement, source authority, identity class, provider, rater result, or any expected or observed study outcome. **Post-hoc favourable selection is prohibited** and would be a protocol violation (§18.3).
- **Ordering is deterministic.** Response order of the field's evidence records, first occurrence first. The set does not depend on the rater, the label, the presentation order (§12.1) or the time of extraction.
- **Exact duplicates are removed.** Byte-identical URL strings appear once, at their first occurrence. URLs that differ in any byte are distinct and both appear; no normalisation, rewriting or canonicalisation is performed.
- **Absent and malformed URLs.** A final evidence record whose `sourceUrl` is null contributes no URL; none is invented or substituted. A `sourceUrl` that is present but is not an https URL is **refused** under the existing URL contract, and no packet is produced from that archive until the response is understood — it is never silently dropped or repaired.
- **An observation with no response** (INVALID, §15.2) has no cited URLs. A field whose evidence list is empty has an empty set; the item is still presented, with CPG's value or null.
- **No change to CPG.** The rule reads the response CPG already emits. No claim identifiers are added to the production response, and CPG's resolution behaviour is untouched.

**Enforcement.** `evaluation-items` derives the set mechanically from the archived response; `rater-packet` records the rule id (`cpg-u1-cited-urls/field-evidence-union/v1`) in the packet, and `verify-rater-packet` rebuilds the packet and requires byte identity, so a hand-edited URL set is refused.

## 13. Source truth, archive and replication

### 13.1 Archive (mandatory)

| Component | Content |
|---|---|
| **Raw documents** | For every request through the recording fetcher: URL, final URL, HTTP status, response headers (incl. `Date`, `Last-Modified`), body bytes, and retrieval timestamp. Per-document SHA-256 plus a Merkle root |
| **Wikidata adapter snapshots** | For every call through the recording lookup: input label, returned object (`founded_year`, `team_size`, `revenue_range`, `matched_label`, `qid`, `official_websites`), timestamp. **These are evidence snapshots, not raw HTTP** — the adapter is not routed through the injectable fetcher |
| **Adapter cache state** | The Wikidata adapter keeps its own cache. The harness must run it cold, or record every cache hit as such |
| **CPG responses** | The complete `lookupGroundedCompanyFacts` response per company |
| **Run metadata** | Run id, `asOf`, resolver SHA, provider configuration hash (`registry/builtins.ts` + `coverageInventory.ts`), wall-clock start and end, the published seal hash |

### 13.2 Hashed and published

Dataset seal (binding both manifests, both screening logs, sizing, the three blind-record files and the reconciled reference file) · archive Merkle root · CPG response set · protocol document · resolver SHA · provider configuration hash · development-only registry · rater instructions · rater order artifacts (§12.1) and the person-to-label assignment fingerprint (§4A.3) · per-rater sheets · adjudication artifacts · exclusion table · results artifact. The registration record, both commitment payloads and both sampling records (from which both seeds are recomputable) are published.

### 13.2A Sampling archive (mandatory)

Registration record and the identity's registration listing; protocol and tooling files; the single frame F; the scan; development-only registry; pilot result; sizing; both payloads; both funding and commitment raw transactions with Merkle proofs; header ranges from a retarget boundary ≤ checkpoint to `H_rand_ho + 6` from two sources; drand chain info and rounds `R_dev`, `R_ho`; manifests; screening logs; both sampling records; the execution authorisation, execution log, audit output, no-preview declaration and stored-lookup exports (§6.5); reference and rating adjudication packets (§9.2.1, §12.2).

### 13.3 What can be replicated

| Claim | Replicable offline? |
|---|---|
| Labels and all endpoints from archived CPG responses + sealed reference truth | **Yes** — independent offline re-scoring |
| CPG's output given the recorded evidence (resolver determinism) | **Yes**, via a replay fetcher and replay Wikidata lookup — **requires the replay harness to exist before execution** |
| That registry and first-party sources returned the archived bytes | **Yes** — raw bytes and headers archived |
| **That Wikidata returned the recorded values** | **No** — only the adapter's output is archived, not its HTTP exchange. Wikidata-derived claims are replayable but not independently re-derivable from raw bytes without an adapter change, which is out of scope |
| **That the sample was not chosen by anyone** (given the committed frames) | **Yes** — `verify-sampling` recomputes commitments, finality, rounds, seeds and draws from the §13.2A archive |
| A later **live** re-execution matching byte-for-byte | **No** — live sources drift. A live re-run must not be described as a failed replication |

## 14. Replication levels

R1 repeated execution from archive · R2 new companies · R3 new jurisdictions · R4 reference truth from source families disjoint from CPG's · R5 independent re-rating. **None has occurred.**

## 15. Validity and exclusion

### 15.1 Observation dispositions

`VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS` and `REFERENCE-STALE`; and the flag `CONTAMINATION-DISCLOSED` (observation remains VALID in the primary analysis; §5.3). `INCONCLUSIVE` is **run-level only**.

### 15.2 Rules

| Condition | Disposition |
|---|---|
| Scored into a §10.1 label from sealed reference truth | VALID |
| Reference truth REFERENCE-CONFLICT (sealed) | REFERENCE-CONFLICT — excluded, published |
| Rater declares REFERENCE-AMBIGUOUS, or the §10.2 temporal rule fails | excluded, published |
| Identity-level inadmissibility discovered after the draw (§5.9) | INVALID — all of that company's observations |
| No response / harness error | INVALID |
| Source unavailable during the run | **VALID, retained** — a real outcome |
| Transient HTTP failure | Bounded retries are the fetcher's own behaviour; a failure surviving retries is an unavailable source. **No scoring-time retry** |
| Abstention | **Never excluded** |
| Zero-fill company | VALID |
| Malformed fixture | Refused at `frame`, **before** any draw |

**No observation may be excluded because its result is unfavourable.** The exclusion table and both screening logs are published. Exclusion rules may not change after any held-out result is seen.

### 15.3 Pre-execution screening log

One row per frame candidate per stage: `candidate_id`, `company_name`, `canonical_domain`, `jurisdiction`, `identifier_scheme`, `decisive_identifier`, `a1`–`a6` (pass / fail / unknown), `held_out_eligible`, `held_out_ineligible_basis`, `admitted`, `exclusion_reason` (closed list incl. `NOT_DRAWN`, `DEVELOPMENT_SURPLUS`), `stratum`, `split`, `stage`, `screened_by`, `screened_at`, `frame_hash`. Written by the tool, write-once, sealed.

### 15.5 Run-level INCONCLUSIVE conditions

1. G1: all fills < 20 [DERIVED]
2. Fewer than 90% of held-out company × field observations VALID [NORMATIVE]
3. Nominal α < 0.667, fewer than 2 independent raters, or < 90% of observations completely rated [NORMATIVE]
4. More than 10% of held-out companies had their decisive registry path unavailable during the run [NORMATIVE]
5. SOURCE-COINCIDENT > 60% of scored observations [NORMATIVE]
6. The published seal hash does not match the seal used, or execution began before the seal was published
7. A protocol violation discovered mid-run (this also **halts** — §18)
8. Any §5.10 VOID or ABANDONED state — the run is **not INCONCLUSIVE but VOID**, and no endpoint may be reported

---

## 16. U4 / U8 / U9 boundaries — frozen statements

### 16.1 U4 — generalisation

- U4 **must** use independent held-out companies of its own.
- U4 **must not** reuse any U1 company, development or held-out: every U1 company becomes held-out-ineligible for U4 under C1(4) once executed.
- U4 **requires its own** sampling and generalisation protocol, registration, commitments and pool; it may reuse U1's admissibility criteria, contamination rules, reference-truth procedure, labels and archive format.

### 16.2 U8 — deterministic quality scoring

- **No validated deterministic quality score may be claimed merely because CPG exposes evidence metadata** (`status`, `evidenceState`, `authority`, `providerFamily`, `identity`, registry verification).
- The **minimum future evidence** to validate such a score:
  1. the score's formula registered **before** it sees any label;
  2. human four-state labels from U1 (or equivalent) paired with the full evidence record, used for **calibration only**;
  3. a **separate held-out** labelled set, never used for calibration, on which the score's agreement with human labels is measured against a pre-registered criterion;
  4. per-source freshness from archived headers (§13.1).
- U1 contributes item 2 only.

### 16.3 U9 — deterministic stack vs direct model

- A **separate experiment** with its **own hypotheses and endpoints**.
- A **separate model arm** under its own registered prompt, model identifier, parameters and abstention instruction.
- A **dedicated non-production model credential**, with `CERT_AI_MOCK` disabled for that arm only. Production credentials never enter it.
- It **may share** U1's dataset, sealed reference truth, raw-document archive and label definitions **where methodologically appropriate**, and must justify that sharing in its own protocol.
- **U9 is never described as, or merged into, U1**, and U1's single-arm design never becomes a "control" for it.

## 17. Omnivyra — permanent status

Omnivyra is:

- a **real-company integration / development / smoke case**;
- **contaminated for U1** (C1(1): 195 repository hits at the resolver SHA; C1(2); C1(5); registry DEV-001);
- **not eligible for held-out U1 evidence**, whatever any scanner or attestation says;
- **not an independent reference-truth case** — its first-party site and any reference values would be authored by the implementers;
- **not a source of any U1 efficacy statistic**.

**The inability to execute its production lookup (CPG-035, blocked by authentication) is not a U1 failure.** Its tenant id (`4bdbec26-4f7e-4e77-a965-d499e1472f5c`) is repository-corroborated, not DB-verified.

## 18. Stopping and halt rules

- **No sequential stopping.** Held-out executes once, in full. There is no interim look and no optional extension.
- **Halt conditions:**
  1. the instrument check (§8.5) produces any fill;
  2. the pilot yield is 0 (§5.6);
  3. a protocol violation is found mid-run — for example a company admitted after execution began, a seal mismatch, or the operator having seen reference truth. The run is **void, not repaired**;
  4. any production system is touched;
  5. any §5.10 VOID state, a protocol or tooling hash ≠ registered, or a seed recomputed ≠ recorded;
  6. a detected §6.5 violation (preview, unauthorised, repeated or post-window execution).

---

## 19. Freeze (registration) requirements

### 19.1 Must be in the registration

| Item | State |
|---|---|
| Protocol version + protocol SHA-256 | this file |
| Tooling aggregate SHA-256; development-only registry SHA-256 | computed by `registration-fields` |
| Design, unit, labels, decision procedure, agreement rules, endpoints, thresholds, outcome vocabulary | **closed** (§4, §8, §10) |
| Admissibility, classes, C1(1)–C1(6), scan scope | **closed** (§5.1–§5.4 of candidate-002, unchanged) |
| Two-stage procedure, rank key, round-robin order, pool multiplier, no-replacement, sizing incl. CAP 60 | **closed** (H1 approved) |
| Registration, commitment, randomness, seed, VOID rules; D = 6, K = 12, 180 days, Δ = 3 h, 30 days, drand chain | **closed** (U1, U2, U3 approved; §5.5–§5.10) |
| Frame sufficiency rule, single frozen frame, registry freeze, execution window and no-preview rule, personnel independence and blinding, rater-order derivation | **closed** (CPG-043 approvals; §4A, §5.3, §5.5, §5.7.2, §6.5, §9.2.1, §12.1, §12.2) |
| Reference roles, rater protocol, archive, validity, halt rules, U4/U8/U9, Omnivyra | **closed** |
| Accountable identity; persistent identifier (type, value) | **UNASSIGNED — required at registration** |
| Bitcoin wallet-key custodian (role `STUDY_OPERATOR`) | **UNASSIGNED — required before funding** |
| Outpoints `O_dev`, `O_ho`; checkpoint (height, hash) | UNASSIGNED — created by the custodian before registration |
| `registration_id`, `registration_timestamp` | issued by OSF at registration |
| Provider configuration hash; `asOf` | computed / chosen before registration |

### 19.2 Decisions and attestations

| ID | Item | Status |
|---|---|---|
| **H1** | CAP 60 fill-expected held-out companies | **Approved** (verbatim in CPG-037 record) |
| **H2** | Development-only registry complete to the best of knowledge | **Confirmed** (verbatim in CPG-037 record) |
| **H3** | Seed custodian | **Superseded** by U1/U2/U3 (§0.1) |
| **U1** | OSF, public, no embargo, accountable identity + persistent identifier | **Approved**; identity not named |
| **U2** | Two single-use outputs, D = 6, K = 12, 180-day abandonment, VOID rules | **Approved**; custodian not named |
| **U3** | Model B, Δ = 3 h, 30-day expiry, pinned verifiable BLS | **Approved** |
| **CPG-042 A-1…A-6, B-1, B-2, X-1** | Personnel independence and blinding, single frozen frame, registry freeze, execution window / no-preview | **Approved for CPG-043**; implemented in protocol-004 and tooling v4 |

### 19.3 Named prerequisites (not decisions; must exist before the stated act)

1. **Accountable OSF identity + persistent identifier** — before registration.
2. **Bitcoin wallet-key custodian** (the study operator) — before funding.
3. **Independent candidate / reference / rater personnel** satisfying §4A: enumerator(s), reference Author, Confirmer and adjudicator, ≥ 2 raters and a rating adjudicator — before the respective stage (or a recorded absence of raters with the §12 ceiling). Seven mutually exclusive independent persons.

Also required before held-out execution: recording fetcher, recording Wikidata lookup, replay harness (§13); certenv with a fixture tenant; two independent Bitcoin header sources (or an own node) and ≥ 2 drand relays for verification.

## 20. Known limitations

1. Small, clustered, exploratory; no population, customer or jurisdiction generalisation.
2. Three fields only; six fields with declared authority are not requested by CPG.
3. Four accessible jurisdiction families; identity resolution is under-tested elsewhere.
4. Wikidata evidence is archived as adapter snapshots, not raw bytes (§13.3).
5. Live-source drift: live re-runs are not byte-replicable.
6. Reference independence is bounded; SOURCE-COINCIDENT is published and capped.
7. User-vs-public conflict is structurally unmeasurable while `userClaims: []`.
8. Rater availability unproven; without raters, Rung 2 at most.
9. U1 exercises the resolver function, not the production deployment or its route.
10. A single-arm design cannot attribute reliability to grounding per se.
11. The development pilot's yield is optimistically biased (contaminated, well-known firms); SAFETY mitigates but does not remove the INCONCLUSIVE risk.
12. The development-only registry's completeness rests on an attestation (H2), not on a mechanical proof.
13. **Study-level grinding under other identities** (pseudonymous parallel registrations) can be neither prevented nor detected; only registrations under the accountable identity count.
14. **Registry trust is institutional**: immutability, timestamps, public listing and tombstones rest on OSF, not cryptography.
15. **drand threshold honesty** is assumed (collusion of a threshold of League-of-Entropy operators could bias R), and **correctness of the vendored BLS library** (@noble/curves 1.9.7 contains changes after its 2024 audit of 1.6.0).
16. **Bitcoin finality is probabilistic**; a reorganisation deeper than 6 blocks before finality is re-evaluated, after finality it voids the study.
17. **Tooling cannot prove non-spend**, most-work status, source independence or drand unavailability from a bundle; outsiders confirm with a full node and ≥ 2 relays (§21).
18. Cryptographic sampling integrity (the sample was not chosen) is **not** independent candidate selection (the frame is unbiased); the latter rests on enumerator independence only.
19. The registration timestamp is off-chain. The tooling proves only that registration preceded the development drand round; that it preceded the commitment broadcast rests on the payload's `registration_id` and outsider comparison (§21 step 7).
20. **No-preview protection is procedural and audit-based.** The protocol cannot prove that no unlogged private CPG query occurred in any environment. The execution-log audit examines only the supplied log, whose timestamps come from the operator's systems (§6.5).
21. **Execution start time** is chosen by the operator after the window opens. No held-out outcome is observable without a (prohibited) preview, but public information about source availability is.
22. **Frame enumeration is larger** (≥ 210 eligible admissible rows before the development commitment). A frame sufficient for the maximum quota is enumerated even when the pilot later yields a small held-out quota.
23. **Personnel independence rests on declarations and organisational confirmation** (§4A.1), not on verifiable proof. The tooling checks the register's structure only.

---

## 21. Sampling-integrity verification procedure (outsider)

1. Resolve the registration's persistent identifier on OSF; confirm public, unembargoed, registry timestamp; list the accountable identity's registrations for `CPG-U1-2026-01` and export them as the identity-registration list.
2. `verify-protocol` and `verify-registration` (protocol, tooling aggregate and registry hashes; authority; completeness) — with `--evidence` to check funding against the checkpoint.
3. Fetch headers from two independent sources from a retarget boundary ≤ checkpoint to the tip; `verify-archive`.
4. Confirm with a full node that the commitment transactions are the spends of `O_dev` / `O_ho` (or that the outpoints are unspent).
5. Fetch drand rounds `R_dev`, `R_ho` from ≥ 2 relays.
6. `verify-sampling --stage development` then `--stage held-out` (with the published sampling records as `--prior-final`).
7. Confirm `registration_timestamp` precedes the development commitment block (the tooling enforces only "precedes `R_dev`").
8. Recompute both draws with `draw-development` / `draw-held-out` on the archived frame, scan, pilot and sizing; compare manifests and seed fingerprints.
9. Verify frame sufficiency on the committed frame and scan (`check-frame-sufficiency`); confirm both payloads carry the same frame and scan hashes and the registered registry hash.
10. After the seal: verify the published seal record, recompute the execution authorisation (`authorize-execution`), audit the execution log (`audit-execution-log`), and recompute rater orders (`verify-rater-order`) and adjudication packets (`verify-adjudication-packet`).

## 22. Attack matrix (Model B, as implemented)

Classes: **PREVENTED** · **DETECTABLE** · **PARTIALLY MITIGATED** · **UNRESOLVED**.

| # | Attack | Class | Control (implementation) |
|--:|---|---|---|
| 1 | Seed chosen after the list | PREVENTED | No seed input; randomness block follows the commitment (`H_commit + 12`) |
| 2 | List chosen after the seed | PREVENTED | `frame_hash` in the on-chain digest before `H_rand` exists |
| 3 | Multiple candidate lists in one study | PREVENTED | Outpoint spendable once (consensus); cross-slot spend VOID |
| 4 | Favourable list selected after randomness | PREVENTED | As 3; finality rule |
| 5 | Favourable randomness selected after the list | PREVENTED | Height rule; drand round unknown when `H_rand` is mined |
| 6 | Commitment deleted | PREVENTED | Proof-of-work depth ≥ 6 |
| 7 | Commitment rewritten | PREVENTED | Depth; post-finality reorg VOID |
| 8 | Identifier changed after commitment | PREVENTED | Frame hash committed; tool refuses a differing frame |
| 9 | Class changed after commitment | PREVENTED | Class is inside committed rows |
| 10 | Quota changed after commitment | PREVENTED | Development quota in protocol; held-out sizing hash in binding |
| 11 | Beacon round / randomness block changed | PREVENTED | K, D, Δ, chain pinned in tooling and registration; round computed; caller rounds ignored |
| 12 | Randomness output discarded (declare failure, restart) | DETECTABLE | Public outpoints and recomputable draws; abandonment disclosed; restart needs new registration |
| 13 | Chain / log changed after randomness | PREVENTED | Registered checkpoint; two agreeing sources; PoW |
| 14 | Candidate list reconstructed differently | PREVENTED | Canonical frame hash |
| 15 | Randomness learned early / miner withholding | PREVENTED for miners (blind); drand threshold collusion assumed | Δ = 3 h after `MTP(H_rand + 6)` |
| 16 | Study-level grinding | PARTIALLY MITIGATED | Public identity-bound registration naming outpoints; residual under other identities (§20.13) |
| 17 | `O_ho` spent early with junk to kill held-out | DETECTABLE | Stage VOID, public; no information advantage |
| 18 | Multiple registrations, same identity | DETECTABLE → VOID | `checkAuthority` |
| 19 | Multiple registrations, different identities | UNRESOLVED (identity-level) | Evidence rule: accountable identity only |
| 20 | Registry replacement | PREVENTED as evidence | Registry pinned to OSF Registries |
| 21 | Registration edited or embargoed | PREVENTED (OSF immutability) / DETECTABLE (withdrawal) | public/embargo enforced; withdrawal VOID |
| 22 | Registration backdated | PREVENTED under registry trust | Registry timestamp; payload binds `registration_id` |
| 22a | Grind-then-register (commit against an old checkpoint, see the draw, register only if favourable) | PREVENTED under registry trust | `registration_timestamp` ≥ `R_dev` scheduled time → study VOID; identity-bound listing |
| 23 | Miner-set block time manipulation | PREVENTED | Height rules; MTP-based round rule and windows |
| 24 | Seed substitution | PREVENTED | Seed recomputed; manifest record compared to chain (abort on mismatch) |
| 25 | Candidate-list replacement after commitment | PREVENTED | Frame hash abort |
| 26 | Candidate-list extension | PREVENTED | Single frozen frame: held-out frame hash = development frame hash (§5.5); sufficiency verified before commitment (§5.7.2) |
| 27 | Post-randomness change of rows, scan or registry | PREVENTED for committed artifacts; attestation truthfulness not cryptographic | Frame, scan, registry hashes committed |
| 28 | Commitment withholding | DETECTABLE | 180-day abandonment |
| 29 | Blockchain reorganisation | PREVENTED within depth; VOID after finality | `--prior-final` check |
| 30 | Development ↔ held-out cross-contamination / cross-binding | PREVENTED | Held-out after dev finality; binding to dev txid/digest/manifest/pilot/sizing |
| 31 | Operator authors a globally biased frame | UNRESOLVED by sampling integrity | Enumerator independence (§4A.2, §19.3) |
| 26a | Outcome-dependent frame composition (appending after pilot sizing) | PREVENTED | Frame complete and sufficient before any CPG outcome; held-out frame hash = development frame hash (§5.5, §5.7.2) |
| 27a | Registry growth or change after the pilot to exclude unfavourable companies (e.g. after private CPG runs) | PREVENTED | Registry frozen at registration; held-out registry hash = registered; held-out scan = development scan (§5.3, §5.5.3) |
| 32 | Private preview of held-out candidates before the authorised run | **DETECTABLE (procedural/audit only)** → VOID if detected | §6.5 window, authorisation, harness logging, declaration, exports; unlogged queries cannot be excluded (§20.20) |
| 33 | Re-running or timing held-out execution after seeing outcomes | PREVENTED for logged runs (single run, no restart) / DETECTABLE otherwise | §6.5; repeated / post-window execution VOID |
| 34 | Role conflicts (enumerator adjudicating reference truth; shared or operator-held roles) | PREVENTED structurally in the register; truthfulness PROCEDURAL | §4A; `check-personnel` |
| 35 | Reference adjudication leakage (class, split, CPG output, recorder identity, tallies) | PREVENTED in the packet; other channels PROCEDURAL | §9.2.1; deterministic packet verification |
| 36 | Rating adjudication leakage (rater identity, tallies, class, split, pilot) | PREVENTED in the packet; other channels PROCEDURAL | §12.2; deterministic packet verification |
| 37 | Rater-order substitution or seed substitution | PREVENTED | §12.1 derivation from the sealed held-out record; verification refuses substitutes |

## 23. Trust model

| Party / component | Trusted for | Can still | Remaining limitation |
|---|---|---|---|
| Enumerators | Truthful attestations; independence from CPG | Bias frame composition globally | Not cryptographic |
| Reference Author / Confirmer / adjudicator | Independent blind records | Share errors; collude | Role assignment |
| Raters + rater adjudicator | Independent labels | Label bias | Without raters: Rung ≤ 2 |
| Study operator = key custodian | Following the protocol; no preview (§6.5) | Abandon (disclosed); run parallel studies under other identities; preview through unlogged channels (VOID if detected) | Cannot choose the sample, frame, scan or registry of a registered study |
| OSF Registries | Immutability, timestamps, listing, tombstones | Institutional failure | Institutional trust |
| Bitcoin consensus | Honest-majority hash power | Deep reorganisation | Probabilistic finality |
| Miners | — | Blind withholding only | None exploitable under Model B |
| drand quicknet | Threshold honesty, availability | Threshold collusion | 30-day VOID rule |
| Vendored BLS (@noble/curves 1.9.7) | Correct verification | Library defect | Post-audit changes; KAT and negative vectors only |
| Tooling v4 | Implements this protocol | Bugs | Self-tests, mutations, clean rebuild |
| Archive | Preservation | Loss/tampering | Lost off-chain payloads or frames → claim lapses |

**Two claims, never merged:** (1) cryptographic sampling integrity — given the committed frame, no one chose the sample; (2) independent candidate selection — the frame is unbiased. Protocols 003–004 strengthen (1); protocol-004 additionally specifies the personnel rules on which (2) rests, without making (2) cryptographic.

## 24. Implementation canonicalizations [CANONICALIZATION]

| Approved wording | Canonical implementation | Reason |
|---|---|---|
| "MTP (median-time-past of the 11 preceding blocks)" | Bitcoin Core `GetMedianTimePast`: median of the block **and** its 10 predecessors | The consensus definition; unambiguous |
| "`MTP(H_rand + D)`" | MTP of the block at height `H_rand + 6`; FINAL therefore needs that block to exist | Literal reading; round computable only then |
| "confirmations" | block at height `h` with tip `t` has `t − h + 1` | Bitcoin convention (tip = 1) |
| "first drand round whose scheduled time ≥ t" | `t ≤ genesis → 1`, else `ceil((t − genesis) / 3) + 1` | Exact first-at-or-after |
| "held-out unspent 180 days after the development draw" | Window starts at the scheduled time of `R_dev` (earliest instant the development draw is computable); measured by chain MTP | Chain-verifiable; no operator clock |
| "development unspent 180 days after registration" | Window starts at the registry-issued `registration_timestamp`; measured by MTP of the tip (unspent) or of the commitment block (late spend) | Chain-verifiable |
| "30 days after R's scheduled time" | Measured by MTP of the agreed tip | No operator clock |
| "confirmed ≥ D before registration" | `funding_height + 6 − 1 ≤ checkpoint_height` | Registration time is off-chain; checkpoint is registered |
| "registration missing at the development commitment's broadcast → VOID" | Tooling: `registration_timestamp` ≥ scheduled time of `R_dev` → VOID (never voids an honest study; closes grind-then-register). Outsider: compare `registration_timestamp` with the commitment block | Broadcast time is not on-chain; `R_dev` time is protocol-determined |
| "output spent before registration → VOID" | Spend height ≤ checkpoint height → VOID; later pre-registration spends excluded via `registration_id` binding + outsider check | Only the checkpoint is chain-verifiable |
| "held-out commitment after the development draw" | Held-out commitment height > `H_rand_dev + 6` | Height-based ordering |
| "most-work chain" / "≥ 2 independent sources" | Two differently named header archives, each fully verified from a retarget boundary ≤ checkpoint, agreeing block-for-block; agreed tip = shorter | Offline-checkable proxy |
| "single-signature P2WPKH" | Output script `00 14` + 20 bytes | Script form |
| Tooling aggregate | sha256 of `"<sha256>  <path>\n"` lines over every file of the tooling tree (incl. vendored BLS and fixtures), sorted by path | CPG-037A definition |
| "large enough for the maximum possible held-out requirement" | `E_c ≥ 2·Qmax_c + Dev_c` with `Qmax` obtained by evaluating the frozen sizing rule on all 4096 permitted pilot outcomes | Derived, not typed; proof in §5.7.2 |
| "held-out candidates" (no-preview scope) | Before the held-out draw every non-development frame company is a potential held-out company; after the draw, the drawn companies | Held-out identity is random until `R_ho` exists |
| "execution window opens" | Registry-issued timestamp of the published seal record linked to the registration | Seal publication before execution was already required (§9.6); OSF is the approved registry |
| "execution window closes" | Completion of the single authorised run (no restart, no resumption) | §6.2 "executed once"; §15.2 harness error → INVALID |
| "preview detected" consequence | Study VOID | §18.3 protocol violation → void, not repaired |
| Rater order | `order_key` over the sealed held-out record with domain `cpg-u1-rater-order/v1`; separate assignment labels for Record 1/2 and Label A/B | No discretionary seed; unknowable before `R_ho`; outsider-recomputable |
| "at the resolver SHA" | The U1 evaluation tree of §7.1: commit `f01a7eb4…`, tree `3b4811fc…`, content manifest aggregate `ffe4f603…` (domain `cpg-u1-evaluation-tree/v1`); used for the treatment, the scan scope, A5 and the provider configuration hash alike | A commit id alone does not say whether the identity is the commit, the tracked tree or the executed closure, and does not survive a history rewrite; the manifest aggregate does, and is recomputable from the published archive |
| "the source URLs CPG cited for that value" | §12.3 Rule A: ordered, deduplicated `grounding.facts[<field>].evidence[].sourceUrl` of that field, all records included | The response states each evidence record's own source URL but carries no claim identifiers on the reported value; the union is the only set derivable without post-hoc selection |

---

*End of `CPG_U1_PROTOCOL_004`. **IMPLEMENTED (tooling v4). NOT REGISTERED. NOT FUNDED. NOT EXECUTED.** Accountable identity, persistent identifier and Bitcoin key custodian: **UNASSIGNED**. No results are included because none exist.*
