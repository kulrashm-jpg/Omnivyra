# DEEPTECH_U1_PREREGISTRATION_003

**Protocol `u1-003` — the frozen independence contract for U1.**

# ⛔ INDEPENDENT AUTHORSHIP NOT AVAILABLE

> **This document records a BLOCKER, not progress.**
>
> DT-C4 set out to obtain independently authored ground truth. **No independent human was available to participate**, so — per the task's own §1 governing principle — the agent authored **no facts** and the independence portion was stopped. No new dataset was created.
>
> `canonicalGrounding.u1Dataset.v2` **remains a self-authored ENGINEERING FIXTURE**, and U1's attainable ceiling remains **Rung 2**.
>
> Issuing `u1-003` does **not** advance U1's evidence rung. What it adds is the frozen, machine-enforced contract that a qualifying independent party must satisfy — so that independence, when obtained, is *recorded as data and enforced by code* rather than asserted in prose.

---

## 0. Identity

| Field | Value |
|---|---|
| Protocol ID | `DEEPTECH-U1` |
| **Protocol version** | **`u1-003`** |
| Supersedes | `u1-002` (preserved unchanged, fingerprint `3c93760a`) |
| **Protocol fingerprint** | **`21de0f2f`** |
| Dataset identity | `canonicalGrounding.u1Dataset.v2` — **unchanged from u1-002** |
| Dataset SHA-256 | `369e2165568305a5e7ae7658c5b939d94957da369b995f837bf37e9efdfd7442` — **unchanged** |
| Repository SHA | `82754497e8f9b64a893319e863941ad2994fd9b7` |
| Registered | 2026-09-10 |
| Machine twin | `backend/evaluation/canonicalGrounding/u1Protocol003.ts` |
| Enforcement module | `backend/evaluation/canonicalGrounding/u1Certification.ts` |

**Protocol lineage — all three preserved, none overwritten:**

| Version | Fingerprint | Dataset | Status |
|---|---|---|---|
| `u1-001` | `b204e168` | `goldenDataset.v1` | Preserved, unmodified |
| `u1-002` | `3c93760a` | `u1Dataset.v2` | Preserved, unmodified |
| **`u1-003`** | **`21de0f2f`** | `u1Dataset.v2` (same) | This document |

---

## 1. Why `u1-003` binds to the same dataset

`u1-002` bound criteria to the v2 dataset. DT-C4 was meant to replace that dataset with independently authored ground truth. It could not: **no independent human participated**, and §1 forbids the implementation agent from authoring facts and then certifying them as independent.

So `u1-003` introduces **no new dataset and no new facts**. It binds to the identical dataset and hash, and adds only the independence contract and its enforcement gate.

**This is the honest outcome.** The alternative — inventing 20 more companies and calling them independent — is precisely what §1 prohibits and what §18 anticipates.

---

## 2. Independence Status — DERIVED, not asserted

```
INDEPENDENCE NOT VERIFIED (0/12 requirements satisfied)
Evidence ceiling: Rung 2 — controlled experiment at most
```

This status is **computed** by `independenceStatus()` from the presence and content of a certification record. `CURRENT_CERTIFICATION` is `null`, so the verdict is derived, not hardcoded — it cannot drift away from reality, and it will change automatically the moment a genuine record is supplied.

| §3 requirement | Status |
|---|---|
| Independent human identified | ❌ **NOT AVAILABLE** |
| Did not implement the system under test | ❌ unfilled |
| Did not implement DT-C1/DT-C2 infrastructure | ❌ unfilled |
| Not merely a nominal approver | ❌ unfilled |
| Independently authored or verified the facts | ❌ unfilled |
| Certified semantic distinctness | ❌ unfilled |
| Approved sealed dataset before first execution | ❌ unfilled |
| §5 — saw no grounded outputs | ❌ unfilled |
| §5 — saw no ungrounded outputs | ❌ unfilled |
| §5 — saw no scorer results | ❌ unfilled |
| §5 — saw no success/failure results | ❌ unfilled |
| §5 — no model output influenced the dataset | ❌ unfilled |

