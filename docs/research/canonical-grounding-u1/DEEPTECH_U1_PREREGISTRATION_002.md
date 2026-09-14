# DEEPTECH_U1_PREREGISTRATION_002

**Pre-registered evaluation protocol `u1-002` for Technical Uncertainty U1 — grounded vs. ungrounded generation, on the v2 dataset.**

> **NO U1 OUTPUT HAS BEEN GENERATED.** Zero model outputs exist for either arm. No model API was called. No human rating occurred. No efficacy result of any kind exists.

> **`DEEPTECH_U1_PREREGISTRATION_001.md` (protocol `u1-001`) is NOT modified, NOT overwritten and NOT superseded in place.** It remains permanently bound to `canonicalGrounding.goldenDataset.v1`. This is a new file for a new version, per the u1-001 immutability rule.

---

## 0. Identity

| Field | Value |
|---|---|
| Protocol ID | `DEEPTECH-U1` |
| **Protocol version** | **`u1-002`** |
| Supersedes | `u1-001` (preserved, fingerprint `b204e168`, unchanged) |
| **Protocol fingerprint** | **`3c93760a`** |
| **Dataset identity** | **`canonicalGrounding.u1Dataset.v2`** |
| **Dataset SHA-256** | **`369e2165568305a5e7ae7658c5b939d94957da369b995f837bf37e9efdfd7442`** |
| Repository SHA | `82754497e8f9b64a893319e863941ad2994fd9b7` |
| Registered | 2026-09-10 |
| Machine-readable twin | `backend/evaluation/canonicalGrounding/u1Protocol002.ts` |
| Dataset source | `backend/evaluation/canonicalGrounding/u1Dataset002.ts` |
| Validator | `backend/evaluation/canonicalGrounding/u1DatasetValidator.ts` |

---

## 1. Why the dataset changed

DT-C2's leakage assessment found two corpus defects in `goldenDataset.v1` severe enough that running U1 against it would produce an uninterpretable result:

| Defect | v1 evidence | v2 status |
|---|---|---|
| **L-1 — duplicated facts** | All rich fixtures share identical `products_services`, `unique_value`, `ideal_customer_profile`, `brand_voice`, `content_themes`, `pain_symptoms`, `competitive_advantages`, `growth_priorities` (`dataset.ts:47-64`). Only `name` and `industry` varied. The corpus was effectively *one rich company repeated nine times*. | ✅ **RESOLVED** — 22 companies, no substantive value repeated. Machine-verified: 0 errors from `auditDistinctness`. |
| **L-2 — internal contradiction** | `market_pulse.core_offerings = ['Analytics suite','Attribution engine']` (`dataset.ts:15-21`) contradicted `products_services = 'Flagship product, Add-on module'` (`:49-50`). The two arms could carry different "truths" for the same company. | ✅ **RESOLVED BY CONSTRUCTION** — `core_offerings` is now *derived* from `products_services_list` via `deriveCoreOfferings()`. They cannot diverge, because there is only one source. Machine-verified: 0 errors from `auditConsistency`. |
| **L-3 — authorship independence** | Fixtures hand-authored in-repo by the same party as the system under test. | ❌ **NOT RESOLVED.** See §5. |

v1 was **not repaired**. It is preserved intact, including its L-1 defect — a test asserts that v1's rich entries still share a single `unique_value`, so the historical record of what `u1-001` was run against stays honest.

---

## 2. Dataset

| Field | Value |
|---|---|
| Identity | `canonicalGrounding.u1Dataset.v2` |
| Version | `v2` |
| **Provenance class** | **SYNTHETIC — NOT INDEPENDENTLY AUTHORED** |
| Companies | **22** |
| Industries | **22 distinct** |
| Workloads | 13 |
| **Paired units** | **286** (22 × 13) |
| Fixed epoch | `2026-07-15T00:00:00Z` — no wall clock anywhere |
| Sealed SHA-256 | `369e2165568305a5e7ae7658c5b939d94957da369b995f837bf37e9efdfd7442` |
| Serialized size | 55,255 bytes |

**Balance:**

