# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 6 — Visitor Intelligence

**Status:** ✅ **READY FOR NEXT CONSUMER**
**Classification:** **B — Reference-only.** Adoption is a **verified no-op**.
**Date:** 2026-07-28 · Predecessors: U-1..U2 ✅ · U3·C1–C5 ✅

---

## 1. Executive Summary

Visitor Intelligence (the canonical `backend/services/visitorIntelligence/` Understanding — Program 5) is
**reference-only**: it partitions by `companyId` and references the visitor's company via `companyRef` (a
references-only FK/edge), and **never reads owner-company identity** (category, industry, business_model,
operating_model, domain_role, provider_type, solution_domains, market_position, firmographics,
report_settings). It fetches no profile, builds no LLM prompt, and re-derives no identity — visitor segments
derive from **visitor behavior only**. There is **nothing to route through `resolveCompanyProjection`**. No
production code was changed; a static boundary **guard test** (19/19) certifies and protects the invariant.

## 2. Consumer Classification

**B — Reference-only Consumer.** Every company touchpoint is a key/FK:
`VisitorIdentityKey{companyId,visitorId}` (partition key), `companyRef?` (nullable FK on the identity
facet), and a `belongs_to → company` references-only edge. `crossUnderstanding.ts` treats `company` as an
`EXTERNAL_OWNER` that may appear only as an edge target — the module structurally enforces reference-only.
There are **zero** product visitor-analytics/segmentation services, `pages/api/**visitor*` routes, or
`components/**Visitor*`.

## 3. Inventory Report

| Field | Read by Visitor? |
|---|---|
| category / industry / business_model / operating_model / domain_role / provider_type / solution_domains / market_position / firmographics / narrative | **no** (owner identity never read) |
| CompanyProfile / report_settings / company_profiles / getProfile / getCanonicalProfile / resolveCompanyProjection | **no** (0 matches) |
| `companyId` / `companyRef` | reference key / FK only |

Independent verification (this session): `grep -i` over `backend/services/visitorIntelligence/` for
`resolveCompanyProjection|getCanonicalProfile|getProfile|company_profiles|report_settings|CompanyProfile|business_model|operating_model|domain_role|provider_type|solution_domains|classifyCompanyBusiness|inferEntityArchetype|inferCompanyDomainShape`
→ **0 matches across 0 files**.

**Owner vs visitor distinction:** `behavioral.ts` `interactionCategories`/`categoryDiversity` is the
*visitor's own* interaction breadth (visitor data), not the owner company's `category`. No reverse-IP
firmographic enrichment field is set at all.

## 4. Duplicate Reasoning Audit

None. No visitor segmentation from company category, no industry/business-model/company-type inference, no
taxonomy repair, no behavior-based identity inference, no prompt-time classification, no heuristic override.
The only classifier (`healthSummary.ts`) is a deterministic threshold over the *visitor's* health, not
company identity. `contract.ts` `VISITOR_MIGRATION_PROHIBITIONS` forbids re-owning other entities' semantics.
Nothing to remove; nothing to document for U5.

## 5. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/tests/unit/visitorIdentityIsolation.test.ts` | NEW | Boundary guard (19 assertions) — no owner-identity read / fetch / classifier / prompt |

**Zero production files changed.** No shared infrastructure touched. No `visitorIntelligence/*` file is in
the working-tree diff (no tangling with concurrent work).

## 6. Reference Certification (not migration)

Not applicable to migrate — no identity acquisition exists. Correct integration = **no integration**,
verified. Visitor builds behavioral understanding and references CompanyUnderstanding's owner by reference;
it never redefines company identity. **Segmentation Integrity:** segments are derived from visitor behavior
and never modify/repair/replace/infer company identity (guard-enforced).

## 7. Tests Added (verification-based; all required types covered)

Consumer Classification / Inventory (module exists/scanned) · Identity Audit (13 forbidden owner-identity
signals) · Reference-only + Segmentation Integrity (`companyRef`/`companyId` present, no identity read) ·
Prompt Integrity (no LLM client / gateway / prompt builder) · Output Parity / Approved Improvement /
Unexpected Regression / Rollback (vacuous — no identity path can diverge, regress, or need rollback under any
flag value). **19/19 pass.** Prior C1–C5/U2 suites unaffected (no shared code changed).

## 8. Performance Report

No identity acquisition ⇒ zero added network/AI/classification/evidence work in Visitor under any flag. The
guard is static file analysis.

## 9. Rollback Verification

`COMPANY_UNDERSTANDING_AUTHORITATIVE` has **no effect** on Visitor Intelligence output (no identity code
path) — byte-identical under every flag value. Rollback trivial / not required.

## 10. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Future drift: Visitor starts reading owner identity | Guard fails the build on any owner-identity read/fetch/classifier/prompt | None |
| False positive on visitor terms (interactionCategories) | Guard targets owner-identity-specific tokens + fetch/classifier signals only | None |
| Misidentifying the consumer | Verified: only the canonical module exists; no product analytics/segmentation service | None |
| Unnecessary churn | No production change | None |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Architectural role proven (reference-only) | ✅ |
| Identity flows exclusively through `resolveCompanyProjection` | ✅ vacuous — reads no identity |
| No duplicate identity reasoning | ✅ none exists |
| Segments never modify/repair/infer company identity | ✅ guard-enforced |
| No prompt asks the LLM to infer identity | ✅ no prompts at all |
| Consumer isolation preserved | ✅ no shared code changed |
| Rollback verified | ✅ flag-independent |
| Performance maintained | ✅ no added work |
| Tests pass | ✅ 19/19; tsc unaffected |

## 12. Recommendation

Visitor Intelligence already honors the target architecture — it references CompanyUnderstanding rather than
reinterpreting company identity — so Consumer 6 is certified with a guard that keeps it that way, and **no
migration was needed or performed**. Proceed to **Consumer 7 (Execution Intelligence)** — individually, next.

# READY FOR NEXT CONSUMER

*No Consumer-7 work has begun; awaiting authorization (one-consumer-at-a-time).*
