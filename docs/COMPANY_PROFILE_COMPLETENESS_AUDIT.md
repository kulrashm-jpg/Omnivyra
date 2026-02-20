# Company Profile Completeness (Foundation Layer) — Audit

**Goal:** Ensure company context is complete, structured, and usable for alignment, diamond extraction, campaign intelligence, and forced context.

---

## A. Completeness Logic

### `calculateCompanyProfileCompleteness()`

| Item | Status | Notes |
|------|--------|-------|
| Exists | ✅ | `companyProfileService.ts:383` |
| Section weights | ✅ | identity 20%, brand_strategy 15%, customer_icp 15%, problem_transformation **25%**, campaign_guidance 15%, commercial 10% |
| Problem-Transformation fields | ✅ | `core_problem_statement`, `pain_symptoms`, `awareness_gap`, `problem_impact`, `life_with_problem`, `life_after_solution`, `desired_transformation`, `transformation_mechanism`, `authority_domains` |

### Strategic strength vs filled fields

| Criterion | Status | Notes |
|-----------|--------|-------|
| Reflects REAL strategic strength | ⚠️ **Partial** | `sectionScore()` uses `hasValue()` — counts any non-empty field. No semantic check (e.g. "generic" vs "specific"). `isGenericValue()` exists for filtering but is NOT used in completeness. |
| Not just filled text | ⚠️ **Partial** | Filled = `String(val).trim().length > 0` or non-empty array. No quality/confidence weighting. |

---

## B. Context Wiring Check

### `buildCompanyContext` (companyContextService.ts)

| Field | In CompanyContext | Notes |
|-------|-------------------|-------|
| `core_problem_statement` | ✅ | `problem_transformation.core_problem_statement` |
| `pain_symptoms` | ✅ | `problem_transformation.pain_symptoms` |
| `awareness_gap` | ✅ | `problem_transformation.awareness_gap` |
| `desired_transformation` | ✅ | `problem_transformation.desired_transformation` |
| `authority_domains` | ✅ | `problem_transformation.authority_domains` |
| `problem_impact` | ✅ | `problem_transformation.problem_impact` |
| `transformation_mechanism` | ✅ | `problem_transformation.transformation_mechanism` |

### Forced context builder

| Field | Forced individually | Via section |
|-------|---------------------|-------------|
| `core_problem_statement` | ✅ | `problem_transformation` |
| `pain_symptoms` | ✅ | `problem_transformation` |
| `authority_domains` | ✅ | `problem_transformation` |
| `awareness_gap` | ❌ | ✅ (via `problem_transformation` _section) |
| `desired_transformation` | ❌ | ✅ (via `problem_transformation` _section) |

### Mission context (companyMissionContext.ts)

| Derived value | Uses problem-transformation fields? | Notes |
|---------------|-------------------------------------|-------|
| `core_problem_domains` | ❌ **NO** | Uses `campaign_focus`, `content_themes`, `target_customer_segment`, `growth_priorities` — **not** `core_problem_statement`, `pain_symptoms`, `authority_domains` |
| `transformation_outcome` | ❌ **NO** | Uses `campaign_focus`, `unique_value`, `competitive_advantages` — **not** `desired_transformation` |
| `deriveDisqualifiedSignals` | ❌ **NO** | Uses `content_strategy`, `identity_safe_topics` — **not** problem-transformation fields |

### Recommendation pipeline

| Layer | `core_problem_statement` | `pain_symptoms` | `awareness_gap` | `desired_transformation` | `authority_domains` |
|-------|---------------------------|-----------------|-----------------|---------------------------|---------------------|
| `buildCoreProblemTokens` | ✅ | ❌ | ❌ | ❌ | ✅ |
| `buildWeightedAlignmentTokens` | ✅ | ❌ | ❌ | ❌ | ✅ |
| Strategy DNA modifier (scoring) | ✅ | ✅ | ❌ | ✅ | ✅ |
| `recommendationIntelligenceService` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `recommendationPolishService` | ❌ | ❌ | ❌ | ❌ | ✅ |
| `recommendationStrategyFeedbackService` | ✅ | ✅ | ❌ | ❌ | ✅ |
| **trendAlignmentService.buildProfileKeywords** | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## C. Missing Signals Audit

### Still ignored in some layers

| Field | Ignored in | Impact |
|-------|------------|--------|
| `awareness_gap` | All recommendation scoring, filtering, sequencing, intelligence | No awareness-gap–driven boost or filter |
| `pain_symptoms` | `buildCoreProblemTokens`, `buildWeightedAlignmentTokens`, `buildProfileKeywords` | Pre-filter and trend alignment do not use pain symptoms |
| `desired_transformation` | `buildCoreProblemTokens`, `buildWeightedAlignmentTokens`, `buildProfileKeywords` | Not in alignment/scoring tokens |
| `core_problem_statement` | `buildProfileKeywords` (trendAlignmentService) | Trend assessments/relevance use only themes, industry, goals, campaign_focus |
| `authority_domains` | `buildProfileKeywords` (trendAlignmentService) | Same as above |

### Mission context

- `deriveProblemDomains` and `deriveTransformationOutcome` **do not use** problem-transformation fields.
- `core_problem_domains` and `transformation_outcome` fall back to campaign_focus/content_themes/unique_value.

---

## Exit Criteria Assessment

| Criterion | Status | Notes |
|-----------|--------|-------|
| ✔ profile completion shown on dashboard | ❌ **FAIL** | `/api/company-profile` returns completeness only when `includeCompleteness=true`. Company-profile page and Dashboard do **not** pass this. No UI displays `overall_profile_completion` or `section_scores`. |
| ✔ company_context completion accurate | ✅ | `computeCompanyContextCompletion()` counts non-empty sections; aligns with `buildCompanyContext`. |
| ✔ fields available for forced context | ✅ | All problem-transformation fields in `CompanyContext.problem_transformation`; `core_problem_statement`, `pain_symptoms`, `authority_domains` individually forceable; full section via `problem_transformation`. |
| ✔ no orphan strategic fields | ⚠️ **Partial** | `awareness_gap` is in completeness, CompanyContext, forced section — but **never used** in recommendation scoring/filtering/sequencing. Effectively orphan for diamond extraction. |

---

## Recommendations

1. **Dashboard/profile completion**
   - Update company-profile page to fetch with `includeCompleteness=true` and display `overall_profile_completion` and `section_scores` (or at least `problem_transformation_completion`).

2. **Mission context wiring**
   - Extend `deriveProblemDomains` to merge `core_problem_statement`, `pain_symptoms`, `authority_domains` when present.
   - Extend `deriveTransformationOutcome` to prefer `desired_transformation` when present.

3. **Recommendation pipeline**
   - Add `pain_symptoms` and `desired_transformation` to `buildCoreProblemTokens` and `buildWeightedAlignmentTokens`.
   - Add `core_problem_statement`, `pain_symptoms`, `authority_domains`, `desired_transformation` to `trendAlignmentService.buildProfileKeywords`.

4. **Awareness gap**
   - Wire `awareness_gap` into at least one layer (e.g. strategy DNA modifier or intelligence extraction) so it is no longer orphan.

5. **Completeness quality**
   - Optionally downweight or exclude generic values (e.g. "technology", "global") in completeness scoring.
   - Consider confidence or semantic quality when computing section scores.