| Axis | Distribution |
|---|---|
| Size | medium 10 · enterprise 7 · small 5 |
| Completeness | **rich 16 · sparse 4 · none 2** |
| Website metadata | on 21 · off 1 |
| Market intelligence | on 18 · off 4 |
| Activity | active 19 · dormant 3 |

**Field coverage (of 22 entries):** `industry` 20 · `name` 20 · all twelve rich grounding fields (`unique_value`, `ideal_customer_profile`, `target_audience`, `products_services`, `brand_voice`, `brand_positioning`, `content_themes`, `pain_symptoms`, `competitive_advantages`, `growth_priorities`) 16 each.

The `sparse` (4) and `none` (2) tiers deliberately preserve v1's hardest grounding cases — companies where canonical assembly must work from signals rather than a first-party profile.

**No dataset decision was made in response to model output, because no model output exists.**

---

## 3. Grounding Field Contract

| Field | Meaning | Source | Required at | Can conflict? |
|---|---|---|---|---|
| `name` | Company identity | spec `name` | rich, sparse | No — unique per company |
| `industry` | Sector | spec `industry` | rich, sparse | Cross-checked against `entry.industry` |
| `category` | Product category | spec `category` | rich | No |
| `products_services_list` | **Canonical offering list — single source of truth** | spec `offerings` | rich | **Authoritative** |
| `products_services` | String form of the above | derived by join | rich | Validated against the list |
| `report_settings.market_pulse.core_offerings` | Market-intel view of offerings | **derived** from `products_services_list` | market-enabled | **Cannot conflict — derived** |
| `unique_value` | Value proposition | spec `uniqueValue` | rich | Cross-checked against `discovered_metadata.description` |
| `ideal_customer_profile` / `target_audience` | Buyer | spec `idealCustomerProfile` | rich | Kept equal by construction |
| `target_audience_list` | Buyer roles | spec `audienceRoles` | rich | No |
| `pain_symptoms` | Buyer pains | spec `painSymptoms` | rich | No |
| `competitive_advantages` | Differentiators | spec `competitiveAdvantages` | rich | No |
| `brand_positioning` / `brand_voice` | Positioning and tone | spec | rich | No |
| `content_themes_list` / `content_themes` | Themes | spec `contentThemes` | rich | String validated against list |
| `growth_priorities` | Priorities | spec `growthPriorities` | rich | No |
| `business_model` | Commercial model | spec `businessModel` | rich | No |
| `report_settings.market_pulse.named_competitors` | Competitors | spec `namedCompetitors` | market-enabled | No |
| `report_settings.discovered_metadata.description` | Site description | derived from `uniqueValue` | website-enabled | **Cannot conflict — derived** |

Every potential contradiction is either eliminated by derivation or checked by `auditConsistency`.

---

## 4. Hypotheses, Arms, Metrics, Acceptance — UNCHANGED from `u1-001`

**The acceptance criteria were not altered.** In the machine-readable protocol they are *imported from `u1Protocol.ts`*, so `u1-002` references the identical frozen objects rather than copies. A test asserts object identity (`toBe`, not `toEqual`) for `ACCEPTANCE_RULES`, `EXCLUSION_RULES`, `METRICS` and `HUMAN_RATING_PROTOCOL`, and value equality for every threshold. **Non-weakening is machine-verified, not asserted in prose.**

| Element | Value | Changed? |
|---|---|---|
| H₀ | `median UCCR(grounded) ≥ median UCCR(ungrounded)` | No |
| H₁ | `median UCCR(grounded) ≤ 0.5 × median UCCR(ungrounded)` | No |
| Arm A — grounded | `canonical` | No |
| Arm B — ungrounded | `ungrounded` (DT-C1 control arm) | No |
| **Primary endpoint** | `M-P1-unsupported-claim-rate` (UCCR), human-rated, lower-is-better | No |
| Minimum effect | **≥50% relative reduction** | **No — deliberately not relaxed** |
| Valid-pair ratio floor | 0.90 | No |
| Inter-rater α floor | 0.67 | No |
| Minimum raters | 2 | No |
| Metric registry | 11 metrics (1 primary + 7 secondary human + 3 machine screening) | No |
| Exclusion rules | 4 rules, incl. "no pair may be excluded for producing an unfavourable result" | No |
| Human rating protocol | Blinded, randomised, ≥2 raters, third-rater adjudication | No |
| **Falsification condition** | `median UCCR(grounded) ≥ median UCCR(ungrounded)` ⇒ **evidence AGAINST the grounding hypothesis** | No |

