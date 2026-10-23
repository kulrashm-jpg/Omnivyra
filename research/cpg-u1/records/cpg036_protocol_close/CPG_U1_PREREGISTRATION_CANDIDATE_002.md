# CPG_U1_PREREGISTRATION_CANDIDATE_002

**STATUS: PREREGISTRATION CANDIDATE — NOT FROZEN · NOT EXECUTED · NOT EVIDENCE**

Supersedes `CPG_U1_PREREGISTRATION_CANDIDATE_001.md` (sha256 `7613e076d4d09256211383623932ae7f5ab127ca78f2c74c6f018b0604e820ef`, preserved byte-identically) as the working basis. It closes the decisions left open by CPG-032–CPG-035 and **governs the dataset tooling** at `tooling_v2/`. Where this document and the tooling disagree, this document wins and the tooling is defective.

| Field | Value |
|---|---|
| Candidate ID | `CPG-U1-CANDIDATE-002` |
| Resolver baseline SHA | `f01a7eb4199be4e04d4fee7fc0116303949dc553` |
| Governed tooling | `tooling_v2/cpg_u1_data.mjs` + `tooling_v2/lib/*` + `tooling_v2/rules/development_only_registry.json` |
| Relationship to `DEEPTECH-U1` (`u1-001`…`u1-004`) | **Separate uncertainty.** Those protocols govern canonical-report grounding and are not inherited. |

**Marking.** **[NORMATIVE]** = a judgement fixed before data. **[DERIVED]** = arithmetically forced by another parameter. **[STRUCTURAL]** = a property of the code at the resolver SHA, cited by file and line. No parameter is **[EMPIRICAL]**, because no CPG outcome measurement exists at any rung.

---

## 0. Corrections to candidate-001 (recorded, not silently fixed)

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

## 5. Dataset construction (normative; executed by independent people, not by this document)

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

### 5.4 Scan scope (decision D-D)

"Committed test fixture, snapshot or assertion" is **replaced** by a two-class scope, evaluated over `git ls-files` at the resolver SHA in a clean clone:

- **TEST** — any path under `test/`, `tests/`, `__tests__/`, `fixture/`, `fixtures/`, `__snapshots__/`, `__mocks__/`, `e2e/`, or named `*.test.*`, `*.spec.*`, `*.snap`.
- **CPG_IMPLEMENTATION** — `backend/services/companyProfile/`, `backend/evaluation/`, `pages/api/company-profile/`, `pages/api/company-grounding/`, `components/companyProfile*`, `components/companyFacts*`.

Name (with and without legal suffixes, whole word), domain and identifier tokens are matched case-insensitively at word boundaries. The scan is **conservative**: a false positive only moves a company to development. *Why the widening matters:* at the resolver SHA, Cloudflare and Tesco also occur in CPG grounding **source** (`discoveredSource.ts:232`, `entityResolution.ts:223`), which a test-only scope would miss.

### 5.5 Two stages, commit–reveal seeds

```
freeze: publish sha256("cpg-u1-seed-commitment|development|<seed_D>") and sha256("…|held-out|<seed_H>")
  1. enumerate frame F₁ → frame → scan → publish frame_hash(F₁)
  2. reveal seed_D → draw-development                   (exact 6/2/2)
  3. development pilot + instrument check (§8.5) → size (§5.6)
  4. optionally extend F₁ → F₂ (APPEND-ONLY) → scan → pool-check (no seed) → publish frame_hash(F₂)
  5. reveal seed_H → draw-held-out                      (sizing quotas)
  6. blind reference construction for BOTH stages → reconcile → seal (§9)
  7. held-out execution (ONCE) → archive (§13) → blinded rating (§12) → analysis
```

- **Seeds** [NORMATIVE]: two independent 256-bit seeds, generated and held by a **seed custodian** who is neither the operator nor an enumerator (§19.2, H3). Only their commitments appear in the frozen protocol. Commitments are stage-separated, so the development seed cannot authorise a held-out draw, and the held-out seed must differ from the development seed [enforced].
- **Why commit–reveal.** A seed known before the frame is complete would let an enumerator compute ranks and choose which companies to add. The seed is revealed only after the frame it draws from has been hashed and published.
- **Append-only** [enforced]: the held-out frame must contain every development-frame row byte-identically. Rows may be added, never edited or removed.

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

