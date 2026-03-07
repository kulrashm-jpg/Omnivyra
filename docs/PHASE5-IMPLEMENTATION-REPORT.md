# Phase 5 — Intelligence Learning Layer Implementation Report

**Date:** 2025-03-06  
**Scope:** Learning and reinforcement from outcomes and feedback.

---

## 1. Learning Architecture After Phase 5

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         INTELLIGENCE LEARNING LAYER (Phase 5)                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Flow: signals → opportunities → recommendations → user/company actions               │
│        → outcome tracking → learning engine → reinforcement scoring                   │
│        → improved intelligence                                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                       │
│  outcomeTrackingEngine              recommendationFeedbackEngine                      │
│  • recordOutcome()                  • recordFeedback()                                │
│  • getOutcomeHistory()               • getFeedbackForCompany()                         │
│  • Types: content_published,         • Types: accepted, ignored, executed,             │
│    campaign_created, feature_built,   successful, failed                              │
│    competitive_response, market_entry • Throttle: 1 per rec per user per hour         │
│  • ON CONFLICT DO NOTHING            • Scores: 0.2–1.0                                │
│       │                                      │                                        │
│       └──────────────────┬───────────────────┘                                        │
│                          ▼                                                            │
│  intelligenceLearningEngine         themeReinforcementEngine                          │
│  • computeLearningAdjustments()     • computeThemeReinforcement()                     │
│  • computeLearningForCompany()      • persistThemeReinforcement()                     │
│  • applyAdjustment()                 • Bounds: [-0.25, +0.25]                          │
│  • Batch: 100, max 15 min           • Output: updated_theme_strength                  │
│  • Bounds: adjustment [-0.25, +0.25]                                                   │
│  • Scores: [0, 1]                                                                     │
│                          │                                                            │
│                          ▼                                                            │
│  learningOrchestrationService                                                         │
│  • getOutcomesForCompany()                                                            │
│  • getLearningForCompany()                                                            │
│                          │                                                            │
│                          ▼                                                            │
│  /api/intelligence/outcomes   /api/intelligence/feedback   /api/intelligence/learning │
│  /api/intelligence/recommendations/record                                               │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Files Created

| File | Purpose |
|------|---------|
| `database/intelligence_recommendations.sql` | Persisted recommendations for outcome/feedback linking |
| `database/intelligence_outcomes.sql` | Outcome records with duplication protection |
| `database/recommendation_feedback.sql` | Feedback records with throttle-supporting indexes |
| `database/strategic_memory_deduplication.sql` | Uniqueness constraint for strategic memory |
| `backend/services/outcomeTrackingEngine.ts` | Records and retrieves outcome history |
| `backend/services/recommendationFeedbackEngine.ts` | Records feedback with 1-per-hour throttle |
| `backend/services/intelligenceLearningEngine.ts` | Computes learning adjustments from outcomes/feedback |
| `backend/services/themeReinforcementEngine.ts` | Reinforces or weakens theme strengths |
| `backend/services/recommendationPersistenceService.ts` | Persists recommendations and returns IDs |
| `backend/services/learningOrchestrationService.ts` | Orchestrates outcomes, learning, reinforcement |
| `pages/api/intelligence/outcomes.ts` | GET/POST outcomes |
| `pages/api/intelligence/feedback.ts` | GET/POST feedback |
| `pages/api/intelligence/learning.ts` | GET learning adjustments and theme reinforcement |
| `pages/api/intelligence/recommendations/index.ts` | GET recommendations (moved from recommendations.ts) |
| `pages/api/intelligence/recommendations/record.ts` | POST to persist recommendation and return ID |

---

## 3. Files Modified

| File | Change |
|------|--------|
| `backend/services/strategicIntelligenceMemoryService.ts` | Phase 5: upsert with `onConflict: company_id,theme_id_effective,memory_type` when `theme_id` is set (deduplication) |
| `pages/api/intelligence/recommendations.ts` | **Removed** — logic moved to `recommendations/index.ts` to support `recommendations/record` sub-route |

---

## 4. Database Migrations

### Run Order

1. `intelligence_recommendations.sql` — must exist first  
2. `intelligence_outcomes.sql` — references `intelligence_recommendations(id)`  
3. `recommendation_feedback.sql` — references `intelligence_recommendations(id)`  
4. `strategic_memory_deduplication.sql` — run after `strategic_memory` exists  

### intelligence_recommendations

```sql
CREATE TABLE IF NOT EXISTS intelligence_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_type TEXT NOT NULL,
  action_summary TEXT NULL,
  supporting_signals JSONB DEFAULT '[]'::jsonb,
  confidence_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Indexes: (company_id), (company_id, created_at DESC)
```

### intelligence_outcomes

```sql
CREATE TABLE IF NOT EXISTS intelligence_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_id UUID NULL REFERENCES intelligence_recommendations(id) ON DELETE SET NULL,
  outcome_type TEXT NOT NULL,
  success_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- UNIQUE (company_id, recommendation_id, outcome_type) — Outcome Duplication Protection
-- Indexes: (company_id), (recommendation_id), (company_id, created_at DESC)
```