### 4.1 The one mechanically-derived change

The success condition "the reduction holds in the same direction in a majority of per-company clusters" now ranges over **22 clusters instead of 9**.

This is a consequence of the dataset, not a relaxation: **a majority of 22 is a strictly harder bar than a majority of 9.** No threshold moved.

---

## 5. Independence — NOT VERIFIED

# ⛔ INDEPENDENCE NOT VERIFIED

| Question | Answer |
|---|---|
| Who authored the factual ground truth? | **The same AI coding agent that implemented DT-C1 and DT-C2.** |
| When? | 2026-09-10, during DT-C3 |
| Provenance category | **Synthetic. Fabricated for evaluation.** No fact drawn from or verified against any external public source. |
| Did the author participate in implementation? | **YES** — the author built the control arm, the scorer and this protocol. |
| Did the author have access to model outputs? | **No — none exist.** |
| Did the author have access to U1 results? | **No — none exist.** |

**The 22 companies do not exist.** They are not real organisations, and nothing here may be presented as externally validated.

### 5.1 Consequence — stated plainly

v2 fixes the two defects that made v1's corpus *internally* unusable. It does **not** make the corpus independent. The party that built the system also wrote its ground truth — the same structural weakness that DT-A1 recorded as F2 for competitor qualification, one level up.

> **`canonicalGrounding.u1Dataset.v2` remains an ENGINEERING FIXTURE — a materially better one, but a fixture.**
>
> A `SUCCESS` outcome under `u1-002` can reach **Rung 2 (controlled experiment) at most.** It can never reach **Rung 6 (held-out validation)**, and no external-defensibility claim may rest on it alone.

### 5.2 Exactly what would close L-3

1. Ground truth authored, or independently verified, by a party that **did not implement** the grounding system.
2. That party must have **no access** to model outputs or U1 results before sealing.
3. Facts drawn from **verifiable external sources**, with per-fact provenance recorded — or, if synthetic, authored by an independent party and labelled as synthetic.
4. The dataset **sealed by hash before first use**, with the seal recorded prior to any generation run.
5. Human review certifying **semantic** distinctness (the machine audit proves only non-duplication — see §6).

Items 1–3 cannot be satisfied from inside this repository by this agent. They require a person.

---

## 6. Distinctness & Consistency Audits

All audits are deterministic, pure, and run via:
```bash
npx tsx backend/evaluation/canonicalGrounding/sealU1Dataset.ts --verify
```

| Audit | Result | Detects |
|---|---|---|
| **Distinctness** | ✅ **PASS — 0 findings** | duplicate slug/name; duplicate scalar fact; duplicate list bundle; duplicate individual list element; copied record body (identity-only difference) |
| **Consistency** | ✅ **PASS — 0 findings** | `core_offerings` vs `products_services_list` (the L-2 defect); `products_services` string vs list; `content_themes` vs list; `discovered_metadata.description` vs `unique_value`; profile industry vs entry industry |
| **Required fields** | ✅ **PASS — 0 findings** | missing rich fields; sparse records carrying rich fields; `none` records carrying profile fields |

Both audits are proven to *catch* their target defect: tests inject a cloned fixture (→ `COPIED_FIXTURE`) and a v1-style offerings contradiction (→ `OFFERINGS_CONTRADICTION`) and assert the audit fails.

### 6.1 ⚠️ Limitations of the distinctness test

These are **exact and normalised-exact string comparisons**. They prove no two companies were built by copying a field. They **do not prove semantic uniqueness** — two companies could describe near-identical businesses in different words and pass every check.

> A distinctness PASS means **"not duplicated"**. It never means **"meaningfully different"**.

