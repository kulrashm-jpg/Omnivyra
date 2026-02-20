# Create Campaign: Topic Cards & Blueprint Flow — Audit

## Desired Flow (per user)

1. **Pre-planning** — duration, capacity (existing)
2. **Accept duration** → Show **recommended topic/theme cards** (like Trend)
3. **User picks** which topics to use for the blueprint
4. **Answer questions** to create content blueprint (guided form, like pre-planning)
5. **Without refinement** — structured output from answers, not AI interpretation

---

## What Already Exists

### 1. Topic / Theme Generation
| Piece | Location | Status |
|-------|----------|--------|
| `suggest-themes` API | `pages/api/campaigns/[id]/suggest-themes.ts` | ✅ **Exists** — uses `generateTrendOpportunities` with campaign context (name, description, types, planning context, company profile). Returns `{ themes: [{ id, title, summary, payload }] }` |
| `getRecommendedTopicsForCompany` | `recommendationEngineService.ts` | ✅ **Exists** — fetches topic strings from `recommendation_snapshots` (past Trend campaigns). Used silently in `regenerate-blueprint` |

### 2. Trend Card UI (reference)
| Piece | Location | Status |
|-------|----------|--------|
| ThemeCard | `TrendCampaignsTab.tsx` | ✅ — Selectable cards, "Build Campaign Blueprint" button |
| useOpportunities | `useOpportunities.ts` | ✅ — Fetches from `/api/opportunities?type=TREND`. Different source than suggest-themes |
| onPromote | Trend flow | Creates campaign from picked recommendation → redirects to campaign-details |

### 3. Current Create Campaign → campaign-details Flow
| Step | Status |
|------|--------|
| Create campaign (form) | ✅ |
| Pre-planning (form or AI) | ✅ |
| Accept duration | ✅ — calls `update-duration` |
| **Immediate** `regenerate-blueprint` | ✅ — AI generates full plan in one shot. `recommended_topics` and `strategic_themes` are fetched and passed to AI **silently** (user never sees or picks) |

### 4. regenerate-blueprint
- Accepts `planningContext` (can include `recommended_topics`, `strategic_themes`)
- If not provided, fetches from company/recommendation_snapshots
- Passes to AI as prompt hints

---

## What Is Missing

### Gap 1: Topic/Theme Card Step (Post Pre-planning)
- **suggest-themes** exists but is **never called** from campaign-details
- No UI to show theme cards after "Accept duration"
- No user selection before blueprint generation

**Needed:**
- After `acceptDuration` succeeds, **before** calling `regenerate-blueprint`:
  - Call `POST /api/campaigns/[id]/suggest-themes` with `companyId`
  - Render selectable theme cards (similar to Trend `ThemeCard`, but lighter — pick for blueprint, not promote)
  - Store selected theme titles/IDs
  - Pass `strategic_themes` or `recommended_topics` (user-picked) to `regenerate-blueprint`

### Gap 2: Guided Q&A for Blueprint
- Current: AI generates plan in one shot from prompt hints
- Desired: "Answer all the questions to create content blueprint" — like pre-planning form
- "Without refinement" = structured form → blueprint, not AI creative generation

**Options:**
- **A) Form-to-blueprint** — Build a multi-step form (platforms, content mix per week, themes per week) and a deterministic builder that creates the 12-week plan without AI.
- **B) Strict prefilled** — Use AI but pass form answers as strict `collectedPlanningContext` so AI only structures, does not "refine". Current `preplanning_form_completed` already skips re-asking; extend with more fields.

**Clarification needed:** Does "answer questions" mean:
- A manual form (platforms, themes per week, content types) that deterministically produces the blueprint?
- Or the existing AI chat Q&A (ask target_audience, platforms, etc.) but without a separate "refinement" pass?

### Gap 3: Flow Wiring
- `acceptDuration` today: update-duration → **immediately** regenerate-blueprint
- Desired: update-duration → **show topic cards** → user picks → **then** form or blueprint step

---

## Summary: Implementation Scope

| Task | Complexity | Notes |
|------|------------|-------|
| 1. Insert topic-card step after Accept | Medium | Use suggest-themes, render cards, store selection |
| 2. Pass selected themes to regenerate-blueprint | Low | Extend planningContext with user-picked themes |
| 3. Guided Q&A / form for blueprint | High | Depends on A vs B above. Either new form + builder, or extend AI flow |

**Recommendation:** Implement 1 + 2 first (topic cards + pass to blueprint). This aligns Create Campaign with the Trend flow (pick themes → create blueprint). For 3, the existing AI in `regenerate-blueprint` already uses `preplanning_form_completed` and `collectedPlanningContext` — extending the pre-planning form with more blueprint-relevant fields (platforms, themes per week) and passing them could satisfy "answer questions" without a full custom form-to-blueprint builder.
