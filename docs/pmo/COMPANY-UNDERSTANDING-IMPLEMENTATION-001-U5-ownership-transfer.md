# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U5 — Production Ownership Transfer & Classifier Retirement

**Verdict:** ⛔ **IMPLEMENTATION BLOCKED** — at the deploy-time controlled-rollout gate (all engineering
preconditions complete; the authoritative read-path is built).
**Date:** 2026-07-29 · Predecessors: U-1..U4.6 ✅ · DECISION-001 ✅
**Code changed this phase:** authoritative READ-path (additive, flag-gated) + its tests. **No classifier
retired; no authoritative write-path finalized.**

---

## 1. Executive Summary

Every *engineering* precondition for the ownership transfer is now met: the canonical producer exists (U4.5),
`business_model`/`provider_type`/`solution_domains` are evidence-derived and `operating_model`/`domain_role`
abstain (U4.6, DECISION-001), and the persisted canonical understanding is written shadow at the write path.
This phase adds the **authoritative read path**: `resolveCompanyProjection` now reads a *persisted* canonical
understanding as the production source of truth (flag-gated, fail-safe, OFF byte-identical). What remains is
**not code** — it is the deploy-time **controlled rollout** the mission itself mandates: deploy → enable
shadow → **observe live parity across production tenants** → finalize + flip the authoritative write path
per-tenant → then retire classifiers one family at a time. That cannot be executed or safely finalized in this
**unmerged, flag-dark, no-production-data** environment. **Stage A cannot certify live here; therefore Stage B
(retirement) must not begin.** 5/5 read-path + 48/48 seam-consumer regression; tsc 0.

## 2. Production Activation Report

| Stage-A element | State |
|---|---|
| Canonical producer (shadow write) | ✅ built (U4.5); persists `report_settings.canonical_understanding` under `COMPANY_UNDERSTANDING_ENABLED` |
| Evidence coverage (B-fields) | ✅ built (U4.6); grounded, quote-or-abstain |
| **Authoritative READ path** | ✅ **built this phase** — `resolveCompanyProjection(profile, { persistedCanonical })` → `source: 'canonical_persisted'` under the flag; fail-safe to legacy on parity-locked regression; OFF ⇒ persistedCanonical ignored (byte-identical) |
| Authoritative WRITE path (gate stored fields to canonical) | ⛔ **deferred** — must be finalized *after* live shadow observation (mission: "controlled rollout / live parity observation" precede activation); building it blind inverts the safe order |
| Live parity observation across tenants | ⛔ not runnable here (needs prod data + deploy) |
| Per-tenant activation / flag flip | ⛔ deploy-time |

## 3. Live Parity Report

**Not runnable in this environment.** The harness (`runProductionParity`, U4.5, now covering the B-fields) is
**corpus-certifiable: 0 unexpected regressions**. "Live parity across production tenants" requires the
production dataset with the shadow producer enabled — a deployed environment. Status: **pending deployment**.

## 4. Ownership Transfer Matrix

| Field | Canonical source | Live owner today | Transfers when |
|---|---|---|---|
| category / industry | evidence (AI extraction) | legacy classifier | authoritative write + live parity |
| business_model | evidence (U4.6, grounded) | `business_classification.level_1` | authoritative write + live parity |
| provider_type | evidence (U4.6, grounded) | `level_2` / `inferCompanyDomainShape` | authoritative write + live parity |
| solution_domains | evidence (U4.6, grounded) | `level_3` / `inferCompanyDomainShape` | authoritative write + live parity |
| operating_model | **abstain** (Policy A) | `inferCompanyDomainShape` | authoritative write (→ null) + consumer NULL-tolerance |
| domain_role | **abstain** (Policy A) | `inferCompanyDomainShape` | authoritative write (→ null) + consumer NULL-tolerance |
| name / domain / products / competitors | evidence (facts) | legacy | authoritative write + live parity |

**No field has transferred yet** (flag OFF; authoritative write not finalized; live parity not certified).

## 5. Classifier Retirement Matrix

| Family | Classifier | Retire now? | Gate |
|---|---|---|---|
| 1 | `classifyCompanyBusiness` | ❌ | Stage A live cert (owns category/industry + business_classification→B-fields) |
| 2 | `inferCompanyDomainShape` | ❌ | Stage A live cert (A-fields abstain, B-fields from evidence) |
| 3 | `inferBusinessModelLabel` | ❌ | Stage A live cert |
| 4 | `inferEntityArchetype` | ❌ | no canonical archetype equivalent → **defer** (mission condition) |
| 5 | read-time identity heuristics (content/lead/competitor) | ❌ | only after canonical ownership proven live |

