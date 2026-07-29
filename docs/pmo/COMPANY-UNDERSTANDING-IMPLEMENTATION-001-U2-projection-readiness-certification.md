# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U2 Gate — Projection Readiness Certification

**Type:** Certification (NOT implementation · NOT consumer migration)
**Question:** Is the projection layer ready to project an **evidence-derived** `CompanyUnderstanding`
into the legacy surface?
**Verdict:** ✅ **READY FOR U2** (2 documented, non-blocking conditions)
**Date:** 2026-07-28 · Mode: shadow · flags OFF

---

## Scope of this certification

The evidence-derived understanding (U1, CERTIFIED) produces a canonical `CompanyUnderstanding` object.
This gate certifies the **projection layer** that turns any such object into the legacy surface —
independent of how the understanding was built. The projection is **source-agnostic**: `projectCompany`
and `toLegacyFields` read *decided facet values*, so they carry an evidence-derived understanding
identically to a profile-derived one. This is already **exercised**: U1's `runSemanticDelta` and 13/13
tests call `toLegacyFields(buildCompanyUnderstandingFromEvidence(...))` — the Omnivyra category
correction already flows through the projection surface today, in shadow.

**Legacy surface** = `LegacyCompanyFields` (via `toLegacyFields`), served through the single seam
`resolveCompanyProjection`. **Rich projection** = `CompanyProjection` (via `projectCompany`).

---

## Verification (12 invariants)

| # | Invariant | Result | Evidence |
|---|---|---|---|
| 1 | Each projected field → exactly one canonical facet | ✅ (2 notes) | mapping below; category has a legacy-compat fallback, confidence is score-derived |
| 2 | Deterministic | ✅ | pure reads; `projectedAt`/`builtAt` injected; grep: no `Date.now`/`Math.random`/`new Date` in projection.ts/persistence.ts |
| 3 | Side-effect free | ✅ | no I/O, no writes, no mutation; returns fresh objects |
| 4 | Explainable | ✅ | facet values trace to `EvidenceRef[]`+provenance; U1 `explainCompanyField` chains Field→Facet→Evidence→Policy→Value |
| 5 | Versioned | ✅ | `projection.version = u.version` (`COMPANY_MODEL_VERSION=1`); shadow record persists `version` |
| 6 | No reasoning in projection | ✅ | reads `facet.value`/`score` only; no inference |
| 7 | No evidence resolution in projection | ✅ | resolution is upstream (`fuseEvidence`); projection reads already-decided values |
| 8 | No classification in projection | ✅ | grep: no `classify`/regex/keyword ladder in projection.ts |
| 9 | No raw-evidence access in projection | ✅ | derives from `facet.value`/`facet.confidence`/`score`, never re-reads `facet.evidence[]` to compute a value |
| 10 | `resolveCompanyProjection` is the only projection entry point | ✅ | single consumer seam; `projectCompany` is the one projection fn (assembly.ts reuses it, no fork) |
| 11 | `validateConsumerParity` covers every projected field | ✅ (1 note) | covers 7/7 semantic fields; `confidence` excluded (no legacy equivalent) |
| 12 | Rollback is O(1) via flags | ✅ | `COMPANY_UNDERSTANDING_AUTHORITATIVE` default OFF ⇒ seam returns byte-identical legacy; single env flip |

---

## 1. Projection Coverage Matrix (legacy surface)

| Projected field | Present in `LegacyCompanyFields` | Populated by | Parity-checked |
|---|---|---|---|
| name | ✓ | facet | ✓ |
| domain | ✓ | facet | ✓ |
| category | ✓ | facet (+fallback) | ✓ |
| business_model | ✓ | facet | ✓ |
| products | ✓ | facet | ✓ |
| services | ✓ | facet | ✓ |
| competitors | ✓ | facet | ✓ |
| confidence | ✓ | score meta | — (no legacy source) |

**8/8 projected · 7/7 semantic fields parity-covered.**

## 2. Projection → Facet Matrix (single owner)

| Field | Owning facet | Rule | 1:1? |
|---|---|---|---|
| name | `identity` | `identity.value.name` | ✅ |
| domain | `identity` | `identity.value.domain` | ✅ |
| business_model | `worldView` | `worldView.value.businessModel` | ✅ |
| products | `offerings` | `offerings.value.products` | ✅ |
| services | `offerings` | `offerings.value.services` | ✅ |
| competitors | `competitive` | `competitive.value.competitors` | ✅ |
| category | `worldView` (owner) | `worldView.value.category ?? marketPosition.value.segment` | ⚠ owner + fallback |
| confidence | `score` | `score.confidence` | ⚠ score-derived (not a facet) |
| worldView (rich) | `worldView` | pass-through | ✅ |
| identity (rich) | `identity` | pass-through | ✅ |