- **Rank key** (decision D-C) [NORMATIVE]: `sha256("<seed>|<scheme>:<identifier>")`. Keying on the identifier means renaming a row cannot re-roll it. The tie-break is the identifier string, which makes the order total.
- **Jurisdiction balance** (decision D-A) [NORMATIVE]: within each class, families are interleaved round-robin in the fixed order `US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY`, each family's queue in rank order. An exhausted family stops contributing and the others continue. **The realised jurisdiction composition is published**, and missing families are declared as a scope limitation.
- **Uniqueness** [enforced]: one row per legal entity. Duplicate identifiers or duplicate canonical domains are refused.
- **Pool minimum** [NORMATIVE]: for each stage and class, the eligible admissible pool must hold at least **2 × the quota**, so the draw is a genuine selection rather than a hand-picked set. `pool-check` verifies this **without the seed**. Below the minimum, nothing is drawn.

### 5.8 Development allocation and surplus (decision D-B)

Development is filled class by class: **held-out-ineligible companies first**, since they can serve nowhere else, then eligible companies, each group in D-A order, capped at the exact development quota. Ineligible admissible companies not drawn are `DEVELOPMENT_SURPLUS` and **never enter held-out**.

### 5.9 No replacement

A drawn company is **never replaced**. If identity-level inadmissibility is discovered after the draw (e.g. the identifier belongs to a different entity), **all of that company's observations become INVALID and are published**. They count against the valid-observation floor (§15.5). *Reason:* replacement after the draw lets the reference team reject hard-to-document companies, and documentation difficulty plausibly correlates with CPG's own difficulty. A reference value of `NOT_AVAILABLE_FROM_SOURCE` is a valid outcome, not inadmissibility.

---

## 6. Development / held-out integrity

1. The held-out set, its identifiers and its sealed reference truth are frozen **before** held-out execution.
2. **The held-out set is executed once.** No threshold, rule, label definition, rater instruction or line of CPG code may change after any held-out result is seen, except by a new protocol version as a new file.
3. Development may be executed without limit (pilot, instrument check, harness debugging).
4. A company moves from development to held-out **never** within a protocol version.

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
| **Reference adjudicator** | Third independent person | Be the Author, Confirmer or operator; introduce a new value |

### 9.2 What each receives

The Author and Confirmer each receive only: company name, canonical domain, jurisdiction family, decisive identifier, the three field definitions, the value-format rules (§9.3), and the authority table (§9.4). **They never receive CPG output, each other's records, or the class prediction.** The adjudicator receives both blind records for the disagreeing company × field only.

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
| **Eligibility** | Must not have implemented CPG, the protocol or the tooling, and must not have been the operator, a seed custodian, an enumerator, the reference Author, Confirmer or adjudicator |
| **Rater packet** | Field; CPG's value or null; the source URLs CPG cited for that value; the sealed reference record |
| **Blinding** (single-arm) | Raters are blind to each other's labels, to running tallies and aggregates, and to the development pilot. There is no arm label to blind |
| **Randomisation** | Presentation order randomised per rater with a recorded seed [NORMATIVE] |
| **Scale** | Categorical: SUPPORTED-FILL, UNSUPPORTED-FILL, INCORRECT-FILL, MISATTRIBUTED-FILL, CORRECT-ABSTENTION, MISSED-FILL, REFERENCE-AMBIGUOUS — applied by the §10.1 procedure with the §10.2 rules |
| **Minimum valid ratings** | Every scored observation needs ≥ 2 independent ratings; ≥ 90% of held-out observations must be completely rated, else INCONCLUSIVE |
| **Agreement** | Krippendorff's α, **nominal**, **≥ 0.667** [NORMATIVE — Krippendorff's own floor for tentative conclusions]; per-label agreement also published |
| **Rater disagreement** | Resolved by a **rater adjudicator** (not either rater, not any excluded role), who selects one of the raters' labels or REFERENCE-AMBIGUOUS; adjudicated values are flagged |
| **Missing ratings** | `pending` — never imputed, never scored |

**If independent raters are unavailable:** execution may occur, but every primary endpoint is labelled **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of independent validation may be made.** The protocol is not weakened to accommodate unavailability.

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

