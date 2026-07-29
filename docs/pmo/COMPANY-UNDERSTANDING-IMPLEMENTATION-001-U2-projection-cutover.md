# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U2 — Projection Cutover

**Status:** ✅ **READY FOR U3**
**Mode:** flag-dark · `COMPANY_UNDERSTANDING_AUTHORITATIVE` default **OFF** · fully reversible
**Date:** 2026-07-28 · Predecessors: U-1 ✅ · U0 ✅ · U1 ✅

---

## 1. Executive Summary

U2 promotes the **evidence-derived** `CompanyUnderstanding` (U1) to the authoritative projection path
**behind the feature flag**, changing only the *source* of projected identity. The seam
`resolveCompanyProjection` now routes: flag **OFF** → byte-identical legacy; flag **ON + evidence** →
evidence-derived canonical (via `buildCompanyUnderstandingFromEvidence`); flag **ON, no evidence** →
profile-derived canonical (U0 baseline). A **fail-safe parity gate** guarantees that any *unexpected
regression* (a parity-locked field diverging) is never served — it falls back to legacy and is recorded.
Approved semantic improvements (category, solution_domains, …) pass. No consumer is migrated, no
classifier retired, no default enabled, and projection stays pure/deterministic/side-effect-free.
**47/47 tests pass; tsc 0 errors.**

## 2. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/adoption/consumerAdapter.ts` | MODIFIED (tracked) | Authoritative routing + evidence source + fail-safe parity gate + `ProjectionObservation` + `validateConsumerParity` evidence integration |
| `backend/services/companyIntelligence/evidence/delta.ts` | MODIFIED (U1, untracked) | Pure refactor: extract `classifyLegacySurfaceDelta` (THE single classifier); `runSemanticDelta` delegates — no behavior change |
| `backend/tests/unit/companyProjectionCutover.test.ts` | NEW | 10 U2 test groups |
| `docs/pmo/…-U2-projection-cutover.md` | NEW | This report |

No consumer, classifier, evidence-resolution, facet-population, projection primitive, or flag default
was changed. `flags.ts`, `projection.ts`, `persistence.ts`, `fromProfile.ts`, `buildFromEvidence.ts`,
`adapters.ts` untouched.

## 3. Routing Changes

### Projection Routing Matrix
| Flag | Evidence supplied | Path (`source`) | Fields | Gate |
|---|---|---|---|---|
| OFF (default) | any | `legacy` | `legacyProjection(profile)` — byte-identical | none |
| ON | yes, 0 unexpected regressions | `canonical_evidence` | `toLegacyFields(evidenceUnderstanding)` | passed |
| ON | yes, ≥1 unexpected regression | `legacy_fallback` | `legacyProjection(profile)` (fail-safe) | **blocked → legacy** |
| ON | no | `canonical_profile` | `toLegacyFields(profileUnderstanding)` | parity 1.0 |

### Flag Matrix
| `COMPANY_UNDERSTANDING_AUTHORITATIVE` | `resolveCompanyProjection` | `observation.flagAuthoritative` |
|---|---|---|
| unset / not `'true'` | legacy | false |
| `'true'` | canonical (evidence/profile) with fail-safe | true |

Single env var; read at call time (no caching) → instant, deploy-free toggling.

## 4. Tests Added (10 groups · companyProjectionCutover.test.ts)

Projection Routing · Authoritative Flag · Rollback · Parity Validation · Approved Divergence ·
Unexpected Regression fail-safe · Projection Version · Projection Explainability · Omnivyra Projection ·
Performance + Determinism. **All pass.** Regression: U1 (13) + Projection-Cert (7) + Company
Understanding suite re-run green after the `delta.ts` refactor → **47/47 total**.

## 5. Parity Results

### Parity Report
- **Evidence path** (`validateConsumerParity(profile,{evidence})`): gate = **zero unexpected
  regressions** (approved improvements do not fail the gate). Omnivyra → `matches: true`,
  `unexpectedRegressions: 0`, `approvedImprovements ≥ 1`.
