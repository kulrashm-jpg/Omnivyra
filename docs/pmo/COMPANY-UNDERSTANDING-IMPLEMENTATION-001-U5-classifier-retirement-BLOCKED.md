# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U5 — Legacy Classifier Retirement

**Verdict:** ⛔ **IMPLEMENTATION BLOCKED**
**Date:** 2026-07-28 · Predecessors: U-1..U4 ✅
**Code changed:** **NONE** (retirement is unsafe under current preconditions — see §5).

---

## 1. Executive Summary

U5 requires retiring every legacy company-identity classifier so that **CompanyUnderstanding is the only
component that derives company identity**, with each retired classifier **replaced by**
`CompanyUnderstanding → Projection → Consumer`, and every identity field originating from **canonical
evidence or explicit abstention**.

Verification shows the replacement precondition is **not met in production**: the canonical
evidence-derived understanding is **never invoked as a producer of company identity anywhere in
production**. It runs only behind `COMPANY_UNDERSTANDING_AUTHORITATIVE` (default **OFF**, never enabled,
branch unmerged) and, even when ON, only when a consumer passes an `EvidenceSources` object — which no
production caller does. In every production path, company identity is still **produced by the legacy
classifiers** and merely **echoed** by the canonical path. Retiring the classifiers now would remove the
only identity producer and force **universal abstention** (category / business_model / operating_model /
domain_role → null for every company) — a catastrophic regression, not an ownership transfer.

Therefore U5 cannot proceed. **No classifier was retired. No code was changed.** The blocking preconditions
and the remediation path are below.

## 2. Classifier Inventory (retirement targets)

| Classifier / heuristic | Location | Live role | Sole producer of |
|---|---|---|---|
| `classifyCompanyBusiness` | `companyProfile/businessClassification.ts` (called `…Pulse.ts:504`, `…Competitors.ts:395`, `…Core.ts:414`, `…Enrich.ts`) | **WRITE-TIME producer** | `category`, `category_list`, `business_classification`, `industry`, `industry_list` |
| `inferEntityArchetype` | `companyProfile/entityArchetype.ts` (called `…Competitors.ts:348`) | write-time producer | `report_settings.entity_archetype` |
| `inferCompanyDomainShape` | `companyProfileServiceRest1Enrich.ts:429` (called `…Pulse.ts:224`) | write-time producer | `market_pulse.{provider_type, domain_role, operating_model, solution_domains}` |
| `inferBusinessModelLabel` | `companyProfileServiceRest1Enrich.ts:329` | write-time producer | `market_pulse.business_model` |
| `inferOperationalModel`, `inferBuyerMaturity` | `longForm/companyContextFoundation.ts:163,130` | read-time content heuristics (identity-adjacent) | long-form prompt operating-model/buyer-maturity |
| Lead keyword classifier (`isB2B`/`isTech`/…) | `pages/api/active-leads/context.ts:71-302` | read-time company-type derivation | source-rec platform recommendations |
| Competitor keyword ladders | `reportCompetitorIntelligenceServiceHelpers.ts:474-500` | discovery-query generation | competitor search queries |
| Competitor taxonomy default `'marketing_seo_software'` | `competitorTaxonomy.ts:88-90` | shared category normalizer default | competitor+owner category fallback |

## 3. Replacement Matrix (intended vs. actual)

| Retired classifier | Intended replacement | Actual production state | Replaceable now? |
|---|---|---|---|
| `classifyCompanyBusiness` (category/business_class.) | CompanyUnderstanding worldView.category (evidence) → projection → consumer | Canonical path **echoes** `p.category` (classifier output) via `companyFromProfile`; evidence path unwired | **NO** |
| `inferCompanyDomainShape` (operating_model/domain_role) | worldView.primaryMotion/marketPosition (evidence) | Same — seeded from `market_pulse.*` the classifier wrote | **NO** |
| `inferBusinessModelLabel` (business_model) | worldView.businessModel (evidence) | Same | **NO** |
| `inferEntityArchetype` | (no canonical equivalent modeled) | archetype not owned by CompanyUnderstanding | **NO** |
| content/lead/competitor heuristics | projected identity | projection is flag-OFF echo of the same classifiers | **NO** |

**Every replacement fails the same way:** the "replacement" (CompanyUnderstanding projection) currently
derives its identity **from the very classifier being retired**, so removal transfers nothing — it deletes
the producer.

## 4. Root-Cause Evidence

1. **Evidence-derived producer is unwired.** `grep buildCompanyUnderstandingFromEvidence|companyFromEvidence`
   → only `consumerAdapter.ts` (flag-gated seam), `evidence/buildFromEvidence.ts` (def), `evidence/delta.ts`,
   one test, and docs. **No write path / job / cron invokes it.**
2. **Flag is OFF and unset.** `grep COMPANY_UNDERSTANDING_AUTHORITATIVE` → only `flags.ts` (default OFF) +
   tests/docs. No env/config enables it; branch `feat/lead-understanding-foundation` is unmerged, flag-dark.