Dataset seal (binding both manifests, both screening logs, sizing, the three blind-record files and the reconciled reference file) · archive Merkle root · CPG response set · protocol document · resolver SHA · provider configuration hash · development-only registry · rater instructions · rater randomisation seed · per-rater sheets · adjudication artifacts · exclusion table · results artifact. Both draw seeds are published after their reveals.

### 13.3 What can be replicated

| Claim | Replicable offline? |
|---|---|
| Labels and all endpoints from archived CPG responses + sealed reference truth | **Yes** — independent offline re-scoring |
| CPG's output given the recorded evidence (resolver determinism) | **Yes**, via a replay fetcher and replay Wikidata lookup — **requires the replay harness to exist before execution** |
| That registry and first-party sources returned the archived bytes | **Yes** — raw bytes and headers archived |
| **That Wikidata returned the recorded values** | **No** — only the adapter's output is archived, not its HTTP exchange. Wikidata-derived claims are replayable but not independently re-derivable from raw bytes without an adapter change, which is out of scope |
| A later **live** re-execution matching byte-for-byte | **No** — live sources drift. A live re-run must not be described as a failed replication |

## 14. Replication levels

R1 repeated execution from archive · R2 new companies · R3 new jurisdictions · R4 reference truth from source families disjoint from CPG's · R5 independent re-rating. **None has occurred.**

## 15. Validity and exclusion

### 15.1 Observation dispositions

`VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS` and `REFERENCE-STALE`. `INCONCLUSIVE` is **run-level only**.

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

---

## 16. U4 / U8 / U9 boundaries — frozen statements

### 16.1 U4 — generalisation

- U4 **must** use independent held-out companies of its own.
- U4 **must not** reuse any U1 company, development or held-out: every U1 company becomes held-out-ineligible for U4 under C1(4) once executed.
- U4 **requires its own** sampling and generalisation protocol, seeds, and pool; it may reuse U1's admissibility criteria, contamination rules, reference-truth procedure, labels and archive format.

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
  4. any production system is touched.

---

## 19. Freeze requirements

### 19.1 Must be in the frozen file

| Item | State |
|---|---|
| Protocol version + content fingerprint | assigned at freeze |
| Design, unit, labels, decision procedure, agreement rules, endpoints, thresholds, outcome vocabulary | **closed** (§4, §8, §10) |
| Admissibility (tri-state), classes, C1(1)–C1(6), scan scope | **closed** (§5.1–§5.4) |
| Development-only registry | **seeded**; completeness attestation pending (**H2**) |
| Two-stage procedure, rank key, round-robin order, pool multiplier, no-replacement | **closed** (§5.5–§5.9) |
| Sizing rule | closed except CAP (**H1**) |
| Seed commitments (development, held-out) | **generated at freeze by the custodian** (**H3**) |
| Reference roles, formats, authority, reconciliation, sealing, operator separation | **closed** (§9) |
| Rater protocol and α | **closed** (§12) |
| Archive, hashing, replication table | **closed** (§13) |
| Validity, exclusion, INCONCLUSIVE, halt rules | **closed** (§15, §18) |
| U4/U8/U9 statements, Omnivyra status | **closed** (§16, §17) |
| Resolver SHA; provider configuration hash; registry hash; governed tooling hash | SHA known; hashes computed at freeze |
| `asOf` | chosen at freeze |

### 19.2 Decisions requiring human approval

| ID | Decision | Why a human must decide |
|---|---|---|
| **H1** | **CAP** on held-out fill-expected companies (proposed 60, i.e. at most 100 held-out companies, 300 reference records, each constructed twice) | A resourcing commitment for independent people, not a methodological judgement |
| **H2** | **Attest completeness** of the development-only registry: every company ever run through CPG or used in its development | Only the implementers know their full history. Without the attestation, C1(6) protects only the seeded entries |
| **H3** | **Name the seed custodian** (not the operator, not an enumerator) | A role assignment that determines whether commit–reveal protects anything |

### 19.3 Must exist before held-out execution (not part of the frozen text)

Independent enumerator(s), Author, Confirmer, reference adjudicator, ≥ 2 raters and a rater adjudicator — or a recorded absence of raters, with the §12 ceiling applied. Also required: the recording fetcher, recording Wikidata lookup, and replay harness (§13); the non-production environment (certenv) with a fixture tenant.

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

---

*End of `CPG_U1_PREREGISTRATION_CANDIDATE_002`. **NOT FROZEN. NOT EXECUTED.** No results are included because none exist.*
