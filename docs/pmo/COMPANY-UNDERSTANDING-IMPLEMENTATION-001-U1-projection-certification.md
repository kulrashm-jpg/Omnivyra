# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U-1 — Projection Certification Report

**Engineer:** Principal Platform Engineer · **Phase:** U-1 (Projection Certification) · **Date:** 2026-07-28
**Scope:** Audit and certify **every** canonical projection against LAW 3 (pure / deterministic / stateless /
versioned; never infers, classifies, runs regex classification, calls AI, or reads raw evidence). **No
production code modified** — audit + a durable certification test only.

---

## 1. Executive Summary

The canonical Company Understanding capability exposes exactly **two field projections** —
`projectCompany` (`companyIntelligence/projection.ts`) and the legacy-compat projection `toLegacyFields`
(`companyIntelligence/persistence.ts`) — plus the pure record builder `toShadowRecord` and the consumer seam
`resolveCompanyProjection` (`adoption/consumerAdapter.ts`). All were audited by inspection, grep, and a new
automated certification suite. **Every projection is pure, deterministic, versioned, mutation-free, and free
of inference / AI / regex-classification / clock / raw-evidence access.** A static source-scan guard is now in
place so a future edit cannot smuggle inference into a projection. **U-1 is certified.**

## 2. Architecture Compliance

| Law | Result |
|---|---|
| **LAW 3 pure** | ✅ `projectCompany`/`toLegacyFields` read `u.facets.*.value` + `u.score.*`; no side effects, no module-level mutable state. |
| **LAW 3 deterministic** | ✅ `projectedAt`/`builtAt` are **passed in** (no `Date.now`/`new Date`/`Math.random` — grep + source-guard confirm). Idempotent; independent builds of the same profile+asOf project identically. |
| **LAW 3 versioned** | ✅ `projectCompany` output carries `version = u.version`. (Observation O-1: `toLegacyFields` targets the intentionally-unversioned legacy shape — version preserved upstream.) |
| **LAW 3 never infers/classifies** | ✅ No regex classification, no AI call, no raw-evidence read (source-guard). Projections only read decided facet values + `??` fallbacks (map/format — permitted). |
| **LAW 3 never reads raw evidence** | ✅ Projections consume the already-decided `CompanyUnderstanding`; evidence intake is confined to the owner (`companyFromProfile`/`builder`). |
| **LAW 1/2 single owner** | ✅ Projections do not derive identity; the sole owner is the understanding. |

## 3. Files Modified

- **Added (test only):** `backend/tests/unit/companyProjectionCertification.test.ts`.
- **Production source modified:** **none.** `companyIntelligence/projection.ts`, `persistence.ts`,
  `adoption/consumerAdapter.ts` were audited **unchanged**.

## 4. Implementation Details

Audited projection inventory (exhaustive):
1. **`projectCompany(u, projectedAt)`** — reshapes decided facet/score values into `CompanyProjection`
   (worldView, identity, scores, overallScore, confidence, facetConfidence, topContradictions). Pure sort/slice/map; `projectedAt` passed in; carries `version`.
2. **`toLegacyFields(u)`** — compat projection to the legacy profile-field shape (name/domain/category/
   business_model/products/services/competitors/confidence). Reads `identity`/`offerings`/`worldView`/
   `competitive`/`marketPosition` facet values with `??` fallbacks. No inference.
3. **`toShadowRecord(u, projection, parity)`** — pure record shape builder (`built_at = u.builtAt`).
4. **`resolveCompanyProjection(profile)`** (seam) — flag OFF ⇒ legacy fields (byte-identical); flag ON ⇒
   `companyFromProfile`→`buildCompanyUnderstanding`→`toLegacyFields`. The *projection* step is pure; the
   *owner build* is confined to Tc (see Performance / Risk for the build-on-read note handled in U2/U3).

