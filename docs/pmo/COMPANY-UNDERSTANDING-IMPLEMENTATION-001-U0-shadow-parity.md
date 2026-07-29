# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U0 — Shadow Parity Report

**Engineer:** Principal Platform Engineer · **Phase:** U0 (Shadow Parity) · **Date:** 2026-07-28
**Scope:** Implement the parity harness; run canonical CompanyUnderstanding in **shadow** over a
representative corpus; produce the Delta Report. **Do not affect production.**

---

## 1. Executive Summary

The shadow parity harness `runCompanyShadowParity` is implemented as a **pure, deterministic, offline
analysis** function that reuses the certified shadow machinery (`companyFromProfile` →
`buildCompanyUnderstanding` → `compareToLegacy`) and is **wired to nothing in production** (imported only by
its test). Run over a 5-company corpus (Omnivyra reconstructed from the failing production profile + four
archetypes), **overall parity is 1.0 (100%)** and **every field matches** — the canonical understanding
faithfully **round-trips** the legacy profile, proving **adoption is byte-safe** and the cutover is
reversible. The report also surfaces the **load-bearing sequencing finding**: because the canonical
understanding is currently built by *adopting the already-classified legacy profile* (`worldView` is a direct
pass-through of the profile fields), U0 **cannot and does not correct Omnivyra** — the semantic fix is a **U1
gate** (feed raw evidence, not the pre-classified profile). **U0 is complete; zero production change.**

## 2. Architecture Compliance

| Law | Result |
|---|---|
| **LAW 8 backward compat / flag OFF = byte-identical** | ✅ No production path touched; flags unchanged (default OFF); harness dormant unless called by the test. |
| **LAW 3 (harness contains no derivation)** | ✅ The harness only *measures* — it reuses `compareToLegacy`; no classification/AI/regex/raw-evidence in it. |
| **LAW 1/2 single owner** | ✅ The harness derives nothing; it builds the understanding via the sole owner and compares. |
| **Determinism** | ✅ Uses each profile's `asOf` (no `Date.now`); two runs produce identical reports; input not mutated. |
| **Zero production impact** | ✅ Grep confirms `shadowParityHarness` is imported only by `companyShadowParity.test.ts` — no consumer, no request path. |

## 3. Files Modified

- **Added (analysis + test, non-production):**
  - `backend/services/companyIntelligence/shadowParityHarness.ts` — pure parity harness (unwired).
  - `backend/tests/unit/companyShadowParity.test.ts` — corpus + parity assertions.
- **Production request paths / consumers modified:** **none.**

## 4. Implementation Details

`runCompanyShadowParity(profiles)` → for each legacy profile builds the canonical understanding
(`companyFromProfile`→`buildCompanyUnderstanding`) and calls the certified `compareToLegacy`, then aggregates:
per-company parity + divergences, per-field parity rates, overall parity, full-match/divergence counts. Pure
and deterministic (no clock, no flag dependency — it is offline analysis, not the flag-gated production
`computeCompanyUnderstandingShadow`). The corpus reconstructs **Omnivyra** verbatim from the production
screenshots (category `"Analytics software for clearer performance insights"`, the marketing/SEO/campaign/
content products, **empty competitors**) plus a BI company, a marketing agency, a SaaS, and a services firm.

## 5. Feature Flags

Unchanged. `COMPANY_UNDERSTANDING_ENABLED` / `COMPANY_UNDERSTANDING_AUTHORITATIVE` remain **default OFF**. U0
is flag-independent (the harness is offline analysis); production shadow computation
(`computeCompanyUnderstandingShadow`) still returns `null` when the flag is OFF.

## 6. Tests Added

`backend/tests/unit/companyShadowParity.test.ts` — **3 tests**: overall + per-field parity = 1.0 across the
corpus; Omnivyra adopts the legacy category verbatim (no divergence — the U1 gate); determinism + input-not-
mutated.

## 7. Regression Results

- U0 suite: **3/3 pass.**
- Combined canonical suites (`companyShadowParity` + `companyProjectionCertification` + `companyUnderstanding`
  + peer): **4 suites / 24 tests pass**, no regression.
- `tsc -p tsconfig.backend.json --noEmit` → **0 errors** in the harness / companyIntelligence scope.