**Zero families retireable** until Stage A certifies live.

## 6. Dead Code Report

None retired — all families live and reachable. Dead-code verification is a Stage-B activity gated on Stage A.

## 7. Evidence Ownership Report

For the canonical understanding the producer persists: every non-null identity value carries provenance
(`source.system`), confidence (weight), freshness (`observedAt`), and kind (`ai_generated`/`structured`/…);
every null value is an explicit canonical abstention (Policy A fields, and unevidenced B-fields). Verified by
the U4.6 + U4.5 + read-path suites. This contract holds in the persisted record consumed by the read path.

## 8. Tests Added

`companyAuthoritativeReadPath.test.ts` (5): OFF ⇒ legacy byte-identical (persistedCanonical ignored) · ON ⇒
`canonical_persisted` (reads persistence, not legacy) · fail-safe (parity-locked divergence ⇒ legacy_fallback)
· rollback (ON→OFF identical) · worldView surfaced. Regression: 48/48 seam-consumer suites green
(additive `persistedCanonical` option is backward-compatible).

## 9. Performance Report

Read path is a pure projection over an already-built understanding — no network/AI/DB. Unchanged.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Read-path change breaks consumers | Additive optional `persistedCanonical`; OFF/no-arg byte-identical; 48/48 green | None |
| Building authoritative write blind | Deferred until live shadow observation (avoids mis-mapping stored fields) | Avoided |
| Retiring before live cert | Not done — would remove ownership / break prod on merge | Avoided |
| Live parity unknown | Harness ready; corpus 0 regressions; run live before flip | Managed |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Canonical persistence is the production source of identity | ❌ authoritative write not finalized; flag OFF (env gate) |
| Authoritative read path exists | ✅ built |
| Legacy classifiers no longer own any field | ❌ they still own (live) |
| Policy-B evidence-derived / Policy-A abstain (in canonical) | ✅ (U4.6) |
| Live parity certified across tenants | ❌ not runnable here |
| Rollback O(1) | ✅ (flag; read-path additive) |
| Dead-code verification | ❌ Stage B (gated) |
| No code changed unsafely | ✅ read-path only (additive/safe) |
| Read-path + regression tests pass; tsc 0 | ✅ |

## 12. Recommendation — Execution Runbook (deploy-time)

All code preconditions are green. Execute the remaining steps in a deployed environment:

1. **Merge** `feat/lead-understanding-foundation`.
2. **Enable shadow:** `COMPANY_UNDERSTANDING_ENABLED=ON` → the producer persists `canonical_understanding`
   per profile refine. `AUTHORITATIVE` stays OFF (production byte-identical).
3. **Observe live parity:** run `runProductionParity` across production tenants (build cases from stored
   profile + its persisted `canonical_understanding`). Require **0 unexpected regressions**; review
   approved improvements (category corrections) and abstentions (operating_model/domain_role null).
4. **Finalize the authoritative WRITE path** (informed by the live observation): when authoritative, persist
   canonical identity into the stored fields — category/industry + `market_pulse.business_model`/
   `provider_type`/`solution_domains` from canonical evidence; `operating_model`/`domain_role` → null; drop
   the `business_classification.level_1/2/3` → market_pulse override. Add consumer NULL-tolerance for the
   two Policy-A fields. Flag OFF ⇒ byte-identical.
5. **Wire consumers to the read path:** pass the persisted `canonical_understanding.understanding` as
   `resolveCompanyProjection`'s `persistedCanonical` (or read the now-canonical stored fields directly).
6. **Per-tenant activation:** flip `COMPANY_UNDERSTANDING_AUTHORITATIVE` per tenant once its live parity is
   clean (O(1); rollback = flip OFF).
7. **Certify Stage A**, then **Stage B**: retire Family 1 → 2 → 3 (defer 4) one at a time, each with
   inventory → verify canonical ownership → live parity → remove call sites → no-transitive-refs →
   regression → dead-code → certify.

**Immediate ask:** authorize the deploy/rollout (or a deployment agent with production access) to execute
steps 1–3. Steps 4–5 are then buildable with live evidence; 6–7 complete the transfer.

# IMPLEMENTATION BLOCKED