## 3. Projection Explainability Matrix

| Field | Chain |
|---|---|
| category | worldView.category → EvidenceRef(ai_extraction) → `max(weight×decay)` → value |
| name/domain/products | facet → EvidenceRef(company_profile/website) → resolution → value |
| firmographics (founded/size) | facet → EvidenceRef(crunchbase/linkedin…) → resolution → value |
| confidence | score.confidence ← facet confidences ← evidence counts |

Every legacy-surface field is traceable to source evidence via `explainCompanyField` (U1).

## 4. Projection Version Matrix

| Artifact | Version source | Value |
|---|---|---|
| `CompanyProjection.version` | `u.version` | 1 |
| `CompanyUnderstandingShadowRecord.version` | `u.version` | 1 |
| Model constant | `COMPANY_MODEL_VERSION` | 1 |

Any model-shape change bumps `COMPANY_MODEL_VERSION` → propagates to every projection.

## 5. Projection Determinism Report

- Pure functions; no wall-clock, no RNG, no network, no mutation (grep-verified in projection.ts/persistence.ts).
- Timestamps are inputs (`projectedAt`, `builtAt`).
- Same understanding ⇒ identical projection (U1 determinism test asserts identical builds; projection is a pure read over them).

## 6. Consumer Compatibility Matrix

| Flag state | Seam output `source` | Fields | Behaviour |
|---|---|---|---|
| `AUTHORITATIVE=OFF` (default) | `legacy` | `legacyProjection(profile)` | byte-identical to today |
| `AUTHORITATIVE=ON` | `canonical` | `toLegacyFields(u)` in legacy shape | same shape, canonical values |

`LegacyCompanyFields` shape is identical in both branches → consumers need no code change.

## 7. Parity Coverage Matrix

| Field | `compareToLegacy` | Note |
|---|---|---|
| name, domain, category, business_model, products, services, competitors | ✅ | 7 semantic fields, `parity = agree/7` |
| confidence | — | excluded: legacy has no confidence (`legacyProjection.confidence = 0`) |

`validateConsumerParity` gates at `parity ≥ 0.999` over all 7 semantic fields.

## 8. Rollback Verification

- `isCompanyProjectionAuthoritative()` reads `COMPANY_UNDERSTANDING_AUTHORITATIVE` (default OFF).
- OFF ⇒ `resolveCompanyProjection` returns `{source:'legacy', fields: legacyProjection(profile)}` — no canonical code path executed.
- Rollback = flip one env var. **O(1)**, no deploy, no data migration, no state to unwind.

---

## Conditions carried into U2 (non-blocking)

- **C1 — `category` fallback.** `toLegacyFields` resolves `category` as `worldView.category ??
  marketPosition.segment`. `worldView` is the single **owner**; the fallback is a legacy-compat safety
  net. For evidence-derived understandings, `worldView.category` is populated directly from
  `ai_extraction` evidence, so the fallback is **dormant**. U2 must keep `worldView` the sole category
  owner (do not add a third source) and should document the fallback as intentional.
- **C2 — `confidence` parity exclusion.** `confidence` is projected but has no legacy counterpart, so it
  is (correctly) outside `compareToLegacy`. Parity therefore certifies the 7 semantic fields; `confidence`
  is a monotonic meta-signal, not a migration-risk field. Acceptable as-is.

Neither condition blocks: both are deterministic, single-precedence, reasoning-free.

---

## Migration Readiness Verdict

The projection layer is **pure, deterministic, side-effect-free, explainable, versioned, single-owner
(one projection fn + one consumer seam), and O(1)-reversible**. It performs **no reasoning, no evidence
resolution, no classification, and no raw-evidence access** — it is a source-agnostic reshape that
already carries evidence-derived understandings in U1's passing shadow tests. It is ready to project the
evidence-derived `CompanyUnderstanding` into the legacy surface under flag.

# READY FOR U2

U2 (Projection Cutover) may proceed to route `resolveCompanyProjection`'s authoritative branch through
the U1 evidence pipeline (`buildCompanyUnderstandingFromEvidence`), guarded by
`COMPANY_UNDERSTANDING_AUTHORITATIVE`, gated by `validateConsumerParity`, honoring conditions C1/C2 —
still shadow/flag-dark until parity is demonstrated. **Awaiting explicit U2 authorization; no U2
implementation has begun.**