Semantic distinctness requires human review, which was **not performed** and is **not claimed**.

---

## 7. Sealing

| Field | Value |
|---|---|
| Serialization | Deterministic — stable key ordering, fixed entry order, fixed epoch, no clock, no RNG |
| Hash | **SHA-256** (cryptographic) over the serialised dataset |
| Value | `369e2165568305a5e7ae7658c5b939d94957da369b995f837bf37e9efdfd7442` |
| Bytes | 55,255 |
| Reproducibility | ✅ Verified — two independent seals produced identical hash and byte count |
| Seal artifact | `backend/evaluation/canonicalGrounding/artifacts/u1-dataset-002.seal.json` (gitignored; regenerable on demand) |

**Immutability rule.** `canonicalGrounding.u1Dataset.v2` is frozen for U1 purposes. Any modification requires a **new dataset version and a new hash**, and — because the protocol records the hash — a new protocol version. A results artifact whose recorded dataset hash does not match the dataset it cites is invalid on its face.

**A hash proves immutability. It never proves quality, and it never proves independence.**

---

## 8. Statistical Treatment

Unchanged in kind from `u1-001`; the counts change with the corpus.

| Field | Commitment |
|---|---|
| Observational unit | (workload, entry) pair — **286** |
| **Independence** | **STILL VIOLATED**, though less severely than in `u1-001`. 286 pairs derive from 22 companies × 13 workloads; observations remain clustered on both axes and are **not** independent samples. |
| Aggregate | Median paired difference, median per-arm, IQR; per-company (n=22) cluster medians alongside |
| Confidence intervals | **NOT REPORTED** — 22 clusters is better than 9 but still too few to justify interval estimates over clustered data |
| Significance test | **NOT an acceptance basis.** Wilcoxon may be reported descriptively, labelled as such |
| Non-normality | Assumed; rank/median-based only |
| Ties | Reported explicitly; never redistributed, never counted as success |
| Multiple metrics | ONE primary endpoint; secondaries may not substitute if it fails |
| Status | **EXPLORATORY, NOT CONFIRMATORY** |
| Generalisation | **NONE.** The corpus is synthetic and not independently authored. No population-level, customer-level or real-company generalisation may be claimed. |

---

## 9. Exclusion Rules — unchanged

1. A pair where either arm produced no output is excluded from primary aggregation and **reported**.
2. A pair whose reference fixture has no checkable company facts (`completeness = 'none'`) is excluded from M-S1 only, and reported.
3. **No pair may be excluded for producing an unfavourable result.**
4. The exclusion list must be published with the results.

---

## 10. Statement of Non-Execution

| | |
|---|---|
| U1 executed | **NO** |
| Model outputs generated | **NO — zero, either arm** |
| OpenAI / Anthropic / any provider called | **NO** |
| Network requests made | **NO** |
| Human rating performed | **NO** |
| Efficacy measured | **NO** |
| Results embedded in this document | **NONE** |
| U1 evidence rung | **Rung 1 (engineering proof)** — unchanged |

---

## 11. Sequence Discipline

```
engineering fixture (v1)      ✅ DT-A1/DT-C2 — defects identified
    → improved fixture (v2)   ✅ DT-C3 — L-1, L-2 resolved; L-3 OPEN
    → independent ground truth   ⛔ BLOCKED — requires a party that is not this agent
    → sealed dataset          ✅ DT-C3 — SHA-256 recorded
    → frozen protocol         ✅ DT-C3 — u1-002, fingerprint 3c93760a
    → model execution            NOT DONE
    → blinded scoring            NOT DONE
    → analysis                   NOT DONE
    → conclusion                 NOT DONE
```

DT-C3 ends here. **It does not test U1.**

---

*End of `DEEPTECH_U1_PREREGISTRATION_002`, protocol `u1-002`, fingerprint `3c93760a`, dataset `canonicalGrounding.u1Dataset.v2` @ `369e2165…fdfd7442`, repository SHA `82754497e8f9b64a893319e863941ad2994fd9b7`. No results are included because none exist.*
