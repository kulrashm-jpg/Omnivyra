# IMPLEMENTATION REPORT — STRATEGIC FEEDBACK LOOP FOUNDATION

## 1. Files Modified

- **Created:** `backend/services/strategicFeedbackService.ts`
- **Created:** `pages/api/community-ai/strategic-feedback.ts`
- **Created:** `docs/IMPLEMENTATION-REPORT-STRATEGIC-FEEDBACK-LOOP-FOUNDATION.md`

## 2. Strategic Metrics Computed

- **Engagement:** `total_posts_published`, `total_comments`, `avg_comments_per_post` (from `scheduled_posts` with `status = 'published'` and `post_comments` linked by `scheduled_post_id`).
- **Action signals:** Counts by `action_type`: `reply`, `like`, `share`, `follow` (from `community_ai_actions` scoped by campaign’s company and by `target_id` in the set of `platform_post_id` / `platform_comment_id` for that campaign’s posts and comments).
- **Comment signals (sentiment-like heuristic):**  
  - Negative: count of comments containing any of “problem”, “bad”, “issue”, “not working”.  
  - Question: count of comments containing `?`.  
  - Long engagement: count of comments with length > 120.  
  - `total_with_signals`: count of comments that have at least one of the above.

## 3. Insight Rules Applied

Deterministic rules producing short insight strings (no AI):

- **Low engagement:** `avg_comments_per_post < 1` and at least one published post → “Low engagement per post — consider adjusting content hook or format.”
- **Explanatory content:** Question signals ≥ 30% of all comments → “High question volume detected — consider more explanatory content.”
- **Messaging risk:** Negative signals ≥ 20% of all comments → “High negative feedback detected — review messaging or product clarity.”
- **Conversational momentum:** Reply actions ≥ 50% of all actions → “Strong conversational engagement — prioritize reply-driven content.”

## 4. Storage Strategy

- **No new table.** Uses existing **`activity_feed`**.
- One row per generation: `action_type = 'strategic_feedback_generated'`, `entity_type = 'campaign'`, `entity_id = campaign_id`, `campaign_id` set, `metadata` = `{ insights, metrics_summary, generated_at }`.
- `user_id` is required: set to campaign owner (`campaigns.user_id`) when available; otherwise fallback to a system/user row for the tenant.

## 5. Data Flow After Change

```text
GET /api/community-ai/strategic-feedback?campaign_id=<id>
  → requireCampaignAccess(req, res, campaign_id)
  → getLatestStrategicFeedback(campaign_id)
  → if no feedback or no recent feedback (within 24h): generateStrategicFeedback(campaign_id)
       → loadCampaignEngagementData(campaign_id)
            → campaigns (user_id), scheduled_posts (published), post_comments, community_ai_actions (by company + target_id)
       → compute metrics + comment_signals
       → generateInsights(metrics, comment_signals)
       → storeStrategicFeedback(campaign_id, campaignUserId, payload)  → activity_feed insert
       → return payload
  → response: { success: true, feedback: { insights, metrics, generated_at } }
```

## 6. Safety Guarantees

- **No weekly planner mutation:** No writes to weekly plans, refinements, or blueprint.
- **No campaign updates:** No changes to `campaigns` or `campaign_versions`.
- **No AI generation:** All insights are from deterministic rules; no AI/LLM calls.
- **No automation:** Generation is only triggered by the GET endpoint when there is no recent feedback.
- **Deterministic only:** Same inputs always produce the same metrics and insight set.
- **Scoped access:** Campaign access enforced via `requireCampaignAccess` (company resolved from DB, user must have campaign/company access).

## 7. Verification Notes

- **Engagement data → insights:** Service reads only `scheduled_posts`, `post_comments`, and `community_ai_actions`; computes metrics and applies the four insight rules above.
- **Storage:** Each generation inserts one `activity_feed` row with `strategic_feedback_generated` and metadata; retrieval uses the same table filtered by `campaign_id`, `action_type`, `entity_type`, `entity_id`, ordered by `created_at` desc, limit 1.
- **Retrieval:** `getLatestStrategicFeedback(campaign_id)` returns the latest stored payload; the API returns that payload (or a newly generated one when none exists recently) in the shape `{ success: true, feedback: { insights, metrics, generated_at } }`.
