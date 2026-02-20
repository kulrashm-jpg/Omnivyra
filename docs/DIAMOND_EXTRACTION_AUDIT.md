# Diamond Extraction Audit

**Goal:** Verify whether recommendation ranking can detect HIGH-VALUE UNDER-SERVED opportunities (diamonds).

**Audit Date:** Feb 20, 2025  
**Scope:** Analysis only — no implementation.

---

## RANKING_FACTORS_TABLE

### recommendationEngineService (primary path)

| Factor | Source | Used when | Role |
|--------|--------|-----------|------|
| **alignment** | `buildWeightedAlignmentTokens` + `computeAlignmentScore` | OmniVyra disabled (fallback) | Primary sort: alignB vs alignA |
| **popularity** | `frequency`, `volume` | OmniVyra disabled | Tie-break: first frequency descending, then volume descending |
| **confidence** | `trend.signal_confidence` | `applyPersonaPlatformBias` only | 40% of baseScore when alignment used |
| **platform bias** | `platform_preferences` | `applyPersonaPlatformBias` | +0.15 if platform matches |
| **core problem overlap** | `buildCoreProblemTokens` | Pre-rank filtering | Binary gate: keep only if `hasOverlapWithTokens` |
| **disqualified keywords** | `deriveDisqualifiedSignals` | Pre-rank filtering | Binary gate: exclude if `containsDisqualifiedKeyword` |

**Alignment token sources (buildWeightedAlignmentTokens):**
- campaign_focus (WEIGHT_HIGH = 3)
- content_themes (WEIGHT_MEDIUM = 2)
- growth_priorities (WEIGHT_MEDIUM = 2)
- industry, goals (WEIGHT_LOW = 1)
- content_themes_list, industry_list, goals_list

**Core problem tokens (buildCoreProblemTokens):**
- campaign_focus
- content_themes
- content_themes_list

### OmniVyra path (when enabled)

| Factor | Source | Role |
|--------|--------|------|
| **relevance** | `getTrendRelevance` (external) | Filter: relevant_trends vs ignored_trends |
| **ranking** | `getTrendRanking` (external) | Order: ranked_trends |

Both receive full `profile`; internal use of specific fields is not visible (black-box).

### recommendationEngine (legacy fuse path)

| Factor | Source | Weight (policy) |
|--------|--------|-----------------|
| trend_score | volume, velocity, sentiment, consensus | trend_score |
| geo_fit | geo vs geo_focus | geo_fit |
| audience_fit | topic vs target_audience personas | audience_fit |
| category_fit | topic vs categories | category_fit |
| platform_fit | eligible platforms | platform_fit |
| health_multiplier | signal freshness/reliability | health_multiplier |
| historical_accuracy | past performance | historical_accuracy |
| effort_penalty | estimateEffort | effort_penalty |

---

## STEP 2 — PROBLEM INTELLIGENCE USAGE

| Field | used_in_filtering? | used_in_scoring? | used_in_ranking? |
|-------|-------------------|------------------|------------------|
| core_problem_statement | **NO** | **NO** | **NO** |
| pain_symptoms | **NO** | **NO** | **NO** |
| awareness_gap | **NO** | **NO** | **NO** |
| desired_transformation | **NO** | **NO** | **NO** |
| authority_domains | **NO** | **NO** | **NO** |

**Note:** `buildCoreProblemTokens` uses only `campaign_focus`, `content_themes`, `content_themes_list`. Problem-transformation fields (`core_problem_statement`, `pain_symptoms`, etc.) are never referenced in ranking logic.

---

## GENERICITY_CONTROL

| Control | Status | Location |
|---------|--------|----------|
| **Generic token blacklist** | **present** | `GENERIC_TOKEN_BLACKLIST`: tools, software, platform, strategies, tips — excluded from alignment tokens |
| **Downweight tokens** | **present** | `DOWNWEIGHT_TOKENS`: marketing, growth, tech, engagement — 0.5× weight in buildWeightedAlignmentTokens |
| **Over-saturated topic penalty** | **absent** | No penalty for topics that appear in many signals or across many companies |
| **Highly broad trend penalty** | **absent** | No penalty for very generic topics (e.g. "growth", "success") beyond downweight list |

**Verdict:** Partial genericity control — blacklist/downweight only. No saturation or breadth penalty.

---

## DIAMOND CAPABILITY

**Score: 4 / 10**

**Interpretation:** Alignment-driven with popularity tie-break. Not authority-gap-driven.

| Dimension | Assessment |
|-----------|------------|
| 0 = popularity-driven | RecommendationEngine (legacy) uses volume/velocity in trend_score; recommendationEngineService fallback uses frequency/volume as tie-break. Popularity influences but is not the primary driver. |
| 5 = alignment-driven | Primary ranking is alignment (campaign_focus, content_themes, etc.). This favours "on-brand" over "on-problem and underserved". |
| 10 = authority-gap-driven | No authority_domains, no under-saturation signal, no "gap between company authority and topic demand". |

### Where diamonds are lost

1. **Pre-filter too broad:** `buildCoreProblemTokens` uses campaign_focus/content_themes only. High-value niches that match `core_problem_statement` or `authority_domains` but not themes are filtered out.
2. **Alignment favours saturation:** Strong token overlap with themes rewards topics that many companies already cover. Underserved niches with weaker token overlap are ranked lower.
3. **Popularity tie-break favours volume:** When alignment is equal, higher volume/frequency wins. Diamonds are often lower-volume.
4. **No authority-gap signal:** `authority_domains` exists on profile but is unused. Topics where the company has authority but low competitive content are not boosted.
5. **No novelty/undersaturation boost:** `novel_theme` is only used in reasoning, not in scoring. New or under-served themes are not rewarded.

---

## DIAMOND_MULTIPLIER_POINT

**Highest-impact single improvement (no architecture refactor):**

**Add `authority_domains` to alignment tokens with WEIGHT_HIGH.**

- **Where:** Extend `buildWeightedAlignmentTokens` to include `profile.authority_domains` (and `profile.core_problem_statement` if present) with WEIGHT_HIGH.
- **Why:** These fields describe where the company can credibly speak. Matching topics get boosted without changing filtering, scoring structure, or OmniVyra integration.
- **Effect:** Topics aligned with authority_domains/core_problem rise in rank. Low-volume, high-authority topics (diamonds) gain relative to saturated, high-volume themes.
- **Scope:** One-line change in token source lists + small block to parse array/string. No new APIs, no new pipeline stages.

---

*End of audit.*