**0 of 12.** No certification record exists.

---

## 3. Why no independent human was available

| Evidence | Finding |
|---|---|
| Session mode | Non-interactive. No human authored or reviewed anything during DT-C4. |
| Repository authorship | `kulrashm-jpg` 1,383 commits · `drishiq2-dot` 199 · `drishiq1` 22 — all on the product under test. |
| Programme direction | DT-A1 → DT-C3 were commissioned and directed by the repository owner, who also owns the system under test. Under §3.1 that person is **not independent of the system under test**. |
| v2 ground truth | Authored by the implementation agent (disclosed in `u1Dataset002.ts` header). |
| Existing certification records | **None.** No certification artifact exists anywhere in the repository. |

No third party has been nominated, and none participated. Per §1: **`INDEPENDENT AUTHORSHIP NOT AVAILABLE`.**

---

## 4. The Frozen Independence Contract

A certification is a **data record supplied from outside this codebase**. The agent cannot synthesise one: there is no factory, builder or default, and no default-to-verified path — all test-enforced.

### 4.1 Hard requirements — any failure ⇒ `NOT_VERIFIED`
1. Certification bound to the exact dataset SHA-256 under evaluation.
2. Author did not implement the system under test.
3. Author did not implement the DT-C1/DT-C2 evaluation infrastructure.
4. Author was not merely a nominal approver of AI-generated facts.
5. Author independently authored, or independently verified, the facts.
6. Author saw no grounded U1 outputs.
7. Author saw no ungrounded U1 outputs.
8. Author saw no scorer results.
9. Author saw no success/failure results.
10. No model output influenced the dataset.

### 4.2 Completeness requirements — failure ⇒ `PARTIALLY_VERIFIED`
11. Human semantic-distinctness certification complete, **explicitly acknowledging that machine string comparison proves non-duplication and NOT semantic uniqueness**.
12. Dataset approved before first U1 execution, with per-company provenance reviewed.

### 4.3 Enforcement rules
| Rule | Mechanism |
|---|---|
| Verdict | Any hard failure ⇒ NOT_VERIFIED · all hard but a gap ⇒ PARTIALLY_VERIFIED · full pass ⇒ VERIFIED |
| Sealing | `sealWithCertification()` **throws** unless VERIFIED. **No force flag, no override, no bypass** — test-enforced |
| Tamper detection | A certification binds to exact dataset bytes; any edit invalidates it automatically |
| Prohibition | A verdict of VERIFIED must **never** be recorded merely because a human reviewed AI-generated material |

### 4.4 Privacy
`authorRef` is **pseudonymous** (a role plus an opaque id). Names, emails and contact details must never enter a certification record — §3 asks only for what reproducibility and audit require.

---

## 5. Acceptance Criteria — UNCHANGED

**No U1 acceptance criterion was changed, and this is machine-verified.** `u1Protocol003.ts` *imports* the criteria from `u1Protocol.ts` — the same frozen objects, not copies. Tests assert object identity (`toBe`).

| Element | Value | Changed? |
|---|---|---|
| Primary endpoint | `M-P1-unsupported-claim-rate` (UCCR), human-rated, lower-is-better | **No** |
| Minimum effect | **≥50% relative reduction** | **No** |
| Valid-pair floor | **≥90%** | **No** |
| Inter-rater α floor | **≥0.67** | **No** |
| Minimum raters | **2** | **No** |
| Exclusion rules | 4, incl. "no pair may be excluded for producing an unfavourable result" | **No** |
| Metric registry | 11 metrics | **No** |
| Statistical treatment | Exploratory; independence violated; no CIs; no significance test as acceptance basis; generalisation NONE | **No** |
| Falsification condition | `median UCCR(grounded) ≥ median UCCR(ungrounded)` ⇒ evidence AGAINST the hypothesis | **No** |
| Arms | `canonical` vs `ungrounded` | **No** |
| Dataset | `u1Dataset.v2` @ `369e2165…` | **No** |