### recommendation_feedback

```sql
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recommendation_id UUID NOT NULL REFERENCES intelligence_recommendations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  feedback_score NUMERIC NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Index: (recommendation_id, user_id, date_trunc('hour', created_at)) — Throttle support
```

### strategic_memory_deduplication

Adds `theme_id_effective` (GENERATED) and `UNIQUE (company_id, theme_id_effective, memory_type)` to prevent strategic memory inflation.

---

## 5. Outcome Tracking Logic

- **recordOutcome():** Inserts outcome; when `recommendation_id` is present, uses upsert with `ON CONFLICT DO NOTHING` on `(company_id, recommendation_id, outcome_type)`.
- **Outcome types:** `content_published`, `campaign_created`, `feature_built`, `competitive_response`, `market_entry`.
- **success_score:** Bounded [0, 1].
- **getOutcomeHistory():** Returns latest outcomes for a company, ordered by `created_at` DESC.

---

## 6. Recommendation Feedback Logic

- **recordFeedback():** Checks for recent feedback in the last hour for `(recommendation_id, user_id)`; if found, returns `throttle_hit: true` without inserting.
- **Feedback types:** `accepted` (0.7), `ignored` (0.2), `executed` (0.8), `successful` (1), `failed` (0.3).
- **feedback_score:** Default by type or explicit; clamped [0, 1].

---

## 7. Learning Algorithm

- **Batched:** Processes up to 100 outcomes and 100 feedback rows.
- **Raw adjustment:** `(avgOutcomeSuccess - 0.5) * 0.3 + (avgFeedback - 0.5) * 0.2`
- **Clamped:** [-0.25, +0.25]
- **Outputs:**
  - `learning_adjustment_score`: main adjustment
  - `updated_confidence`: base 0.5 + adjustment, clamped [0, 1]
  - `signal_relevance_adjustment`, `opportunity_score_adjustment`, `recommendation_confidence_adjustment`, `theme_strength_adjustment`: derived adjustments (same bounds)

---

## 8. Theme Reinforcement Logic

- **Factors:** Outcome success rate, feedback rate across company.
- **Raw reinforcement:** `(outcomeRate - 0.5) * 0.4 + (feedbackRate - 0.5) * 0.3`
- **Clamped:** [-0.25, +0.25]
- **Output:** `updated_theme_strength` per theme (current + reinforcement), clamped [0, 1].
- **persistThemeReinforcement():** Optional write to `company_strategic_themes.theme_strength`.

---

## 9. API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/intelligence/outcomes` | GET | Outcome history (`?companyId`, `?limit`) |
| `/api/intelligence/outcomes` | POST | Record outcome (`recommendation_id?`, `outcome_type`, `success_score`) |
| `/api/intelligence/feedback` | GET | Feedback history (`?companyId`, `?limit`) |
| `/api/intelligence/feedback` | POST | Record feedback (`recommendation_id`, `feedback_type`, requires `user_id`) |
| `/api/intelligence/learning` | GET | Learning adjustments and theme reinforcement (`?companyId`) |
| `/api/intelligence/recommendations` | GET | Recommendations (unchanged) |
| `/api/intelligence/recommendations/record` | POST | Persist recommendation, return `id` for outcome/feedback use |

---

## 10. Architecture Safeguards

| Safeguard | Implementation |
|-----------|-----------------|
| **Strategic memory deduplication** | `UNIQUE (company_id, theme_id_effective, memory_type)`; upsert with `ON CONFLICT` when `theme_id` set |
| **Learning loop protection** | Adjustment range [-0.25, +0.25]; scores kept in [0, 1] |
| **Outcome duplication protection** | `UNIQUE (company_id, recommendation_id, outcome_type)`; upsert with `ignoreDuplicates: true` when `recommendation_id` present |
| **Feedback spam protection** | 1 feedback per `(recommendation_id, user_id)` per hour; throttle returns `throttle_hit: true` |
| **Learning computation guard** | `BATCH_SIZE = 100`; `MAX_LEARNING_FREQUENCY_MS = 15 min`; processing by batch only |

---

## 11. Performance Considerations

| Component | Notes |
|-----------|-------|
| Outcome recording | Insert or upsert; single row per call |
| Feedback recording | Throttle check (1 query) + insert |
| Learning computation | 2 queries (outcomes, feedback) + in-memory computation; batch limited to 100 |
| Theme reinforcement | 3 queries (themes, outcomes, feedback) + per-theme computation |
| Persist reinforcement | Optional; one update per theme |

---

## 12. Compatibility Verification

- **signalClusterEngine, signalIntelligenceEngine, companyIntelligenceEngine, strategicThemesEngine:** Unchanged; Phase 5 is additive.
- **opportunityDetectionEngine, strategicRecommendationEngine:** Unchanged; Phase 5 consumes their output.
- **strategicIntelligenceMemoryService:** Extended for Phase 5 deduplication; existing callers unaffected.

Phase 5 adds new services and tables; no existing engines were modified.