**Certification test asserts:** idempotence (`project(u,t)===project(u,t)`), versioned output,
`projectedAt` echoed (never generated), **input not mutated** (JSON before/after), cross-build determinism,
reads-decided-values (no re-derivation), **honest empty-state** (empty profile ⇒ null/empty, no fabrication),
and a **LAW-3 source-guard** over `projection.ts`+`persistence.ts` banning `Date.now`/`new Date`/`Math.random`/
AI-gateway/`RegExp`/`.exec`/`.test`/`fetch`/`safeFetch`/`crawl`/`readEvidence`.

## 5. Feature Flags

None changed. `COMPANY_UNDERSTANDING_ENABLED` and `COMPANY_UNDERSTANDING_AUTHORITATIVE` remain **default OFF**
(shadow). U-1 is flag-independent (projection purity holds regardless of flag state).

## 6. Tests Added

`backend/tests/unit/companyProjectionCertification.test.ts` — **7 tests** across 3 describes (projectCompany
purity/determinism/versioning/no-mutation; toLegacyFields purity/reads-decided/honest-empty; LAW-3
source-guard on both projection files).

## 7. Regression Results

- New suite: **7/7 pass.**
- Existing certified canonical suite (`companyUnderstanding.test.ts`) + peers: **re-run green** — combined
  **3 suites / 21 tests pass**, no regression.
- `npx tsc -p tsconfig.backend.json --noEmit` → **0 errors** in `companyIntelligence` / the new test scope.

## 8. Parity Results

N/A for U-1 (parity measurement is Phase U0). U-1 certifies the *substrate* the parity harness will use;
`validateConsumerParity`/`compareToLegacy` already exist and depend on these now-certified projections.

## 9. Performance Impact

**None** from U-1 (test-only; no production path touched). **Forward note (not a U-1 defect):** the seam
`resolveCompanyProjection` currently builds the understanding on each call — under the performance constraint
"reuse canonical understanding / no duplicate computation," U2/U3 must cache/reuse the built understanding so
projection reads add no synchronous compute or network. Tracked for U2/U3, not U-1.

## 10. Rollback Verification

No production change ⇒ nothing to roll back. The added test is additive and isolated (disjoint from the
branch's existing uncommitted work). Deleting the one test file fully reverts U-1.

## 11. Risks

| Risk | Severity | Status |
|---|---|---|
| A future projection edit sneaks in inference/AI/regex | Low | **Mitigated** — LAW-3 source-guard test fails CI on any such edit. |
| `toLegacyFields` unversioned legacy shape (O-1) | Low | Accepted — version preserved in understanding/`projectCompany`; U2 extended projection will carry version. |
| Current projection surface does **not** yet cover provider_type/operating_model/domain_role/solution_domains | Info | Out of U-1 scope — those are **U2** extensions and require their own certification when built (LAW 3 re-applied). |
| Seam builds understanding on read (perf) | Medium | Deferred to U2/U3 (reuse/cache); not a projection-purity issue. |

## 12. Certification Checklist

- [x] Every projection enumerated (projectCompany, toLegacyFields, toShadowRecord, seam).
- [x] Pure (no side effects / no module-level mutable state).
- [x] Deterministic (`projectedAt`/`builtAt` passed in; idempotent; cross-build identical).
- [x] Versioned (`projectCompany` carries version; O-1 noted for legacy shape).
- [x] No hidden inference / classification.
- [x] No AI call.
- [x] No regex classification.
- [x] No raw-evidence access.
- [x] Input not mutated.
- [x] Honest empty-state (no fabrication).
- [x] Static source-guard in place (durable enforcement).
- [x] Regression green; tsc clean; flags unchanged (default OFF).

## 13. Recommendation

All existing canonical projections satisfy LAW 3 and are now protected by an automated certification suite;
no production behavior changed; regression and type-check are green. The projection substrate is certified and
ready for the shadow-parity phase.

# ✅ READY FOR NEXT PHASE (U0 — Shadow Parity)
