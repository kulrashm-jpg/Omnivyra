# Campaign Recommendations Extension – Spec

**Migration required:** Run `database/campaign_recommendation_weeks.sql` in Supabase SQL Editor before using.

## Concept

**Expert consultation to improve what we have.** Not blueprint creation. A dedicated flow where an AI "consultant" reviews the campaign's current plan, suggests improvements (topics, objectives, scheduling, platform×content mix), and—after the user vets and refines via chat—merges agreed changes into the weekly plans.

---

## Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Campaign Recommendations Page  │  /campaigns/[id]/recommendations           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. GENERATE (on-demand)                                                     │
│     User clicks "Generate Recommendations"                                   │
│     → Stage-aware suggestions: topics, objectives, scheduling, platform mix  │
│                                                                             │
│  2. EXPERT CONSULTATION (AI chat)                                            │
│     Chat opens with suggestions in context                                  │
│     → User asks questions, requests changes, prioritizes                    │
│     → AI helps vet, refine, propose alternatives until user agrees           │
│                                                                             │
│  3. MERGE                                                                   │
│     User confirms → agreed refinements merged into weekly plans              │
│     → twelve_week_plan / weekly_content_refinements updated                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Stage-Aware Suggestions

| Stage | Focus of recommendations |
|-------|--------------------------|
| planning | Topic ideas, themes, objectives, audience angles |
| twelve_week_plan | Per-week topic refinements, platform mix, new topics |
| daily_plan | Daily hooks, CTAs, cadence, timing |
| charting | Platform × content type matrix, reuse opportunities |
| schedule | Posting times, frequency, gaps / over-posting |

---

## APIs

| Endpoint | Purpose |
|----------|---------|
| `POST /api/campaigns/[id]/recommendations` | Generate on-demand, stage-aware recommendations |
| `POST /api/campaigns/[id]/merge-recommendations` | Merge agreed refinements into weekly plans |

---

## AI Chat Integration

- **Context:** `campaign-recommendations`
- **Input:** Generated recommendations pre-loaded as `initialRecommendations`
- **Behavior:** Vet, refine, answer questions; output refined payload when user agrees
- **Merge trigger:** User action (e.g. "Apply to Campaign") with agreed payload

---

## Data Shapes (draft)

### Generated recommendations
```json
{
  "stage": "twelve_week_plan",
  "content_improvements": {
    "topics": [...],
    "objectives": [...],
    "goals": [...]
  },
  "scheduling": { "best_times": [...], "suggested_cadence": {...} },
  "platform_content_matrix": {
    "linkedin": { "post": 3, "article": 1, "video": 1 },
    "instagram": { "reel": 2, "story": 5, "carousel": 1 }
  }
}
```

### Merge payload (agreed refinements)
- Subset of generated fields the user agreed to
- Week-level granularity where applicable
- Written into blueprint / refinements only for affected weeks

---

## Table: campaign_recommendation_weeks

Stores recommendations **per week**, aligned with weekly plans. Enables:
- **Append per week** — user agrees on Week 3 only → apply that row
- **Append combined weeks** — user agrees on Weeks 1–4 → apply those rows
- **Session grouping** — one consultation run = one `session_id`

| Column | Purpose |
|--------|---------|
| campaign_id, week_number | Align with twelve_week_plan.weeks / weekly_content_refinements |
| session_id | Groups recommendations from one generate + chat session |
| status | `pending` (vetting), `agreed` (user confirmed), `applied` (merged) |
| topics_to_cover, primary_objective, summary, objectives, goals | Content improvements |
| suggested_days_to_post, suggested_best_times, suggested_cadence | Scheduling |
| platform_allocation, platform_content_breakdown, content_type_mix | Platform × content matrix |
| agreed_at, applied_at | Timestamps for merge tracking |

**Merge flow:**
1. Generate → insert rows with `status=pending`
2. User vets via chat → update rows (refinements)
3. User agrees (per week or combined) → set `status=agreed`, `agreed_at=NOW()`
4. Apply → merge into twelve_week_plan.weeks / weekly_content_refinements; set `status=applied`, `applied_at=NOW()`