3. **Canonical path echoes the classifier.** `resolveCompanyProjection` (flag ON, no evidence) →
   `companyFromProfile(profile)` → `worldView = { category: p.category, businessModel: p.businessModel, … }`
   — a direct pass-through of the classifier-populated stored profile.
4. **Classifier is the live producer.** `saveProfile` (`…Pulse.ts:503-514`) calls `classifyCompanyBusiness`
   and writes `category`/`category_list`/`business_classification`/`industry` — the stored identity every
   consumer (flag OFF = production) reads.
5. **Consumers read legacy in production.** All U3 consumers overlay canonical identity **only when the flag
   is ON**; production (OFF) returns the same-reference legacy value (by design, U3).

Chain: **legacy classifier → stored profile identity → (flag OFF) consumers read stored / (flag ON,
no-evidence) canonical echoes stored.** The evidence-derived understanding is never the production source.

## 5. Why Retirement Is Blocked (completion-criteria conflict)

Retiring the classifiers now would violate the mission's own rules:

- **Replacement Rule** ("replace with CompanyUnderstanding → Projection → Consumer"): impossible — the
  projection is not an independent producer; it echoes the classifier.
- **Evidence Rule** ("every identity field must originate from canonical evidence or explicit abstention;
  never fabricate"): with no production evidence provisioning, every field would resolve to **abstention** —
  i.e. **null category/business_model/operating_model/domain_role for every company**.
- **Abstention Rule** ("if canonical understanding cannot determine … the system must abstain; retired
  classifiers must never be recreated as fallback"): canonical understanding currently **cannot determine
  any** of these in production, so this collapses to blanket abstention — identity loss, not a transition.
- **Completion criteria** ("no new behavior", "all regression suites pass", "performance unchanged"): blanket
  abstention **is** new behavior and **would fail** every consumer's production (flag-OFF) parity.

## 6. Dead Code Verification

Not applicable — the classifiers are **live and reachable** (write path), **not** dead code. Dead-code
retirement presupposes an unreferenced component; these are the actively-referenced production producers.

## 7. Preconditions to Unblock U5 (required, in order)

1. **Wire a write-time canonical identity producer.** Add a production path that fetches website / AI-
   extraction / firmographic **evidence** and calls `buildCompanyUnderstandingFromEvidence` to persist
   canonical identity (or make the projection the authoritative producer) — so identity originates from
   canonical evidence, not from `companyFromProfile` echoing the classifier. *(This is net-new wiring — it
   was never an authorized phase; U1 built the pipeline as shadow with injected inputs only.)*
2. **Flip `COMPANY_UNDERSTANDING_AUTHORITATIVE` to authoritative** for production tenants **after live parity
   validation** — a rollout step gated by `validateConsumerParity` across the live tenant base (U0/U1 proved
   parity on fixtures only).
3. **Certify live parity + approved-divergence** across production companies (not fixtures), with zero
   unexpected regressions, so the canonical identity is provably at-least-as-good as the classifier output.
4. **Merge the branch** (`feat/lead-understanding-foundation`) — U1–U4 are unmerged/flag-dark; retiring
   *live-on-main* classifiers from an unmerged branch would break production on merge.

Only when 1–4 hold does retiring the classifiers **transfer** ownership (canonical produces, classifier
removed) rather than **remove** it.

## 8. Risk Assessment

| If U5 were forced now | Impact |
|---|---|
| Delete `classifyCompanyBusiness` | `company_profiles.category`/`business_classification` unpopulated at save → every profile loses category/industry |
| Delete `inferCompanyDomainShape`/`inferBusinessModelLabel` | `market_pulse.{business_model,operating_model,domain_role,provider_type,solution_domains}` unpopulated → Market Pulse + Competitor search lose identity |
| Consumers (flag OFF) | read null identity → universal abstention → broken content grounding, competitor discovery, source-rec, market pulse |
| Rollback | NOT O(1) — data (stored identity) would already be unpopulated on every save; a code revert would not restore lost writes |

## 9. Certification Checklist

| Criterion | Status |
|---|---|
| Every legacy identity classifier retired | ❌ blocked (would remove the only producer) |
| CompanyUnderstanding is the only identity owner | ❌ not in production (flag OFF; evidence unwired; echoes classifier) |
| No identity heuristics remain | ❌ cannot remove safely yet |
| All regression suites pass | ❌ would fail (universal abstention) |
| Dead code verified | ❌ classifiers are live, not dead |
| Rollback O(1) | ❌ data loss on save is not code-revertible |
| Performance unchanged | n/a |
| No code changed this phase | ✅ (correctly — retirement withheld) |

## 10. Recommendation

**Do not retire any classifier.** U5 is blocked on a missing precondition: CompanyUnderstanding is not yet
the **live, authoritative, evidence-derived producer** of company identity — in production it still derives
identity from the classifiers it would replace. Authorize the preconditions in §7 (write-time evidence
provisioning → live parity certification → authoritative flag flip → merge) as their own phase(s). Once
canonical identity is genuinely produced in production, U5 can retire the classifiers as a true ownership
transfer, one family at a time, with dead-code proof and O(1) rollback.

# IMPLEMENTATION BLOCKED
