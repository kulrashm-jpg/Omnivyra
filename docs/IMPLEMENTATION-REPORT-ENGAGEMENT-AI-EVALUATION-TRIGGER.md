# IMPLEMENTATION REPORT — ENGAGEMENT → AI EVALUATION TRIGGER

## 1. Files Modified

- **Created:** `backend/services/engagementEvaluationService.ts`
- **Modified:** `backend/services/engagementIngestionService.ts`

## 2. New Service Overview

**engagementEvaluationService** triggers Community AI evaluation when engagement (comments) exists for a scheduled post.

- **evaluatePostEngagement(scheduled_post_id):** Loads scheduled_post and comments from `post_comments`; skips if comments count = 0 (safety guard). Derives tenant/org from campaign via `getLatestCampaignVersionByCampaignId(post.campaign_id)` → `company_id` (used as both `tenant_id` and `organization_id` per existing Community AI pattern). Resolves `brand_voice` via `getProfile(organizationId)`. Builds input: `platform`, `post_data` (from scheduled_post), `engagement_activity` (comments), `engagement_metrics` (`total_comments`, `recent_comments`). Calls **communityAiOmnivyraService.evaluateEngagement()**. For each item in returned `suggested_actions`, runs best-effort dedupe (platform + target_id + action_type + suggested_text) and, if not existing, inserts into **community_ai_actions** with `status: 'pending'`. Light logging: `[EngagementEvaluation] scheduled_post_id=... comments=...` and `[EngagementEvaluation] actions_created=...`. No execution, no auto-approve, no queue or schema changes.

## 3. Data Flow After Change

```text
Engagement ingestion (ingestComments)
  → persistComments (post_comments)
  → if ingested > 0: dynamic import engagementEvaluationService.evaluatePostEngagement(scheduled_post_id)
       → getScheduledPost, getCommentsForScheduledPost
       → if comments.length === 0: return (skip)
       → resolveTenantOrg (campaign_versions.company_id)
       → resolveBrandVoice (getProfile)
       → evaluateEngagement(input)  [communityAiOmnivyraService]
       → for each suggested_action: actionExists(...) then insert if !exists
       → log actions_created
  → return ingest result
```

So: **Engagement ingested → (if new comments) → Community AI evaluation runs → suggested_actions persisted as pending in community_ai_actions.**

## 4. Action Deduplication Strategy

- **Key:** `platform` + `target_id` + `action_type` + `suggested_text` (best-effort, no schema change).
- **Check:** Before insert, query **community_ai_actions** for same `tenant_id`, `organization_id`, `platform`, `target_id`, `action_type`, and (when provided) `suggested_text`. If any row exists, skip insert.
- **Result:** Re-ingestion or re-evaluation does not create duplicate rows for the same action; multiple different suggested texts for the same target+type can coexist.

## 5. Safety Guarantees

- **No execution:** Only inserts with `status: 'pending'`. Action executor is not called and not modified.
- **No auto-approve:** `requires_human_approval: true`, `requires_approval: true` on inserted rows.
- **Skip when no comments:** If `comments.length === 0`, evaluation is skipped and returns `{ success: true, actionsCreated: 0 }`.
- **Tenant/org required:** If campaign has no campaign_version or company_id, evaluation returns error and does not call AI.
- **No queue or schema changes:** Scheduler and DB schema unchanged.
- **No new scoring/automation:** Only wiring to existing evaluateEngagement and existing table.

## 6. Verification Notes

- **Ingest → evaluation:** When `ingestComments` ingests at least one new comment, it calls `evaluatePostEngagement(scheduled_post_id)` after persist. Evaluation runs only when `ingested > 0`.
- **Suggested actions in DB:** New pending rows appear in **community_ai_actions** with `tenant_id`, `organization_id`, `platform`, `action_type`, `target_id`, `suggested_text`, `status: 'pending'`.
- **Re-ingestion:** Re-running ingest for the same post may call evaluation again; dedupe by (platform, target_id, action_type, suggested_text) prevents duplicate actions for the same suggestion.
