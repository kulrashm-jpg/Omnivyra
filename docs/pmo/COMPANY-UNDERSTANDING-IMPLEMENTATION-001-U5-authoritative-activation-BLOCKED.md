# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U5 — Authoritative Activation & Classifier Retirement

**Verdict:** ⛔ **IMPLEMENTATION BLOCKED**
**Date:** 2026-07-29 · Predecessors: U-1..U4.5 ✅
**Code changed:** **NONE** (Stage A cannot certify here; Stage B retirement is unsafe until it does).

---

## 1. Executive Summary

U5 is correctly sequenced: **Stage A** (activate canonical as the authoritative production source + certify
**live parity across production tenants**) must certify before **Stage B** (retire classifiers) may begin —
"no classifier deletion until Stage A certifies." Two hard gates block Stage A certification, and therefore
all of Stage B:

1. **Live parity certification is not executable in this environment.** Stage A requires validating parity
   **across production tenants** with the flag authoritative. This branch (`feat/lead-understanding-foundation`)
   is unmerged and flag-dark; there is no production data access, no deploy, and both flags are OFF. U4.5
   built + corpus-certified the producer, but "live parity across production tenants" is a deploy-time
   operation this environment cannot perform.
2. **The mandated interpretive-fields decision is unmade** — and it is a hard prerequisite, because the
   classifiers slated for retirement are the **sole source** of fields canonical **abstains** on. Until the
   decision (accept abstention **or** provision an approved evidence source) is made, activating authoritative
   ownership would silently null those fields, and retiring the classifiers would remove their only producer.

No classifier was retired. No authoritative write-path gating was added (it cannot be correctly defined
without the interpretive-fields decision). Both flags remain OFF.

## 2. Stage A Activation Report (mechanism ready, certification blocked)

- **Producer (U4.5):** exists and persists canonical identity to `report_settings.canonical_understanding`
  (shadow, gated `COMPANY_UNDERSTANDING_ENABLED`). `category`/`industry` are evidence-derived.
- **What Stage A still requires:** (a) make `resolveCompanyProjection` consume the **persisted canonical**
  (not `companyFromProfile`), which — without changing consumers/contracts — means the write path must write
  canonical identity into the **stored** fields when authoritative; (b) **live** parity across production
  tenants; (c) confirm legacy write-time outputs are no longer the active source.
- **Why the mechanism can't be built correctly yet:** the authoritative write-path gating **defines what the
  interpretive fields resolve to** when activated. Because canonical abstains on them, building the gating
  requires the §7 decision first. Building it either way now would either null 5 production fields (decision A,
  unauthorized) or need a new evidence source (decision B, not built).

## 3. Live Parity Report

**Not runnable here.** `runProductionParity` (U4.5) is corpus-certifiable (0 unexpected regressions) but the
mission's "live parity across production tenants" needs the production dataset + authoritative flag, i.e. a
deployed environment. Status: **pending deployment** (harness ready for CI/prod).

## 4. Ownership Transfer Matrix

| Field | Canonical produces from evidence? | Legacy still sole live producer? | Ownership transferred? |
|---|---|---|---|
| category | ✅ (AI extraction) | yes (flag OFF) | ❌ pending Stage A live activation |
| industry | ✅ (AI extraction) | yes | ❌ pending activation |
| name / domain / products / competitors | ✅ (facts) | yes | ❌ pending activation |
| business_model | ❌ **abstains** | `business_classification.level_1` (Family 1) | ❌ blocked on §7 decision |
| provider_type | ❌ abstains | `business_classification.level_2` (Family 1) / `inferCompanyDomainShape` | ❌ blocked on §7 |
| operating_model | ❌ abstains | `inferCompanyDomainShape` | ❌ blocked on §7 |
| domain_role | ❌ abstains | `inferCompanyDomainShape` | ❌ blocked on §7 |
| solution_domains | ❌ abstains | `business_classification.level_3` (Family 1) / `inferCompanyDomainShape` | ❌ blocked on §7 |
| archetype | ❌ not modeled | `inferEntityArchetype` | ❌ (no canonical equivalent — defer per mission) |

**No field has completed ownership transfer** (flag OFF; live activation not performed).

## 5. Classifier Retirement Matrix