## 8. Parity Results — DELTA REPORT

**Corpus:** Omnivyra (production fixture #1) + `bi-co` + `agency` + `saas` + `services` (5 companies).

**Overall parity: `1.0` (100%). Full matches: 5/5. Divergences: 0.**

| Field | Parity rate | Notes |
|---|---|---|
| name | 1.0 | pass-through |
| domain | 1.0 | pass-through |
| category | 1.0 | `worldView.category` = profile.category (adopted) |
| business_model | 1.0 | `worldView.businessModel` = profile.businessModel (no normalization) |
| products | 1.0 | `offerings.products` = profile.products |
| services | 1.0 | `offerings.services` = profile.services |
| competitors | 1.0 | `competitive.competitors` = profile.competitors |

- **Per-company parity:** omnivyra 1.0 · bi-co 1.0 · agency 1.0 · saas 1.0 · services 1.0.
- **Semantic differences:** **none at U0.** The canonical understanding reproduces the legacy profile exactly.
- **Approved semantic improvements:** **none yet** — deferred to U1 (see finding below).
- **Unexpected regressions:** **none.**

**Omnivyra delta:** `category` canonical = legacy = `"Analytics software for clearer performance insights"`;
`competitors` canonical = legacy = `[]`. Parity 1.0 — the canonical currently **adopts** the wrong legacy
value rather than correcting it.

### Load-bearing finding (sequencing)

Parity is 1.0 **because the canonical understanding is currently built from the already-classified legacy
profile** — `companyFromProfile` maps profile fields straight into facets and `worldView` is a direct
pass-through (verified: `fromProfile.ts:60`). Therefore:

- **U0 certifies ADOPTION SAFETY** — canonical == legacy across the corpus ⇒ cutting projections over to the
  canonical path is byte-safe and O(1) reversible (LAW 8 satisfied).
- **U0 does NOT correct Omnivyra, by design.** The wrong category/empty competitors persist because the
  understanding is fed the legacy output, not raw evidence. The semantic correction is a **U1 gate**: when
  raw evidence (website crawl + AI extraction + firmographics) replaces the pre-classified profile as the
  understanding's input, canonical will *diverge* from legacy — and those divergences become the **approved
  semantic improvements** measured in the U1/U0-re-run delta.

This is the correct, expected U0 outcome and confirms the migration is properly sequenced.

## 9. Performance Impact

None. The harness is offline analysis (test/CI only), not a request path. No synchronous network calls, no
added latency, no duplicate computation in production. (The seam's build-on-read performance item remains
tracked for U2/U3.)

## 10. Rollback Verification

No production change ⇒ nothing to roll back. Both added files are additive and isolated (disjoint from the
branch's existing uncommitted work). Deleting the two files fully reverts U0. Flags untouched.

## 11. Risks

| Risk | Severity | Status |
|---|---|---|
| Misreading U0's 1.0 parity as "Omnivyra fixed" | Medium | **Documented** — U0 proves adoption safety only; the fix is the U1 gate (finding §8). |
| Corpus not representative of production distribution | Low–Med | U0 uses a small archetype corpus + the real Omnivyra profile; **U1** should run over a larger real-profile sample before any authoritative flip. |
| Harness accidentally wired into a request path later | Low | Grep-verified unwired now; U6 invariant enforcement will guard bypass. |

## 12. Certification Checklist

- [x] Parity harness implemented (pure, deterministic).
- [x] Runs canonical in shadow; measures per-field + per-company + overall parity.
- [x] Delta Report produced (per-field parity, semantic differences, approved improvements, regressions).
- [x] Omnivyra fixture included and characterized.
- [x] Zero production impact (harness unwired; flags OFF; no request path).
- [x] Deterministic; input not mutated.
- [x] Regression green; tsc clean.
- [x] Sequencing finding documented (U1 gate for semantic correction).

## 13. Recommendation

The parity harness is implemented and the Delta Report shows **1.0 parity across the corpus** — adoption is
byte-safe and reversible — with the semantic correction correctly deferred to **U1 Evidence Unification**. No
production behavior changed; regression and type-check are green.

# ✅ READY FOR NEXT PHASE (U1 — Evidence Unification)
