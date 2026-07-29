# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 4 — Journey Intelligence

**Status:** ✅ **READY FOR NEXT CONSUMER**
**Outcome:** Adoption is a **verified no-op** — Journey Intelligence consumes no company identity.
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3·C1/C2/C3 ✅

---

## 1. Executive Summary

Journey Intelligence (the canonical `backend/services/journeyIntelligence/` Understanding — the 5th
canonical entity, flag-dark/shadow, owning temporal PROGRESSION) is **references-only**: it references
Company by `companyRef`/`companyId` and **never reads legacy company identity** (category, business_model,
operating_model, domain_role, industry, ICP, positioning), never fetches a profile, never classifies, and
constructs **no LLM prompt**. Therefore there is **nothing to route through `resolveCompanyProjection`** —
the completion criteria are satisfied *by construction*. No production code was changed. A static
source-contract **guard test** (17/17) certifies and protects the invariant so Journey can never begin
reinterpreting company identity.

## 2. Inventory Report

| Field to check | Where Journey reads it | Result |
|---|---|---|
| category / business_model / operating_model / domain_role / industry / ICP / positioning / narrative | — | **not read anywhere** (grep: 0 matches across the module) |
| CompanyProfile / getProfile / getCanonicalProfile / resolveCompanyProjection | — | **not imported** (0 matches) |
| Company reference | `fromRaw.ts` `companyRef` / `companyId` (reference edge `belongs_to → company`) | reference-only (key/ref, no field read) |

The product-facing journey features (report-journey orchestrator, lead-attribution customer journey,
onboarding journey) read scan/report/attribution/onboarding **state**, not company identity — and are
distinct features, not "Journey Intelligence."

Independent verification (this session): `grep -i` over `backend/services/journeyIntelligence/` for
`category|business_model|operating_model|domain_role|ideal_customer|report_settings|CompanyProfile|getProfile|getCanonicalProfile|resolveCompanyProjection|.industry` → **0 matches across 0 files**.

## 3. Duplicate Reasoning Audit

None. The canonical module is descriptive progression only ("no prediction, no intent"). No journey/persona
classification from company category, no business-model/operating-model repair, no industry/company-type
inference, no prompt-time or post-processing classification, no heuristic identity override. (The unrelated
`classifyAudienceJourney` in `lib/creator-templates/audienceJourney.ts` derives an audience awareness stage
from content strategy — not company identity — and is outside Journey Intelligence.) Nothing to remove;
nothing to document for U5.

## 4. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/tests/unit/journeyIdentityIsolation.test.ts` | NEW | Source-contract guard (17 assertions) enforcing references-only / no-identity-read |

**Zero production files changed.** No shared infrastructure touched. No `journeyIntelligence/*` file is in
the working tree diff (no tangling with concurrent work).

## 5. Projection Integration

Not applicable — there is no identity acquisition to route through the seam. Adopting the projection here
would require **inventing** an identity read that does not (and should not) exist; doing so would violate
the Journey references-only contract. Correct integration = **no integration**, verified.

## 6. Journey Context Mapping

| Journey input | Source | Company identity? |
|---|---|---|
| touchpoints / progression | `JourneyRawInput` (passed in) | no |
| `companyRef` / `companyId` | reference key on the input | reference only (no field read) |
| actor / lead / offering | references | reference only |

Journey builds customer-journey **progression**; it references company identity's owner (CompanyUnderstanding)
by reference and never redefines it — exactly the required behavior.

## 7. Tests Added (verification-based; all required types covered)

Inventory (module exists/scanned) · Consumer Isolation (11 forbidden-identity-read guards) · Projection
Integration / Journey Context (references-only: `companyRef` present, no identity read) · Prompt Integrity /
Narrative Integrity (no LLM client / gateway / prompt builder) · Output Parity / Approved Improvement /
Unexpected Regression / Rollback (vacuous — no identity path can diverge, regress, or need rollback under
any flag value). **17/17 pass.** Regression: prior C1/C2/C3/U2 suites unaffected (no shared code changed).

## 8. Performance Report

No identity acquisition ⇒ zero added network/AI/classification/evidence work in Journey under any flag. The
guard test is static file analysis (no runtime coupling).

## 9. Rollback Verification

`COMPANY_UNDERSTANDING_AUTHORITATIVE` has **no effect** on Journey Intelligence output (no identity code
path exists) — Journey is byte-identical under every flag value. Rollback is trivially O(1) / not required.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Future drift: Journey starts reading company identity | Guard test fails the build if any forbidden identity read/import/prompt is added | None |
| Misidentifying the consumer | Verified the canonical module + product journey features independently; none reads identity | None |
| Unnecessary code churn | No production change made | None |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Identity flows exclusively through `resolveCompanyProjection` | ✅ vacuous — Journey reads no identity |
| No duplicate identity reasoning remains | ✅ none exists |
| Journey generation does not reinterpret identity | ✅ references-only; guard-enforced |
| No prompt asks the LLM to infer identity | ✅ no prompts at all |
| Consumer isolation preserved | ✅ no shared code changed |
| Rollback verified | ✅ flag-independent |
| Performance maintained | ✅ no added work |
| Tests pass | ✅ 17/17; tsc unaffected |

## 12. Recommendation

Journey Intelligence already honors the target architecture — it references CompanyUnderstanding rather than
reinterpreting company identity — so Consumer 4 is certified with a guard that keeps it that way, and **no
migration was needed or performed**. Proceed to **Consumer 5 (Lead Intelligence)** — individually, next.

# READY FOR NEXT CONSUMER

*No Consumer-5 work has begun; awaiting authorization (one-consumer-at-a-time).*