Nothing was weakened. Nothing was strengthened to compensate.

---

## 6. Dataset Status

| Field | Value |
|---|---|
| Identity | `canonicalGrounding.u1Dataset.v2` |
| SHA-256 | `369e2165568305a5e7ae7658c5b939d94957da369b995f837bf37e9efdfd7442` |
| Companies | 22 across 22 industries |
| Pairs | 286 (22 × 13) |
| Machine distinctness audit | ✅ PASS — 0 findings |
| Machine consistency audit (L-2) | ✅ PASS — 0 findings, contradiction still eliminated |
| Required-field audit | ✅ PASS — 0 findings |
| Reproducible seal | ✅ YES |
| **Provenance class** | **SYNTHETIC — NOT INDEPENDENTLY AUTHORED** |
| **Human semantic-distinctness certification** | ❌ **NOT PERFORMED** |
| **Independence** | ❌ **NOT VERIFIED** |

The DT-C3 audits remain in force and their negative controls still fail correctly. What is missing is not machine rigour — it is a person.

---

## 7. What Would Close This

1. **Nominate a qualifying person** — did not implement Omnivyra's grounding stack, did not implement DT-C1/DT-C2, and has no access to U1 outputs or results.
2. **They author or verify the facts** — either ≥20 real companies with externally verifiable per-fact provenance, or ≥20 synthetic companies they construct themselves, labelled `SYNTHETIC — INDEPENDENTLY AUTHORED`.
3. **They certify semantic distinctness**, explicitly acknowledging the machine test is insufficient.
4. **They sign the §5 non-exposure attestations.**
5. **The record is supplied as data**, `CURRENT_CERTIFICATION` is set from it, and `sealWithCertification()` is run — it will refuse anything short of a full pass.
6. **The seal is recorded before any model output is generated.**

Steps 1–4 require a person. The agent's role is confined to tooling, validation and sealing — never authorship, never certification.

---

## 8. Statement of Non-Execution

| | |
|---|---|
| U1 executed | **NO** |
| Model outputs generated | **NO — zero, either arm** |
| OpenAI / Anthropic / any provider called | **NO** |
| Network requests made | **NO** |
| Human rating performed | **NO** |
| Efficacy measured | **NO** |
| Facts authored by the agent in DT-C4 | **NONE** |
| Results embedded in this document | **NONE** |
| U1 evidence rung | **Rung 1 (engineering proof)** — unchanged |
| Attainable ceiling under u1-003 | **Rung 2** — unchanged from u1-002 |

---

## 9. Sequence Discipline

```
engineering fixture (v1)          ✅ DT-A1/DT-C2 — defects found
  → improved fixture (v2)         ✅ DT-C3 — L-1, L-2 resolved
  → independence contract         ✅ DT-C4 — frozen + machine-enforced
  → independent ground truth      ⛔ BLOCKED — INDEPENDENT AUTHORSHIP NOT AVAILABLE
  → certified sealed dataset         NOT DONE — gate refuses, correctly
  → frozen protocol               ✅ u1-003, fingerprint 21de0f2f
  → model execution                  NOT DONE
  → blinded scoring                  NOT DONE
  → analysis                         NOT DONE
  → conclusion                       NOT DONE
```

**DT-C4 ends here. It does not test U1, and it does not establish independence.**

---

*End of `DEEPTECH_U1_PREREGISTRATION_003`, protocol `u1-003`, fingerprint `21de0f2f`, dataset `canonicalGrounding.u1Dataset.v2` @ `369e2165…fdfd7442`, repository SHA `82754497e8f9b64a893319e863941ad2994fd9b7`. Independence: NOT VERIFIED, 0/12. No results are included because none exist.*