| Family | Classifier | Retire now? | Reason |
|---|---|---|---|
| 1 | `classifyCompanyBusiness` | ❌ | Produces category/industry (evidence-owned only after Stage A live) **and** `business_classification.level_1/2/3` — the **sole source** of `market_pulse.business_model`/`provider_type`/`solution_domains` (`…Competitors.ts:700-702`). Retiring removes the interpretive-field source → blocked on §7 + Stage A. |
| 2 | `inferCompanyDomainShape` | ❌ | Sole producer of operating_model/domain_role (+ provider_type/solution_domains fallback). Canonical abstains → blocked on §7. |
| 3 | `inferBusinessModelLabel` | ❌ | Producer of business_model. Canonical abstains → blocked on §7. |
| 4 | `inferEntityArchetype` | ❌ | No canonical equivalent modeled → **defer** (mission's own condition). |
| 5 | content/lead/competitor identity heuristics | ❌ | Retire "only where canonical identity has replaced their derivation" — it has not (flag OFF). |

**Zero families retireable** under current preconditions.

## 6. Dead Code Report

None retired. All five families are **live and reachable** at the write path (Family 1 `…Pulse.ts:504` /
`…Competitors.ts:395,563`; Family 2/3 `…Enrich.ts:429,329` via `buildAiMarketPulseSettings`; Family 4
`…Competitors.ts:348`). Dead-code retirement presupposes an unreferenced component — none qualifies.

## 7. Abstention Report — the required decision (BLOCKING, user's call)

Per the mission's **Interpretive Fields** rule, each field needs an explicit decision **before retirement**:

| Field | Legacy source | Canonical | Decision A (accept abstention) | Decision B (new evidence source) |
|---|---|---|---|---|
| business_model | `business_classification.level_1` | abstains | Market Pulse + Competitor lose business_model (null) | extend AI extraction / firmographics to yield it |
| operating_model | `inferCompanyDomainShape` | abstains | Market Pulse prompt + competitor search lose operating_model | new evidence source |
| domain_role | `inferCompanyDomainShape` | abstains | competitor domain-signal weakened | new evidence source |
| provider_type | `level_2` / `inferCompanyDomainShape` | abstains | competitor classification weakened | new evidence source |
| solution_domains | `level_3` / `inferCompanyDomainShape` | abstains | Market Pulse + competitor lose solution_domains | new evidence source |

- **Decision A (accept abstention):** compliant with the Evidence Rule ("unknown remains unknown"), but these
  5 fields become **null in production** — a real downstream reduction for Market Pulse & Competitor. This is
  a product judgment the platform owner must make.
- **Decision B (provision evidence):** requires a NEW approved evidence source (extended AI extraction that
  infers operating/domain/provider from grounded website evidence, or a firmographics provider) — net-new
  work, and "no heuristic recreation is permitted."

**This decision has not been made.** It cannot be inferred from code and is not the engineer's to make
unilaterally (it changes production behavior). It is a hard prerequisite for Stage A (authoritative gating)
and Stage B Families 1–3.

## 8. Tests Added

**None** — no safe code change exists this phase (retirement unsafe; activation gating undefined without §7).

## 9. Performance Report

Unchanged (no code touched).

## 10. Risk Assessment

| If U5 were forced now | Impact |
|---|---|
| Activate authoritative (write canonical into stored fields) | 5 interpretive fields → null in production (Market Pulse / Competitor degraded) — unauthorized behavior change |
| Retire Family 1 | removes `business_classification` → business_model/provider_type/solution_domains lose their source |
| Retire Family 2/3 | operating_model/domain_role/business_model unproduced → abstain everywhere |
| Any retirement, flag OFF/unmerged | canonical not the live owner → identity collapse on deploy |
| Rollback | not O(1) for data — activated writes / removed classifiers can't be value-restored by a code revert |

## 11. Certification Checklist

| Criterion | Status |
|---|---|
| Canonical identity is the live production owner | ❌ flag OFF; live activation not performed (env gate) |
| All retired families transferred ownership | ❌ none retired |
| No retired classifier remains callable | ❌ all live |
| Projection reads canonical persistence | ❌ needs authoritative gating (blocked on §7) |
| Live parity across production tenants | ❌ not executable here (deploy gate) |
| Interpretive-fields decision made | ❌ pending (user) |
| Rollback O(1) | n/a |
| No code changed this phase | ✅ (correctly — activation/retirement withheld) |

## 12. Recommendation

**Do not activate authoritatively or retire any classifier yet.** Two gates must clear first, in order:

1. **Make the interpretive-fields decision (§7)** — A (accept abstention, per-field) or B (approve a specific
   new evidence source and build it). This is the platform owner's call; it defines what authoritative
   activation does to `business_model`/`operating_model`/`domain_role`/`provider_type`/`solution_domains`.
2. **Execute Stage A at deploy:** build the authoritative write-path gating (per the §7 decision), merge the
   branch, roll `COMPANY_UNDERSTANDING_ENABLED` → shadow-observe, run `runProductionParity` **live**, then
   flip `COMPANY_UNDERSTANDING_AUTHORITATIVE` per-tenant (O(1)) once live parity certifies with zero
   unexpected regressions.

Only after Stage A certifies live does Stage B retire classifiers, one family at a time, as a true ownership
transfer. Until then, retirement removes ownership rather than transferring it.

**Immediate ask of the platform owner:** the §7 interpretive-fields decision (A or B, per field). With that,
the Stage A activation code becomes buildable; live parity + flag flip remain the deploy operation.

# IMPLEMENTATION BLOCKED