- **Profile path** (`validateConsumerParity(profile)`): unchanged ≥0.999 field-parity gate → `matches: true`.

## 6. Semantic Delta Report

| Field | Legacy | Canonical (evidence) | Class |
|---|---|---|---|
| category | "Analytics software for clearer performance insights" | "AI-driven digital marketing & content platform" | **approved_improvement** |
| name / domain / products | (as-is) | identical | parity |
| competitors | [] | [] | parity (honest abstention) |

**Unexpected regressions: 0.** Approved-divergence fields (category / solution_domains / provider_type /
operating_model / domain_role / competitors / firmographics) are the only fields permitted to differ;
all others are parity-locked and enforced by the fail-safe.

## 7. Observability

`ProjectionObservation` (pure) records per resolution: `companyId`, `version`, `path`
(legacy / canonical_evidence / canonical_profile / legacy_fallback), `flagAuthoritative`, `parity`,
`unexpectedRegressions`, `approvedImprovements`, `deltas[]` (field-level classification →
Projection → Facet → EvidenceRefs → Resolution Policy → Value). Latency is measured at the harness
boundary (kept out of the pure function to preserve determinism). No user-visible behavior while OFF.

## 8. Performance

Constant-time, allocation-light, **no network, no additional evidence reads, single build reused for
serve + gate** (no duplicate computation). 1000 evidence-path resolves complete well under the 2 s test
bound; deterministic (two identical calls ⇒ identical result).

## 9. Rollback Verification

Flag OFF ⇒ `resolveCompanyProjection` returns `{source:'legacy', fields: legacyProjection(profile)}` and
**no canonical code path executes**. Test asserts flag OFF result deep-equals the legacy shape and that
flipping ON then OFF restores an identical result. **O(1)** — one env var, no deploy, no data migration.
Additionally, even with the flag ON, the fail-safe degrades any regressing company to legacy.

## 10. Risks

| Risk | Mitigation | Residual |
|---|---|---|
| Regression reaches a consumer | Fail-safe: unexpected regression → `legacy_fallback`, recorded | None |
| Seam return-shape change breaks a consumer | No live consumer imports the seam yet (U3 migrates them); shape is additive (`observation`) | None |
| Approved improvement wrongly blocked | Gate keys on unexpected regressions only, not raw parity | None |
| Non-determinism / hidden latency read | Timestamps injected; latency measured externally; grep-clean | None |
| Accidental default-on | Flag default OFF; test asserts OFF byte-identical | None |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| `resolveCompanyProjection` is the authoritative seam | ✅ |
| Feature flag controls routing | ✅ |
| Rollback O(1) | ✅ |
| Projection pure / deterministic / side-effect-free / versioned | ✅ |
| Projection only reads facets / maps / formats / returns legacy shape | ✅ |
| No reasoning / classify / infer / resolve / raw-evidence / AI / network in projection | ✅ |
| `validateConsumerParity` integrated (evidence gate) | ✅ |
| Approved semantic improvements pass | ✅ |
| Unexpected regressions = 0 (and fail-safe if any) | ✅ |
| Observability records version/path/flag/parity/delta | ✅ |
| Consumers unchanged; no default enabled; classifiers intact | ✅ |
| All regression suites pass (47/47); tsc 0 | ✅ |

## 12. Recommendation

The authoritative projection path is cut over to evidence-derived understanding behind
`COMPANY_UNDERSTANDING_AUTHORITATIVE`, reversible in O(1), with a fail-safe parity gate that makes an
unexpected regression unservable. Projection remains a pure reshape. This satisfies every U2 completion
criterion. **U3 (Consumer Adoption)** may now migrate downstream consumers to read through this seam
(passing `EvidenceSources`), enabling per-tenant rollout with the parity gate — still flag-dark until
adopted.

# READY FOR U3

*No U3 work has begun; per one-phase-at-a-time discipline, awaiting explicit U3 authorization.*
